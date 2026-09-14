import { randomUUID } from "node:crypto";
import {
  createGenerationObservation as createPureGenerationObservation,
  validatedGenerationRequestId,
  validatedBuildId,
  type GenerationObservation,
  type GenerationObservationEvent,
  type GenerationObservationOptions,
} from "../generation-observability";

export * from "../generation-observability";
export type { GenerationObservation, GenerationObservationEvent };

export function generationRequestId(): string {
  return randomUUID();
}

export function clientRunIdFromRequest(request: Request): string | undefined {
  const value = request.headers.get("x-orbsie-client-run-id");
  return value ? validatedClientRunId(value) : undefined;
}

export function validatedClientRunId(value: unknown): string | undefined {
  return validatedGenerationRequestId(value);
}

export function currentBuildId(): string | undefined {
  // VERCEL_GIT_COMMIT_SHA identifies the caller deployment and may be stale
  // when a hosted executor outlives it. Only an explicitly assigned runtime
  // build ID is safe to attach to server events.
  return validatedBuildId(process.env.ORBSIE_BUILD_ID);
}

export function createGenerationObservation(
  options: Omit<GenerationObservationOptions, "requestId" | "buildId"> & {
    requestId?: string;
    buildId?: string;
  },
): GenerationObservation {
  return createPureGenerationObservation({
    ...options,
    requestId: validatedGenerationRequestId(options.requestId) ?? randomUUID(),
    buildId: validatedBuildId(options.buildId) ?? currentBuildId(),
  });
}

export function withGenerationRequestId(response: Response, requestId: string) {
  const headers = new Headers(response.headers);
  headers.set(
    "X-Orbsie-Request-Id",
    validatedGenerationRequestId(requestId) ?? generationRequestId(),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
