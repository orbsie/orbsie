import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import sharp from "sharp";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { TGALoader } from "three/addons/loaders/TGALoader.js";

const inspectionPath =
  process.env.MUSHROOM_INSPECTION_PATH ??
  "docs/evidence/mushroom-basic-inspection/report.json";
const evidenceDirectory =
  process.env.MUSHROOM_TEXTURED_EVIDENCE_DIRECTORY ??
  "docs/evidence/mushroom-basic-textured-conversion";
const selectedFbxArchivePath =
  process.env.MUSHROOM_FBX_ARCHIVE_PATH ?? "Meshes/Fly_Agaric_Basic.fbx";
const outputPath = join(evidenceDirectory, "prototype.glb");
const outputReportPath = join(evidenceDirectory, "report.json");
const outputAtlasPath = join(evidenceDirectory, "atlas.png");
const outputLicensePath = join(evidenceDirectory, "License.txt");
const ATLAS_SIZE = 512;
const MAX_VERTICES = 30_000;
const MAX_BYTES = 2 * 1024 * 1024;
const require = createRequire(import.meta.url);
let evidenceCreated = false;

function installedSharpVersion() {
  const packagePath = join(dirname(dirname(require.resolve("sharp"))), "package.json");
  return JSON.parse(require("node:fs").readFileSync(packagePath, "utf8")).version;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function asArrayBuffer(bytes) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}

function finiteArray(values) {
  return Array.from(values).every(Number.isFinite);
}

function collectUris(value, result = []) {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const item of value) collectUris(item, result);
    return result;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "uri" && typeof child === "string") result.push(child);
    else collectUris(child, result);
  }
  return result;
}

function glbParts(bytes) {
  const view = new DataView(asArrayBuffer(bytes));
  if (view.getUint32(0, true) !== 0x46546c67)
    throw new Error("Output is not a GLB file.");
  if (view.getUint32(4, true) !== 2)
    throw new Error("Output GLB version is not 2.");
  const jsonChunks = [];
  let binChunk;
  let offset = 12;
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) jsonChunks.push(chunk);
    if (type === 0x004e4942) binChunk = chunk;
    offset += 8 + length;
  }
  if (jsonChunks.length !== 1 || !binChunk)
    throw new Error("Output GLB must contain exactly one JSON and one BIN chunk.");
  return {
    json: JSON.parse(new TextDecoder().decode(jsonChunks[0]).trim()),
    bin: binChunk,
  };
}

function accessorValues(gltf, bin, accessorIndex) {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor || accessor.componentType !== 5126)
    throw new Error(`Accessor ${accessorIndex} is not a float accessor.`);
  const componentCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[
    accessor.type
  ];
  if (!componentCount) throw new Error(`Unsupported accessor type: ${accessor.type}`);
  const bufferView = gltf.bufferViews?.[accessor.bufferView];
  if (!bufferView) throw new Error(`Accessor ${accessorIndex} has no bufferView.`);
  const stride = bufferView.byteStride ?? componentCount * 4;
  if (stride < componentCount * 4)
    throw new Error(`Accessor ${accessorIndex} has an invalid byte stride.`);
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const end = start + (accessor.count - 1) * stride + componentCount * 4;
  if (start < 0 || end > bin.byteLength)
    throw new Error(`Accessor ${accessorIndex} exceeds the BIN chunk.`);
  const values = new Float32Array(accessor.count * componentCount);
  const dataView = new DataView(
    bin.buffer,
    bin.byteOffset,
    bin.byteLength,
  );
  for (let index = 0; index < accessor.count; index++) {
    const sourceOffset = start + index * stride;
    for (let component = 0; component < componentCount; component++)
      values[index * componentCount + component] = dataView.getFloat32(
        sourceOffset + component * 4,
        true,
      );
  }
  return { values, componentCount, count: accessor.count };
}

function indexValues(gltf, bin, accessorIndex) {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor || accessor.type !== "SCALAR")
    throw new Error(`Index accessor ${accessorIndex} is invalid.`);
  const componentBytes = {
    5121: 1,
    5123: 2,
    5125: 4,
  }[accessor.componentType];
  if (!componentBytes) throw new Error("Index accessor component type is invalid.");
  const bufferView = gltf.bufferViews?.[accessor.bufferView];
  if (!bufferView) throw new Error(`Index accessor ${accessorIndex} has no bufferView.`);
  const stride = bufferView.byteStride ?? componentBytes;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const end = start + (accessor.count - 1) * stride + componentBytes;
  if (start < 0 || end > bin.byteLength)
    throw new Error(`Index accessor ${accessorIndex} exceeds the BIN chunk.`);
  const dataView = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const values = new Uint32Array(accessor.count);
  for (let index = 0; index < accessor.count; index++) {
    const sourceOffset = start + index * stride;
    values[index] =
      accessor.componentType === 5121
        ? dataView.getUint8(sourceOffset)
        : accessor.componentType === 5123
          ? dataView.getUint16(sourceOffset, true)
          : dataView.getUint32(sourceOffset, true);
  }
  return values;
}

function validateGeometry(gltf, bin) {
  if (!Array.isArray(gltf.meshes) || gltf.meshes.length !== 1)
    throw new Error("Textured GLB must contain exactly one mesh.");
  const primitives = gltf.meshes[0].primitives;
  if (!Array.isArray(primitives) || primitives.length !== 1)
    throw new Error("Textured GLB must contain exactly one primitive.");
  const primitive = primitives[0];
  const attributes = primitive.attributes ?? {};
  for (const required of ["POSITION", "NORMAL", "TEXCOORD_0"])
    if (!Number.isInteger(attributes[required]))
      throw new Error(`Textured GLB is missing ${required}.`);
  const positions = accessorValues(gltf, bin, attributes.POSITION);
  const normals = accessorValues(gltf, bin, attributes.NORMAL);
  const uvs = accessorValues(gltf, bin, attributes.TEXCOORD_0);
  if (positions.count !== normals.count || positions.count !== uvs.count)
    throw new Error("Textured GLB geometry attribute counts do not match.");
  const indices = primitive.indices === undefined
    ? Uint32Array.from({ length: positions.count }, (_, index) => index)
    : indexValues(gltf, bin, primitive.indices);
  if (indices.length % 3 !== 0)
    throw new Error("Textured GLB index count is not divisible by three.");
  if (!finiteArray(positions.values) || !finiteArray(normals.values) || !finiteArray(uvs.values))
    throw new Error("Textured GLB geometry attributes are not finite.");
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.count; index++) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions.values[index * 3 + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  let minNormalLength = Infinity;
  let maxNormalLength = -Infinity;
  for (let index = 0; index < normals.count; index++) {
    const x = normals.values[index * 3];
    const y = normals.values[index * 3 + 1];
    const z = normals.values[index * 3 + 2];
    const length = Math.hypot(x, y, z);
    minNormalLength = Math.min(minNormalLength, length);
    maxNormalLength = Math.max(maxNormalLength, length);
  }
  let invertedWindingCount = 0;
  let minWindingDot = Infinity;
  let maxWindingDot = -Infinity;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const [a, b, c] = [indices[offset], indices[offset + 1], indices[offset + 2]];
    if ([a, b, c].some((index) => index >= positions.count))
      throw new Error("Textured GLB index exceeds POSITION count.");
    const ax = positions.values[a * 3];
    const ay = positions.values[a * 3 + 1];
    const az = positions.values[a * 3 + 2];
    const ab = [
      positions.values[b * 3] - ax,
      positions.values[b * 3 + 1] - ay,
      positions.values[b * 3 + 2] - az,
    ];
    const ac = [
      positions.values[c * 3] - ax,
      positions.values[c * 3 + 1] - ay,
      positions.values[c * 3 + 2] - az,
    ];
    const face = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const faceLength = Math.hypot(...face);
    if (faceLength === 0) throw new Error("Textured GLB contains a zero-area triangle.");
    const normal = [0, 1, 2].reduce(
      (sum, axis) =>
        sum +
        (normals.values[a * 3 + axis] +
          normals.values[b * 3 + axis] +
          normals.values[c * 3 + axis]) /
          3 *
          face[axis],
      0,
    );
    const windingDot = normal / faceLength;
    minWindingDot = Math.min(minWindingDot, windingDot);
    maxWindingDot = Math.max(maxWindingDot, windingDot);
    if (windingDot < 0) invertedWindingCount++;
  }
  const height = max[1] - min[1];
  if (Math.abs(min[1]) > 1e-6 || Math.abs(height - 1) > 1e-5)
    throw new Error(`Textured GLB bounds are not normalized: minY=${min[1]}, height=${height}`);
  return {
    vertices: positions.count,
    triangles: indices.length / 3,
    attributes: Object.keys(attributes),
    bounds: {
      min,
      max,
      size: max.map((value, axis) => value - min[axis]),
    },
    normals: {
      minLength: minNormalLength,
      maxLength: maxNormalLength,
    },
    winding: {
      minFaceNormalDotInterpolatedNormal: minWindingDot,
      maxFaceNormalDotInterpolatedNormal: maxWindingDot,
      invertedWindingCount,
    },
  };
}

function createPngCanvasSupport() {
  class NodeImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  class NodeCanvasContext {
    constructor(canvas) {
      this.canvas = canvas;
      this.flipY = false;
    }
    translate() {}
    scale(_x, y) {
      this.flipY = y < 0;
    }
    putImageData(imageData) {
      const source = imageData.data;
      const rowBytes = imageData.width * 4;
      const output = new Uint8ClampedArray(source);
      if (this.flipY) {
        const flipped = new Uint8ClampedArray(output.length);
        for (let row = 0; row < imageData.height; row++) {
          const sourceOffset = row * rowBytes;
          const targetOffset = (imageData.height - row - 1) * rowBytes;
          flipped.set(output.subarray(sourceOffset, sourceOffset + rowBytes), targetOffset);
        }
        this.canvas.data = flipped;
      } else {
        this.canvas.data = output;
      }
    }
  }
  class NodeOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
      this.context = new NodeCanvasContext(this);
    }
    getContext(type) {
      if (type !== "2d") throw new Error(`Unsupported canvas context: ${type}`);
      return this.context;
    }
    async convertToBlob({ type = "image/png" } = {}) {
      if (type !== "image/png") throw new Error(`Unsupported image type: ${type}`);
      const bytes = await sharp(Buffer.from(this.data), {
        raw: { width: this.width, height: this.height, channels: 4 },
      })
        .png()
        .toBuffer();
      return new Blob([bytes], { type });
    }
  }
  globalThis.ImageData = NodeImageData;
  globalThis.OffscreenCanvas = NodeOffscreenCanvas;
}

class NodeFileReader {
  constructor() {
    this.result = null;
    this.error = null;
    this.onloadend = null;
    this.onerror = null;
  }
  async readAsArrayBuffer(blob) {
    try {
      this.result = await blob.arrayBuffer();
      this.onloadend?.({ target: this });
    } catch (error) {
      this.error = error;
      this.onerror?.({ target: this });
    }
  }
}

function copyTextureTransform(source, target) {
  target.flipY = source.flipY;
  target.wrapS = source.wrapS;
  target.wrapT = source.wrapT;
  target.magFilter = source.magFilter;
  target.minFilter = source.minFilter;
  target.offset.copy(source.offset);
  target.repeat.copy(source.repeat);
  target.center.copy(source.center);
  target.rotation = source.rotation;
  target.channel = source.channel;
  target.updateMatrix();
}

async function main() {
  await mkdir(dirname(evidenceDirectory), { recursive: true });
  await mkdir(evidenceDirectory);
  evidenceCreated = true;
  const inspection = JSON.parse(await readFile(inspectionPath, "utf8"));
  const fbxEntry = inspection.selectedFiles.find(
    (entry) => entry.archivePath === selectedFbxArchivePath,
  );
  const tgaEntry = inspection.selectedFiles.find(
    (entry) => entry.archivePath === "Textures/Mushrooms_C.tga",
  );
  if (!fbxEntry || !tgaEntry)
    throw new Error("Inspection report does not contain the selected Basic FBX/TGA inputs.");
  const [fbxBytes, tgaBytes, licenseText] = await Promise.all([
    readFile(fbxEntry.path),
    readFile(tgaEntry.path),
    readFile(inspection.license.sourcePath, "utf8"),
  ]);
  const fbxSha256 = sha256(fbxBytes);
  const tgaSha256 = sha256(tgaBytes);
  const licenseSha256 = sha256(Buffer.from(licenseText));
  if (fbxSha256 !== fbxEntry.sha256)
    throw new Error(`FBX SHA-256 mismatch: ${fbxSha256}`);
  if (tgaSha256 !== tgaEntry.sha256)
    throw new Error(`TGA SHA-256 mismatch: ${tgaSha256}`);
  if (licenseSha256 !== inspection.license.licenseSha256)
    throw new Error(`License SHA-256 mismatch: ${licenseSha256}`);
  await writeFile(outputLicensePath, licenseText);

  const tgaData = new TGALoader().parse(asArrayBuffer(tgaBytes));
  const resized = await sharp(Buffer.from(tgaData.data), {
    raw: { width: tgaData.width, height: tgaData.height, channels: 4 },
  })
    .resize(ATLAS_SIZE, ATLAS_SIZE, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const atlasPng = await sharp(resized.data, {
    raw: { width: resized.info.width, height: resized.info.height, channels: 4 },
  })
    .png()
    .toBuffer();
  await writeFile(outputAtlasPath, atlasPng);

  const sourceTexture = new THREE.DataTexture(
    tgaData.data,
    tgaData.width,
    tgaData.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  sourceTexture.flipY = tgaData.flipY ?? false;
  sourceTexture.colorSpace = THREE.SRGBColorSpace;
  sourceTexture.needsUpdate = true;
  const textureHandler = {
    path: "",
    setPath(path) {
      this.path = path;
      return this;
    },
    load(url, onLoad) {
      const basename = String(url).replaceAll("\\", "/").split("/").at(-1);
      if (basename !== "Mushrooms_C.tga")
        throw new Error(`Unexpected TGA request: ${url}`);
      onLoad?.(sourceTexture);
      return sourceTexture;
    },
  };
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.tga$/i, textureHandler);
  manager.setURLModifier((url) => {
    throw new Error(`Unexpected external resource request: ${url}`);
  });
  const sourceScene = new FBXLoader(manager).parse(
    asArrayBuffer(fbxBytes),
    `${dirname(fbxEntry.path)}/`,
  );
  sourceScene.updateMatrixWorld(true);
  const meshes = [];
  sourceScene.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });
  if (meshes.length !== 1) throw new Error(`Expected one FBX mesh, got ${meshes.length}.`);
  const sourceMesh = meshes[0];
  const sourceMaterial = Array.isArray(sourceMesh.material)
    ? sourceMesh.material[0]
    : sourceMesh.material;
  if (!sourceMaterial?.map || sourceMaterial.map !== sourceTexture)
    throw new Error("Selected FBX material does not use the prepared TGA map.");
  const sourceBounds = new THREE.Box3().setFromObject(sourceScene);
  const sourceHeight = sourceBounds.max.y - sourceBounds.min.y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0)
    throw new Error(`Source height is invalid: ${sourceHeight}`);
  const centerX = (sourceBounds.min.x + sourceBounds.max.x) / 2;
  const centerZ = (sourceBounds.min.z + sourceBounds.max.z) / 2;
  const sourceToOutputScale = 1 / sourceHeight;
  const normalizedGeometry = sourceMesh.geometry.clone();
  normalizedGeometry.applyMatrix4(sourceMesh.matrixWorld);
  normalizedGeometry.applyMatrix4(
    new THREE.Matrix4()
      .makeTranslation(
        -centerX * sourceToOutputScale,
        -sourceBounds.min.y * sourceToOutputScale,
        -centerZ * sourceToOutputScale,
      )
      .multiply(
        new THREE.Matrix4().makeScale(
          sourceToOutputScale,
          sourceToOutputScale,
          sourceToOutputScale,
        ),
      ),
  );
  const atlasTexture = new THREE.DataTexture(
    new Uint8Array(resized.data),
    resized.info.width,
    resized.info.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  copyTextureTransform(sourceTexture, atlasTexture);
  // The source DataTexture defaults to nearest filtering in this offline loader.
  // Set the atlas sampling explicitly so the GLB does not inherit that aliasing.
  atlasTexture.magFilter = THREE.LinearFilter;
  atlasTexture.minFilter = THREE.LinearMipmapLinearFilter;
  atlasTexture.generateMipmaps = true;
  atlasTexture.colorSpace = THREE.SRGBColorSpace;
  atlasTexture.needsUpdate = true;
  const outputMaterial = sourceMaterial.clone();
  outputMaterial.map = atlasTexture;
  outputMaterial.needsUpdate = true;
  outputMaterial.name = "Mushooms_MAT_embedded_512_png";
  const outputMesh = new THREE.Mesh(normalizedGeometry, outputMaterial);
  outputMesh.name = "Fly_Agaric_Basic_textured_512";
  const outputScene = new THREE.Scene();
  outputScene.name = "Fly_Agaric_Basic_textured_scene";
  outputScene.add(outputMesh);

  createPngCanvasSupport();
  if (typeof FileReader === "undefined") globalThis.FileReader = NodeFileReader;
  const glb = await new GLTFExporter().parseAsync(outputScene, {
    binary: true,
    onlyVisible: true,
    maxTextureSize: ATLAS_SIZE,
  });
  const glbBytes = new Uint8Array(glb);
  await writeFile(outputPath, glbBytes);
  if (glbBytes.byteLength >= MAX_BYTES)
    throw new Error(`GLB byte cap exceeded: ${glbBytes.byteLength}`);
  const { json, bin } = glbParts(glbBytes);
  const uris = collectUris(json);
  if (uris.length) throw new Error(`Textured GLB contains external URIs: ${uris.join(",")}`);
  if (!Array.isArray(json.images) || json.images.length !== 1)
    throw new Error("Textured GLB must contain exactly one embedded image.");
  const image = json.images[0];
  if (image.mimeType !== "image/png" || !Number.isInteger(image.bufferView) || image.uri !== undefined)
    throw new Error("Textured GLB image is not an embedded PNG bufferView.");
  const imageView = json.bufferViews?.[image.bufferView];
  if (!imageView) throw new Error("Embedded PNG bufferView is missing.");
  const imageStart = imageView.byteOffset ?? 0;
  const imageEnd = imageStart + imageView.byteLength;
  if (imageStart < 0 || imageEnd > bin.byteLength)
    throw new Error("Embedded PNG bufferView exceeds the BIN chunk.");
  const embeddedPng = bin.subarray(imageStart, imageEnd);
  const imageMetadata = await sharp(embeddedPng).metadata();
  if (imageMetadata.format !== "png" || imageMetadata.width !== ATLAS_SIZE || imageMetadata.height !== ATLAS_SIZE)
    throw new Error("Embedded image is not a 512x512 PNG.");
  const baseColorTexture = json.materials?.[0]?.pbrMetallicRoughness?.baseColorTexture;
  if (!baseColorTexture || baseColorTexture.index !== 0)
    throw new Error("Textured GLB material does not reference the embedded base-color texture.");
  const textureDefinition = json.textures?.[baseColorTexture.index];
  const sampler = Number.isInteger(textureDefinition?.sampler)
    ? json.samplers?.[textureDefinition.sampler]
    : undefined;
  if (sampler?.magFilter !== 9729 || sampler?.minFilter !== 9987)
    throw new Error("Textured GLB atlas sampler is not explicit linear/trilinear filtering.");
  const geometry = validateGeometry(json, bin);
  if (geometry.vertices > MAX_VERTICES)
    throw new Error(`Vertex cap exceeded: ${geometry.vertices}`);
  const report = {
    status: "prototype-generated",
    scope: "offline embedded-texture derivative; no runtime integration or catalog admission",
    sourceInspection: inspectionPath,
    license: {
      spdx: inspection.license.license,
      creator: inspection.license.creator,
      url: inspection.license.licenseUrl,
      sourceTextPath: inspection.license.sourcePath,
      sourceTextSha256: licenseSha256,
      preservedTextPath: outputLicensePath,
    },
    inputs: {
      fbx: { path: fbxEntry.path, sha256: fbxSha256, bytes: fbxBytes.byteLength },
      tga: { path: tgaEntry.path, sha256: tgaSha256, bytes: tgaBytes.byteLength },
    },
    texture: {
      atlasPath: outputAtlasPath,
      atlasSha256: sha256(atlasPng),
      sourceWidth: tgaData.width,
      sourceHeight: tgaData.height,
      atlasWidth: ATLAS_SIZE,
      atlasHeight: ATLAS_SIZE,
      format: "PNG",
      embeddedMimeType: image.mimeType,
      embeddedBufferView: image.bufferView,
      embeddedBytes: embeddedPng.byteLength,
      colorSpace: "sRGB",
      sampling: "source UVs retained; atlas resized from original TGA with Lanczos3",
      sampler: {
        magFilter: atlasTexture.magFilter,
        minFilter: atlasTexture.minFilter,
        generateMipmaps: atlasTexture.generateMipmaps,
        gltfMagFilter: sampler.magFilter,
        gltfMinFilter: sampler.minFilter,
      },
      encoder: {
        package: "sharp",
        version: installedSharpVersion(),
        role: "transitive build-time PNG encoder; no new dependency added",
      },
    },
    material: {
      name: outputMaterial.name,
      baseColor: sourceMaterial.color?.toArray() ?? [1, 1, 1],
      baseColorTextureIndex: baseColorTexture.index,
      mapPreserved: true,
    },
    normalization: {
      sourceBounds: {
        min: sourceBounds.min.toArray(),
        max: sourceBounds.max.toArray(),
        size: sourceBounds.getSize(new THREE.Vector3()).toArray(),
      },
      sourceMatrixWorld: sourceMesh.matrixWorld.toArray(),
      applied: "source matrixWorld, then center X/Z, subtract source min Y, scale total height to 1 meter",
      sourceToOutputScale,
      outputUnits: "meters",
      outputBaseY: 0,
      outputHeight: 1,
    },
    output: {
      path: outputPath,
      bytes: glbBytes.byteLength,
      sha256: sha256(glbBytes),
      selfContained: true,
      hasImages: true,
      hasExternalUris: uris.length > 0,
      images: json.images,
      meshes: [
        {
          name: outputMesh.name,
          vertices: geometry.vertices,
          triangles: geometry.triangles,
          attributes: geometry.attributes,
          hasMap: true,
        },
      ],
      bounds: geometry.bounds,
    },
    structural: geometry,
    checks: {
      finiteGeometry: true,
      vertexLimit: `${geometry.vertices} <= ${MAX_VERTICES}`,
      byteLimit: `${glbBytes.byteLength} < ${MAX_BYTES}`,
      baseY: Math.abs(geometry.bounds.min[1]) <= 1e-6,
      oneMeterHeight: Math.abs(geometry.bounds.size[1] - 1) <= 1e-5,
      normalsFinite: true,
      uvFinite: true,
      noExternalUris: uris.length === 0,
      oneEmbeddedPng: true,
      embeddedBufferViewInRange: true,
      embeddedAtlas512: true,
      linearAtlasSampling: sampler.magFilter === 9729 && sampler.minFilter === 9987,
      windingNoInversions: geometry.winding.invertedWindingCount === 0,
    },
    appearance: {
      status: "unverified",
      note: "Front/rear isolated comparison is recorded by the companion textured preview evidence.",
    },
  };
  await writeFile(outputReportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  normalizedGeometry.dispose();
  outputMaterial.dispose();
  outputScene.traverse((object) => {
    if (object.isMesh) object.geometry.dispose();
  });
  sourceTexture.dispose();
  atlasTexture.dispose();
  sourceScene.traverse((object) => object.geometry?.dispose());
}

try {
  await main();
} catch (error) {
  const report = {
    status: "error",
    scope: "offline embedded-texture derivative; no runtime integration or catalog admission",
    sourceInspection: inspectionPath,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  };
  if (evidenceCreated)
    await writeFile(outputReportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}
