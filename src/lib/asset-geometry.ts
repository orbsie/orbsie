import * as THREE from "three";
import {
  assetManifest,
  assetPathFor,
  assetUrlFor,
  requireCatalogAsset,
  type AssetId,
  type CatalogAsset,
} from "./asset-catalog";
import {
  prepareAssetGeometry,
  type AssetGeometryWorkerFactory,
} from "./asset-geometry-queue";
import { AssetGeometryError } from "./asset-geometry-error";

export { AssetGeometryError } from "./asset-geometry-error";
export type { AssetGeometryWorkerFactory } from "./asset-geometry-queue";

const DEFAULT_MAX_ASSET_BYTES = assetManifest.policy.maxCheckedInBytes;
const DEFAULT_MAX_CACHE_ENTRIES = 12;
const DEFAULT_MAX_CACHE_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_GEOMETRY_BYTES = 24 * 1024 * 1024;
const DEFAULT_MAX_VERTICES = 250_000;

// The standalone player is served from an exported directory. Keep catalog
// fetches relative there; the editor remains rooted at the app origin.
declare const ORBSIE_STANDALONE_ASSET_WORKER: string | undefined;

export type AssetBytesFetcher = (
  url: string,
  signal: AbortSignal,
) => Promise<ArrayBuffer | Uint8Array>;

export interface AssetGeometryLoaderOptions {
  readonly maxAssetBytes?: number;
  readonly maxCacheEntries?: number;
  readonly maxCacheBytes?: number;
  readonly maxGeometryBytes?: number;
  readonly maxVertices?: number;
  readonly baseUrl?: string | URL;
  readonly fetchBytes?: AssetBytesFetcher;
  readonly verifyManifest?: boolean;
  readonly workerUrl?: string;
  readonly workerFactory?: AssetGeometryWorkerFactory;
  readonly workerTimeoutMs?: number;
  readonly maxQueuedJobs?: number;
}

export interface AssetGeometryLoadOptions {
  readonly signal?: AbortSignal;
}

export interface LoadedAssetGeometry {
  readonly asset: CatalogAsset;
  readonly geometry: THREE.BufferGeometry;
  readonly byteLength: number;
  readonly release: () => void;
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

function positiveBound(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`${name} must be positive.`);
  return Math.floor(value);
}

function bytesOfGeometry(geometry: THREE.BufferGeometry): number {
  let bytes = 0;
  for (const attribute of Object.values(geometry.attributes))
    bytes += (attribute.array as ArrayBufferView).byteLength;
  if (geometry.index) bytes += geometry.index.array.byteLength;
  return bytes;
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
      { cause: error },
    );
  }
  if (!response.ok)
    throw new AssetGeometryError(
      "fetch-failed",
      `Could not fetch local asset ${url} (HTTP ${response.status}).`,
    );
  const declaredText = response.headers.get("content-length");
  const declared = declaredText === null ? undefined : Number(declaredText);
  if (declared !== undefined && (!Number.isFinite(declared) || declared < 0))
    throw new AssetGeometryError(
      "fetch-failed",
      `Asset ${url} returned an invalid content length.`,
    );
  if (declared !== undefined && declared > maxBytes)
    throw new AssetGeometryError(
      "too-large",
      `Asset ${url} is larger than the ${maxBytes} byte read limit.`,
    );
  if (
    declared !== undefined &&
    expectedSize !== undefined &&
    declared !== expectedSize
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
  if (expectedSize !== undefined && total !== expectedSize)
    throw new AssetGeometryError(
      "integrity-failed",
      `Asset ${url} has an unexpected manifest size.`,
    );
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
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

export class AssetGeometryLoader {
  readonly #maxAssetBytes: number;
  readonly #maxCacheEntries: number;
  readonly #maxCacheBytes: number;
  readonly #maxGeometryBytes: number;
  readonly #maxVertices: number;
  readonly #baseUrl?: string | URL;
  readonly #fetchBytes?: AssetBytesFetcher;
  readonly #verifyManifest: boolean;
  readonly #workerUrl?: string;
  readonly #workerFactory?: AssetGeometryWorkerFactory;
  readonly #workerTimeoutMs?: number;
  readonly #maxQueuedJobs?: number;
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
    this.#workerUrl = options.workerUrl;
    this.#workerFactory = options.workerFactory;
    this.#workerTimeoutMs = options.workerTimeoutMs;
    this.#maxQueuedJobs = options.maxQueuedJobs;
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
    const id = asset.id as AssetId;
    const cached = this.#cache.get(id);
    if (cached) {
      this.#touch(cached);
      return this.#lease(cached);
    }
    let pending = this.#pending.get(id);
    if (pending?.controller.signal.aborted && !pending.done) {
      this.#pending.delete(id);
      pending = undefined;
    }
    if (!pending) {
      const controller = new AbortController();
      pending = {
        id,
        controller,
        consumers: 0,
        done: false,
        promise: Promise.resolve(undefined as never),
      };
      pending.promise = this.#start(asset, pending);
      this.#pending.set(id, pending);
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

  cancel(value?: AssetId): void {
    if (value === undefined) {
      for (const pending of this.#pending.values()) pending.controller.abort();
      return;
    }
    this.#pending
      .get(requireCatalogAsset(value).id as AssetId)
      ?.controller.abort();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const pending of this.#pending.values()) pending.controller.abort();
    this.#pending.clear();
    for (const entry of this.#cache.values()) {
      entry.released = true;
      entry.geometry.dispose();
    }
    this.#cache.clear();
    this.#cacheBytes = 0;
    for (const entry of this.#ephemeral) {
      entry.released = true;
      entry.geometry.dispose();
    }
    this.#ephemeral.clear();
    this.#activeLeases = 0;
  }

  #start(asset: CatalogAsset, pending: PendingEntry): Promise<GeometryEntry> {
    const promise = (async () => {
      try {
        const url =
          this.#baseUrl !== undefined
            ? assetUrlFor(asset.id, this.#baseUrl)
            : typeof ORBSIE_STANDALONE_ASSET_WORKER !== "undefined"
              ? `.${assetPathFor(asset.id)}`
              : assetPathFor(asset.id);
        const raw = this.#fetchBytes
          ? await this.#fetchBytes(url, pending.controller.signal)
          : await defaultFetchBytes(
              url,
              pending.controller.signal,
              this.#maxAssetBytes,
              this.#verifyManifest ? asset.sizeBytes : undefined,
            );
        throwIfAborted(pending.controller.signal);
        if (!(raw instanceof ArrayBuffer) && !(raw instanceof Uint8Array))
          throw new AssetGeometryError(
            "fetch-failed",
            "The catalog asset resolver returned invalid bytes.",
          );
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
          if ((await sha256Hex(bytes)) !== asset.sha256)
            throw new AssetGeometryError(
              "integrity-failed",
              `Asset ${asset.id} does not match its manifest SHA-256.`,
            );
        }
        let geometry: THREE.BufferGeometry | undefined;
        let transferred = false;
        try {
          geometry = await prepareAssetGeometry(
            bytes,
            asset.id as AssetId,
            this.#maxVertices,
            this.#maxGeometryBytes,
            pending.controller.signal,
            {
              workerUrl: this.#workerUrl,
              workerFactory: this.#workerFactory,
              workerTimeoutMs: this.#workerTimeoutMs,
              maxQueuedJobs: this.#maxQueuedJobs,
              maxAssetBytes: this.#maxAssetBytes,
              verifyManifest: this.#verifyManifest,
            },
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
          } else this.#ephemeral.add(entry);
          transferred = true;
          return entry;
        } finally {
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

export function createAssetGeometryLoader(
  options: AssetGeometryLoaderOptions = {},
): AssetGeometryLoader {
  return new AssetGeometryLoader(options);
}
