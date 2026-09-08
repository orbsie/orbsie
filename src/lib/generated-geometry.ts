import * as THREE from "three";
import { GeneratedGeometryError } from "./generated-geometry-error";
export { GeneratedGeometryError } from "./generated-geometry-error";
import { prepareGeneratedGeometry } from "./generated-geometry-queue";

import {
  MAX_GENERATED_MODEL_BYTES,
  readGeneratedModel,
} from "./generated-models";

const DEFAULT_MAX_CACHE_ENTRIES = 10;
const DEFAULT_MAX_CACHE_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_GEOMETRY_BYTES = 24 * 1024 * 1024;
const DEFAULT_MAX_VERTICES = 100_000;

/** Trusted application-owned bytes lookup keyed only by the validated hash. */
export type GeneratedBytesResolver = (
  hash: string,
  signal: AbortSignal,
) => Promise<ArrayBuffer | Uint8Array>;

export interface GeneratedGeometryLoaderOptions {
  /** Maximum number of cached merged geometries. */
  readonly maxCacheEntries?: number;
  /** Maximum estimated GPU attribute bytes retained by the cache. */
  readonly maxCacheBytes?: number;
  /** Reject a merged result larger than this before it reaches the cache. */
  readonly maxGeometryBytes?: number;
  /** Reject maliciously complex models before merging. */
  readonly maxVertices?: number;
  /** Optional trusted hash-to-bytes resolver for standalone exports. */
  readonly resolveBytes?: GeneratedBytesResolver;
}

export interface GeneratedGeometryLoadOptions {
  readonly signal?: AbortSignal;
}

export interface LoadedGeneratedGeometry {
  readonly hash: string;
  readonly geometry: THREE.BufferGeometry;
  /** Estimated attribute memory retained by this geometry. */
  readonly byteLength: number;
  /** Release this caller's ownership; safe to call more than once. */
  readonly release: () => void;
  /** Alias used by scene teardown code. */
  readonly dispose: () => void;
}

export interface GeneratedGeometryCacheStats {
  readonly entries: number;
  readonly bytes: number;
  readonly pending: number;
  readonly activeLeases: number;
}

interface GeometryEntry {
  readonly hash: string;
  readonly geometry: THREE.BufferGeometry;
  readonly byteLength: number;
  cached: boolean;
  refs: number;
  released: boolean;
}

interface PendingEntry {
  readonly hash: string;
  readonly controller: AbortController;
  consumers: number;
  done: boolean;
  promise: Promise<GeometryEntry>;
}

function abortError(
  message = "Generated geometry loading was cancelled.",
): GeneratedGeometryError {
  return new GeneratedGeometryError("aborted", message);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function assertHash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new GeneratedGeometryError(
      "invalid-hash",
      "Generated geometry requires a lowercase SHA-256 content hash.",
    );
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

export class GeneratedGeometryLoader {
  readonly #maxCacheEntries: number;
  readonly #maxCacheBytes: number;
  readonly #maxGeometryBytes: number;
  readonly #maxVertices: number;
  readonly #resolveBytes: GeneratedBytesResolver | undefined;
  readonly #cache = new Map<string, GeometryEntry>();
  readonly #pending = new Map<string, PendingEntry>();
  readonly #ephemeral = new Set<GeometryEntry>();
  #cacheBytes = 0;
  #activeLeases = 0;
  #disposed = false;

  constructor(options: GeneratedGeometryLoaderOptions = {}) {
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
    this.#resolveBytes =
      options.resolveBytes ??
      (typeof window === "undefined"
        ? async (hash) => (await readGeneratedModel(hash)).glb
        : undefined);
  }

  get stats(): GeneratedGeometryCacheStats {
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
    hash: string,
    options: GeneratedGeometryLoadOptions = {},
  ): Promise<LoadedGeneratedGeometry> {
    if (this.#disposed)
      throw new GeneratedGeometryError(
        "disposed",
        "This generated geometry loader has been disposed.",
      );
    assertHash(hash);
    throwIfAborted(options.signal);
    const cached = this.#cache.get(hash);
    if (cached) {
      this.#touch(cached);
      return this.#lease(cached);
    }

    let pending = this.#pending.get(hash);
    if (pending?.controller.signal.aborted && !pending.done) {
      this.#pending.delete(hash);
      pending = undefined;
    }
    if (!pending) {
      const controller = new AbortController();
      pending = {
        hash,
        controller,
        consumers: 0,
        done: false,
        promise: Promise.resolve(undefined as never),
      };
      pending.promise = this.#start(pending);
      this.#pending.set(hash, pending);
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

  /** Cancel an in-flight load, or all in-flight loads when no hash is supplied. */
  cancel(hash?: string): void {
    if (hash === undefined) {
      for (const pending of this.#pending.values()) pending.controller.abort();
      return;
    }
    assertHash(hash);
    this.#pending.get(hash)?.controller.abort();
  }

  /** Release all cache ownership and abort unresolved work. */
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

  #start(pending: PendingEntry): Promise<GeometryEntry> {
    const promise = (async () => {
      let geometry: THREE.BufferGeometry | undefined;
      let transferred = false;
      try {
        let raw: ArrayBuffer | Uint8Array | undefined;
        try {
          raw = await this.#resolveBytes?.(
            pending.hash,
            pending.controller.signal,
          );
        } catch (error) {
          if (pending.controller.signal.aborted) throw abortError();
          if (error instanceof GeneratedGeometryError) throw error;
          const message =
            error instanceof Error
              ? error.message
              : "Could not read generated model.";
          throw new GeneratedGeometryError(
            /integrity/i.test(message) ? "integrity-failed" : "fetch-failed",
            `Could not read generated model ${pending.hash}.`,
            { cause: error },
          );
        }
        throwIfAborted(pending.controller.signal);
        if (
          (raw !== undefined || this.#resolveBytes !== undefined) &&
          !(raw instanceof ArrayBuffer) &&
          !(raw instanceof Uint8Array)
        )
          throw new GeneratedGeometryError(
            "fetch-failed",
            "The generated model resolver returned invalid bytes.",
          );
        const bytes = raw === undefined ? undefined : new Uint8Array(raw);
        if (bytes && bytes.byteLength > MAX_GENERATED_MODEL_BYTES)
          throw new GeneratedGeometryError(
            "too-large",
            `Generated model exceeds the ${MAX_GENERATED_MODEL_BYTES} byte limit.`,
          );
        geometry = await prepareGeneratedGeometry(
          bytes,
          pending.hash,
          this.#maxVertices,
          this.#maxGeometryBytes,
          pending.controller.signal,
        );
        throwIfAborted(pending.controller.signal);
        const entry: GeometryEntry = {
          hash: pending.hash,
          geometry,
          byteLength: Object.values(geometry.attributes).reduce(
            (n, a) => n + a.array.byteLength,
            0,
          ),
          cached: false,
          refs: 0,
          released: false,
        };
        if (entry.byteLength <= this.#maxCacheBytes) {
          entry.cached = true;
          this.#cache.set(entry.hash, entry);
          this.#cacheBytes += entry.byteLength;
          this.#trimCache();
        } else this.#ephemeral.add(entry);
        transferred = true;
        return entry;
      } catch (error) {
        if (error instanceof GeneratedGeometryError) throw error;
        if (pending.controller.signal.aborted) throw abortError();
        throw error;
      } finally {
        pending.done = true;
        if (this.#pending.get(pending.hash) === pending)
          this.#pending.delete(pending.hash);

        if (!transferred) geometry?.dispose();
      }
    })();
    pending.promise = promise;
    return promise;
  }

  #lease(entry: GeometryEntry): LoadedGeneratedGeometry {
    if (entry.released)
      throw new GeneratedGeometryError(
        "disposed",
        "Generated geometry is no longer available.",
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
      hash: entry.hash,
      geometry: entry.geometry,
      byteLength: entry.byteLength,
      release,
      dispose: release,
    };
  }

  #touch(entry: GeometryEntry): void {
    if (!entry.cached) return;
    this.#cache.delete(entry.hash);
    this.#cache.set(entry.hash, entry);
  }

  #trimCache(): void {
    for (const [hash, entry] of this.#cache) {
      if (
        (this.#cache.size <= this.#maxCacheEntries &&
          this.#cacheBytes <= this.#maxCacheBytes) ||
        entry.refs > 0
      )
        continue;
      this.#cache.delete(hash);
      this.#cacheBytes -= entry.byteLength;
      entry.released = true;
      entry.geometry.dispose();
    }
  }
}

export function createGeneratedGeometryLoader(
  options: GeneratedGeometryLoaderOptions = {},
): GeneratedGeometryLoader {
  return new GeneratedGeometryLoader(options);
}
