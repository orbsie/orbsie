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
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
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
