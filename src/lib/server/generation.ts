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
import type { ModelCapabilities } from "../model-capabilities";
import {
  ReviewImageValidationError,
  UnsupportedReviewImageError,
  validateSceneReviewImage,
  type SceneReviewImage,
} from "../review-image";
import type {
  GenerationObservation,
  GenerationStreamFailureReason,
} from "./generation-observability";
import {
  createAuthoringLifecycle,
  updateSceneProvenance,
  type AuthoringLifecycleHooks,
  type SceneProvenanceMap,
  initialSceneProvenance,
} from "../scene-binding";

export class GenerationProviderError extends Error {
  constructor(
    public status: number,
    message: string,
    public providerStatus = status,
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
  return new GenerationProviderError(code, message, status);
}
export const commandJSONSchema = z.toJSONSchema(commandSchema);
export const authoringPromptSections = {
  currentUserIntentAndPreservation: `You create playful, coherent 3D worlds for Orbsie. CURRENT USER INTENT AND PRESERVATION: Use recentConversation only as context for references and prior preferences; the current instruction and project snapshot govern this turn. Follow explicit subject, mood, distinctive details, and scoped edits within the schema and policies below. On edits preserve established direction, IDs, and unrelated entities. Reserve only NEW entities FIRST with a stable ID, label, position, scale, color, and stage seed. For edits, use setters on existing IDs; never reserve them again or remove/recreate them as an editing shortcut. Remove only objects the current request asks to remove, respecting game and group references. Scene hierarchy: create_group is a stable non-rendered group (id,label,position,scale, optional rotation,parentId); parents must already be groups. Reserve child entities with parentId while retaining their IDs and geometry. set_group_transform edits a group; set_transform edits one entity. Authoring transforms are parent-local meters with XYZ radians and Y up; group scales are positive. set_parent targets an entity or group and requires parentId (group ID or null) plus explicit keepWorldTransform: true preserves placement when representable as local TRS, false preserves local coordinates. Unsupported shear reparenting, cycles, and nonempty group removal are rejected atomically; use remove_group only after moving or removing its children. Legacy move axes and game path positions remain root/world-space. Keep descendant world positions and unrelated groups and entities unchanged.`,
  artisticIntent: `ARTISTIC INTENT: Honor the requested subject, mood, and distinctive details with a recognizable silhouette, deliberate proportions, coherent restrained palette, and purposeful accents. Establish focal hierarchy with supporting scenery; spend geometry on play-camera-visible details. At play-camera scale, prioritize each subject's defining silhouette and relative scale, then make requested attached forms visibly connected and unobscured before surface decoration; preserve requested colors on defining features. Match distinctive object forms, not just their color: a round blue sphere does not convey a pointed berry when the request names one. Add visible stem, branch, or other support geometry when needed. When a catalog asset cannot express a requested defining feature, build that feature with available custom or procedural geometry while keeping suitable catalog pieces. Give objects believable contact and support, with intentional variation among related forms. Size attached details against the main object: unless the user requests oversized forms, fruit, leaves, wheels, windows, and similar details should remain subordinate to their support and be visibly distinct from one another. Do not let a few giant details overwhelm the requested subject. Do not mandate a fixed style, prop arrangement, or template catalogue. An explicit giant or size request overrides default tree guidance of about 2 meters.`,
  playableExperience: `PLAYABLE EXPERIENCE: For game worlds, define a clear player action and reachable objective, visible feedback, and supported completion/reset mechanics. Build the essential route and interactions before decoration; provide a clear spawn/path. Keep platform tops, gaps, and motion endpoints within player capabilities, and do not make appearance imply unsupported collision or interaction. Do not force win/loss on exploratory worlds. Coordinates are x/z on the horizontal ground plane and y up; default ground extends in every horizontal direction and a useful starting spawn is [0,0,5]. For a distant game, set optional game.spawn to a world-space player-center position near the route, and keep the spawn, objectives, and every path reachable from one another. Create a bounded island, walls, cliffs, or other barriers only when the user or game concept explicitly calls for them. Treat authored islands and barriers as visual geometry unless a supported interaction mechanic provides the requested behavior; do not imply or rely on physical containment from them. Keep objectives reachable through supported platforms, pickups, portals, and motion. Supported behaviors are static, collect (crystal), move (platform, axis/speed/amplitude), portal (unlocks when all collect entities are collected), bloom (click), and bounce. For a moving bounce platform, keep the entity behavior.type as "bounce" and use a game-program move_path action on that same entity from a start or timer rule; this composes path motion with bounce-on-contact player launch. A set_position action only repositions the platform; it never launches the player and cancels an active path. Keep platform tops and spacing between successive tops within jump reach: with JUMP_SPEED 6 and gravity 15 (ideal rise 1.2), leave a sensible margin. A game program owns score and outcomes; define them explicitly instead of relying on the legacy portal auto-win.`,
  stagedAuthoring: `STAGED AUTHORING: For composable games, use set_game with the complete data-only program: optional world-space player-center spawn, variables, ordered rules, start/click/collision/collect/input/timer triggers, conditions, and actions including score, win/lose/reset, and movement paths. For a distant game, set game.spawn near its reachable route; keep objectives and movement paths reachable from that spawn. If omitted, authored games keep the default player start. For generated geometry, reserve first, optionally provide a procedural coarse preview, then send one refined generated job; objects referenced by project.game receive refined replacements directly so saved gameplay remains valid. Built-in procedural kinds may carry custom parts in the same object; use them for visible defining details attached to the base shape. A lathe custom part uses profile points [radius,height] revolved about local Y, then its position, scale, and rotation; use it when a tapered or curved silhouette is important, with separately colored parts for attached details. Use kind custom when no base kind fits. Finish referenced entities to ready before set_game. Replace or clear rules with set_game before removing a referenced object; game:null removes the program. Keep unrelated rules when editing, using current project.game as the baseline. Conclude with commit_revision with a brief friendly message.`,
  supportedCapabilitiesAndOutput: `SUPPORTED CAPABILITIES AND OUTPUT: Entity and group position components may use finite parent-local coordinates from -1,000,000 to 1,000,000 meters; prefer practical nearby values because extreme coordinates have coarser renderer precision. Keep local custom-part positions, scales, and rotations within their bounded schema. Use at most 70 objects. Aim for at most 16 custom parts per object for useful, bounded authoring; the custom-parts geometry schema hard limit is 32 parts per object. Never include arbitrary code, URLs, credentials, scripts, or external assets. The only code-like output permitted is the typed browser-procedural source object when browserModeling is true and its capability instructions explicitly permit it. You may use known local catalog IDs supplied in assetCatalog via kind asset and assetId. Prefer a useful mix of catalog models and newly generated procedural/custom shapes, alternating where they fit; never force an unsuitable substitution. Explicit new-only policy prohibits catalog reuse for that scope, including follow-up edits. Preserve original catalog material colors unless recoloring is requested; use set_material for an explicit tint. For object edits preserve all unrelated entities. Return only scene command JSON without Markdown. Each command must match the provided command schema; syntax and validation remain authoritative.`,
} as const;

const baseSystemPrompt = Object.values(authoringPromptSections).join("\n\n");

const modelingFeedbackInstruction =
  "If modelingFeedback is present, it is a bounded browser-side rejection report. Repair the reported entity or node in response to the current instruction, preserve stable IDs and unrelated finished geometry, and change the rejected recipe instead of repeating it.";

const catalogCompositionInstruction =
  "When catalog assets are allowed, use each asset's supplied unscaled local bounds, origin, units, axis, and source-to-runtime scale to size and place every asset, including standalone placements and replacements. Apply the entity transform and any parent transform when reasoning about world placement. When changing geometry or scale, recompute translation to preserve the intended ground or support contact; do not blindly keep a raw y value. For unrotated root/world Y-up placement, use y = supportY - minY * scaleY (for example, source minY=-0.05 at scaleY=25 needs y=1.25 for groundY=0). With rotation or parents, use transformed bounds and express the correction in the parent-local convention. Preserve horizontal location and unrelated scene content, and do not snap a request that is intentionally floating or embedded. Material-only edits preserve the existing geometry, scale, rotation, and position. Scale catalog assets when needed; keep joined forms visibly connected with stem, branch, or other support geometry where needed. When replacing an object, compare the replacement's transformed physical dimensions with the existing object's bounds; raw scale values across different catalog assets are not comparable. For larger or giant requests, choose dimensions that exceed the previous intended size using bounds and transforms. If a catalog asset cannot express a requested defining feature, use available custom or procedural geometry for that feature while retaining suitable catalog pieces. Do not represent attached details as disconnected shapes. Use procedural freedom for varied silhouettes and requested details.";

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

const MAX_PROVIDER_REQUEST_BYTES = 512 * 1024;

type ProviderMessage = {
  role: "system" | "user";
  content:
    | string
    | readonly (
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      )[];
};

/** Build the provider content while preserving the text-only wire shape. */
export function buildProviderMessages({
  prompt,
  project,
  selected,
  localModeling,
  browserModeling,
  assetPolicy,
  modelingFeedback,
  generationFeedback,
  outputFormat,
  reviewImage,
}: {
  prompt: string;
  project: Project;
  selected?: string;
  localModeling: boolean;
  browserModeling: boolean;
  assetPolicy: ReturnType<typeof deriveAssetPolicy>;
  modelingFeedback?: ModelingFeedback;
  generationFeedback?: GenerationFeedback;
  outputFormat: GenerationOutputFormat;
  reviewImage?: SceneReviewImage;
}): ProviderMessage[] {
  const userText = JSON.stringify({
    instruction: prompt,
    recentConversation: authoringHistory(project, prompt),
    localModeling,
    browserModeling,
    assetPolicy,
    assetCatalog: promptCatalogForPolicy(assetPolicy.requestAssetPolicy),
    selectedEntityId: selected,
    ...(modelingFeedback ? { modelingFeedback } : {}),
    project: { ...project, messages: [] },
  });
  const userContent = reviewImage
    ? [
        { type: "text" as const, text: userText },
        {
          type: "image_url" as const,
          image_url: { url: reviewImage.image },
        },
      ]
    : userText;
  return [
    {
      role: "system",
      content: [
        systemPromptForCapabilities(
          localModeling,
          browserModeling,
          outputFormat,
        ),
        generationFeedbackInstruction(generationFeedback),
      ]
        .filter(Boolean)
        .join(" "),
    },
    { role: "user", content: userContent },
  ];
}

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
  reviewImage,
  capabilities,
  observability,
  lifecycle,
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
  /** A server-preflight capability snapshot; never supplied by the client. */
  capabilities?: ModelCapabilities;
  /** Internal trusted review capture, bound below to this project snapshot. */
  reviewImage?: unknown;
  /** Internal server observation; never supplied by the public request body. */
  observability?: GenerationObservation;
  /** Internal completion authority; public routes do not provide this hook. */
  lifecycle?: AuthoringLifecycleHooks;
}) {
  const observation = observability;
  const consumerAbort = new AbortController();
  const streamSignal = AbortSignal.any([signal, consumerAbort.signal]);
  let latestProject = project;
  const provenance: SceneProvenanceMap = lifecycle
    ? initialSceneProvenance(project)
    : new Map();
  const lifecycleController = createAuthoringLifecycle(
    lifecycle,
    streamSignal,
    () => ({ project: latestProject, provenance }),
  );
  const validatedReviewImage =
    reviewImage === undefined
      ? undefined
      : validateSceneReviewImage(reviewImage, {
          projectId: project.id,
          revision: project.revision,
        });
  if (validatedReviewImage && capabilities?.imageInput?.supported !== true)
    throw new UnsupportedReviewImageError();
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
  const messages = buildProviderMessages({
    prompt,
    project,
    selected,
    localModeling,
    browserModeling,
    assetPolicy,
    modelingFeedback: modelingFeedback
      ? modelingFeedbackSchema.parse(modelingFeedback)
      : undefined,
    generationFeedback: validatedGenerationFeedback,
    outputFormat,
    reviewImage: validatedReviewImage,
  });
  const requestBody = {
    model,
    stream: true,
    max_tokens: maxTokens,
    ...(isRecommendedModel(model) ? { reasoning: { effort: "low" } } : {}),
    ...(structuredOpenRouterRouting
      ? { provider: structuredOpenRouterRouting }
      : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    messages,
  };
  const serializedRequestBody = JSON.stringify(requestBody);
  if (
    validatedReviewImage &&
    new TextEncoder().encode(serializedRequestBody).byteLength >
      MAX_PROVIDER_REQUEST_BYTES
  )
    throw new ReviewImageValidationError(
      "payload-too-large",
      "This review request exceeds the provider input limit.",
    );
  observation?.phase("provider-start");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(provider === "openrouter"
          ? { "HTTP-Referer": "https://orbsie.com", "X-Title": "Orbsie" }
          : {}),
      },
      body: serializedRequestBody,
      signal,
    });
  } catch (error) {
    await lifecycleController.fail(error);
    const timedOut =
      streamSignal.aborted && streamSignal.reason?.name === "TimeoutError";
    const clientAborted = streamSignal.aborted && !timedOut;
    observation?.terminal({
      reason: timedOut
        ? "deadline"
        : clientAborted
          ? "client-abort"
          : "transport-error",
      abortSource: timedOut ? "deadline" : clientAborted ? "client" : undefined,
      failureCode: timedOut
        ? "timeout"
        : clientAborted
          ? "cancelled"
          : "transport",
    });
    throw error;
  }
  if (!response.ok) {
    await response.body?.cancel();
    const error = providerFailure(response.status);
    await lifecycleController.fail(error);
    observation?.terminal({
      reason: "provider-error",
      failureCode: response.status === 402 ? "quota" : "provider-rejected",
      httpStatus: response.status,
    });
    throw error;
  }
  const providerBody = response.body;
  if (!providerBody) {
    const error = Error("Provider response body is missing.");
    await lifecycleController.fail(error);
    observation?.terminal({
      reason: "transport-error",
      failureCode: "transport",
    });
    throw error;
  }
  return new ReadableStream({
    async start(controller) {
      const reader = providerBody.getReader();
      const cancelReader = () => {
        void reader.cancel().catch(() => {});
      };
      if (streamSignal.aborted) {
        await reader.cancel().catch(() => {});
        if (!consumerAbort.signal.aborted) controller.close();
        return;
      }
      streamSignal.addEventListener("abort", cancelReader, { once: true });
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "",
        records = "",
        working = project,
        count = 0,
        lastCommandType = "";
      let missingCommit = false;
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
      function applyAndEnqueue(command: ModelCommand, deferCommit = false) {
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
        latestProject = working;
        cursor = applied.cursor;
        updateSceneProvenance(provenance, command);
        lastCommandType = command.type;
        observation?.noteCommand();
        observation?.noteOutputBytes(
          encoder.encode(JSON.stringify(command) + "\n").byteLength,
        );
        if (!deferCommit) {
          if (command.type === "commit_revision") observation?.commit();
          controller.enqueue(encoder.encode(JSON.stringify(command) + "\n"));
        }
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
        if (pendingCommit)
          throw new SceneProtocolError(
            finishReason,
            "No scene commands may follow commit_revision.",
          );
        if (command.type === "commit_revision") {
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
          observation?.noteInputBytes(value.byteLength);
          observation?.phase("first-byte");
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
        } else if (records.trim()) emit(records);
        if (!count) {
          if (finishReason === "length")
            throw new TruncatedSceneStreamError(finishReason);
          missingCommit = true;
          throw new SceneProtocolError(
            finishReason,
            "This model did not return any supported scene commands. Select another model.",
          );
        }
        if (!pendingCommit) {
          missingCommit = true;
          const message =
            "Generation ended before committing this turn. Finished objects are preserved; retry to continue.";
          if (finishReason === "length")
            throw new TruncatedSceneStreamError(finishReason, message);
          throw new SceneProtocolError(finishReason, message);
        }
        if (finishReason && finishReason !== "stop") {
          if (finishReason === "length")
            throw new TruncatedSceneStreamError(
              finishReason,
              "The model response ended before the scene was complete. Finished objects are preserved; retry to continue.",
            );
          throw new SceneProtocolError(
            finishReason,
            "The model did not complete this scene update.",
          );
        }
        const commit = pendingCommit;
        if (!commit)
          throw new SceneProtocolError(finishReason, "Missing scene commit.");
        pendingCommit = undefined;
        applyAndEnqueue(commit, true);
        await lifecycleController.complete();
        observation?.commit();
        controller.enqueue(encoder.encode(JSON.stringify(commit) + "\n"));
      } catch (error) {
        await lifecycleController.fail(error);
        const aborted = streamSignal.aborted;
        const completionFailed = lifecycleController.completionFailed();
        const diagnostic = generationDiagnostic(error, count, finishReason);
        const parserFailure =
          diagnostic !== undefined && !(error instanceof ProviderStreamError);
        const failure: GenerationStreamFailureReason = completionFailed
          ? "completion-record-failure"
          : aborted && streamSignal.reason?.name === "TimeoutError"
            ? "deadline"
            : error instanceof TruncatedSceneStreamError ||
                finishReason === "length"
              ? "output-limit"
              : missingCommit
                ? "clean-eof-without-commit"
                : error instanceof ProviderStreamError
                  ? "provider-error"
                  : error instanceof SceneJSONError ||
                      error instanceof SceneProtocolError ||
                      parserFailure
                    ? "parser-failure"
                    : "stream-error";
        observation?.terminal({
          reason: aborted
            ? streamSignal.reason?.name === "TimeoutError"
              ? "deadline"
              : "client-abort"
            : completionFailed
              ? "completion-record-failure"
              : failure === "output-limit"
                ? "output-limit"
                : missingCommit
                  ? "clean-eof-without-commit"
                  : error instanceof ProviderStreamError
                    ? "provider-error"
                    : error instanceof SceneJSONError ||
                        error instanceof SceneProtocolError ||
                        error instanceof TruncatedSceneStreamError ||
                        parserFailure
                      ? "parser-failure"
                      : "transport-error",
          abortSource: aborted
            ? streamSignal.reason?.name === "TimeoutError"
              ? "deadline"
              : "client"
            : undefined,
          failureCode: aborted
            ? streamSignal.reason?.name === "TimeoutError"
              ? "timeout"
              : "cancelled"
            : completionFailed
              ? "host-unavailable"
              : failure === "output-limit"
                ? "output-limit"
                : missingCommit
                  ? "parser"
                  : error instanceof ProviderStreamError
                    ? error.providerStatus === 402
                      ? "quota"
                      : "provider-rejected"
                    : error instanceof SceneJSONError ||
                        error instanceof SceneProtocolError ||
                        error instanceof TruncatedSceneStreamError ||
                        parserFailure
                      ? "parser"
                      : "transport",
          httpStatus:
            error instanceof ProviderStreamError &&
            error.providerStatus !== null
              ? error.providerStatus
              : undefined,
          finishReason: finishReason ?? undefined,
        });
        if (!consumerAbort.signal.aborted)
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
                ...(diagnostic ?? {}),
              }) + "\n",
            ),
          );
      } finally {
        if (
          !streamSignal.aborted &&
          lastCommandType === "commit_revision" &&
          !lifecycleController.completionFailed()
        )
          observation?.terminal({
            reason: "completed",
            finishReason: finishReason ?? undefined,
          });
        await reader.cancel().catch(() => {});
        streamSignal.removeEventListener("abort", cancelReader);
        if (!consumerAbort.signal.aborted) controller.close();
      }
    },
    cancel(reason) {
      consumerAbort.abort(reason);
      return lifecycleController.fail(
        reason instanceof Error ? reason : Error("Generation cancelled."),
      );
    },
  });
}
