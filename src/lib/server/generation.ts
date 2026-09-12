import {
  assertModelingCommand,
  modelingInstructions,
} from "../modeling-policy";
import { deriveAssetPolicy, enforceAssetPolicy } from "../asset-policy";
import { promptCatalogForPolicy } from "../asset-catalog";
import { authoringHistory } from "../authoring-history";
import {
  commandSchema,
  applyModelOperation,
  modelCommandJSONSchemaForCapabilities,
  parseModelCommandForProcessing,
  type Project,
  type Cursor,
  type ModelCommand,
} from "../protocol";
import { z } from "zod";
import { isRecommendedModel, openrouterProviderRouting } from "../model-modes";
import {
  generationDiagnostic,
  normalizeFinishReason,
  ProviderStreamError,
  SceneJSONError,
  SceneProtocolError,
  TruncatedSceneStreamError,
  type GenerationFinishReason,
} from "../generation-diagnostics";
import {
  modelingFeedbackSchema,
  type ModelingFeedback,
} from "../modeling-feedback";
import {
  generationFeedbackInstruction,
  generationFeedbackSchema,
  type GenerationFeedback,
} from "../generation-feedback";
import {
  SceneCommandEnvelopeDecoder,
  SceneCommandEnvelopeError,
} from "./scene-command-envelope";
import {
  strictSceneCommandJSONSchemaForCapabilities,
  decodeStrictSceneCommand,
  StrictSceneSchemaError,
} from "./strict-scene-schema";
import type { GenerationOutputFormat } from "./generation-output-format";

export class GenerationProviderError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function providerFailure(status: number) {
  const failures: Record<number, [number, string]> = {
    400: [
      400,
      "The provider rejected this model or request. Check your model in Advanced.",
    ],
    401: [
      401,
      "The provider rejected your API key. Check your provider connection.",
    ],
    402: [
      402,
      "Your provider could not authorize payment. Check its credits and spending limits.",
    ],
    403: [
      403,
      "Your provider denied access to this model. Check the key permissions and provider settings.",
    ],
    404: [
      400,
      "This model is unavailable from your provider. Choose another model in Advanced.",
    ],
    429: [
      429,
      "Your provider is busy or rate limited. Wait a moment and retry.",
    ],
  };
  const [code, message] = failures[status] ?? [
    502,
    "Your provider is temporarily unavailable. Please try again shortly.",
  ];
  return new GenerationProviderError(code, message);
}
export const commandJSONSchema = z.toJSONSchema(commandSchema);
const baseSystemPrompt = `You create playful, coherent 3D worlds for Orbsie. Use recentConversation only as context for references and prior preferences; the current instruction and current project snapshot govern this turn. Return only scene command JSON without Markdown. Each command must match the provided command schema. Reserve only NEW entities FIRST with a new stable ID, label, position, scale, color, stage seed. For edits to an existing entity ID, use setters directly; NEVER reserve that ID again or remove/recreate it. Preserve the existing ID and all unrelated entities. For generated geometry, reserve first, optionally provide a procedural coarse preview, then send one refined generated job; objects referenced by project.game must receive refined replacements directly so their saved gameplay remains valid. Use reusable kinds or custom parts to invent varied objects. Scene hierarchy: create_group creates a stable non-rendered group (id,label,position,scale, optional rotation and parentId). Parents must be existing group IDs. Reserve child entities with parentId to group them while retaining their individual IDs and geometry. set_group_transform edits a group; set_transform edits one entity. These authoring transforms are parent-local, in meters with XYZ Euler rotation in radians and Y up. Group scales must be positive. set_parent targets an entity or group and requires parentId (group ID or null) and explicit keepWorldTransform: true preserves placement if representable as local TRS, false preserves local coordinates. Unsupported shear reparenting, cycles, and nonempty group removal are rejected atomically. Use remove_group only after explicitly moving or removing its children. Legacy move axes and game path positions remain root/world-space. Keep descendant world positions on the island and preserve unrelated groups and entities during targeted edits. Coordinates: x/z ground plane, y up; playable circular island radius 8, start at [0,0,5]. Keep all objects on island. Use max 70 objects, max 16 parts/object. Trees ~2 units tall. Supported behaviors: static, collect (crystal), move (platform, axis/speed/amplitude), portal (unlocks when all collect entities are collected), bloom (click), bounce. For composable games use set_game with the complete data-only program: variables, ordered rules, start/click/collision/collect/input/timer triggers, conditions, and actions including score, win/lose/reset and movement paths. Finish referenced entities to ready before set_game. Replace or clear rules with set_game before removing a referenced object. game:null removes the program. Keep unrelated rules when editing; use the current project.game as the baseline. A game program owns score and outcomes; define them explicitly instead of relying on the legacy portal auto-win. Never include arbitrary code, URLs, credentials, scripts, or external assets. The only code-like output permitted is the typed browser-procedural source object when browserModeling is true and its capability instructions explicitly permit it. You may use known local catalog IDs supplied in assetCatalog via kind asset and assetId. Prefer a useful mix of catalog models and newly generated procedural/custom shapes, alternating where they fit the request; never force an unsuitable substitution. Explicit new-only policy prohibits catalog reuse for that scope, including follow-up edits. Preserve original catalog material colors unless recoloring is requested; use set_material for an explicit tint. For object edits, preserve all unrelated entities. Conclude with commit_revision with a brief friendly message.`;

const modelingFeedbackInstruction =
  "If modelingFeedback is present, it is a bounded browser-side rejection report. Repair the reported entity or node in response to the current instruction, preserve stable IDs and unrelated finished geometry, and change the rejected recipe instead of repeating it.";

const catalogCompositionInstruction =
  "When catalog assets are allowed and combined with generated parts, use each asset's supplied unscaled local bounds, origin, units, axis, and source-to-runtime scale to size and place attachments. Apply the entity transform and any parent transform when reasoning about world placement. Scale catalog assets when needed; make attachments intentionally contact or provide explicit branch/stem support. Do not treat separated spheres as detailed fruit. Use procedural freedom for varied silhouettes and requested details.";

function modelingInstructionsForOutputFormat(
  localModeling: boolean,
  browserModeling: boolean,
  outputFormat: GenerationOutputFormat,
) {
  const instructions = modelingInstructions(localModeling, browserModeling);
  if (outputFormat === "ndjson") return instructions;
  const formatted = instructions.replace(
    /Keep each command as one complete compact NDJSON line:[^.]*\./,
    "Keep each command as one complete object in the commands array in authoring order: close the recipe, then job and geometry, then the command-level assetPolicy and final command brace before the next array entry.",
  );
  if (outputFormat !== "json-schema-strict") return formatted;
  return formatted.replace(
    "This complete schema-valid set_geometry command uses a generic reserved ID and shows the placement:",
    "This canonical set_geometry example is conceptual only; do not copy it verbatim. Encode its modeling recipe using the strict wire wrappers and tuple objects supplied in response_format:",
  );
}

function outputFormatInstruction(outputFormat: GenerationOutputFormat) {
  if (outputFormat === "ndjson")
    return "Output ONLY newline-delimited JSON, one complete command per line, without Markdown.";
  if (outputFormat === "json-schema-strict")
    return "Output exactly one JSON object with only a commands array, without Markdown or other root keys. Use the strict wire schema supplied in response_format. Every optional property is a required wrapper of {present:false} or {present:true,value:...}; explicit null belongs inside value. Heterogeneous fixed tuples use closed objects with item0, item1, and so on. Put complete command objects in authoring order; the server validates each object incrementally and accepts the envelope only after its closing braces.";
  return "Output exactly one JSON object with only a commands array, without Markdown or other root keys. Put complete command objects in authoring order; the server validates each object incrementally and accepts the envelope only after its closing braces.";
}

export function systemPromptForCapabilities(
  localModeling = false,
  browserModeling = false,
  outputFormat: GenerationOutputFormat = "ndjson",
) {
  const schemaInstruction =
    outputFormat === "json-schema-strict"
      ? "Each command in the commands array must match the strict wire schema supplied in response_format. Preserve every optional field with its presence wrapper and use itemN objects for heterogeneous tuples; the server restores canonical project commands before applying them."
      : outputFormat === "json-schema"
        ? "Each command in the commands array must match the command schema supplied in response_format."
        : `You may only use commands matching this schema: ${JSON.stringify(modelCommandJSONSchemaForCapabilities(localModeling, browserModeling))}`;
  return `${baseSystemPrompt} ${outputFormatInstruction(outputFormat)} ${modelingFeedbackInstruction} ${catalogCompositionInstruction} ${modelingInstructionsForOutputFormat(localModeling, browserModeling, outputFormat)} ${schemaInstruction}`;
}

function responseFormatFor(
  outputFormat: GenerationOutputFormat,
  localModeling: boolean,
  browserModeling: boolean,
) {
  if (outputFormat === "ndjson") return undefined;
  if (outputFormat === "json-object") return { type: "json_object" as const };
  const items =
    outputFormat === "json-schema-strict"
      ? strictSceneCommandJSONSchemaForCapabilities(
          localModeling,
          browserModeling,
        )
      : modelCommandJSONSchemaForCapabilities(localModeling, browserModeling);
  return {
    type: "json_schema" as const,
    json_schema: {
      name: "orbsie_scene_commands",
      strict: outputFormat === "json-schema-strict",
      schema: {
        type: "object",
        properties: {
          commands: {
            type: "array",
            items,
          },
        },
        required: ["commands"],
        additionalProperties: false,
      },
    },
  };
}

export const systemPrompt = systemPromptForCapabilities();
export async function generateCommands({
  provider,
  model,
  key,
  prompt,
  project,
  selected,
  signal,
  maxTokens = 10000,
  localModeling = false,
  browserModeling = false,
  modelingFeedback,
  generationFeedback,
  outputFormat = "ndjson",
}: {
  provider: "openrouter" | "gateway";
  model: string;
  key: string;
  prompt: string;
  project: Project;
  selected?: string;
  signal: AbortSignal;
  maxTokens?: number;
  localModeling?: boolean;
  browserModeling?: boolean;
  modelingFeedback?: ModelingFeedback;
  generationFeedback?: GenerationFeedback;
  outputFormat?: GenerationOutputFormat;
}) {
  const assetPolicy = deriveAssetPolicy(prompt, selected, project);
  const endpoint =
    provider === "openrouter"
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://ai-gateway.vercel.sh/v1/chat/completions";
  const providerRouting =
    provider === "openrouter" ? openrouterProviderRouting(model) : undefined;
  const structuredOpenRouterRouting =
    provider === "openrouter" && outputFormat !== "ndjson"
      ? { ...(providerRouting ?? {}), require_parameters: true }
      : providerRouting;
  const responseFormat = responseFormatFor(
    outputFormat,
    localModeling,
    browserModeling,
  );
  const validatedGenerationFeedback = generationFeedback
    ? generationFeedbackSchema.parse(generationFeedback)
    : undefined;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(provider === "openrouter"
        ? { "HTTP-Referer": "https://orbsie.com", "X-Title": "Orbsie" }
        : {}),
    },
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: maxTokens,
      ...(isRecommendedModel(model) ? { reasoning: { effort: "low" } } : {}),
      ...(structuredOpenRouterRouting
        ? { provider: structuredOpenRouterRouting }
        : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
      messages: [
        {
          role: "system",
          content: [
            systemPromptForCapabilities(
              localModeling,
              browserModeling,
              outputFormat,
            ),
            generationFeedbackInstruction(validatedGenerationFeedback),
          ]
            .filter(Boolean)
            .join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            instruction: prompt,
            recentConversation: authoringHistory(project, prompt),
            localModeling,
            browserModeling,
            assetPolicy,
            assetCatalog: promptCatalogForPolicy(
              assetPolicy.requestAssetPolicy,
            ),
            selectedEntityId: selected,
            ...(modelingFeedback
              ? {
                  modelingFeedback:
                    modelingFeedbackSchema.parse(modelingFeedback),
                }
              : {}),
            project: { ...project, messages: [] },
          }),
        },
      ],
    }),
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw providerFailure(response.status);
  }
  return new ReadableStream({
    async start(controller) {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "",
        records = "",
        working = project,
        count = 0,
        lastCommandType = "";
      const structuredOutput = outputFormat !== "ndjson";
      const strictStructuredOutput = outputFormat === "json-schema-strict";
      let pendingCommit:
        Extract<ModelCommand, { type: "commit_revision" }> | undefined;
      let refusalSeen = false;
      let finishReason: GenerationFinishReason = null;
      let cursor: Cursor = {
        runId: crypto.randomUUID(),
        sequence: 0,
        seen: new Set(),
      };
      const objectRecord = (
        value: unknown,
      ): Record<string, unknown> | undefined =>
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : undefined;
      function applyAndEnqueue(command: ModelCommand) {
        let applied: ReturnType<typeof applyModelOperation>;
        try {
          applied = applyModelOperation(
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
        } catch (error) {
          if (error instanceof z.ZodError) throw error;
          throw new SceneProtocolError(finishReason);
        }
        working = applied.project;
        cursor = applied.cursor;
        lastCommandType = command.type;
        controller.enqueue(encoder.encode(JSON.stringify(command) + "\n"));
      }
      function emit(line: string) {
        if (!line.trim()) return;
        if (++count > 250)
          throw Error(
            "This turn reached its scene update limit. Continue from the saved world.",
          );
        let input: unknown;
        try {
          input = JSON.parse(line);
        } catch {
          throw new SceneJSONError(finishReason);
        }
        if (strictStructuredOutput) {
          try {
            input = decodeStrictSceneCommand(
              input,
              localModeling,
              browserModeling,
            );
          } catch (error) {
            if (error instanceof StrictSceneSchemaError)
              throw new SceneProtocolError(finishReason);
            throw error;
          }
        }
        let parsed: ModelCommand;
        try {
          parsed = parseModelCommandForProcessing(
            input,
            localModeling,
            browserModeling,
          );
        } catch (error) {
          if (error instanceof z.ZodError) throw error;
          throw new SceneProtocolError(finishReason);
        }
        let command: ModelCommand;
        try {
          command = enforceAssetPolicy(working, parsed, assetPolicy);
        } catch (error) {
          if (error instanceof z.ZodError) throw error;
          throw new SceneProtocolError(finishReason);
        }
        try {
          assertModelingCommand(command, localModeling, browserModeling);
        } catch (error) {
          if (error instanceof z.ZodError) throw error;
          throw new SceneProtocolError(
            finishReason,
            error instanceof Error ? error.message : undefined,
          );
        }
        if (structuredOutput && pendingCommit)
          throw new SceneProtocolError(
            finishReason,
            "No scene commands may follow commit_revision.",
          );
        if (structuredOutput && command.type === "commit_revision") {
          pendingCommit = command;
          return;
        }
        applyAndEnqueue(command);
      }
      const envelopeDecoder = structuredOutput
        ? new SceneCommandEnvelopeDecoder({ onCommand: emit })
        : undefined;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 200000)
            throw Error("Provider event exceeded the size limit.");
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const text = line.slice(5).trim();
            if (!text || text === "[DONE]") continue;
            let event: unknown;
            try {
              event = JSON.parse(text);
            } catch {
              throw new SceneProtocolError(finishReason);
            }
            const record = objectRecord(event);
            if (!record) throw new SceneProtocolError(finishReason);
            const choice = Array.isArray(record.choices)
              ? objectRecord(record.choices[0])
              : undefined;
            if (choice) {
              const reason = choice.finish_reason;
              if (reason === "refusal") refusalSeen = true;
              if (reason !== undefined && reason !== null)
                finishReason = normalizeFinishReason(reason);
            }
            if (record.error)
              throw new ProviderStreamError(record.error, finishReason);
            const deltaRecord = objectRecord(choice?.delta);
            if (typeof deltaRecord?.refusal === "string") refusalSeen = true;
            const delta = deltaRecord?.content;
            if (typeof delta !== "string") continue;
            if (structuredOutput) {
              try {
                envelopeDecoder!.push(delta);
              } catch (error) {
                if (error instanceof SceneCommandEnvelopeError)
                  throw new SceneJSONError(finishReason);
                throw error;
              }
            } else {
              records += delta;
              if (records.length > 100000)
                throw Error("Scene command exceeded the size limit.");
              const complete = records.split("\n");
              records = complete.pop()!;
              for (const record of complete) emit(record);
            }
          }
        }
        if (structuredOutput) {
          try {
            envelopeDecoder!.finish();
          } catch (error) {
            if (
              error instanceof SceneCommandEnvelopeError &&
              finishReason === "length"
            )
              throw new TruncatedSceneStreamError(finishReason);
            if (error instanceof SceneCommandEnvelopeError)
              throw new SceneJSONError(finishReason);
            throw error;
          }
          if (finishReason === "length")
            throw new TruncatedSceneStreamError(
              finishReason,
              "The model response ended before the scene was complete. Finished objects are preserved; retry to continue.",
            );
          if (refusalSeen || finishReason !== "stop")
            throw new SceneProtocolError(
              finishReason,
              "The model did not complete this scene update.",
            );
          if (pendingCommit) {
            const commit = pendingCommit;
            pendingCommit = undefined;
            applyAndEnqueue(commit);
          }
        } else if (records.trim()) emit(records);
        if (!count) {
          if (finishReason === "length")
            throw new TruncatedSceneStreamError(finishReason);
          throw new SceneProtocolError(
            finishReason,
            "This model did not return any supported scene commands. Select another model.",
          );
        }
        if (lastCommandType !== "commit_revision") {
          const message =
            "Generation ended before committing this turn. Finished objects are preserved; retry to continue.";
          if (finishReason === "length")
            throw new TruncatedSceneStreamError(finishReason, message);
          throw new SceneProtocolError(finishReason, message);
        }
      } catch (error) {
        const diagnostic = generationDiagnostic(error, count, finishReason);
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              error:
                error instanceof Error &&
                !(error instanceof z.ZodError) &&
                !(error instanceof SyntaxError)
                  ? error.message
                  : "The model returned an invalid scene update. Finished objects are preserved.",
              ...(diagnostic ?? {}),
            }) + "\n",
          ),
        );
      } finally {
        await reader.cancel().catch(() => {});
        controller.close();
      }
    },
  });
}
