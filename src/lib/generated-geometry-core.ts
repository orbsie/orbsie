import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { validateGeneratedGLB } from "./generated-glb";
import { GeneratedGeometryError } from "./generated-geometry-error";
export function bytesOfGeometry(geometry: THREE.BufferGeometry): number {
  let bytes = 0;
  for (const attribute of Object.values(geometry.attributes)) {
    const array = attribute.array as ArrayBufferView;
    bytes += array.byteLength;
  }
  if (geometry.index) bytes += geometry.index.array.byteLength;
  return bytes;
}

function disposeObjectResources(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (
          value &&
          typeof value === "object" &&
          (value as THREE.Texture).isTexture
        )
          (value as THREE.Texture).dispose();
      }
      material.dispose();
    }
  });
}

function cloneAttributeRange(
  attribute: THREE.BufferAttribute,
  start: number,
  count: number,
): THREE.BufferAttribute {
  if (
    "isInterleavedBufferAttribute" in attribute &&
    attribute.isInterleavedBufferAttribute
  )
    throw new GeneratedGeometryError(
      "parse-failed",
      "Interleaved generated attributes are not supported by formation geometry.",
    );
  const itemSize = attribute.itemSize;
  const values = attribute.array.slice(
    start * itemSize,
    (start + count) * itemSize,
  ) as typeof attribute.array;
  return new THREE.BufferAttribute(values, itemSize, attribute.normalized);
}

function asNonIndexedPart(
  source: THREE.BufferGeometry,
  start = 0,
  count = source.index?.count ?? source.getAttribute("position")?.count ?? 0,
): THREE.BufferGeometry {
  const nonIndexed = source.index ? source.toNonIndexed() : source.clone();
  const part = new THREE.BufferGeometry();
  try {
    for (const [name, attribute] of Object.entries(nonIndexed.attributes))
      part.setAttribute(
        name,
        cloneAttributeRange(attribute as THREE.BufferAttribute, start, count),
      );
    return part;
  } catch (error) {
    part.dispose();
    throw error;
  } finally {
    nonIndexed.dispose();
  }
}

function materialColor(material: THREE.Material | undefined): THREE.Color {
  const color = material && "color" in material ? material.color : undefined;
  return color instanceof THREE.Color
    ? color.clone()
    : new THREE.Color(0xffffff);
}

function addVertexColors(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | undefined,
): void {
  const position = geometry.getAttribute("position");
  if (!position)
    throw new GeneratedGeometryError(
      "empty-geometry",
      "Generated mesh has no position attribute.",
    );
  const source = geometry.getAttribute("color");
  const color = materialColor(material);
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index++) {
    if (source) {
      colors[index * 3] = color.r * source.getX(index);
      colors[index * 3 + 1] = color.g * source.getY(index);
      colors[index * 3 + 2] = color.b * source.getZ(index);
    } else {
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function sourceParts(mesh: THREE.Mesh): THREE.BufferGeometry[] {
  const source = mesh.geometry;
  const materials: THREE.Material[] = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  const position = source.getAttribute("position");
  if (!position)
    throw new GeneratedGeometryError(
      "empty-geometry",
      "Generated mesh has no position attribute.",
    );
  const groups = source.groups.length
    ? source.groups
    : [
        {
          start: 0,
          count: source.index?.count ?? position.count,
          materialIndex: 0,
        },
      ];
  const parts: THREE.BufferGeometry[] = [];
  try {
    for (const group of groups) {
      const part = asNonIndexedPart(source, group.start, group.count);
      for (const name of [
        "uv",
        "uv1",
        "uv2",
        "tangent",
        "skinIndex",
        "skinWeight",
      ])
        part.deleteAttribute(name);
      if (!part.getAttribute("normal")) part.computeVertexNormals();
      addVertexColors(
        part,
        materials[group.materialIndex ?? 0] ?? materials[0],
      );
      part.applyMatrix4(mesh.matrixWorld);
      parts.push(part);
    }
    return parts;
  } catch (error) {
    parts.forEach((part) => part.dispose());
    throw error;
  }
}

function mergeSourceGeometry(
  gltf: { scene: THREE.Group },
  hash: string,
  maxVertices: number,
  maxGeometryBytes: number,
): THREE.BufferGeometry {
  gltf.scene.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  let vertices = 0;
  let merged: THREE.BufferGeometry | undefined;
  try {
    gltf.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh)
        throw new GeneratedGeometryError(
          "parse-failed",
          "Generated geometry cannot contain a skinned mesh.",
        );
      const meshParts = sourceParts(mesh);
      vertices += meshParts.reduce(
        (total, part) => total + part.getAttribute("position").count,
        0,
      );
      if (vertices > maxVertices) {
        meshParts.forEach((part) => part.dispose());
        throw new GeneratedGeometryError(
          "too-large",
          `Generated geometry exceeds the ${maxVertices.toLocaleString()} vertex limit.`,
        );
      }
      parts.push(...meshParts);
    });
    if (!parts.length)
      throw new GeneratedGeometryError(
        "empty-geometry",
        "Generated GLB contains no mesh geometry.",
      );
    merged = mergeGeometries(parts, false);
    if (!merged)
      throw new GeneratedGeometryError(
        "parse-failed",
        "Could not merge generated GLB geometry.",
      );
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const bytes = bytesOfGeometry(merged);
    if (bytes > maxGeometryBytes) {
      merged.dispose();
      throw new GeneratedGeometryError(
        "too-large",
        `Generated geometry exceeds the ${maxGeometryBytes} byte limit.`,
      );
    }
    merged.userData.orbsieGeneratedHash = hash;
    merged.userData.sourceTransformsPreserved = true;
    merged.userData.sourceMaterialColorsPreserved = true;
    return merged;
  } finally {
    parts.forEach((part) => part.dispose());
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new GeneratedGeometryError(
      "integrity-failed",
      "This runtime cannot verify generated model integrity.",
    );
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function decodeGeneratedGeometry(
  bytes: Uint8Array,
  hash: string,
  maxVertices: number,
  maxGeometryBytes: number,
) {
  if (bytes.byteLength > 2 * 1024 * 1024)
    throw new GeneratedGeometryError(
      "too-large",
      "Generated model exceeds its byte limit.",
    );
  if ((await sha256Hex(bytes)) !== hash)
    throw new GeneratedGeometryError(
      "integrity-failed",
      "Generated model content does not match its requested hash.",
    );
  let gltf: Awaited<ReturnType<GLTFLoader["parseAsync"]>> | undefined;
  try {
    validateGeneratedGLB(bytes);
    gltf = await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, "");
    return mergeSourceGeometry(gltf, hash, maxVertices, maxGeometryBytes);
  } catch (error) {
    if (error instanceof GeneratedGeometryError) throw error;
    throw new GeneratedGeometryError(
      "parse-failed",
      "Could not parse generated model GLB.",
      { cause: error },
    );
  } finally {
    if (gltf) disposeObjectResources(gltf.scene);
  }
}
