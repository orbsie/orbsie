import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareAssetGeometry,
  type AssetGeometryWorkerLike,
} from "../src/lib/asset-geometry-queue";

class FakeWorker implements AssetGeometryWorkerLike {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly terminate = vi.fn();
  readonly postMessage = vi.fn();

  constructor() {
    FakeWorker.instances.push(this);
  }
}

const workerFactory = () => new FakeWorker();

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});

function start(
  controller = new AbortController(),
  options: Parameters<typeof prepareAssetGeometry>[5] = {},
) {
  return {
    controller,
    promise: prepareAssetGeometry(
      new Uint8Array([1, 2, 3]),
      "kenney.nature.tree-default",
      100_000,
      1_000_000,
      controller.signal,
      { workerFactory, ...options },
    ),
  };
}

describe("bounded catalog geometry worker queue", () => {
  it("bounds queued work and removes cancelled jobs before worker startup", async () => {
    vi.stubGlobal("window", {});
    const jobs = Array.from({ length: 9 }, () =>
      start(undefined, { maxQueuedJobs: 8 }),
    );
    expect(FakeWorker.instances).toHaveLength(1);
    await expect(
      start(undefined, { maxQueuedJobs: 8 }).promise,
    ).rejects.toThrow("queue is full");
    for (const job of jobs.slice(1)) job.controller.abort();
    expect(FakeWorker.instances).toHaveLength(1);
    jobs[0].controller.abort();
    const outcomes = await Promise.allSettled(jobs.map((job) => job.promise));
    expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(
      true,
    );
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });

  it("terminates an active worker on cancellation and releases the next job", async () => {
    vi.stubGlobal("window", {});
    const first = start();
    const second = start();
    first.controller.abort();
    expect(FakeWorker.instances).toHaveLength(2);
    second.controller.abort();
    await expect(first.promise).rejects.toMatchObject({ code: "aborted" });
    await expect(second.promise).rejects.toMatchObject({ code: "aborted" });
    expect(
      FakeWorker.instances.every(
        (worker) => worker.terminate.mock.calls.length,
      ),
    ).toBe(true);
  });

  it("does not decode on the browser main thread when worker startup fails", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("Worker", undefined);
    await expect(
      prepareAssetGeometry(
        new Uint8Array([1]),
        "kenney.nature.tree-default",
        100_000,
        1_000_000,
        new AbortController().signal,
      ),
    ).rejects.toThrow("Could not start catalog geometry worker");
  });

  it("reconstructs only the transferred typed arrays on the main thread", async () => {
    vi.stubGlobal("window", {});
    const job = start();
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    FakeWorker.instances[0].onmessage?.({
      data: {
        decoded: {
          attributes: {
            position: { array: positions, itemSize: 3, normalized: false },
          },
          box: { min: [0, 0, 0], max: [1, 1, 0] },
          sphere: { center: [0.5, 0.5, 0], radius: 1 },
          byteLength: positions.byteLength,
          userData: { sourceTransformsPreserved: true },
        },
      },
    } as MessageEvent);
    const geometry = await job.promise;
    expect(geometry.getAttribute("position").array).toBe(positions);
    expect(geometry.boundingBox?.max.toArray()).toEqual([1, 1, 0]);
    expect(geometry.userData.sourceTransformsPreserved).toBe(true);
    geometry.dispose();
  });
});
