import { describe, expect, it } from "vitest";
import {
  BROWSER_PROCEDURAL_OUTPUT_MAX_BYTES,
  BROWSER_PROCEDURAL_SOURCE_MAX_BYTES,
  BrowserProceduralError,
  parseBrowserProceduralSource,
} from "../src/lib/browser-procedural";
import { evaluateBrowserProceduralSource } from "../src/lib/browser-procedural-evaluator";
import { BrowserProceduralQueue } from "../src/lib/browser-procedural-queue";

const box = (size = 1) => ({
  version: 1,
  revision: 0,
  output: "box",
  nodes: [{ id: "box", kind: "box", size: [size, size, size] }],
});

const sourceFor = (recipe: unknown) => ({
  version: 1 as const,
  language: "quickjs" as const,
  seed: 1,
  code: JSON.stringify(recipe),
});

describe("browser procedural QuickJS evaluator", () => {
  it("runs deterministically with the seeded orb and Math.random helpers", async () => {
    const source = {
      version: 1 as const,
      language: "quickjs" as const,
      seed: 42,
      code: `(() => {
        const first = 0.5 + orb.random();
        const second = 0.5 + Math.random();
        return {version: 1, revision: 0, output: "box", nodes: [
          {id: "box", kind: "box", size: [first, second, 1]}
        ]};
      })()`,
    };
    const first = await evaluateBrowserProceduralSource(source);
    const second = await evaluateBrowserProceduralSource(source);
    const changed = await evaluateBrowserProceduralSource({
      ...source,
      seed: 43,
    });
    expect(first).toEqual(second);
    expect(changed).not.toEqual(first);
  });

  it("keeps a zero seed nonzero internally and preserves its public seed", async () => {
    const recipe = await evaluateBrowserProceduralSource({
      version: 1,
      language: "quickjs",
      seed: 0,
      code: `({version: 1, revision: 0, output: "box", nodes: [{
        id: "box", kind: "box", size: [orb.seed === 0 ? 1 : 2, orb.random() + 1, 1]
      }]})`,
    });
    expect(recipe.nodes[0]).toMatchObject({ size: [1, expect.any(Number), 1] });
  });

  it("does not expose host, clock, storage, or WebAssembly capabilities", async () => {
    const recipe = await evaluateBrowserProceduralSource({
      version: 1,
      language: "quickjs",
      seed: 1,
      code: `({version: 1, revision: 0, output: "box", nodes: [{
        id: "box", kind: "box", size: [
          typeof fetch === "undefined" &&
          typeof document === "undefined" &&
          typeof localStorage === "undefined" &&
          typeof crypto === "undefined" &&
          typeof process === "undefined" &&
          typeof require === "undefined" &&
          typeof Date === "undefined" &&
          typeof WebAssembly === "undefined" ? 1 : 2,
          typeof orb.randomInt === "function" ? 1 : 2,
          1
        ]
      }]})`,
    });
    expect(recipe.nodes[0]).toMatchObject({ size: [1, 1, 1] });
  });

  it("rejects malformed recipes and bounded source/output", async () => {
    expect(() =>
      parseBrowserProceduralSource({
        version: 1,
        language: "quickjs",
        seed: 1,
        code: "x".repeat(BROWSER_PROCEDURAL_SOURCE_MAX_BYTES + 1),
      }),
    ).toThrowError(BrowserProceduralError);
    await expect(
      evaluateBrowserProceduralSource({
        version: 1,
        language: "quickjs",
        seed: 1,
        code: "({})",
      }),
    ).rejects.toMatchObject({ code: "invalid-recipe" });
    await expect(
      evaluateBrowserProceduralSource({
        version: 1,
        language: "quickjs",
        seed: 1,
        code: `"x".repeat(${BROWSER_PROCEDURAL_OUTPUT_MAX_BYTES + 1})`,
      }),
    ).rejects.toMatchObject({ code: "output-limit" });
  });

  it("uses captured serializer intrinsics when guest code mutates prototypes", async () => {
    const recipe = await evaluateBrowserProceduralSource({
      version: 1,
      language: "quickjs",
      seed: 1,
      code: `(() => {
        String.prototype.charCodeAt = () => 0;
        JSON.stringify = () => "not-a-recipe";
        return ${JSON.stringify(box(2))};
      })()`,
    });
    expect(recipe).toEqual(box(2));
    await expect(
      evaluateBrowserProceduralSource({
        version: 1,
        language: "quickjs",
        seed: 1,
        code: `(() => {
          String.prototype.charCodeAt = () => 0;
          return "x".repeat(${BROWSER_PROCEDURAL_OUTPUT_MAX_BYTES + 1});
        })()`,
      }),
    ).rejects.toMatchObject({ code: "output-limit" });
  });

  it("interrupts infinite loops and rejects cancellation before VM startup", async () => {
    await expect(
      evaluateBrowserProceduralSource(
        {
          version: 1,
          language: "quickjs",
          seed: 1,
          code: "(() => { while (true) {} })()",
        },
        { deadlineMs: 50 },
      ),
    ).rejects.toMatchObject({ code: "timeout" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      evaluateBrowserProceduralSource(
        {
          version: 1,
          language: "quickjs",
          seed: 1,
          code: JSON.stringify(box()),
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "aborted" });
  });

  it("enforces the QuickJS memory limit for runaway allocations", async () => {
    await expect(
      evaluateBrowserProceduralSource(
        {
          version: 1,
          language: "quickjs",
          seed: 1,
          code: `(() => { const values = []; for (let i = 0; i < 1000000; i++) values.push("xxxxxxxxxxxxxxxx"); return values; })()`,
        },
        { deadlineMs: 2_000 },
      ),
    ).rejects.toBeInstanceOf(BrowserProceduralError);
  });
});

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  posted: unknown[] = [];
  postMessage(value: unknown) {
    this.posted.push(value);
  }
  terminate() {
    this.terminated = true;
  }
}

class TrackingSignal {
  aborted = false;
  readonly listeners = new Set<() => void>();
  addEventListener(type: string, listener: () => void) {
    if (type === "abort") this.listeners.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    if (type === "abort") this.listeners.delete(listener);
  }
  abort() {
    this.aborted = true;
    for (const listener of [...this.listeners]) listener();
  }
}

describe("browser procedural worker queue", () => {
  it("bounds pending work and terminates workers on timeout before recovery", async () => {
    const workers: FakeWorker[] = [];
    const queue = new BrowserProceduralQueue({
      maxPending: 1,
      workerDeadlineMs: 10,
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });
    const first = queue.enqueue(sourceFor(box()));
    const pending = queue.enqueue(sourceFor(box()));
    await expect(queue.enqueue(sourceFor(box()))).rejects.toMatchObject({
      code: "queue-full",
    });
    await expect(first).rejects.toMatchObject({ code: "timeout" });
    expect(workers[0].terminated).toBe(true);

    workers[1].onmessage?.({
      data: {
        type: "result",
        jobId: (workers[1].posted[0] as { jobId: string }).jobId,
        recipe: box(),
      },
    } as MessageEvent);
    await expect(pending).resolves.toEqual(box());
    expect(workers[1].terminated).toBe(true);

    const recovered = queue.enqueue(sourceFor(box(2)));
    workers[2].onmessage?.({
      data: {
        type: "result",
        jobId: (workers[2].posted[0] as { jobId: string }).jobId,
        recipe: box(2),
      },
    } as MessageEvent);
    await expect(recovered).resolves.toEqual(box(2));
    expect(workers[2].terminated).toBe(true);
  });

  it("terminates an active worker on abort and ignores stale messages", async () => {
    const worker = new FakeWorker();
    const queue = new BrowserProceduralQueue({
      workerFactory: () => worker as unknown as Worker,
      workerDeadlineMs: 1_000,
    });
    const controller = new AbortController();
    const result = queue.enqueue(sourceFor(box()), {
      signal: controller.signal,
    });
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: "aborted" });
    expect(worker.terminated).toBe(true);
    worker.onmessage?.({
      data: { type: "result", jobId: "stale", recipe: box(3) },
    } as MessageEvent);
  });

  it("removes abort listeners and worker handlers on terminal paths", async () => {
    const workers: FakeWorker[] = [];
    const queue = new BrowserProceduralQueue({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
      workerDeadlineMs: 1_000,
    });
    const completedSignal = new TrackingSignal();
    const completed = queue.enqueue(sourceFor(box()), {
      signal: completedSignal as unknown as AbortSignal,
    });
    expect(completedSignal.listeners.size).toBe(1);
    workers[0].onmessage?.({
      data: {
        type: "result",
        jobId: (workers[0].posted[0] as { jobId: string }).jobId,
        recipe: box(),
      },
    } as MessageEvent);
    await expect(completed).resolves.toEqual(box());
    expect(completedSignal.listeners.size).toBe(0);
    expect(workers[0].onmessage).toBeNull();
    expect(workers[0].onerror).toBeNull();
    expect(workers[0].onmessageerror).toBeNull();

    const abortedSignal = new TrackingSignal();
    const aborted = queue.enqueue(sourceFor(box()), {
      signal: abortedSignal as unknown as AbortSignal,
    });
    expect(abortedSignal.listeners.size).toBe(1);
    abortedSignal.abort();
    await expect(aborted).rejects.toMatchObject({ code: "aborted" });
    expect(abortedSignal.listeners.size).toBe(0);
    expect(workers[1].onmessage).toBeNull();
    expect(workers[1].onerror).toBeNull();
    expect(workers[1].onmessageerror).toBeNull();
  });
});
