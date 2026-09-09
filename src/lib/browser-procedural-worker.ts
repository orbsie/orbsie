import { evaluateBrowserProceduralSource } from "./browser-procedural-evaluator";
import {
  parseBrowserProceduralSource,
  type BrowserProceduralSource,
} from "./browser-procedural";
import type { BrowserModelRecipe } from "./browser-modeling";

export interface BrowserProceduralWorkerRequest {
  readonly type: "evaluate";
  readonly jobId: string;
  readonly source: BrowserProceduralSource;
}

export interface BrowserProceduralWorkerSuccess {
  readonly type: "result";
  readonly jobId: string;
  readonly recipe: BrowserModelRecipe;
}

export interface BrowserProceduralWorkerFailure {
  readonly type: "error";
  readonly jobId: string;
  readonly code: string;
  readonly error: string;
}

export type BrowserProceduralWorkerResponse =
  BrowserProceduralWorkerSuccess | BrowserProceduralWorkerFailure;

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<BrowserProceduralWorkerRequest>) => void;
  postMessage: (value: BrowserProceduralWorkerResponse) => void;
};

function failure(
  jobId: string,
  code = "execution",
): BrowserProceduralWorkerFailure {
  return {
    type: "error",
    jobId,
    code,
    error: "Procedural authoring failed.",
  };
}

function requestFrom(value: unknown): BrowserProceduralWorkerRequest {
  if (!value || typeof value !== "object") throw new Error("invalid");
  const request = value as Partial<BrowserProceduralWorkerRequest>;
  if (request.type !== "evaluate" || typeof request.jobId !== "string")
    throw new Error("invalid");
  return {
    type: "evaluate",
    jobId: request.jobId,
    source: parseBrowserProceduralSource(request.source),
  };
}

scope.onmessage = async ({ data }) => {
  let jobId = "";
  try {
    const request = requestFrom(data);
    jobId = request.jobId;
    const recipe = await evaluateBrowserProceduralSource(request.source);
    scope.postMessage({ type: "result", jobId, recipe });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "execution";
    scope.postMessage(failure(jobId, code));
  }
};
