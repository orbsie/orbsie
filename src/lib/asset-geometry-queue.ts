import * as THREE from "three";
import { AssetGeometryError } from "./asset-geometry-error";
import type {
  AssetGeometryArray,
  AssetGeometryTransfer,
} from "./asset-geometry-core";
import type { AssetId } from "./asset-catalog";

// Ten catalog IDs can be requested together by a cold scene. The active job
// plus this bounded waiting room still keeps decode work finite.
const DEFAULT_MAX_QUEUED = 10;
const DEFAULT_WORKER_TIMEOUT_MS = 30_000;

/** Small test seam that does not expose Worker construction to the core. */
export interface AssetGeometryWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export type AssetGeometryWorkerFactory = (
  url: string,
) => AssetGeometryWorkerLike;

export interface PrepareAssetGeometryOptions {
  readonly workerUrl?: string;
  readonly workerFactory?: AssetGeometryWorkerFactory;
  readonly workerTimeoutMs?: number;
  readonly maxQueuedJobs?: number;
  readonly maxAssetBytes?: number;
  readonly verifyManifest?: boolean;
}

type Job = {
  bytes: Uint8Array;
  id: AssetId;
  maxAssetBytes: number;
  maxVertices: number;
  maxGeometryBytes: number;
  verifyManifest: boolean;
  signal: AbortSignal;
  options: PrepareAssetGeometryOptions;
  resolve: (geometry: THREE.BufferGeometry) => void;
  reject: (error: unknown) => void;
  cancel: () => void;
};

const queue: Job[] = [];
let active: Job | undefined;
let stopActive: (() => void) | undefined;

function aborted(): AssetGeometryError {
  return new AssetGeometryError(
    "aborted",
    "Asset geometry loading was cancelled.",
  );
}

function positiveBound(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`${name} must be positive.`);
  return Math.floor(value);
}

function point(
  value: readonly number[] | { x: number; y: number; z: number },
  label: string,
): [number, number, number] {
  const values: readonly number[] = Array.isArray(value)
    ? value
    : [
        (value as { x: number }).x,
        (value as { y: number }).y,
        (value as { z: number }).z,
      ];
  if (
    values.length !== 3 ||
    values.some((coordinate) => !Number.isFinite(coordinate))
  )
    throw new AssetGeometryError(
      "parse-failed",
      `Catalog geometry returned invalid ${label} bounds.`,
    );
  return [values[0], values[1], values[2]];
}

function isTypedArray(value: unknown): value is AssetGeometryArray {
  return (
    ArrayBuffer.isView(value) &&
    !(value instanceof DataView) &&
    typeof (value as { length?: unknown }).length === "number"
  );
}

/** Reconstruct the only Three.js object that crosses back onto the main thread. */
export function reconstructAssetGeometry(
  decoded: AssetGeometryTransfer,
): THREE.BufferGeometry {
  if (!decoded || typeof decoded !== "object" || !decoded.attributes)
    throw new AssetGeometryError(
      "parse-failed",
      "Catalog geometry worker returned an invalid payload.",
    );
  const geometry = new THREE.BufferGeometry();
  try {
    for (const [name, attribute] of Object.entries(decoded.attributes)) {
      if (
        !attribute ||
        !isTypedArray(attribute.array) ||
        !Number.isSafeInteger(attribute.itemSize) ||
        attribute.itemSize <= 0
      )
        throw new AssetGeometryError(
          "parse-failed",
          `Catalog geometry returned an invalid ${name} attribute.`,
        );
      geometry.setAttribute(
        name,
        new THREE.BufferAttribute(
          attribute.array,
          attribute.itemSize,
          Boolean(attribute.normalized),
        ),
      );
    }
    const min = point(decoded.box.min, "minimum");
    const max = point(decoded.box.max, "maximum");
    const center = point(decoded.sphere.center, "sphere");
    if (!Number.isFinite(decoded.sphere.radius) || decoded.sphere.radius < 0)
      throw new AssetGeometryError(
        "parse-failed",
        "Catalog geometry returned an invalid sphere radius.",
      );
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(...min),
      new THREE.Vector3(...max),
    );
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(...center),
      decoded.sphere.radius,
    );
    geometry.userData = { ...(decoded.userData ?? {}) };
    return geometry;
  } catch (error) {
    geometry.dispose();
    throw error;
  }
}

declare const ORBSIE_STANDALONE_ASSET_WORKER: string | undefined;

function defaultWorkerUrl(): string {
  return typeof ORBSIE_STANDALONE_ASSET_WORKER !== "undefined"
    ? ORBSIE_STANDALONE_ASSET_WORKER
    : "/player/asset-geometry-worker.js";
}

function defaultWorkerFactory(url: string): AssetGeometryWorkerLike {
  if (typeof Worker === "undefined")
    throw new AssetGeometryError(
      "parse-failed",
      "Could not start catalog geometry worker: Web Workers are unavailable.",
    );
  return new Worker(url, { type: "module" });
}

function transferBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength)
    return bytes;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function failureFromWorker(data: unknown): AssetGeometryError | undefined {
  if (!data || typeof data !== "object") return undefined;
  const payload = data as {
    error?: unknown;
    code?: unknown;
  };
  if (typeof payload.error !== "string") return undefined;
  const codes: AssetGeometryError["code"][] = [
    "unknown-id",
    "unsafe-url",
    "fetch-failed",
    "too-large",
    "parse-failed",
    "empty-geometry",
    "integrity-failed",
    "aborted",
    "disposed",
  ];
  const code = codes.includes(payload.code as AssetGeometryError["code"])
    ? (payload.code as AssetGeometryError["code"])
    : "parse-failed";
  return new AssetGeometryError(code, payload.error);
}

function decodedFromWorker(data: unknown): AssetGeometryTransfer {
  const payload =
    data && typeof data === "object" && "decoded" in data
      ? (data as { decoded: AssetGeometryTransfer }).decoded
      : (data as AssetGeometryTransfer);
  if (!payload || typeof payload !== "object" || !payload.attributes)
    throw new AssetGeometryError(
      "parse-failed",
      "Catalog geometry worker returned an invalid payload.",
    );
  return payload;
}

function pump(): void {
  if (active || !queue.length) return;
  const job = queue.shift()!;
  active = job;
  let worker: AssetGeometryWorkerLike | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = (error?: unknown, geometry?: THREE.BufferGeometry) => {
    if (active !== job) {
      geometry?.dispose();
      return;
    }
    worker?.terminate();
    if (timer !== undefined) clearTimeout(timer);
    job.signal.removeEventListener("abort", job.cancel);
    active = undefined;
    stopActive = undefined;
    if (error) job.reject(error);
    else job.resolve(geometry!);
    pump();
  };
  stopActive = () => finish(aborted());
  try {
    const factory = job.options.workerFactory ?? defaultWorkerFactory;
    worker = factory(job.options.workerUrl ?? defaultWorkerUrl());
    worker.onerror = () =>
      finish(
        new AssetGeometryError(
          "parse-failed",
          "Catalog geometry worker failed. Reload and try again.",
        ),
      );
    worker.onmessageerror = () =>
      finish(
        new AssetGeometryError(
          "parse-failed",
          "Catalog geometry worker returned unreadable data.",
        ),
      );
    worker.onmessage = ({ data }) => {
      const failure = failureFromWorker(data);
      if (failure) {
        finish(failure);
        return;
      }
      let geometry: THREE.BufferGeometry | undefined;
      try {
        geometry = reconstructAssetGeometry(decodedFromWorker(data));
        finish(undefined, geometry);
      } catch (error) {
        geometry?.dispose();
        finish(error);
      }
    };
    timer = setTimeout(
      () =>
        finish(
          new AssetGeometryError(
            "parse-failed",
            "Catalog geometry worker timed out.",
          ),
        ),
      positiveBound(
        job.options.workerTimeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS,
        "workerTimeoutMs",
      ),
    );
    const bytes = transferBytes(job.bytes);
    worker.postMessage(
      {
        bytes,
        id: job.id,
        maxAssetBytes: job.maxAssetBytes,
        maxVertices: job.maxVertices,
        maxGeometryBytes: job.maxGeometryBytes,
        verifyManifest: job.verifyManifest,
      },
      [bytes.buffer],
    );
  } catch (error) {
    finish(
      error instanceof AssetGeometryError
        ? error
        : new AssetGeometryError(
            "parse-failed",
            "Could not start catalog geometry worker.",
            { cause: error },
          ),
    );
  }
}

/** Decode on a worker in browsers, with an explicit Node/test fallback. */
export async function prepareAssetGeometry(
  bytes: Uint8Array,
  id: AssetId,
  maxVertices: number,
  maxGeometryBytes: number,
  signal: AbortSignal,
  options: PrepareAssetGeometryOptions = {},
): Promise<THREE.BufferGeometry> {
  if (signal.aborted) throw aborted();
  if (typeof window === "undefined") {
    const { decodeAssetGeometry } = await import("./asset-geometry-core");
    const decoded = await decodeAssetGeometry(
      bytes,
      id,
      maxVertices,
      maxGeometryBytes,
      {
        maxAssetBytes: options.maxAssetBytes,
        verifyManifest: options.verifyManifest,
      },
    );
    if (signal.aborted) throw aborted();
    return reconstructAssetGeometry(decoded);
  }
  const maxQueuedJobs = positiveBound(
    options.maxQueuedJobs ?? DEFAULT_MAX_QUEUED,
    "maxQueuedJobs",
  );
  if (queue.length >= maxQueuedJobs)
    throw new AssetGeometryError(
      "too-large",
      "Catalog geometry queue is full. Try again after current models finish.",
    );
  return new Promise((resolve, reject) => {
    const job: Job = {
      bytes,
      id,
      maxAssetBytes: options.maxAssetBytes ?? Number.MAX_SAFE_INTEGER,
      maxVertices,
      maxGeometryBytes,
      verifyManifest: options.verifyManifest ?? true,
      signal,
      options,
      resolve,
      reject,
      cancel: () => {
        if (active === job) stopActive?.();
        else {
          const index = queue.indexOf(job);
          if (index >= 0) queue.splice(index, 1);
          signal.removeEventListener("abort", job.cancel);
          reject(aborted());
        }
      },
    };
    signal.addEventListener("abort", job.cancel, { once: true });
    queue.push(job);
    pump();
  });
}

export const ASSET_GEOMETRY_MAX_QUEUED = DEFAULT_MAX_QUEUED;
