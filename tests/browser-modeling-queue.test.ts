import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_MODEL_MAX_PENDING,
  evaluateBrowserModelRecipeInWorker,
  type BrowserModelWorkerLike,
} from "../src/lib/browser-modeling-queue";
import { parseBrowserModelRecipe } from "../src/lib/browser-modeling";
import type {
  BrowserModelWorkerRequest,
  BrowserModelWorkerResponse,
  BrowserModelWorkerSuccess,
} from "../src/lib/browser-modeling-worker";

const recipe = parseBrowserModelRecipe({
  version: 1,
  revision: 3,
  output: "box",
  nodes: [{ id: "box", kind: "box", size: [2, 2, 2] }],
});

const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
const indices = new Uint32Array([0, 1, 2]);

class FakeWorker implements BrowserModelWorkerLike {
  static instances: FakeWorker[] = [];
  onmessage:
    ((event: MessageEvent<BrowserModelWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly terminate = vi.fn();
  readonly postMessage = vi.fn((message: BrowserModelWorkerRequest) => {
    this.request = message;
  });
  request?: BrowserModelWorkerRequest;

  constructor() {
    FakeWorker.instances.push(this);
  }

  emit(response: BrowserModelWorkerResponse) {
    this.onmessage?.({
      data: response,
    } as MessageEvent<BrowserModelWorkerResponse>);
  }

  emitError() {
    this.onerror?.({ message: "failed" } as ErrorEvent);
  }
}

const workerFactory = () => new FakeWorker();
const controllers: AbortController[] = [];
const promises: Promise<unknown>[] = [];

function start(
  overrides: Parameters<typeof evaluateBrowserModelRecipeInWorker>[2] = {},
) {
  const controller = new AbortController();
  const promise = evaluateBrowserModelRecipeInWorker(
    recipe,
    controller.signal,
    {
      workerFactory,
      ...overrides,
    },
  );
  controllers.push(controller);
  promises.push(promise);
  return { controller, promise };
}

function success(
  worker: FakeWorker,
  overrides: Partial<BrowserModelWorkerSuccess> = {},
) {
  const request = worker.request!;
  worker.emit({
    type: "result",
    jobId: request.jobId,
    revision: request.recipe.revision,
    vertices: positions,
    indices,
    bounds: { min: [-1, -1, 0], max: [1, 1, 0] },
    statistics: {
      triangles: 1,
      vertices: 3,
      bytes: positions.byteLength + indices.byteLength,
    },
    ...overrides,
  } as BrowserModelWorkerResponse);
}

afterEach(async () => {
  for (const controller of controllers) controller.abort();
  await Promise.allSettled(promises);
  controllers.length = 0;
  promises.length = 0;
  FakeWorker.instances = [];
  vi.useRealTimers();
});

describe("browser modeling worker queue", () => {
  it("starts one worker, transfers a typed result, and validates its shape", async () => {
    const job = start();
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0];
    expect(worker.request).toMatchObject({ type: "evaluate", recipe });
    success(worker);
    const result = await job.promise;
    expect(result.vertices).toBe(positions);
    expect(result.indices).toBe(indices);
    expect(result.statistics).toEqual({
      triangles: 1,
      vertices: 3,
      bytes: positions.byteLength + indices.byteLength,
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("allows one active job and bounds pending work", async () => {
    const first = start();
    const waiting = Array.from({ length: BROWSER_MODEL_MAX_PENDING }, () =>
      start(),
    );
    await expect(start().promise).rejects.toMatchObject({ code: "queue-full" });
    expect(FakeWorker.instances).toHaveLength(1);
    first.controller.abort();
    await expect(first.promise).rejects.toMatchObject({ code: "aborted" });
    for (const job of waiting) job.controller.abort();
    await Promise.all(
      waiting.map((job) =>
        expect(job.promise).rejects.toMatchObject({ code: "aborted" }),
      ),
    );
  });

  it("removes only the queued cancellation and ignores stale active output", async () => {
    const first = start();
    const second = start();
    const third = start();
    const firstWorker = FakeWorker.instances[0];
    const staleHandler = firstWorker.onmessage;
    second.controller.abort();
    first.controller.abort();
    await expect(first.promise).rejects.toMatchObject({ code: "aborted" });
    expect(FakeWorker.instances).toHaveLength(2);
    const thirdWorker = FakeWorker.instances[1];
    staleHandler?.({
      data: {
        type: "result",
        jobId: firstWorker.request!.jobId,
        revision: recipe.revision,
        vertices: positions,
        indices,
        bounds: { min: [-1, -1, 0], max: [1, 1, 0] },
        statistics: { triangles: 1, vertices: 3, bytes: 48 },
      },
    } as MessageEvent<BrowserModelWorkerResponse>);
    success(thirdWorker);
    await expect(second.promise).rejects.toMatchObject({ code: "aborted" });
    await expect(third.promise).resolves.toMatchObject({
      statistics: { triangles: 1 },
    });
  });

  it("times out, terminates the worker, and recovers for the next job", async () => {
    vi.useFakeTimers();
    const first = start({ deadlineMs: 10 });
    vi.advanceTimersByTime(10);
    await expect(first.promise).rejects.toMatchObject({ code: "timeout" });
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    const second = start();
    success(FakeWorker.instances[1]);
    await expect(second.promise).resolves.toMatchObject({
      statistics: { triangles: 1 },
    });
  });

  it("recovers when the worker reports an execution error", async () => {
    const first = start();
    FakeWorker.instances[0].emitError();
    await expect(first.promise).rejects.toMatchObject({ code: "worker" });
    const second = start();
    success(FakeWorker.instances[1]);
    await expect(second.promise).resolves.toMatchObject({
      statistics: { triangles: 1 },
    });
  });

  it.each([
    ["job ID", { jobId: "stale-job" }],
    ["revision", { revision: recipe.revision + 1 }],
  ])("rejects a wrong %s and recovers", async (_label, mismatch) => {
    const first = start();
    success(FakeWorker.instances[0], mismatch);
    await expect(first.promise).rejects.toMatchObject({ code: "protocol" });
    const second = start();
    success(FakeWorker.instances[1]);
    await expect(second.promise).resolves.toMatchObject({
      statistics: { triangles: 1 },
    });
  });

  it.each([
    ["non-finite vertices", { vertices: new Float32Array([NaN, 0, 0]) }],
    ["out-of-range index", { indices: new Uint32Array([0, 1, 9]) }],
    [
      "false bounds",
      {
        bounds: {
          min: [-2, -1, 0] as [number, number, number],
          max: [1, 1, 0] as [number, number, number],
        },
      },
    ],
    [
      "empty mesh",
      { vertices: new Float32Array(), indices: new Uint32Array() },
    ],
  ])("rejects malformed %s and recovers", async (_label, malformed) => {
    const first = start();
    success(FakeWorker.instances[0], malformed);
    await expect(first.promise).rejects.toMatchObject({ code: "protocol" });
    const second = start();
    success(FakeWorker.instances[1]);
    await expect(second.promise).resolves.toMatchObject({
      statistics: { triangles: 1 },
    });
  });

  it("snapshots the recipe and validates options before starting work", async () => {
    const holding = start();
    const mutable = {
      version: 1 as const,
      revision: 3,
      output: "box",
      nodes: [
        {
          id: "box",
          kind: "box" as const,
          size: [2, 2, 2] as [number, number, number],
        },
      ],
    };
    const controller = new AbortController();
    const promise = evaluateBrowserModelRecipeInWorker(
      mutable,
      controller.signal,
      {
        workerFactory,
      },
    );
    mutable.nodes[0].size[0] = 99;
    expect(FakeWorker.instances).toHaveLength(1);
    holding.controller.abort();
    await expect(holding.promise).rejects.toMatchObject({ code: "aborted" });
    expect(FakeWorker.instances[1].request?.recipe.nodes[0]).toMatchObject({
      size: [2, 2, 2],
    });
    success(FakeWorker.instances[1]);
    await expect(promise).resolves.toMatchObject({
      statistics: { triangles: 1 },
    });

    await expect(
      evaluateBrowserModelRecipeInWorker(recipe, new AbortController().signal, {
        workerFactory,
        deadlineMs: DEFAULT_TEST_DEADLINE + 1,
      }),
    ).rejects.toThrow("deadlineMs");
    const recovery = start();
    success(FakeWorker.instances[2]);
    await expect(recovery.promise).resolves.toMatchObject({
      statistics: { triangles: 1 },
    });
  });
});

const DEFAULT_TEST_DEADLINE = 15_000;
