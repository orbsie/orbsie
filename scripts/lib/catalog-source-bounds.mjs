import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

function finiteBounds(bounds) {
  return (
    bounds.min.every(Number.isFinite) &&
    bounds.max.every(Number.isFinite) &&
    bounds.min.every((value, axis) => value <= bounds.max[axis])
  );
}

function include(bounds, point) {
  for (const axis of [0, 1, 2]) {
    bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
  }
}

function activeMeshBounds(mesh) {
  const position = mesh.geometry.getAttribute("position");
  if (!position) return null;
  const index = mesh.geometry.index;
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  const point = new THREE.Vector3();
  const count = index?.count ?? position.count;
  for (let offset = 0; offset < count; offset++) {
    const vertex = index ? index.getX(offset) : offset;
    point.fromBufferAttribute(position, vertex).applyMatrix4(mesh.matrixWorld);
    include(bounds, point.toArray());
  }
  return finiteBounds(bounds) ? bounds : null;
}

function disposeScene(scene) {
  scene.traverse((object) => {
    const mesh = object;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of materials) material.dispose();
  });
}

const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;

/**
 * Keep geometry and material indices intact while removing material payloads
 * that can make GLTFLoader decode browser-only image resources during a bounds
 * audit. The original bytes are never modified.
 */
function geometryOnlyGlb(inputBytes) {
  const bytes = new Uint8Array(
    inputBytes.buffer,
    inputBytes.byteOffset,
    inputBytes.byteLength,
  );
  if (bytes.byteLength < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES)
    throw new Error("Catalog bounds audit received a truncated GLB.");
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== "glTF")
    throw new Error("Catalog bounds audit received a non-GLB file.");

  const inputView = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  if (inputView.getUint32(4, true) !== 2)
    throw new Error("Catalog bounds audit requires GLB version 2.");
  if (inputView.getUint32(8, true) !== bytes.byteLength)
    throw new Error("Catalog bounds audit found an invalid GLB length header.");

  const chunks = [];
  let offset = GLB_HEADER_BYTES;
  while (offset < bytes.byteLength) {
    if (offset + GLB_CHUNK_HEADER_BYTES > bytes.byteLength)
      throw new Error(
        "Catalog bounds audit found a truncated GLB chunk header.",
      );
    const chunkLength = inputView.getUint32(offset, true);
    const chunkType = inputView.getUint32(offset + 4, true);
    const dataStart = offset + GLB_CHUNK_HEADER_BYTES;
    const dataEnd = dataStart + chunkLength;
    if (dataEnd > bytes.byteLength)
      throw new Error("Catalog bounds audit found a truncated GLB chunk.");
    chunks.push({ type: chunkType, data: bytes.subarray(dataStart, dataEnd) });
    offset = dataEnd;
  }

  const jsonChunkIndex = chunks.findIndex(
    ({ type }) => type === GLB_JSON_CHUNK_TYPE,
  );
  if (
    jsonChunkIndex === -1 ||
    chunks.some(
      ({ type }, index) =>
        type === GLB_JSON_CHUNK_TYPE && index !== jsonChunkIndex,
    )
  )
    throw new Error("Catalog bounds audit requires one GLB JSON chunk.");

  const document = JSON.parse(
    new TextDecoder().decode(chunks[jsonChunkIndex].data),
  );
  if (Array.isArray(document.materials))
    document.materials = document.materials.map((material) =>
      typeof material?.name === "string" ? { name: material.name } : {},
    );
  const encodedJson = new TextEncoder().encode(JSON.stringify(document));
  const paddedJsonLength = Math.ceil(encodedJson.byteLength / 4) * 4;
  const paddedJson = new Uint8Array(paddedJsonLength);
  paddedJson.fill(0x20);
  paddedJson.set(encodedJson);
  chunks[jsonChunkIndex].data = paddedJson;

  let totalLength = GLB_HEADER_BYTES;
  for (const { data } of chunks) {
    totalLength += GLB_CHUNK_HEADER_BYTES + data.byteLength;
  }
  const output = new Uint8Array(totalLength);
  output.set([0x67, 0x6c, 0x54, 0x46], 0);
  const outputView = new DataView(output.buffer);
  outputView.setUint32(4, 2, true);
  outputView.setUint32(8, totalLength, true);
  offset = GLB_HEADER_BYTES;
  for (const { type, data } of chunks) {
    outputView.setUint32(offset, data.byteLength, true);
    outputView.setUint32(offset + 4, type, true);
    output.set(data, offset + GLB_CHUNK_HEADER_BYTES);
    offset += GLB_CHUNK_HEADER_BYTES + data.byteLength;
  }
  return output;
}

/**
 * Compute bounds from active indexed vertices after GLTF node transforms.
 * This follows the production decoder's indexed-to-non-indexed merge and
 * avoids including unused vertices in a shared accessor.
 */
export async function transformedCatalogSourceBounds(bytes, expectedPath) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    throw new Error(
      `Catalog bounds audit encountered external resource ${url}`,
    );
  });
  const loader = new GLTFLoader(manager);
  let gltf;
  try {
    const geometryBytes = geometryOnlyGlb(bytes);
    const buffer = new ArrayBuffer(geometryBytes.byteLength);
    new Uint8Array(buffer).set(geometryBytes);
    gltf = await loader.parseAsync(buffer, expectedPath);
    gltf.scene.updateMatrixWorld(true);
    const sceneBounds = {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    };
    const meshes = [];
    gltf.scene.traverse((object) => {
      if (!object.isMesh) return;
      const bounds = activeMeshBounds(object);
      if (!bounds) return;
      const index = object.geometry.index;
      const triangles =
        (index?.count ?? object.geometry.getAttribute("position").count) / 3;
      meshes.push({
        name: object.name,
        triangles,
        material: Array.isArray(object.material)
          ? object.material.map((entry) => entry.name)
          : [object.material?.name ?? ""],
        bounds,
      });
      include(sceneBounds, bounds.min);
      include(sceneBounds, bounds.max);
    });
    if (!finiteBounds(sceneBounds))
      throw new Error("Catalog GLB contains no active mesh vertices.");
    return {
      bounds: {
        min: sceneBounds.min,
        max: sceneBounds.max,
        size: sceneBounds.max.map(
          (value, axis) => value - sceneBounds.min[axis],
        ),
      },
      meshes,
      nodeCount: (() => {
        let count = 0;
        gltf.scene.traverse(() => count++);
        return count;
      })(),
    };
  } finally {
    if (gltf) disposeScene(gltf.scene);
  }
}
