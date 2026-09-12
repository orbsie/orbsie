import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { TGALoader } from "three/addons/loaders/TGALoader.js";
import { transformedCatalogSourceBounds } from "./lib/catalog-source-bounds.mjs";

const inspectionPath =
  process.env.MUSHROOM_INSPECTION_PATH ??
  "docs/evidence/mushroom-candidate-inspection/report.json";
const evidenceDirectory =
  process.env.MUSHROOM_EVIDENCE_DIRECTORY ??
  "docs/evidence/mushroom-candidate-conversion";
const selectedFbxArchivePath = process.env.MUSHROOM_FBX_ARCHIVE_PATH;
const outputPath = join(evidenceDirectory, "prototype.glb");
const outputReportPath = join(evidenceDirectory, "report.json");
const outputLicensePath = join(evidenceDirectory, "License.txt");
const SUBDIVISION_LEVEL = 4;
const MAX_VERTICES = 30_000;
const MAX_BYTES = 2 * 1024 * 1024;

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

function wrappedIndex(index, size, wrapping) {
  if (wrapping === THREE.ClampToEdgeWrapping)
    return Math.max(0, Math.min(size - 1, index));
  if (wrapping === THREE.MirroredRepeatWrapping) {
    const period = size * 2;
    const wrapped = ((index % period) + period) % period;
    return wrapped < size ? wrapped : period - 1 - wrapped;
  }
  const wrapped = index % size;
  return wrapped < 0 ? wrapped + size : wrapped;
}

function srgbToLinear(value) {
  const srgb = value / 255;
  return srgb <= 0.04045
    ? srgb / 12.92
    : ((srgb + 0.055) / 1.055) ** 2.4;
}

function bilinearTextureSample(texture, uv) {
  const transformed = texture.transformUv(uv.clone());
  const { width, height, data } = texture.image;
  const x = transformed.x * width - 0.5;
  const y = transformed.y * height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const sample = (sampleX, sampleY) => {
    const wrappedX = wrappedIndex(sampleX, width, texture.wrapS);
    const wrappedY = wrappedIndex(sampleY, height, texture.wrapT);
    const offset = (wrappedY * width + wrappedX) * 4;
    return [
      srgbToLinear(data[offset]),
      srgbToLinear(data[offset + 1]),
      srgbToLinear(data[offset + 2]),
    ];
  };
  const topLeft = sample(x0, y0);
  const topRight = sample(x1, y0);
  const bottomLeft = sample(x0, y1);
  const bottomRight = sample(x1, y1);
  return topLeft.map((_, channel) => {
    const top = topLeft[channel] * (1 - tx) + topRight[channel] * tx;
    const bottom =
      bottomLeft[channel] * (1 - tx) + bottomRight[channel] * tx;
    return bottom * ty + top * (1 - ty);
  });
}

function interpolateVector(a, b, c, weights) {
  return a
    .clone()
    .multiplyScalar(weights[0])
    .addScaledVector(b, weights[1])
    .addScaledVector(c, weights[2]);
}

function glbJson(bytes) {
  const view = new DataView(asArrayBuffer(bytes));
  if (view.getUint32(0, true) !== 0x46546c67)
    throw new Error("Output is not a GLB file.");
  let offset = 12;
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (type === 0x4e4f534a) {
      const text = new TextDecoder().decode(
        bytes.subarray(offset + 8, offset + 8 + length),
      );
      return JSON.parse(text.trim());
    }
    offset += 8 + length;
  }
  throw new Error("GLB JSON chunk is missing.");
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

function disposeScene(scene) {
  scene.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [];
    for (const material of materials) material.dispose?.();
  });
}

function sourceTriangle(
  mesh,
  triangleOffset,
  position,
  normal,
  uv,
  index,
  normalMatrix,
) {
  const readIndex = (corner) =>
    index ? index.getX(triangleOffset * 3 + corner) : triangleOffset * 3 + corner;
  const vertices = [0, 1, 2].map((corner) => {
    const vertexIndex = readIndex(corner);
    const point = new THREE.Vector3().fromBufferAttribute(position, vertexIndex);
    point.applyMatrix4(mesh.matrixWorld);
    const vertexNormal = normal
      ? new THREE.Vector3().fromBufferAttribute(normal, vertexIndex)
      : new THREE.Vector3(0, 1, 0);
    vertexNormal.applyMatrix3(normalMatrix).normalize();
    const vertexUv = new THREE.Vector2().fromBufferAttribute(uv, vertexIndex);
    return { point, normal: vertexNormal, uv: vertexUv };
  });
  return vertices;
}

function addBakedTriangle(output, triangle, barycentric, texture, materialColor, normalization) {
  const point = interpolateVector(
    triangle[0].point,
    triangle[1].point,
    triangle[2].point,
    barycentric,
  )
    .sub(normalization.center)
    .multiplyScalar(normalization.scale);
  const normal = interpolateVector(
    triangle[0].normal,
    triangle[1].normal,
    triangle[2].normal,
    barycentric,
  ).normalize();
  const uv = interpolateVector(
    triangle[0].uv,
    triangle[1].uv,
    triangle[2].uv,
    barycentric,
  );
  const color = bilinearTextureSample(texture, uv).map(
    (channel, index) => channel * materialColor[index],
  );
  output.positions.push(point.x, point.y, point.z);
  output.normals.push(normal.x, normal.y, normal.z);
  output.colors.push(color[0], color[1], color[2]);
}

function bakeMesh(mesh, texture, material) {
  const position = mesh.geometry.getAttribute("position");
  const normal = mesh.geometry.getAttribute("normal");
  const uv = mesh.geometry.getAttribute("uv");
  if (!position || !uv)
    throw new Error("The selected mesh must contain positions and UVs.");
  const index = mesh.geometry.index;
  const triangleCount = (index?.count ?? position.count) / 3;
  if (!Number.isInteger(triangleCount))
    throw new Error(`Mesh triangle count is not integral: ${triangleCount}`);
  const materialColor = material.color
    ? [material.color.r, material.color.g, material.color.b]
    : [1, 1, 1];
  const sourceBounds = new THREE.Box3();
  const triangles = [];
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  for (let triangleOffset = 0; triangleOffset < triangleCount; triangleOffset++) {
    const triangle = sourceTriangle(
      mesh,
      triangleOffset,
      position,
      normal,
      uv,
      index,
      normalMatrix,
    );
    for (const vertex of triangle) sourceBounds.expandByPoint(vertex.point);
    triangles.push(triangle);
  }
  const sourceHeight = sourceBounds.max.y - sourceBounds.min.y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0)
    throw new Error(`Source height is invalid: ${sourceHeight}`);
  const normalization = {
    center: new THREE.Vector3(
      (sourceBounds.min.x + sourceBounds.max.x) / 2,
      sourceBounds.min.y,
      (sourceBounds.min.z + sourceBounds.max.z) / 2,
    ),
    scale: 1 / sourceHeight,
  };
  const output = { positions: [], normals: [], colors: [] };
  const n = SUBDIVISION_LEVEL;
  for (const triangle of triangles) {
    const vertexAt = (i, j) => {
      const weights = [i / n, j / n, 1 - (i + j) / n];
      return [weights, triangle];
    };
    const emit = (a, b, c) => {
      addBakedTriangle(output, triangle, vertexAt(...a)[0], texture, materialColor, normalization);
      addBakedTriangle(output, triangle, vertexAt(...b)[0], texture, materialColor, normalization);
      addBakedTriangle(output, triangle, vertexAt(...c)[0], texture, materialColor, normalization);
    };
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        emit([i, j], [i + 1, j], [i, j + 1]);
        if (j < n - i - 1)
          emit([i + 1, j], [i + 1, j + 1], [i, j + 1]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(output.positions, 3),
  );
  geometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(output.normals, 3),
  );
  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(output.colors, 3),
  );
  return { geometry, sourceBounds, normalization, triangleCount };
}

function runSamplerAssertions() {
  const texture = new THREE.DataTexture(
    new Uint8Array([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    ]),
    2,
    2,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.updateMatrix();
  const center = bilinearTextureSample(texture, new THREE.Vector2(0.25, 0.25));
  const seam = bilinearTextureSample(texture, new THREE.Vector2(0, 0.25));
  const near = (actual, expected) =>
    actual.every((value, index) => Math.abs(value - expected[index]) < 1e-6);
  if (!near(center, [1, 0, 0]))
    throw new Error(`Sampler texel-center assertion failed: ${center}`);
  if (!near(seam, [0.5, 0.5, 0]))
    throw new Error(`Sampler repeat-seam assertion failed: ${seam}`);
  texture.dispose();
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

async function main() {
  runSamplerAssertions();
  await mkdir(evidenceDirectory, { recursive: true });
  const inspection = JSON.parse(await readFile(inspectionPath, "utf8"));
  const fbxEntries = inspection.selectedFiles.filter((entry) =>
    entry.archivePath.toLowerCase().endsWith(".fbx"),
  );
  const fbxEntry = selectedFbxArchivePath
    ? fbxEntries.find((entry) => entry.archivePath === selectedFbxArchivePath)
    : fbxEntries.length === 1
      ? fbxEntries[0]
      : fbxEntries.find(
          (entry) => entry.archivePath === "Meshes/Fly_Agaric_Big.fbx",
        );
  const tgaEntry = inspection.selectedFiles.find(
    (entry) => entry.archivePath === "Textures/Mushrooms_C.tga",
  );
  if (!fbxEntry || !tgaEntry)
    throw new Error("Inspection report does not contain selected FBX/TGA inputs.");
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
  const texture = new THREE.DataTexture(
    tgaData.data,
    tgaData.width,
    tgaData.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.flipY = tgaData.flipY;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

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
      onLoad?.(texture);
      return texture;
    },
  };
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.tga$/i, textureHandler);
  manager.setURLModifier((url) => {
    throw new Error(`Unexpected external resource request: ${url}`);
  });
  const scene = new FBXLoader(manager).parse(
    asArrayBuffer(fbxBytes),
    `${dirname(fbxEntry.path)}/`,
  );
  scene.updateMatrixWorld(true);
  const mesh = [];
  scene.traverse((object) => {
    if (object.isMesh) mesh.push(object);
  });
  if (mesh.length !== 1) throw new Error(`Expected one mesh, got ${mesh.length}.`);
  const sourceMesh = mesh[0];
  const material = Array.isArray(sourceMesh.material)
    ? sourceMesh.material[0]
    : sourceMesh.material;
  if (!material?.map || material.map !== texture)
    throw new Error("Selected FBX material does not use the prepared TGA map.");
  texture.updateMatrix();
  const baked = bakeMesh(sourceMesh, texture, material);
  const bakedMesh = new THREE.Mesh(
    baked.geometry,
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0,
      vertexColors: true,
      name: "Fly_Agaric_Big_baked_vertex_colors",
    }),
  );
  bakedMesh.name = `${sourceMesh.name}_baked`;
  const bakedScene = new THREE.Scene();
  bakedScene.name = "Fly_Agaric_Big_baked_scene";
  bakedScene.add(bakedMesh);

  const vertexCount = baked.geometry.getAttribute("position").count;
  const triangleCount = vertexCount / 3;
  if (vertexCount > MAX_VERTICES) throw new Error(`Vertex cap exceeded: ${vertexCount}`);
  if (!Number.isInteger(triangleCount)) throw new Error("Output triangles are not integral.");
  if (typeof FileReader === "undefined") globalThis.FileReader = NodeFileReader;
  const glb = await new GLTFExporter().parseAsync(bakedScene, {
    binary: true,
    onlyVisible: true,
  });
  const glbBytes = new Uint8Array(glb);
  await writeFile(outputPath, glbBytes);
  if (glbBytes.byteLength > MAX_BYTES)
    throw new Error(`GLB byte cap exceeded: ${glbBytes.byteLength}`);

  const json = glbJson(glbBytes);
  const uris = collectUris(json);
  const hasImages = Array.isArray(json.images) && json.images.length > 0;
  const gltf = await new GLTFLoader().parseAsync(
    asArrayBuffer(glbBytes),
    "prototype.glb",
  );
  gltf.scene.updateMatrixWorld(true);
  const decodedMeshes = [];
  let finiteOutput = true;
  let minColor = [Infinity, Infinity, Infinity];
  let maxColor = [-Infinity, -Infinity, -Infinity];
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    const position = object.geometry.getAttribute("position");
    const normal = object.geometry.getAttribute("normal");
    const color = object.geometry.getAttribute("color");
    finiteOutput &&= !!position && !!normal && !!color;
    for (const attribute of [position, normal, color])
      if (attribute) finiteOutput &&= finiteArray(attribute.array);
    if (color) {
      for (let index = 0; index < color.count; index++) {
        for (let channel = 0; channel < 3; channel++) {
          const value = color.getComponent(index, channel);
          minColor[channel] = Math.min(minColor[channel], value);
          maxColor[channel] = Math.max(maxColor[channel], value);
          finiteOutput &&= value >= 0 && value <= 1;
        }
      }
    }
    decodedMeshes.push({
      name: object.name,
      vertices: position?.count ?? 0,
      triangles:
        (object.geometry.index?.count ?? position?.count ?? 0) / 3,
      attributes: Object.keys(object.geometry.attributes),
      hasMap: Array.isArray(object.material)
        ? object.material.some((entry) => !!entry.map)
        : !!object.material?.map,
    });
  });
  const transformedBounds = await transformedCatalogSourceBounds(
    glbBytes,
    "prototype.glb",
  );
  const outputBounds = transformedBounds.bounds;
  const minY = outputBounds.min[1];
  const outputHeight = outputBounds.size[1];
  finiteOutput &&= Math.abs(minY) <= 1e-6;
  finiteOutput &&= Math.abs(outputHeight - 1) <= 1e-5;
  if (!finiteOutput) throw new Error("Output GLB failed finite/range/bounds validation.");
  if (hasImages || uris.length) throw new Error("Output GLB contains image or URI resources.");

  const report = {
    status: "prototype-generated",
    scope: "offline texture-baked derivative; no catalog admission or visual fidelity claim",
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
    bake: {
      subdivisionPasses: 2,
      subdivisionLevel: SUBDIVISION_LEVEL,
      sourceTriangles: baked.triangleCount,
      outputTriangles: triangleCount,
      outputVertices: vertexCount,
      textureSampling: {
        transform: "THREE.Texture.transformUv (repeat/offset/wrap/flipY)",
        filter: "bilinear",
        colorConversion: "sRGB bytes to linear float before bilinear interpolation",
        materialColorMultiplied: [material.color.r, material.color.g, material.color.b],
      },
    },
    normalization: {
      sourceBounds: {
        min: baked.sourceBounds.min.toArray(),
        max: baked.sourceBounds.max.toArray(),
        size: baked.sourceBounds.getSize(new THREE.Vector3()).toArray(),
      },
      sourceMatrixWorld: sourceMesh.matrixWorld.toArray(),
      applied: "source matrixWorld, then center X/Z, subtract source min Y, scale total height to 1 meter",
      sourceToOutputScale: baked.normalization.scale,
      outputUnits: "meters",
      outputBaseY: 0,
      outputHeight: 1,
    },
    output: {
      path: outputPath,
      bytes: glbBytes.byteLength,
      sha256: sha256(glbBytes),
      selfContained: true,
      hasImages,
      uris,
      meshes: decodedMeshes,
      bounds: outputBounds,
      colorRange: { min: minColor, max: maxColor },
    },
    checks: {
      finiteOutput,
      vertexLimit: `${vertexCount} <= ${MAX_VERTICES}`,
      byteLimit: `${glbBytes.byteLength} <= ${MAX_BYTES}`,
      baseY: Math.abs(minY) <= 1e-6,
      oneMeterHeight: Math.abs(outputHeight - 1) <= 1e-5,
      noImages: !hasImages,
      noExternalUris: uris.length === 0,
      decodedWithGLTFLoader: true,
      transformedBoundsHelper: true,
    },
    appearance: {
      status: "unverified",
      note: "No visual render was performed in this bounded conversion task.",
    },
  };
  await writeFile(outputReportPath, `${JSON.stringify(report, null, 2)}\n`);
  disposeScene(scene);
  disposeScene(bakedScene);
  texture.dispose();
  disposeScene(gltf.scene);
  console.log(JSON.stringify(report, null, 2));
}

try {
  await main();
} catch (error) {
  const report = {
    status: "error",
    scope: "offline texture-baked derivative; no catalog admission or visual fidelity claim",
    sourceInspection: inspectionPath,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  };
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(outputReportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}
