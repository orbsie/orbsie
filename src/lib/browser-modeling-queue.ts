import {
  browserModelKernelLimits,
  type BrowserModelEvaluation,
} from "./browser-modeling-kernel";
import {
  browserModelRecipeSchema,
  type BrowserModelRecipe,
} from "./browser-modeling";
import type {
  BrowserModelWorkerRequest,
  BrowserModelWorkerResponse,
} from "./browser-modeling-worker";

const DEFAULT_MAX_PENDING = 8;
const DEFAULT_DEADLINE_MS = 15_000;

export type BrowserModelWorkerErrorCode =
  "aborted" | "queue-full" | "unavailable" | "timeout" | "worker" | "protocol";

export class BrowserModelWorkerError extends Error {
  readonly code: BrowserModelWorkerErrorCode;

  constructor(
    code: BrowserModelWorkerErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "BrowserModelWorkerError";
    this.code = code;
  }
}

export interface BrowserModelWorkerLike {
  onmessage: ((event: MessageEvent<BrowserModelWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(
    message: BrowserModelWorkerRequest,
    transfer?: Transferable[],
  ): void;
  terminate(): void;
}

export type BrowserModelWorkerFactory = (url: string) => BrowserModelWorkerLike;

export interface EvaluateBrowserModelOptions {
  readonly workerUrl?: string;
  readonly workerFactory?: BrowserModelWorkerFactory;
  readonly deadlineMs?: number;
  readonly maxPendingJobs?: number;
}

interface Job {
  readonly id: string;
  readonly recipe: BrowserModelRecipe;
  readonly signal: AbortSignal;
  readonly options: EvaluateBrowserModelOptions;
  readonly resolve: (evaluation: BrowserModelEvaluation) => void;
  readonly reject: (error: unknown) => void;
  readonly cancel: () => void;
}

interface ActiveJob {
  readonly job: Job;
  readonly worker: BrowserModelWorkerLike;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
}

const pending: Job[] = [];
let active: ActiveJob | undefined;
let stopActive: (() => void) | undefined;
let nextId = 0;

function abortError(): BrowserModelWorkerError {
  return new BrowserModelWorkerError(
    "aborted",
    "Browser modeling was cancelled.",
  );
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(`${name} must be a positive integer.`);
  return value;
}

function boundedPositiveInteger(
  value: number,
  name: string,
  maximum: number,
): number {
  const bounded = positiveInteger(value, name);
  if (bounded > maximum)
    throw new RangeError(`${name} must be at most ${maximum}.`);
  return bounded;
}

function defaultWorkerFactory(url: string): BrowserModelWorkerLike {
  if (typeof Worker === "undefined")
    throw new BrowserModelWorkerError(
      "unavailable",
      "Browser modeling workers are unavailable.",
    );
  return new Worker(url, { type: "module" });
}

function protocolError(message: string): BrowserModelWorkerError {
  return new BrowserModelWorkerError("protocol", message);
}

function finiteVector(value: unknown, name: string): [number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some(
      (coordinate) =>
        typeof coordinate !== "number" || !Number.isFinite(coordinate),
    )
  )
    throw protocolError(`Browser modeling worker returned invalid ${name}.`);
  return [value[0], value[1], value[2]];
}

function validateEvaluation(data: unknown, job: Job): BrowserModelEvaluation {
  if (!data || typeof data !== "object")
    throw protocolError("Browser modeling worker returned an invalid message.");
  const response = data as Partial<BrowserModelWorkerResponse> & {
    vertices?: unknown;
    indices?: unknown;
    bounds?: unknown;
    statistics?: unknown;
  };
  if (response.jobId !== job.id || response.revision !== job.recipe.revision)
    throw protocolError("Browser modeling worker returned a stale result.");
  if (response.type === "error") {
    if (typeof response.error !== "string")
      throw protocolError("Browser modeling worker returned an invalid error.");
    throw new BrowserModelWorkerError("worker", response.error);
  }
  if (response.type !== "result")
    throw protocolError(
      "Browser modeling worker returned an unknown response.",
    );
  if (!(response.vertices instanceof Float32Array))
    throw protocolError("Browser modeling worker returned invalid vertices.");
  if (!(response.indices instanceof Uint32Array))
    throw protocolError("Browser modeling worker returned invalid indices.");
  if (response.vertices.length % 3 !== 0 || response.indices.length % 3 !== 0)
    throw protocolError(
      "Browser modeling worker returned incomplete mesh data.",
    );

  const vertices = response.vertices.length / 3;
  const triangles = response.indices.length / 3;
  if (
    vertices === 0 ||
    triangles === 0 ||
    vertices > browserModelKernelLimits.maxVertices ||
    triangles > browserModelKernelLimits.maxTriangles
  )
    throw protocolError("Browser modeling worker exceeded the mesh budget.");
  for (const value of response.vertices)
    if (!Number.isFinite(value))
      throw protocolError(
        "Browser modeling worker returned non-finite vertices.",
      );
  for (const index of response.indices)
    if (index >= vertices)
      throw protocolError(
        "Browser modeling worker returned an out-of-range index.",
      );

  if (!response.bounds || typeof response.bounds !== "object")
    throw protocolError("Browser modeling worker returned invalid bounds.");
  const bounds = response.bounds as { min?: unknown; max?: unknown };
  const min = finiteVector(bounds.min, "bounds");
  const max = finiteVector(bounds.max, "bounds");
  for (let axis = 0; axis < 3; axis += 1)
    if (min[axis] > max[axis])
      throw protocolError("Browser modeling worker returned unordered bounds.");

  const measuredMin = [Infinity, Infinity, Infinity];
  const measuredMax = [-Infinity, -Infinity, -Infinity];
  for (let vertex = 0; vertex < vertices; vertex += 1)
    for (let axis = 0; axis < 3; axis += 1) {
      const value = response.vertices[vertex * 3 + axis];
      measuredMin[axis] = Math.min(measuredMin[axis], value);
      measuredMax[axis] = Math.max(measuredMax[axis], value);
    }
  for (let axis = 0; axis < 3; axis += 1) {
    const tolerance =
      1e-4 *
      Math.max(1, Math.abs(measuredMin[axis]), Math.abs(measuredMax[axis]));
    if (
      Math.abs(min[axis] - measuredMin[axis]) > tolerance ||
      Math.abs(max[axis] - measuredMax[axis]) > tolerance
    )
      throw protocolError(
        "Browser modeling worker returned bounds that do not match its vertices.",
      );
  }

  if (!response.statistics || typeof response.statistics !== "object")
    throw protocolError("Browser modeling worker returned invalid statistics.");
  const statistics = response.statistics as {
    triangles?: unknown;
    vertices?: unknown;
    bytes?: unknown;
  };
  const bytes = response.vertices.byteLength + response.indices.byteLength;
  if (
    statistics.triangles !== triangles ||
    statistics.vertices !== vertices ||
    statistics.bytes !== bytes ||
    !Number.isSafeInteger(statistics.triangles) ||
    !Number.isSafeInteger(statistics.vertices) ||
    !Number.isSafeInteger(statistics.bytes) ||
    bytes > browserModelKernelLimits.maxMeshBytes
  )
    throw protocolError(
      "Browser modeling worker returned inconsistent statistics.",
    );

  return {
    vertices: response.vertices,
    indices: response.indices,
    bounds: { min, max },
    statistics: { triangles, vertices, bytes },
  };
}

function pump(): void {
  if (active || pending.length === 0) return;
  const job = pending.shift()!;
  let worker: BrowserModelWorkerLike;
  try {
    worker = (job.options.workerFactory ?? defaultWorkerFactory)(
      job.options.workerUrl ?? "/modeling/worker.js",
    );
  } catch (error) {
    job.signal.removeEventListener("abort", job.cancel);
    job.reject(
      error instanceof BrowserModelWorkerError
        ? error
        : new BrowserModelWorkerError(
            "worker",
            "Could not start the browser modeling worker.",
            { cause: error },
          ),
    );
    pump();
    return;
  }

  const state: ActiveJob = {
    job,
    worker,
    timer: undefined as unknown as ReturnType<typeof setTimeout>,
    settled: false,
  };
  active = state;
  const finish = (error?: unknown, evaluation?: BrowserModelEvaluation) => {
    if (active !== state || state.settled) {
      return;
    }
    state.settled = true;
    clearTimeout(state.timer);
    state.job.signal.removeEventListener("abort", state.job.cancel);
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    active = undefined;
    stopActive = undefined;
    if (error) state.job.reject(error);
    else state.job.resolve(evaluation!);
    pump();
  };
  state.timer = setTimeout(
    () => {
      finish(
        new BrowserModelWorkerError(
          "timeout",
          "Browser modeling worker timed out.",
        ),
      );
    },
    positiveInteger(
      job.options.deadlineMs ?? DEFAULT_DEADLINE_MS,
      "deadlineMs",
    ),
  );
  stopActive = () => finish(abortError());
  job.signal.addEventListener("abort", job.cancel, { once: true });
  worker.onerror = () =>
    finish(
      new BrowserModelWorkerError("worker", "Browser modeling worker failed."),
    );
  worker.onmessageerror = () =>
    finish(
      new BrowserModelWorkerError(
        "protocol",
        "Browser modeling worker returned unreadable data.",
      ),
    );
  worker.onmessage = ({ data }) => {
    try {
      finish(undefined, validateEvaluation(data, job));
    } catch (error) {
      finish(error);
    }
  };
  try {
    worker.postMessage({ type: "evaluate", jobId: job.id, recipe: job.recipe });
  } catch (error) {
    finish(
      new BrowserModelWorkerError(
        "worker",
        "Could not send browser modeling work to the worker.",
        { cause: error },
      ),
    );
  }
}

/** Evaluate a validated recipe in a bounded, cancellable browser worker. */
export function evaluateBrowserModelRecipeInWorker(
  recipe: BrowserModelRecipe,
  signal: AbortSignal,
  options: EvaluateBrowserModelOptions = {},
): Promise<BrowserModelEvaluation> {
  if (signal.aborted) return Promise.reject(abortError());
  let maxPending: number;
  let deadlineMs: number;
  let validatedRecipe: BrowserModelRecipe;
  try {
    maxPending = boundedPositiveInteger(
      options.maxPendingJobs ?? DEFAULT_MAX_PENDING,
      "maxPendingJobs",
      DEFAULT_MAX_PENDING,
    );
    deadlineMs = boundedPositiveInteger(
      options.deadlineMs ?? DEFAULT_DEADLINE_MS,
      "deadlineMs",
      DEFAULT_DEADLINE_MS,
    );
    validatedRecipe = browserModelRecipeSchema.parse(recipe);
  } catch (error) {
    return Promise.reject(error);
  }
  if (pending.length >= maxPending)
    return Promise.reject(
      new BrowserModelWorkerError(
        "queue-full",
        "Browser modeling queue is full.",
      ),
    );

  const normalizedOptions: EvaluateBrowserModelOptions = {
    ...options,
    maxPendingJobs: maxPending,
    deadlineMs,
  };
  const id = `browser-model-${++nextId}`;
  return new Promise((resolve, reject) => {
    const job = {
      id,
      recipe: validatedRecipe,
      signal,
      options: normalizedOptions,
      resolve,
      reject,
      cancel: () => {
        if (active?.job === job) {
          stopActive?.();
          return;
        }
        const index = pending.indexOf(job);
        if (index >= 0) pending.splice(index, 1);
        signal.removeEventListener("abort", job.cancel);
        reject(abortError());
        pump();
      },
    } satisfies Job;
    signal.addEventListener("abort", job.cancel, { once: true });
    pending.push(job);
    pump();
  });
}

export const BROWSER_MODEL_MAX_PENDING = DEFAULT_MAX_PENDING;
export const BROWSER_MODEL_DEADLINE_MS = DEFAULT_DEADLINE_MS;
