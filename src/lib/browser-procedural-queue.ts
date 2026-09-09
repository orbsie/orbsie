import {
  BROWSER_PROCEDURAL_WORKER_DEADLINE_MS,
  parseBrowserProceduralSource,
  type BrowserProceduralSource,
} from "./browser-procedural";
import type {
  BrowserProceduralWorkerRequest,
  BrowserProceduralWorkerResponse,
} from "./browser-procedural-worker";
import {
  parseBrowserModelRecipe,
  type BrowserModelRecipe,
} from "./browser-modeling";

export type BrowserProceduralQueueErrorCode =
  | "aborted"
  | "queue-full"
  | "timeout"
  | "worker"
  | "protocol"
  | "invalid-source"
  | "source-limit"
  | "invalid-recipe"
  | "output-limit"
  | "execution";

export class BrowserProceduralQueueError extends Error {
  readonly code: BrowserProceduralQueueErrorCode;

  constructor(code: BrowserProceduralQueueErrorCode, message: string) {
    super(message);
    this.name = "BrowserProceduralQueueError";
    this.code = code;
  }
}

export interface BrowserProceduralQueueOptions {
  readonly workerUrl?: string;
  readonly workerFactory?: (url: string) => Worker;
  readonly maxPending?: number;
  readonly workerDeadlineMs?: number;
}

export interface BrowserProceduralEnqueueOptions {
  readonly signal?: AbortSignal;
  readonly workerDeadlineMs?: number;
}

interface Job {
  readonly source: BrowserProceduralSource;
  readonly signal?: AbortSignal;
  readonly deadlineMs: number;
  readonly resolve: (recipe: BrowserModelRecipe) => void;
  readonly reject: (error: unknown) => void;
  readonly id: string;
  worker?: Worker;
  timer?: ReturnType<typeof setTimeout>;
  abortListener?: () => void;
  settled: boolean;
}

const DEFAULT_MAX_PENDING = 1;
const DEFAULT_WORKER_URL = "/modeling/procedural-worker.js";

function nextId(): string {
  return `procedural-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function abortError(): BrowserProceduralQueueError {
  return new BrowserProceduralQueueError(
    "aborted",
    "Procedural authoring was cancelled.",
  );
}

function workerErrorCode(code: string): BrowserProceduralQueueErrorCode {
  if (
    code === "aborted" ||
    code === "timeout" ||
    code === "invalid-source" ||
    code === "source-limit" ||
    code === "invalid-recipe" ||
    code === "output-limit" ||
    code === "execution"
  )
    return code;
  return "worker";
}

export class BrowserProceduralQueue {
  private readonly workerUrl: string;
  private readonly workerFactory: (url: string) => Worker;
  private readonly maxPending: number;
  private readonly defaultDeadlineMs: number;
  private pending: Job[] = [];
  private active?: Job;

  constructor(options: BrowserProceduralQueueOptions = {}) {
    this.workerUrl = options.workerUrl ?? DEFAULT_WORKER_URL;
    this.workerFactory =
      options.workerFactory ?? ((url) => new Worker(url, { type: "module" }));
    this.maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
    this.defaultDeadlineMs =
      options.workerDeadlineMs ?? BROWSER_PROCEDURAL_WORKER_DEADLINE_MS;
    if (!Number.isInteger(this.maxPending) || this.maxPending < 1)
      throw new Error("Invalid procedural queue limit.");
    if (!Number.isFinite(this.defaultDeadlineMs) || this.defaultDeadlineMs <= 0)
      throw new Error("Invalid procedural worker deadline.");
  }

  enqueue(
    input: unknown,
    options: BrowserProceduralEnqueueOptions = {},
  ): Promise<BrowserModelRecipe> {
    const source = parseBrowserProceduralSource(input);
    if (this.pending.length >= this.maxPending)
      return Promise.reject(
        new BrowserProceduralQueueError(
          "queue-full",
          "Procedural authoring queue is full.",
        ),
      );
    const deadlineMs = options.workerDeadlineMs ?? this.defaultDeadlineMs;
    if (!Number.isFinite(deadlineMs) || deadlineMs <= 0)
      return Promise.reject(
        new BrowserProceduralQueueError(
          "protocol",
          "Invalid procedural deadline.",
        ),
      );
    return new Promise<BrowserModelRecipe>((resolve, reject) => {
      const job: Job = {
        source,
        signal: options.signal,
        deadlineMs,
        resolve,
        reject,
        id: nextId(),
        settled: false,
      };
      if (options.signal?.aborted) {
        reject(abortError());
        return;
      }
      this.pending.push(job);
      if (options.signal) {
        const abortListener = () => this.cancelPending(job);
        job.abortListener = abortListener;
        options.signal.addEventListener("abort", abortListener, { once: true });
      }
      this.pump();
    });
  }

  private cancelPending(job: Job): void {
    if (job.settled) return;
    if (this.active === job) {
      this.finish(job, abortError());
      return;
    }
    const index = this.pending.indexOf(job);
    if (index < 0) return;
    this.pending.splice(index, 1);
    job.settled = true;
    this.cleanup(job);
    job.reject(abortError());
    this.pump();
  }

  private pump(): void {
    if (this.active || this.pending.length === 0) return;
    const job = this.pending.shift()!;
    if (job.signal?.aborted) {
      job.settled = true;
      this.cleanup(job);
      job.reject(abortError());
      this.pump();
      return;
    }
    this.active = job;
    let worker: Worker;
    try {
      worker = this.workerFactory(this.workerUrl);
      job.worker = worker;
    } catch {
      this.finish(
        job,
        new BrowserProceduralQueueError(
          "worker",
          "Procedural authoring worker failed.",
        ),
      );
      return;
    }
    const finishFromResponse = (response: BrowserProceduralWorkerResponse) => {
      if (response.jobId !== job.id) {
        this.finish(
          job,
          new BrowserProceduralQueueError(
            "protocol",
            "Procedural authoring worker returned a stale result.",
          ),
        );
        return;
      }
      if (response.type === "result") {
        try {
          this.finish(job, undefined, parseBrowserModelRecipe(response.recipe));
        } catch {
          this.finish(
            job,
            new BrowserProceduralQueueError(
              "protocol",
              "Procedural authoring worker returned an invalid recipe.",
            ),
          );
        }
      } else {
        this.finish(
          job,
          new BrowserProceduralQueueError(
            workerErrorCode(response.code),
            "Procedural authoring failed.",
          ),
        );
      }
    };
    worker.onmessage = ({
      data,
    }: MessageEvent<BrowserProceduralWorkerResponse>) => {
      if (!data || typeof data !== "object") {
        this.finish(
          job,
          new BrowserProceduralQueueError(
            "protocol",
            "Procedural authoring worker returned an invalid message.",
          ),
        );
        return;
      }
      finishFromResponse(data);
    };
    worker.onerror = () =>
      this.finish(
        job,
        new BrowserProceduralQueueError(
          "worker",
          "Procedural authoring worker failed.",
        ),
      );
    worker.onmessageerror = () =>
      this.finish(
        job,
        new BrowserProceduralQueueError(
          "protocol",
          "Procedural authoring worker returned unreadable data.",
        ),
      );
    job.timer = setTimeout(
      () =>
        this.finish(
          job,
          new BrowserProceduralQueueError(
            "timeout",
            "Procedural authoring timed out.",
          ),
        ),
      job.deadlineMs,
    );
    try {
      const request: BrowserProceduralWorkerRequest = {
        type: "evaluate",
        jobId: job.id,
        source: job.source,
      };
      worker.postMessage(request);
    } catch {
      this.finish(
        job,
        new BrowserProceduralQueueError(
          "worker",
          "Procedural authoring worker failed.",
        ),
      );
    }
  }

  private finish(
    job: Job,
    error?: BrowserProceduralQueueError,
    recipe?: BrowserModelRecipe,
  ): void {
    if (job.settled) return;
    job.settled = true;
    this.cleanup(job);
    if (this.active === job) this.active = undefined;
    if (error) job.reject(error);
    else if (recipe) job.resolve(recipe);
    else
      job.reject(
        new BrowserProceduralQueueError(
          "protocol",
          "Procedural authoring worker returned no recipe.",
        ),
      );
    this.pump();
  }

  private cleanup(job: Job): void {
    if (job.timer) {
      clearTimeout(job.timer);
      job.timer = undefined;
    }
    if (job.signal && job.abortListener) {
      job.signal.removeEventListener("abort", job.abortListener);
      job.abortListener = undefined;
    }
    if (job.worker) {
      job.worker.onmessage = null;
      job.worker.onerror = null;
      job.worker.onmessageerror = null;
      job.worker.terminate();
      job.worker = undefined;
    }
  }
}

let defaultQueue: BrowserProceduralQueue | undefined;

export function evaluateBrowserProceduralInWorker(
  source: BrowserProceduralSource,
  options: BrowserProceduralEnqueueOptions = {},
): Promise<BrowserModelRecipe> {
  defaultQueue ??= new BrowserProceduralQueue();
  return defaultQueue.enqueue(source, options);
}
