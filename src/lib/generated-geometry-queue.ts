import * as THREE from "three";
import { GeneratedGeometryError } from "./generated-geometry-error";
// Static worker is bundled by build-player for both Next and standalone playback.
const MAX_QUEUED = 8;
type Job = {
  bytes?: Uint8Array;
  hash: string;
  maxVertices: number;
  maxGeometryBytes: number;
  signal: AbortSignal;
  resolve: (g: THREE.BufferGeometry) => void;
  reject: (e: unknown) => void;
  cancel: () => void;
};
const queue: Job[] = [];
let active: Job | undefined;
let stopActive: (() => void) | undefined;
function aborted() {
  return new GeneratedGeometryError(
    "aborted",
    "Generated geometry loading was cancelled.",
  );
}
function pump() {
  if (active || !queue.length) return;
  const job = queue.shift()!;
  active = job;
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = (error?: unknown, geometry?: THREE.BufferGeometry) => {
    if (active !== job) {
      geometry?.dispose();
      return;
    }
    worker?.terminate();
    clearTimeout(timer);
    job.signal.removeEventListener("abort", job.cancel);
    active = undefined;
    stopActive = undefined;
    if (error) job.reject(error);
    else job.resolve(geometry!);
    pump();
  };
  stopActive = () => finish(aborted());
  try {
    if (typeof Worker === "undefined")
      throw Error("Web Workers are unavailable in this browser.");
    // Export build substitutes the relative URL; editor uses the public runtime directory.
    worker = new Worker(
      typeof ORBSIE_STANDALONE_WORKER !== "undefined"
        ? ORBSIE_STANDALONE_WORKER
        : "/player/generated-geometry-worker.js",
      { type: "module" },
    );
    worker.onerror = () =>
      finish(
        new GeneratedGeometryError(
          "parse-failed",
          "Generated geometry worker failed. Reload and try again.",
        ),
      );
    worker.onmessageerror = () =>
      finish(
        new GeneratedGeometryError(
          "parse-failed",
          "Generated geometry worker returned unreadable data.",
        ),
      );
    worker.onmessage = ({ data }) => {
      if (data.error)
        return finish(new GeneratedGeometryError(data.code, data.error));
      let geometry: THREE.BufferGeometry | undefined;
      try {
        geometry = new THREE.BufferGeometry();
        for (const [name, a] of Object.entries(data.attributes) as [
          string,
          { array: Float32Array; itemSize: number; normalized: boolean },
        ][])
          geometry.setAttribute(
            name,
            new THREE.BufferAttribute(a.array, a.itemSize, a.normalized),
          );
        geometry.boundingBox = new THREE.Box3(
          new THREE.Vector3().copy(data.box.min),
          new THREE.Vector3().copy(data.box.max),
        );
        geometry.boundingSphere = new THREE.Sphere(
          new THREE.Vector3().copy(data.sphere.center),
          data.sphere.radius,
        );
        geometry.userData = data.userData;
        finish(undefined, geometry);
      } catch (error) {
        geometry?.dispose();
        finish(error);
      }
    };
    timer = setTimeout(
      () =>
        finish(
          new GeneratedGeometryError(
            "parse-failed",
            "Generated geometry worker timed out.",
          ),
        ),
      30000,
    );
    worker.postMessage(
      {
        bytes: job.bytes,
        hash: job.hash,
        maxVertices: job.maxVertices,
        maxGeometryBytes: job.maxGeometryBytes,
      },
      job.bytes ? [job.bytes.buffer as ArrayBuffer] : [],
    );
  } catch (error) {
    finish(
      new GeneratedGeometryError(
        "parse-failed",
        "Could not start generated geometry worker.",
        { cause: error },
      ),
    );
  }
}
declare const ORBSIE_STANDALONE_WORKER: string | undefined;
export async function prepareGeneratedGeometry(
  bytes: Uint8Array | undefined,
  hash: string,
  maxVertices: number,
  maxGeometryBytes: number,
  signal: AbortSignal,
): Promise<THREE.BufferGeometry> {
  if (signal.aborted) throw aborted();
  if (typeof window === "undefined") {
    // Explicit non-browser test/server path. Browser failures never fall back here.
    if (!bytes) throw Error("Node geometry decoding requires explicit bytes.");
    const { decodeGeneratedGeometry } =
      await import("./generated-geometry-core");
    return decodeGeneratedGeometry(bytes, hash, maxVertices, maxGeometryBytes);
  }
  if (queue.length >= MAX_QUEUED)
    throw new GeneratedGeometryError(
      "too-large",
      "Generated geometry queue is full. Try again after current models finish.",
    );
  return new Promise((resolve, reject) => {
    const job: Job = {
      bytes,
      hash,
      maxVertices,
      maxGeometryBytes,
      signal,
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
