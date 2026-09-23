import { z } from "zod";
import {
  projectSchema,
  entitySchema,
  applyModelOperation,
  parseModelCommandForProcessing,
  type Cursor,
  type ModelCommand,
} from "../protocol";
import { deriveAssetPolicy, enforceAssetPolicy } from "../asset-policy";
import { promptCatalogForPolicy } from "../asset-catalog";
import { authoringHistory } from "../authoring-history";
import { assertModelingCommand } from "../modeling-policy";
import {
  ChatGPTGenerationError,
  generationDiagnostic,
  SceneProtocolError,
} from "../generation-diagnostics";
import { systemPromptForCapabilities } from "./generation";
import type { createChatGPTGeneration } from "./chatgpt-generation";
import { modelingFeedbackSchema } from "../modeling-feedback";
import {
  generationFeedbackInstruction,
  generationFeedbackSchema,
} from "../generation-feedback";
import {
  validateSceneReviewImage,
  type SceneReviewImage,
} from "../review-image";
import type {
  GenerationObservation,
  GenerationStreamFailureReason,
} from "./generation-observability";
import {
  createAuthoringLifecycle,
  initialSceneProvenance,
  updateSceneProvenance,
  type AuthoringLifecycleHooks,
  type SceneProvenanceMap,
} from "../scene-binding";

export const chatGPTSceneRequestSchema = z
  .object({
    model: z.string().min(1).max(256),
    effort: z.string().min(1).max(32),
    prompt: z.string().trim().min(1).max(4000),
    project: projectSchema,
    selected: entitySchema.shape.id.optional(),
    browserModeling: z.boolean().default(false),
    localModeling: z.literal(false).default(false),
    modelingFeedback: modelingFeedbackSchema.optional(),
    generationFeedback: generationFeedbackSchema.optional(),
  })
  .strict();

/** Only validated incremental commands cross into the live browser scene. */
export function createChatGPTSceneStream(
  raw: unknown,
  generator: ReturnType<typeof createChatGPTGeneration>,
  signal?: AbortSignal,
  /** Internal loop option; public request schemas remain unchanged. */
  options?: {
    reviewImage?: unknown;
    observability?: GenerationObservation;
    lifecycle?: AuthoringLifecycleHooks;
  },
) {
  const input = chatGPTSceneRequestSchema.parse(raw);
  if (
    new Set(input.project.entities.map((e) => e.id)).size !==
      input.project.entities.length ||
    (input.selected &&
      !input.project.entities.some((e) => e.id === input.selected))
  )
    throw Error("Invalid selected world.");
  if (
    input.generationFeedback &&
    input.generationFeedback.projectId !== input.project.id
  )
    throw Error("Invalid generation feedback.");
  const reviewImage: SceneReviewImage | undefined =
    options?.reviewImage === undefined
      ? undefined
      : validateSceneReviewImage(options.reviewImage, {
          projectId: input.project.id,
          revision: input.project.revision,
        });
  const policy = deriveAssetPolicy(input.prompt, input.selected, input.project);
  const modelInput = JSON.stringify({
    instruction: input.prompt,
    recentConversation: authoringHistory(input.project, input.prompt),
    localModeling: false,
    browserModeling: input.browserModeling,
    assetPolicy: policy,
    assetCatalog: promptCatalogForPolicy(policy.requestAssetPolicy),
    selectedEntityId: input.selected,
    ...(input.modelingFeedback
      ? { modelingFeedback: input.modelingFeedback }
      : {}),
    project: { ...input.project, messages: [] },
  });
  if (Buffer.byteLength(modelInput) > 256 * 1024)
    throw Error("This world exceeds the ChatGPT request limit.");
  const local = new AbortController();
  const combined = signal
    ? AbortSignal.any([signal, local.signal])
    : local.signal;
  const encoder = new TextEncoder();
  const observation = options?.observability;
  const lifecycle = options?.lifecycle;
  let latestProject = input.project;
  const provenance: SceneProvenanceMap = lifecycle
    ? initialSceneProvenance(input.project)
    : new Map();
  const lifecycleController = createAuthoringLifecycle(
    lifecycle,
    combined,
    () => ({ project: latestProject, provenance }),
  );
  let cancelled = false;
  return new ReadableStream<Uint8Array>(
    {
      async start(controller) {
        let working = input.project,
          buffer = "",
          count = 0,
          pendingCommit: ModelCommand | undefined;
        let providerReturned = false;
        let committed = false;
        let failed = false;
        let missingCommit = false;
        let cursor: Cursor = {
          runId: crypto.randomUUID(),
          sequence: 0,
          seen: new Set(),
        };
        const enqueue = (value: unknown) => {
          combined.throwIfAborted();
          if ((controller.desiredSize ?? 0) < -512 * 1024)
            throw Error("Client is too slow.");
          controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
        };
        const emit = (line: string) => {
          if (!line.trim()) return;
          if (++count > 250) throw Error("Too many scene commands.");
          const command = enforceAssetPolicy(
            working,
            parseModelCommandForProcessing(
              JSON.parse(line),
              false,
              input.browserModeling,
            ),
            policy,
          );
          assertModelingCommand(command, false, input.browserModeling);
          if (pendingCommit)
            throw new SceneProtocolError(
              null,
              "No scene commands may follow commit_revision.",
            );
          observation?.noteCommand();
          observation?.noteOutputBytes(encoder.encode(line + "\n").byteLength);
          if (command.type === "commit_revision") {
            pendingCommit = command;
            return;
          }
          const applied = applyModelOperation(
            working,
            {
              version: 1,
              projectId: working.id,
              runId: cursor.runId,
              operationId: crypto.randomUUID(),
              sequence: cursor.sequence + 1,
              baseRevision: working.revision,
              command,
            },
            cursor,
          );
          working = applied.project;
          latestProject = working;
          cursor = applied.cursor;
          updateSceneProvenance(provenance, command);
          enqueue(command);
        };
        try {
          observation?.phase("provider-start");
          await generator.generate({
            model: input.model,
            effort: input.effort,
            instructions:
              systemPromptForCapabilities(false, input.browserModeling) +
              (input.generationFeedback
                ? ` ${generationFeedbackInstruction(input.generationFeedback)}`
                : ""),
            input: modelInput,
            ...(reviewImage ? { reviewImage } : {}),
            signal: combined,
            onText(delta) {
              combined.throwIfAborted();
              observation?.noteInputBytes(Buffer.byteLength(delta));
              observation?.phase("first-byte");
              buffer += delta;
              if (Buffer.byteLength(buffer) > 128 * 1024)
                throw Error("Scene command is too large.");
              const lines = buffer.split("\n");
              buffer = lines.pop()!;
              for (const line of lines) emit(line);
            },
          });
          providerReturned = true;
          emit(buffer);
          combined.throwIfAborted();
          if (!pendingCommit) {
            missingCommit = true;
            throw new SceneProtocolError(
              null,
              "The model did not finish with a commit_revision.",
            );
          }
          const commit = pendingCommit;
          pendingCommit = undefined;
          const applied = applyModelOperation(
            working,
            {
              version: 1,
              projectId: working.id,
              runId: cursor.runId,
              operationId: crypto.randomUUID(),
              sequence: cursor.sequence + 1,
              baseRevision: working.revision,
              command: commit,
            },
            cursor,
          );
          working = applied.project;
          latestProject = working;
          cursor = applied.cursor;
          updateSceneProvenance(provenance, commit);
          await lifecycleController.complete();
          committed = true;
          observation?.commit();
          enqueue(commit);
        } catch (error) {
          failed = true;
          await lifecycleController.fail(error);
          const chatGPTError =
            error instanceof ChatGPTGenerationError ? error : undefined;
          const providerStatus =
            chatGPTError?.sceneDiagnostic?.diagnostic.providerStatus;
          const timedOut =
            (combined.aborted && combined.reason?.name === "TimeoutError") ||
            chatGPTError?.reason === "timeout";
          const clientAborted = combined.aborted && !timedOut;
          const generationCancelled = chatGPTError?.reason === "cancelled";
          const providerFailure =
            chatGPTError?.reason === "rpc-rejection" ||
            chatGPTError?.reason === "terminal-failure" ||
            chatGPTError?.reason === "model-unavailable";
          const diagnostic = generationDiagnostic(error, count, null);
          const validationFailure =
            diagnostic !== undefined &&
            !providerFailure &&
            chatGPTError?.reason !== "runtime-closed" &&
            chatGPTError?.reason !== "timeout" &&
            chatGPTError?.reason !== "cancelled";
          const completionFailed = lifecycleController.completionFailed();
          const outputLimit =
            diagnostic?.code === "TRUNCATED_SCENE_STREAM" ||
            diagnostic?.diagnostic.finishReason === "length";
          const failure: GenerationStreamFailureReason = completionFailed
            ? "completion-record-failure"
            : timedOut
              ? "deadline"
              : missingCommit
                ? "clean-eof-without-commit"
                : outputLimit
                  ? "output-limit"
                  : providerFailure
                    ? "provider-error"
                    : validationFailure
                      ? "parser-failure"
                      : "stream-error";
          observation?.terminal({
            reason: timedOut
              ? "deadline"
              : clientAborted || generationCancelled
                ? "client-abort"
                : completionFailed
                  ? "completion-record-failure"
                  : missingCommit
                    ? "clean-eof-without-commit"
                    : outputLimit
                      ? "output-limit"
                      : providerFailure
                        ? "provider-error"
                        : validationFailure
                          ? "parser-failure"
                          : providerReturned && !committed
                            ? "clean-eof-without-commit"
                            : "parser-failure",
            abortSource: timedOut
              ? "deadline"
              : clientAborted || generationCancelled
                ? "client"
                : undefined,
            failureCode: timedOut
              ? "timeout"
              : clientAborted || generationCancelled
                ? "cancelled"
                : completionFailed
                  ? "host-unavailable"
                  : outputLimit
                    ? "output-limit"
                    : providerFailure
                      ? providerStatus === 402
                        ? "quota"
                        : "provider-rejected"
                      : validationFailure || missingCommit
                        ? "parser"
                        : chatGPTError?.reason === "runtime-closed"
                          ? "host-unavailable"
                          : "parser",
            httpStatus:
              typeof providerStatus === "number" ? providerStatus : undefined,
          });
          let safeError = error;
          if (!(error instanceof ChatGPTGenerationError)) {
            const scene = generationDiagnostic(error, count, null);
            if (scene?.code && scene.code !== "PROVIDER_STREAM_ERROR")
              safeError = new ChatGPTGenerationError(
                "stream",
                "callback-validation",
                { sceneDiagnostic: scene },
              );
          }
          const safeDiagnostic = generationDiagnostic(safeError, count, null);
          if (!cancelled)
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  error:
                    failure === "completion-record-failure"
                      ? "The scene completion could not be recorded."
                      : failure === "clean-eof-without-commit"
                        ? "Generation ended before committing this turn."
                        : failure === "output-limit"
                          ? "The model reached its output limit before finishing."
                          : failure === "provider-error"
                            ? "The provider could not complete this generation."
                            : failure === "deadline"
                              ? "Generation took too long to finish."
                              : failure === "stream-error"
                                ? "The provider response was interrupted."
                                : "The model returned a scene change that could not be applied.",
                  failure,
                  ...(safeDiagnostic ?? {}),
                }) + "\n",
              ),
            );
        } finally {
          const finishedAborted = combined.aborted;
          const finishedFailed = failed;
          const finishedCommitted = committed;
          local.abort();
          if (
            !finishedFailed &&
            finishedCommitted &&
            !finishedAborted &&
            !lifecycleController.completionFailed()
          )
            observation?.terminal({ reason: "completed" });
          else if (!finishedFailed && finishedAborted)
            observation?.terminal({
              reason:
                combined.reason?.name === "TimeoutError"
                  ? "deadline"
                  : "client-abort",
              abortSource:
                combined.reason?.name === "TimeoutError"
                  ? "deadline"
                  : "client",
              failureCode:
                combined.reason?.name === "TimeoutError"
                  ? "timeout"
                  : "cancelled",
            });
          if (!cancelled) controller.close();
        }
      },
      cancel(reason) {
        cancelled = true;
        local.abort(reason);
        return lifecycleController.fail(
          reason instanceof Error ? reason : Error("Generation cancelled."),
        );
      },
    },
    { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength },
  );
}
