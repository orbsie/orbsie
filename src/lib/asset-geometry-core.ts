import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  assetManifest,
  requireCatalogAsset,
  type AssetId,
  type CatalogAsset,
} from "./asset-catalog";
import { AssetGeometryError } from "./asset-geometry-error";
import { prepareFormationParticles } from "./formation-particles";

/** Typed arrays are transferred to the editor thread without a JSON copy. */
export type AssetGeometryArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array;

export interface AssetGeometryAttributeTransfer {
  readonly array: AssetGeometryArray;
  readonly itemSize: number;
  readonly normalized: boolean;
}

export interface AssetGeometryBoundsTransfer {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface AssetGeometrySphereTransfer {
  readonly center: readonly [number, number, number];
  readonly radius: number;
}

/** Structured clone/transfer payload emitted by the catalog worker. */
export interface AssetGeometryTransfer {
  readonly attributes: Readonly<Record<string, AssetGeometryAttributeTransfer>>;
  readonly box: AssetGeometryBoundsTransfer;
  readonly sphere: AssetGeometrySphereTransfer;
  readonly byteLength: number;
  readonly userData: Readonly<Record<string, unknown>>;
}

export interface DecodeAssetGeometryOptions {
  /** Maximum bytes accepted by the decoder, including worker direct calls. */
  readonly maxAssetBytes?: number;
  /** Verify checked-in manifest size and SHA-256 before parsing. */
  readonly verifyManifest?: boolean;
}

function positiveBound(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`${name} must be positive.`);
  return Math.floor(value);
}

function asBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function bytesOfGeometry(geometry: THREE.BufferGeometry): number {
  let bytes = 0;
  for (const attribute of Object.values(geometry.attributes)) {
    bytes += (attribute.array as ArrayBufferView).byteLength;
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
    throw new AssetGeometryError(
      "parse-failed",
      "Interleaved asset attributes are not supported by formation geometry.",
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
    throw new AssetGeometryError(
      "empty-geometry",
      "Asset mesh has no position attribute.",
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

function localResourceUrl(url: string, expectedPath: string): string {
  // Catalog GLBs are self-contained. URLModifier sees every requested image,
  // buffer, and nested resource, so accepting only the exact GLB path prevents
  // a catalog model from loading arbitrary external resources.
  let parsed: URL;
  try {
    parsed = new URL(url, "https://orbsie.local");
  } catch (error) {
    throw new AssetGeometryError(
      "unsafe-url",
      `Invalid asset resource URL ${url}.`,
      { cause: error },
    );
  }
  if (
    parsed.origin !== "https://orbsie.local" ||
    parsed.pathname !== expectedPath ||
    parsed.search ||
    parsed.hash
  )
    throw new AssetGeometryError(
      "unsafe-url",
      `Asset ${expectedPath} attempted to reference an external resource ${url}.`,
    );
  return expectedPath;
}

function parseManager(expectedPath: string): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => localResourceUrl(url, expectedPath));
  return manager;
}

function mergeSourceGeometry(
  gltf: { scene: THREE.Group },
  asset: CatalogAsset,
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
        throw new AssetGeometryError(
          "parse-failed",
          `${asset.id} contains a skinned mesh; static formation geometry is required.`,
        );
      const source = mesh.geometry;
      const position = source.getAttribute("position");
      if (!position)
        throw new AssetGeometryError(
          "empty-geometry",
          `${asset.id} contains a mesh without positions.`,
        );
      const materials: THREE.Material[] = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      const groups = source.groups.length
        ? source.groups
        : [
            {
              start: 0,
              count: source.index?.count ?? position.count,
              materialIndex: 0,
            },
          ];
      const meshParts: THREE.BufferGeometry[] = [];
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
          meshParts.push(part);
        }
      } catch (error) {
        meshParts.forEach((part) => part.dispose());
        throw error;
      }
      vertices += meshParts.reduce(
        (total, part) => total + part.getAttribute("position").count,
        0,
      );
      if (vertices > maxVertices) {
        meshParts.forEach((part) => part.dispose());
        throw new AssetGeometryError(
          "too-large",
          `${asset.id} exceeds the ${maxVertices.toLocaleString()} vertex limit.`,
        );
      }
      parts.push(...meshParts);
    });
    if (!parts.length)
      throw new AssetGeometryError(
        "empty-geometry",
        `${asset.id} contains no mesh geometry.`,
      );
    merged = mergeGeometries(parts, false);
    if (!merged)
      throw new AssetGeometryError(
        "parse-failed",
        `Could not merge ${asset.id} geometry.`,
      );
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    prepareFormationParticles(merged);
    const bytes = bytesOfGeometry(merged);
    if (bytes > maxGeometryBytes) {
      merged.dispose();
      throw new AssetGeometryError(
        "too-large",
        `${asset.id} merged geometry exceeds the ${maxGeometryBytes} byte limit.`,
      );
    }
    merged.userData.orbsieAssetId = asset.id;
    merged.userData.orbsieAssetPath = asset.path;
    merged.userData.sourceTransformsPreserved = true;
    merged.userData.sourceMaterialColorsPreserved = true;
    return merged;
  } catch (error) {
    merged?.dispose();
    throw error;
  } finally {
    parts.forEach((part) => part.dispose());
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new AssetGeometryError(
      "integrity-failed",
      "This runtime cannot verify catalog asset integrity.",
    );
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function unknownAsset(value: unknown): AssetGeometryError {
  return new AssetGeometryError(
    "unknown-id",
    `Unknown catalog asset ID ${JSON.stringify(value)}.`,
  );
}

/** Decode and validate one catalog asset. This function is worker safe. */
export async function decodeAssetGeometry(
  value: Uint8Array | ArrayBuffer,
  id: AssetId | string,
  maxVertices: number,
  maxGeometryBytes: number,
  options: DecodeAssetGeometryOptions = {},
): Promise<AssetGeometryTransfer> {
  let asset: CatalogAsset;
  try {
    asset = requireCatalogAsset(id);
  } catch (error) {
    throw unknownAsset(id);
  }
  const bytes = asBytes(value);
  const maxAssetBytes = positiveBound(
    options.maxAssetBytes ?? assetManifest.policy.maxCheckedInBytes,
    "maxAssetBytes",
  );
  if (bytes.byteLength > maxAssetBytes)
    throw new AssetGeometryError(
      "too-large",
      `Asset ${asset.id} is larger than the ${maxAssetBytes} byte read limit.`,
    );
  const verifyManifest = options.verifyManifest ?? true;
  if (verifyManifest) {
    if (bytes.byteLength !== asset.sizeBytes)
      throw new AssetGeometryError(
        "integrity-failed",
        `Asset ${asset.id} does not match its manifest size.`,
      );
    if ((await sha256Hex(bytes)) !== asset.sha256)
      throw new AssetGeometryError(
        "integrity-failed",
        `Asset ${asset.id} does not match its manifest SHA-256.`,
      );
  }
  const vertexLimit = positiveBound(maxVertices, "maxVertices");
  const geometryLimit = positiveBound(maxGeometryBytes, "maxGeometryBytes");
  let gltf: Awaited<ReturnType<GLTFLoader["parseAsync"]>> | undefined;
  try {
    const parseBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(parseBuffer).set(bytes);
    gltf = await new GLTFLoader(parseManager(asset.path)).parseAsync(
      parseBuffer,
      asset.path,
    );
    let geometry: THREE.BufferGeometry | undefined;
    let transferred = false;
    try {
      geometry = mergeSourceGeometry(gltf, asset, vertexLimit, geometryLimit);
      const box = geometry.boundingBox;
      const sphere = geometry.boundingSphere;
      if (!box || !sphere)
        throw new AssetGeometryError(
          "parse-failed",
          `Could not compute bounds for ${asset.id}.`,
        );
      const attributes = Object.fromEntries(
        Object.entries(geometry.attributes).map(([name, attribute]) => [
          name,
          {
            array: attribute.array as AssetGeometryArray,
            itemSize: attribute.itemSize,
            normalized: attribute.normalized,
          },
        ]),
      ) as Record<string, AssetGeometryAttributeTransfer>;
      const transfer: AssetGeometryTransfer = {
        attributes,
        box: {
          min: [box.min.x, box.min.y, box.min.z],
          max: [box.max.x, box.max.y, box.max.z],
        },
        sphere: {
          center: [sphere.center.x, sphere.center.y, sphere.center.z],
          radius: sphere.radius,
        },
        byteLength: bytesOfGeometry(geometry),
        userData: { ...geometry.userData },
      };
      geometry.dispose();
      transferred = true;
      return transfer;
    } finally {
      if (!transferred) geometry?.dispose();
    }
  } catch (error) {
    if (error instanceof AssetGeometryError) throw error;
    throw new AssetGeometryError(
      "parse-failed",
      `Could not parse catalog asset ${asset.id}.`,
      { cause: error },
    );
  } finally {
    if (gltf) disposeObjectResources(gltf.scene);
  }
}

/** The exact buffers that a worker response must transfer to its caller. */
export function transferableAssetGeometryBuffers(
  decoded: AssetGeometryTransfer,
): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const attribute of Object.values(decoded.attributes)) {
    const buffer = attribute.array.buffer;
    if (buffer instanceof ArrayBuffer) buffers.add(buffer);
  }
  return [...buffers];
}
