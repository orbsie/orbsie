import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  assetManifest,
  assetPathFor,
  assetUrlFor,
  requireCatalogAsset,
  type AssetId,
  type CatalogAsset,
} from "./asset-catalog";

const DEFAULT_MAX_ASSET_BYTES = assetManifest.policy.maxCheckedInBytes;
const DEFAULT_MAX_CACHE_ENTRIES = 12;
const DEFAULT_MAX_CACHE_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_GEOMETRY_BYTES = 24 * 1024 * 1024;
const DEFAULT_MAX_VERTICES = 250_000;

export class AssetGeometryError extends Error {
  readonly code:
    | "unknown-id"
    | "unsafe-url"
    | "fetch-failed"
    | "too-large"
    | "parse-failed"
    | "empty-geometry"
    | "integrity-failed"
    | "aborted"
    | "disposed";

  constructor(
    code: AssetGeometryError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AssetGeometryError";
    this.code = code;
  }
}

export type AssetBytesFetcher = (
  url: string,
  signal: AbortSignal,
) => Promise<ArrayBuffer | Uint8Array>;

export interface AssetGeometryLoaderOptions {
  /** Maximum bytes read from any one checked-in model. */
  readonly maxAssetBytes?: number;
  /** Maximum number of cached merged geometries. */
  readonly maxCacheEntries?: number;
  /** Maximum estimated GPU attribute bytes retained by the cache. */
  readonly maxCacheBytes?: number;
  /** Reject a merged result larger than this before it reaches the cache. */
  readonly maxGeometryBytes?: number;
  /** Reject maliciously complex models before merging. */
  readonly maxVertices?: number;
  /** Optional same-origin absolute URL used by a browser test or app shell. */
  readonly baseUrl?: string | URL;
  /** Injected reader for tests and standalone packaging. */
  readonly fetchBytes?: AssetBytesFetcher;
  /**
   * Keep true for checked-in runtime assets. Tests that exercise merging with
   * synthetic GLBs may explicitly disable the manifest boundary.
   */
  readonly verifyManifest?: boolean;
}

export interface AssetGeometryLoadOptions {
  readonly signal?: AbortSignal;
}

export interface LoadedAssetGeometry {
  readonly asset: CatalogAsset;
  readonly geometry: THREE.BufferGeometry;
  /** Estimated attribute memory retained by this geometry. */
  readonly byteLength: number;
  /** Release this caller's ownership; safe to call more than once. */
  readonly release: () => void;
  /** Alias used by scene teardown code. */
  readonly dispose: () => void;
}

export interface AssetGeometryCacheStats {
  readonly entries: number;
  readonly bytes: number;
  readonly pending: number;
  readonly activeLeases: number;
}

interface GeometryEntry {
  readonly id: AssetId;
  readonly asset: CatalogAsset;
  readonly geometry: THREE.BufferGeometry;
  readonly byteLength: number;
  cached: boolean;
  refs: number;
  released: boolean;
}

interface PendingEntry {
  readonly id: AssetId;
  readonly controller: AbortController;
  consumers: number;
  done: boolean;
  promise: Promise<GeometryEntry>;
}

function abortError(
  message = "Asset geometry loading was cancelled.",
): AssetGeometryError {
  return new AssetGeometryError("aborted", message);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function bytesOfGeometry(geometry: THREE.BufferGeometry): number {
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
  for (const [name, attribute] of Object.entries(nonIndexed.attributes)) {
    if (
      "isInterleavedBufferAttribute" in attribute &&
      attribute.isInterleavedBufferAttribute
    )
      throw new AssetGeometryError(
        "parse-failed",
        "Interleaved asset attributes are not supported by the formation mesh.",
      );
    part.setAttribute(
      name,
      cloneAttributeRange(attribute as THREE.BufferAttribute, start, count),
    );
  }
  nonIndexed.dispose();
  return part;
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
  const source = geometry.getAttribute("color");
  const color = materialColor(material);
  const colors = new Float32Array(geometry.getAttribute("position").count * 3);
  for (let i = 0; i < colors.length / 3; i++) {
    if (source) {
      colors[i * 3] = color.r * source.getX(i);
      colors[i * 3 + 1] = color.g * source.getY(i);
      colors[i * 3 + 2] = color.b * source.getZ(i);
    } else {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function sourceParts(mesh: THREE.Mesh): THREE.BufferGeometry[] {
  const source = mesh.geometry;
  const materials: THREE.Material[] = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  const groups = source.groups.length
    ? source.groups
    : [
        {
          start: 0,
          count: source.index?.count ?? source.getAttribute("position").count,
          materialIndex: 0,
        },
      ];
  const parts: THREE.BufferGeometry[] = [];
  try {
    for (const group of groups) {
      const part = asNonIndexedPart(source, group.start, group.count);
      // The formation material consumes position, normal, and vertex color. UVs,
      // tangents and skin attributes are intentionally omitted from the merged
      // result because they cannot be safely combined across source materials.
      for (const name of [
        "uv",
        "uv1",
        "uv2",
        "tangent",
        "skinIndex",
        "skinWeight",
      ]) {
        part.deleteAttribute(name);
      }
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
      const meshParts = sourceParts(mesh);
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
  } finally {
    parts.forEach((part) => part.dispose());
  }
}

function localResourceUrl(url: string, expectedPath: string): string {
  // GLB assets in this catalog are self-contained.  A model-supplied URI is
  // accepted only when it resolves to the exact checked-in GLB path.  This
  // rejects HTTP(S), data:, blob:, file:, and sibling .bin/texture requests.
  let parsed: URL;
  try {
    parsed = new URL(url, "https://orbsie.local");
  } catch (error) {
    throw new AssetGeometryError(
      "unsafe-url",
      `Invalid asset resource URL ${url}.`,
      {
        cause: error,
      },
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

async function defaultFetchBytes(
  url: string,
  signal: AbortSignal,
  maxBytes: number,
  expectedSize?: number,
): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetch(url, { signal, redirect: "error" });
  } catch (error) {
    if (signal.aborted) throw abortError();
    throw new AssetGeometryError(
      "fetch-failed",
      `Could not fetch local asset ${url}.`,
      {
        cause: error,
      },
    );
  }
  if (!response.ok)
    throw new AssetGeometryError(
      "fetch-failed",
      `Could not fetch local asset ${url} (HTTP ${response.status}).`,
    );
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > maxBytes)
    throw new AssetGeometryError(
      "too-large",
      `Asset ${url} is larger than the ${maxBytes} byte read limit.`,
    );
  if (
    declared &&
    expectedSize !== undefined &&
    Number(declared) !== expectedSize
  )
    throw new AssetGeometryError(
      "integrity-failed",
      `Asset ${url} has an unexpected manifest size.`,
    );
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maxBytes)
      throw new AssetGeometryError(
        "too-large",
        `Asset ${url} is larger than the ${maxBytes} byte read limit.`,
      );
    if (expectedSize !== undefined && bytes.byteLength !== expectedSize)
      throw new AssetGeometryError(
        "integrity-failed",
        `Asset ${url} has an unexpected manifest size.`,
      );
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AssetGeometryError(
          "too-large",
          `Asset ${url} is larger than the ${maxBytes} byte read limit.`,
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (expectedSize !== undefined && bytes.byteLength !== expectedSize)
    throw new AssetGeometryError(
      "integrity-failed",
      `Asset ${url} has an unexpected manifest size.`,
    );
  return bytes.buffer;
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

function parseManager(expectedPath: string): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => localResourceUrl(url, expectedPath));
  return manager;
}

export class AssetGeometryLoader {
  readonly #maxAssetBytes: number;
  readonly #maxCacheEntries: number;
  readonly #maxCacheBytes: number;
  readonly #maxGeometryBytes: number;
  readonly #maxVertices: number;
  readonly #baseUrl?: string | URL;
  readonly #fetchBytes?: AssetBytesFetcher;
  readonly #verifyManifest: boolean;
  readonly #cache = new Map<AssetId, GeometryEntry>();
  readonly #pending = new Map<AssetId, PendingEntry>();
  readonly #ephemeral = new Set<GeometryEntry>();
  #cacheBytes = 0;
  #activeLeases = 0;
  #disposed = false;

  constructor(options: AssetGeometryLoaderOptions = {}) {
    this.#maxAssetBytes = positiveBound(
      options.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES,
      "maxAssetBytes",
    );
    this.#maxCacheEntries = positiveBound(
      options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES,
      "maxCacheEntries",
    );
    this.#maxCacheBytes = positiveBound(
      options.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES,
      "maxCacheBytes",
    );
    this.#maxGeometryBytes = positiveBound(
      options.maxGeometryBytes ?? DEFAULT_MAX_GEOMETRY_BYTES,
      "maxGeometryBytes",
    );
    this.#maxVertices = positiveBound(
      options.maxVertices ?? DEFAULT_MAX_VERTICES,
      "maxVertices",
    );
    this.#baseUrl = options.baseUrl;
    this.#fetchBytes = options.fetchBytes;
    this.#verifyManifest = options.verifyManifest ?? true;
  }

  get stats(): AssetGeometryCacheStats {
    let pending = 0;
    for (const item of this.#pending.values()) pending += item.consumers;
    return {
      entries: this.#cache.size,
      bytes: this.#cacheBytes,
      pending: this.#pending.size,
      activeLeases: this.#activeLeases,
    };
  }

  async load(
    value: AssetId,
    options: AssetGeometryLoadOptions = {},
  ): Promise<LoadedAssetGeometry> {
    if (this.#disposed)
      throw new AssetGeometryError(
        "disposed",
        "This asset loader has been disposed.",
      );
    let asset: CatalogAsset;
    try {
      asset = requireCatalogAsset(value);
    } catch (error) {
      throw new AssetGeometryError(
        "unknown-id",
        error instanceof Error ? error.message : "Unknown catalog asset ID.",
        { cause: error },
      );
    }
    throwIfAborted(options.signal);
    const cached = this.#cache.get(asset.id as AssetId);
    if (cached) {
      this.#touch(cached);
      return this.#lease(cached);
    }

    let pending = this.#pending.get(asset.id as AssetId);
    if (pending?.controller.signal.aborted && !pending.done) {
      this.#pending.delete(asset.id as AssetId);
      pending = undefined;
    }
    if (!pending) {
      const controller = new AbortController();
      pending = {
        id: asset.id as AssetId,
        controller,
        consumers: 0,
        done: false,
        promise: Promise.resolve(undefined as never),
      };
      pending.promise = this.#start(asset, pending);
      this.#pending.set(pending.id, pending);
    }
    pending.consumers += 1;
    let abandoned = false;
    const abandon = () => {
      if (abandoned) return;
      abandoned = true;
      pending!.consumers -= 1;
      if (pending!.consumers <= 0 && !pending!.done)
        pending!.controller.abort();
    };
    options.signal?.addEventListener("abort", abandon, { once: true });
    try {
      const entry = await raceAbort(pending.promise, options.signal);
      throwIfAborted(options.signal);
      return this.#lease(entry);
    } finally {
      options.signal?.removeEventListener("abort", abandon);
      if (!abandoned) {
        pending.consumers -= 1;
        if (pending.consumers <= 0 && !pending.done) pending.controller.abort();
      }
    }
  }

  /** Cancel an in-flight load, or all in-flight loads when no ID is supplied. */
  cancel(value?: AssetId): void {
    if (value === undefined) {
      for (const pending of this.#pending.values()) pending.controller.abort();
      return;
    }
    this.#pending
      .get(requireCatalogAsset(value).id as AssetId)
      ?.controller.abort();
  }

  /** Release all cache ownership and abort unresolved work. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const pending of this.#pending.values()) pending.controller.abort();
    this.#pending.clear();
    for (const entry of this.#cache.values()) entry.geometry.dispose();
    this.#cache.clear();
    this.#cacheBytes = 0;
    for (const entry of this.#ephemeral) entry.geometry.dispose();
    this.#ephemeral.clear();
  }

  #start(asset: CatalogAsset, pending: PendingEntry): Promise<GeometryEntry> {
    const promise = (async () => {
      try {
        const path = assetPathFor(asset.id);
        const url = assetUrlFor(asset.id, this.#baseUrl);
        const raw = this.#fetchBytes
          ? await this.#fetchBytes(url, pending.controller.signal)
          : await defaultFetchBytes(
              url,
              pending.controller.signal,
              this.#maxAssetBytes,
              this.#verifyManifest ? asset.sizeBytes : undefined,
            );
        throwIfAborted(pending.controller.signal);
        const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
        if (bytes.byteLength > this.#maxAssetBytes)
          throw new AssetGeometryError(
            "too-large",
            `Asset ${asset.id} is larger than the ${this.#maxAssetBytes} byte read limit.`,
          );
        if (this.#verifyManifest) {
          if (bytes.byteLength !== asset.sizeBytes)
            throw new AssetGeometryError(
              "integrity-failed",
              `Asset ${asset.id} does not match its manifest size.`,
            );
          const digest = await sha256Hex(bytes);
          if (digest !== asset.sha256)
            throw new AssetGeometryError(
              "integrity-failed",
              `Asset ${asset.id} does not match its manifest SHA-256.`,
            );
        }
        let gltf: { scene: THREE.Group };
        try {
          const loader = new GLTFLoader(parseManager(path));
          const parseBuffer = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(parseBuffer).set(bytes);
          gltf = await loader.parseAsync(parseBuffer, path);
        } catch (error) {
          if (error instanceof AssetGeometryError) throw error;
          throw new AssetGeometryError(
            "parse-failed",
            `Could not parse catalog asset ${asset.id}.`,
            { cause: error },
          );
        }
        let geometry: THREE.BufferGeometry | undefined;
        let transferred = false;
        try {
          geometry = mergeSourceGeometry(
            gltf,
            asset,
            this.#maxVertices,
            this.#maxGeometryBytes,
          );
          throwIfAborted(pending.controller.signal);
          const entry: GeometryEntry = {
            id: asset.id as AssetId,
            asset,
            geometry,
            byteLength: bytesOfGeometry(geometry),
            cached: false,
            refs: 0,
            released: false,
          };
          if (entry.byteLength <= this.#maxCacheBytes) {
            entry.cached = true;
            this.#cache.set(entry.id, entry);
            this.#cacheBytes += entry.byteLength;
            this.#trimCache();
          } else {
            this.#ephemeral.add(entry);
          }
          transferred = true;
          return entry;
        } finally {
          disposeObjectResources(gltf.scene);
          if (!transferred) geometry?.dispose();
        }
      } catch (error) {
        if (error instanceof AssetGeometryError) throw error;
        if (pending.controller.signal.aborted) throw abortError();
        throw error;
      } finally {
        pending.done = true;
        if (this.#pending.get(pending.id) === pending)
          this.#pending.delete(pending.id);
      }
    })();
    pending.promise = promise;
    return promise;
  }

  #lease(entry: GeometryEntry): LoadedAssetGeometry {
    if (entry.released)
      throw new AssetGeometryError(
        "disposed",
        "Asset geometry is no longer available.",
      );
    entry.refs += 1;
    this.#activeLeases += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      entry.refs = Math.max(0, entry.refs - 1);
      this.#activeLeases = Math.max(0, this.#activeLeases - 1);
      if (!entry.cached && entry.refs === 0) {
        entry.released = true;
        this.#ephemeral.delete(entry);
        entry.geometry.dispose();
      }
      this.#trimCache();
    };
    return {
      asset: entry.asset,
      geometry: entry.geometry,
      byteLength: entry.byteLength,
      release,
      dispose: release,
    };
  }

  #touch(entry: GeometryEntry): void {
    if (!entry.cached) return;
    this.#cache.delete(entry.id);
    this.#cache.set(entry.id, entry);
  }

  #trimCache(): void {
    for (const [id, entry] of this.#cache) {
      if (
        (this.#cache.size <= this.#maxCacheEntries &&
          this.#cacheBytes <= this.#maxCacheBytes) ||
        entry.refs > 0
      )
        continue;
      this.#cache.delete(id);
      this.#cacheBytes -= entry.byteLength;
      entry.released = true;
      entry.geometry.dispose();
    }
  }
}

function positiveBound(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`${name} must be positive.`);
  return Math.floor(value);
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(abortError());
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export function createAssetGeometryLoader(
  options: AssetGeometryLoaderOptions = {},
): AssetGeometryLoader {
  return new AssetGeometryLoader(options);
}
