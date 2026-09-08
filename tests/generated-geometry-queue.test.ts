import { afterEach, expect, it, vi } from "vitest";
import { prepareGeneratedGeometry } from "../src/lib/generated-geometry-queue";
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});
function setup() {
  vi.stubGlobal("window", {});
  vi.stubGlobal("Worker", FakeWorker);
}
function start(controller = new AbortController()) {
  return {
    controller,
    promise: prepareGeneratedGeometry(
      new Uint8Array(20),
      "a".repeat(64),
      100000,
      1000000,
      controller.signal,
    ),
  };
}
it("bounds the queue and removes cancelled queued work without starting it", async () => {
  setup();
  const jobs = Array.from({ length: 9 }, () => start());
  const settled = Promise.allSettled(jobs.map((j) => j.promise));
  expect(FakeWorker.instances).toHaveLength(1);
  await expect(start().promise).rejects.toThrow("queue is full");
  for (const job of jobs.slice(1)) job.controller.abort();
  expect(FakeWorker.instances).toHaveLength(1);
  jobs[0].controller.abort();
  await settled;
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
});
it("terminates active decoding on cancellation then starts the next job", async () => {
  setup();
  const first = start(),
    second = start();
  const result = Promise.allSettled([first.promise, second.promise]);
  first.controller.abort();
  expect(FakeWorker.instances).toHaveLength(2);
  FakeWorker.instances[1].onerror?.();
  const outcomes = await result;
  expect(outcomes.every((o) => o.status === "rejected")).toBe(true);
  expect(
    FakeWorker.instances.every((w) => w.terminate.mock.calls.length === 1),
  ).toBe(true);
});
it("does not decode on the browser main thread when Worker is unavailable", async () => {
  setup();
  vi.stubGlobal("Worker", undefined);
  await expect(start().promise).rejects.toThrow("Could not start");
});
it("wraps worker-transferred attributes without recomputing their bounds", async () => {
  setup();
  const job = start();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  FakeWorker.instances[0].onmessage?.({
    data: {
      attributes: {
        position: { array: positions, itemSize: 3, normalized: false },
      },
      box: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 } },
      sphere: { center: { x: 0.5, y: 0.5, z: 0 }, radius: 1 },
      userData: { sourceTransformsPreserved: true },
    },
  });
  const geometry = await job.promise;
  expect(geometry.getAttribute("position").array).toBe(positions);
  expect(geometry.boundingBox?.max.toArray()).toEqual([1, 1, 0]);
  geometry.dispose();
});

it("terminates a stalled worker at the deadline and releases the queue", async () => {
  setup();
  vi.useFakeTimers();
  try {
    const job = start();
    const failure = expect(job.promise).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30000);
    await failure;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
