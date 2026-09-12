import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { TGALoader } from "three/addons/loaders/TGALoader.js";

const inspectionPath =
  "docs/evidence/mushroom-candidate-inspection/report.json";
const outputPath = "docs/evidence/mushroom-candidate-import/report.json";

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

function wrappingName(value) {
  return {
    [THREE.ClampToEdgeWrapping]: "clamp-to-edge",
    [THREE.RepeatWrapping]: "repeat",
    [THREE.MirroredRepeatWrapping]: "mirrored-repeat",
  }[value] ?? `unknown(${value})`;
}

function tgaOrigin(flags) {
  return {
    0: "bottom-left",
    1: "bottom-right",
    2: "top-left",
    3: "top-right",
  }[(flags & 0x30) >> 4] ?? "unknown";
}

function includeTransformedBounds(bounds, mesh) {
  const position = mesh.geometry.getAttribute("position");
  if (!position) return;
  const index = mesh.geometry.index;
  const count = index?.count ?? position.count;
  const point = new THREE.Vector3();
  for (let offset = 0; offset < count; offset++) {
    const vertex = index ? index.getX(offset) : offset;
    point.fromBufferAttribute(position, vertex).applyMatrix4(mesh.matrixWorld);
    bounds.expandByPoint(point);
  }
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
    for (const material of materials) {
      material.map?.dispose?.();
      material.dispose?.();
    }
  });
}

await mkdir(dirname(outputPath), { recursive: true });
let report;
try {
  const inspection = JSON.parse(await readFile(inspectionPath, "utf8"));
  const fbxEntry = inspection.selectedFiles.find(
    (entry) => entry.archivePath === "Meshes/Fly_Agaric_Big.fbx",
  );
  const tgaEntry = inspection.selectedFiles.find(
    (entry) => entry.archivePath === "Textures/Mushrooms_C.tga",
  );
  if (!fbxEntry || !tgaEntry)
    throw new Error("Inspection report does not contain the selected FBX/TGA inputs.");

  const [fbxBytes, tgaBytes] = await Promise.all([
    readFile(fbxEntry.path),
    readFile(tgaEntry.path),
  ]);
  const fbxSha256 = sha256(fbxBytes);
  const tgaSha256 = sha256(tgaBytes);
  if (fbxSha256 !== fbxEntry.sha256)
    throw new Error(`FBX SHA-256 mismatch: expected ${fbxEntry.sha256}, got ${fbxSha256}`);
  if (tgaSha256 !== tgaEntry.sha256)
    throw new Error(`TGA SHA-256 mismatch: expected ${tgaEntry.sha256}, got ${tgaSha256}`);

  const tgaFlags = tgaBytes[17];
  const tgaLoader = new TGALoader();
  const tgaData = tgaLoader.parse(asArrayBuffer(tgaBytes));
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

  const fbxPath = fbxEntry.path;
  const scene = new FBXLoader(manager).parse(
    asArrayBuffer(fbxBytes),
    `${dirname(fbxPath)}/`,
  );
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  const meshes = [];
  let finiteGeometry = true;
  scene.traverse((object) => {
    if (!object.isMesh) return;
    const position = object.geometry.getAttribute("position");
    const uv = object.geometry.getAttribute("uv");
    const index = object.geometry.index;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    const matrixWorld = object.matrixWorld.toArray();
    finiteGeometry &&= !!position && finiteArray(position.array);
    finiteGeometry &&= !uv || finiteArray(uv.array);
    finiteGeometry &&= finiteArray(matrixWorld);
    includeTransformedBounds(bounds, object);
    meshes.push({
      name: object.name,
      vertices: position?.count ?? 0,
      triangles: (index?.count ?? position?.count ?? 0) / 3,
      uvVertices: uv?.count ?? 0,
      indexed: !!index,
      materialNames: materials.map((material) => material?.name ?? ""),
      materialMapIdentity: materials.map((material) => material?.map === texture),
      matrixWorld,
    });
  });

  const boundsMin = bounds.min.toArray();
  const boundsMax = bounds.max.toArray();
  finiteGeometry &&= meshes.length > 0;
  finiteGeometry &&= finiteArray(boundsMin) && finiteArray(boundsMax);
  if (!finiteGeometry) throw new Error("Imported geometry contains non-finite data.");
  report = {
    status: "imported",
    scope: "offline FBX/TGA import probe; no conversion or catalog admission",
    sourceInspection: inspectionPath,
    inputs: {
      fbx: {
        path: fbxPath,
        archivePath: fbxEntry.archivePath,
        bytes: fbxBytes.byteLength,
        sha256: fbxSha256,
        expectedSha256: fbxEntry.sha256,
      },
      tga: {
        path: tgaEntry.path,
        archivePath: tgaEntry.archivePath,
        bytes: tgaBytes.byteLength,
        sha256: tgaSha256,
        expectedSha256: tgaEntry.sha256,
      },
    },
    tga: {
      width: tgaData.width,
      height: tgaData.height,
      pixelDataBytes: tgaData.data.byteLength,
      pixelSizeBits: tgaBytes[16],
      imageType: tgaBytes[2],
      origin: tgaOrigin(tgaFlags),
      descriptorFlags: tgaFlags,
      loaderFlipY: tgaData.flipY,
      textureFlipY: texture.flipY,
      wrapS: wrappingName(texture.wrapS),
      wrapT: wrappingName(texture.wrapT),
      colorSpace: texture.colorSpace,
    },
    scene: {
      name: scene.name,
      meshCount: meshes.length,
      totalVertices: meshes.reduce((sum, mesh) => sum + mesh.vertices, 0),
      totalTriangles: meshes.reduce((sum, mesh) => sum + mesh.triangles, 0),
      bounds: {
        min: boundsMin,
        max: boundsMax,
        size: boundsMax.map((value, axis) => value - boundsMin[axis]),
      },
      meshes,
    },
    checks: {
      finiteGeometry,
      textureMapIdentity: meshes.every((mesh) => mesh.materialMapIdentity.every(Boolean)),
      urlModifierInstalled: true,
      externalResourceRequests: 0,
    },
  };
  disposeScene(scene);
  texture.dispose();
} catch (error) {
  report = {
    status: "error",
    scope: "offline FBX/TGA import probe; no conversion or catalog admission",
    sourceInspection: inspectionPath,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  };
  process.exitCode = 1;
}

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
