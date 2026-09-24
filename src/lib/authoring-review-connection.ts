import type { Project } from "./protocol";
import type { SceneReviewImage } from "./review-image";
import type { SceneReviewPhase } from "./scene-review";
import type { SceneReviewStructuralObservations } from "./server/scene-review-observations";
import { validatedClientRunId } from "./generation-observability";
import {
  isGenerationReady,
  type GenerationConnection,
} from "./generation-connection";

export type AuthoringReviewRequest = {
  runId: string;
  phase: SceneReviewPhase;
  prompt: string;
  project: Project;
  selected?: string;
  browserModeling: boolean;
  reviewImage?: SceneReviewImage;
  structuralObservations?: SceneReviewStructuralObservations;
  feedback?: string;
};

export type AuthoringReviewStartRequest = {
  priorRunId: string;
  prompt: string;
  project: Project;
  selected?: string;
  browserModeling: boolean;
};

/** Admit a review-only run that continues an earlier authoring run. */
export function authoringReviewStartRequest(
  connection: GenerationConnection,
  input: AuthoringReviewStartRequest,
  clientRunId: string,
): { url: string; init: RequestInit } {
  if (
    !["free", "openrouter", "gateway", "chatgpt-hosted"].includes(
      connection.provider,
    ) ||
    !isGenerationReady(connection)
  )
    throw Error("Choose a complete AI connection.");
  if (!validatedClientRunId(input.priorRunId))
    throw Error("The authoring review run is unavailable.");
  const validatedClientId = validatedClientRunId(clientRunId);
  if (!validatedClientId) throw Error("The authoring request is unavailable.");
  const hosted = connection.provider === "chatgpt-hosted";
  const body = {
    priorRunId: input.priorRunId,
    prompt: input.prompt,
    project: input.project,
    ...(input.selected ? { selected: input.selected } : {}),
    browserModeling: input.browserModeling,
    localModeling: false,
    ...(hosted
      ? { model: connection.model, effort: connection.effort }
      : connection.provider === "free"
        ? { provider: "free" }
        : {
            provider: connection.provider,
            model: connection.model,
            key: connection.key,
          }),
  };
  return {
    url: hosted ? "/api/chatgpt/review/start" : "/api/generate/review/start",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Orbsie-Client-Run-Id": validatedClientId,
      },
      body: JSON.stringify(body),
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
    },
  };
}

/** Build a review request from the original connection, never from model output. */
export function authoringReviewRequest(
  connection: GenerationConnection,
  input: AuthoringReviewRequest,
  clientRunId: string,
): { url: string; init: RequestInit } {
  if (
    !["free", "openrouter", "gateway", "chatgpt-hosted"].includes(
      connection.provider,
    ) ||
    !isGenerationReady(connection)
  )
    throw Error("Choose a complete AI connection.");
  if (!validatedClientRunId(input.runId))
    throw Error("The authoring review run is unavailable.");
  const validatedClientId = validatedClientRunId(clientRunId);
  if (!validatedClientId) throw Error("The authoring request is unavailable.");
  const hosted = connection.provider === "chatgpt-hosted";
  const body = {
    runId: input.runId,
    phase: input.phase,
    prompt: input.prompt,
    project: input.project,
    ...(input.selected ? { selected: input.selected } : {}),
    browserModeling: input.browserModeling,
    localModeling: false,
    ...(input.reviewImage ? { reviewImage: input.reviewImage } : {}),
    ...(input.structuralObservations
      ? { structuralObservations: input.structuralObservations }
      : {}),
    ...(input.feedback ? { feedback: input.feedback } : {}),
    ...(hosted
      ? { model: connection.model, effort: connection.effort }
      : connection.provider === "free"
        ? { provider: "free" }
        : {
            provider: connection.provider,
            model: connection.model,
            key: connection.key,
          }),
  };
  return {
    url: hosted ? "/api/chatgpt/review" : "/api/generate/review",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Orbsie-Client-Run-Id": validatedClientId,
      },
      body: JSON.stringify(body),
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
    },
  };
}
