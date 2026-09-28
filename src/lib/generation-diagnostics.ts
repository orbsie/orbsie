import { z } from "zod";

const MAX_ISSUES = 8;
const MAX_PATH_DEPTH = 12;
const MAX_PATH_INDEX = 255;
const MAX_UNION_DEPTH = 4;
const MAX_CANDIDATES = 256;
const MAX_OPERATION_COUNT = 251;

export const generationDiagnosticCodes = [
  "INVALID_SCENE_UPDATE",
  "INVALID_SCENE_JSON",
  "INVALID_SCENE_PROTOCOL",
  "TRUNCATED_SCENE_STREAM",
  "PROVIDER_STREAM_ERROR",
] as const;
export const chatGPTGenerationDiagnosticCode =
  "CHATGPT_GENERATION_ERROR" as const;
export const generationDiagnosticReasons = [
  "duplicate_recipe_node_id",
  "unreachable_recipe_node",
] as const;
export const sceneProtocolSubreasons = [
  "malformed-provider-event",
  "strict-schema-rejected",
  "unsupported-command",
  "asset-policy-rejected",
  "modeling-policy-rejected",
  "command-apply-rejected",
  "command-after-commit",
  "provider-incomplete",
  "no-supported-commands",
  "missing-commit",
  "unclassified",
] as const;
export type SceneProtocolSubreason = (typeof sceneProtocolSubreasons)[number];
const knownSceneProtocolSubreasons = new Set<string>(sceneProtocolSubreasons);

function safeSceneProtocolSubreason(value: unknown): SceneProtocolSubreason {
  return typeof value === "string" && knownSceneProtocolSubreasons.has(value)
    ? (value as SceneProtocolSubreason)
    : "unclassified";
}

export const generationDiagnosticPathKeys = [
  "type",
  "version",
  "revision",
  "output",
  "nodes",
  "id",
  "kind",
  "size",
  "radius",
  "segments",
  "depth",
  "axis",
  "profile",
  "input",
  "position",
  "rotation",
  "scale",
  "operation",
  "operands",
  "entity",
  "label",
  "color",
  "stage",
  "geometry",
  "assetPolicy",
  "game",
  "sky",
  "ground",
  "water",
  "message",
  "behavior",
  "speed",
  "amplitude",
  "collision",
  "job",
  "backend",
  "recipe",
  "detail",
  "tint",
  "assetId",
  "parts",
  "shape",
  "vertices",
  "faces",
  "bevel",
  "subdivision",
  "model",
  "source",
  "kernelVersion",
  "blenderVersion",
  "sha256",
  "bytes",
  "bounds",
  "min",
  "max",
  "createdAt",
  "title",
  "seed",
  "entities",
  "environment",
  "messages",
  "role",
  "text",
  "entityId",
  "variables",
  "rules",
  "name",
  "initial",
  "trigger",
  "conditions",
  "actions",
  "operand",
  "comparison",
  "value",
  "action",
  "seconds",
  "repeat",
  "amount",
  "visible",
  "points",
  "duration",
  "loop",
  "delta",
] as const;

export const generationDiagnosticIssueCodes = [
  "invalid_type",
  "too_big",
  "too_small",
  "invalid_format",
  "not_multiple_of",
  "unrecognized_keys",
  "invalid_union",
  "invalid_key",
  "invalid_element",
  "invalid_value",
  "custom",
] as const;

export const chatGPTGenerationStages = [
  "catalog",
  "thread-start",
  "turn-start",
  "stream",
] as const;

export const chatGPTGenerationReasons = [
  "rpc-rejection",
  "terminal-failure",
  "callback-validation",
  "tool-rejection",
  "timeout",
  "cancelled",
  "output-bound",
  "runtime-closed",
  "model-unavailable",
  "image-unsupported",
  "invalid-input",
  "unknown",
] as const;

export type ChatGPTGenerationStage = (typeof chatGPTGenerationStages)[number];
export type ChatGPTGenerationReason = (typeof chatGPTGenerationReasons)[number];

const MIN_RPC_CODE = -32_768;
const MAX_RPC_CODE = 32_767;

/** Keep JSON-RPC codes numeric and bounded; discard all other error data. */
export function boundedRpcCode(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= MIN_RPC_CODE &&
    value <= MAX_RPC_CODE
    ? value
    : undefined;
}

/** A provider-safe rejection created by the isolated App Server transport. */
export class ChatGPTRpcError extends Error {
  readonly rpcCode?: number;

  constructor(code?: unknown) {
    super("ChatGPT App Server request failed.");
    this.name = "ChatGPTRpcError";
    const bounded = boundedRpcCode(code);
    if (bounded !== undefined) this.rpcCode = bounded;
  }
}

export type ChatGPTGenerationErrorOptions = {
  rpcCode?: unknown;
  sceneDiagnostic?: GenerationDiagnostic;
  message?: string;
};
const knownDiagnosticReasons = new Set<string>(generationDiagnosticReasons);
const knownPathKeys = new Set<string>(generationDiagnosticPathKeys);
const knownIssueCodes = new Set<string>(generationDiagnosticIssueCodes);

type DiagnosticCode =
  | (typeof generationDiagnosticCodes)[number]
  | typeof chatGPTGenerationDiagnosticCode;

export type GenerationFinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "error"
  | "other"
  | null;

export function normalizeFinishReason(value: unknown): GenerationFinishReason {
  if (value === null || value === undefined) return null;
  if (
    value === "stop" ||
    value === "length" ||
    value === "tool_calls" ||
    value === "content_filter" ||
    value === "error"
  )
    return value;
  return "other";
}

export class SceneJSONError extends SyntaxError {
  readonly finishReason: GenerationFinishReason;
  constructor(finishReason: GenerationFinishReason) {
    super("The model returned malformed scene JSON.");
    this.name = "SceneJSONError";
    this.finishReason = finishReason;
  }
}

export class SceneProtocolError extends Error {
  readonly finishReason: GenerationFinishReason;
  readonly protocolSubreason: SceneProtocolSubreason;
  constructor(
    finishReason: GenerationFinishReason,
    options: {
      message?: string;
      protocolSubreason?: unknown;
    } = {},
  ) {
    super(
      options.message ??
        "The model returned a scene update that could not be applied.",
    );
    this.name = "SceneProtocolError";
    this.finishReason = finishReason;
    this.protocolSubreason = safeSceneProtocolSubreason(
      options.protocolSubreason,
    );
  }
}

export class TruncatedSceneStreamError extends Error {
  readonly finishReason: GenerationFinishReason;
  constructor(
    finishReason: GenerationFinishReason,
    message = "The model response ended before the scene was complete.",
  ) {
    super(message);
    this.name = "TruncatedSceneStreamError";
    this.finishReason = finishReason;
  }
}

/** Retain only a bounded status code, never provider messages or metadata. */
export class ProviderStreamError extends Error {
  readonly providerStatus: number | null;
  readonly finishReason?: GenerationFinishReason;
  constructor(value: unknown, finishReason?: GenerationFinishReason) {
    super("The provider interrupted this generation. Please retry.");
    const code =
      value && typeof value === "object" && "code" in value
        ? value.code
        : undefined;
    this.providerStatus =
      typeof code === "number" &&
      Number.isInteger(code) &&
      code >= 400 &&
      code <= 599
        ? code
        : null;
    if (finishReason !== undefined) this.finishReason = finishReason;
  }
}
type DiagnosticPathSegment = string | number;

export interface GenerationDiagnosticIssue {
  readonly code: string;
  readonly path: readonly DiagnosticPathSegment[];
  readonly reason?: string;
}

export interface GenerationDiagnostic {
  readonly code: DiagnosticCode;
  readonly diagnostic: {
    readonly operation: number;
    readonly issues: readonly GenerationDiagnosticIssue[];
    readonly providerStatus?: number | null;
    readonly finishReason?: GenerationFinishReason;
    readonly protocolSubreason?: SceneProtocolSubreason;
    readonly stage?: ChatGPTGenerationStage;
    readonly reason?: ChatGPTGenerationReason;
    readonly rpcCode?: number;
  };
}

/** Safe metadata for one hosted ChatGPT generation failure. */
export class ChatGPTGenerationError extends Error {
  readonly stage: ChatGPTGenerationStage;
  readonly reason: ChatGPTGenerationReason;
  readonly rpcCode?: number;
  readonly sceneDiagnostic?: GenerationDiagnostic;

  constructor(
    stage: ChatGPTGenerationStage,
    reason: ChatGPTGenerationReason,
    options: ChatGPTGenerationErrorOptions = {},
  ) {
    super(options.message ?? "ChatGPT generation could not be completed.");
    this.name = "ChatGPTGenerationError";
    this.stage = (chatGPTGenerationStages as readonly unknown[]).includes(stage)
      ? stage
      : "stream";
    this.reason = (chatGPTGenerationReasons as readonly unknown[]).includes(
      reason,
    )
      ? reason
      : "unknown";
    const bounded = boundedRpcCode(options.rpcCode);
    if (bounded !== undefined) this.rpcCode = bounded;
    const sceneCode = options.sceneDiagnostic?.code;
    if (
      options.sceneDiagnostic &&
      sceneCode &&
      (generationDiagnosticCodes as readonly string[]).includes(sceneCode)
    )
      this.sceneDiagnostic = {
        code: sceneCode,
        diagnostic: safeSceneDiagnostic(options.sceneDiagnostic, 0),
      };
  }
}

type Candidate = {
  code: string;
  path: unknown[];
  reason?: string;
  depth: number;
  order: number;
};

function issueCode(value: unknown): string {
  return typeof value === "string" && knownIssueCodes.has(value)
    ? value
    : "custom";
}

function issueReason(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const reason = (value as Record<string, unknown>).diagnosticReason;
  return typeof reason === "string" && knownDiagnosticReasons.has(reason)
    ? reason
    : undefined;
}

function sanitizePath(path: readonly unknown[]): DiagnosticPathSegment[] {
  return path.slice(0, MAX_PATH_DEPTH).map((segment) => {
    if (
      typeof segment === "number" &&
      Number.isInteger(segment) &&
      segment >= 0 &&
      segment <= MAX_PATH_INDEX
    )
      return segment;
    if (typeof segment === "string" && knownPathKeys.has(segment))
      return segment;
    return "?";
  });
}

function collectIssue(
  value: unknown,
  parentPath: readonly unknown[],
  parentDepth: number,
  unionDepth: number,
  candidates: Candidate[],
  nextOrder: { value: number },
) {
  if (candidates.length >= MAX_CANDIDATES) return;
  if (!value || typeof value !== "object") return;
  const issue = value as Record<string, unknown>;
  const ownPath = Array.isArray(issue.path) ? issue.path : [];
  const remaining = Math.max(0, MAX_PATH_DEPTH - parentPath.length);
  const path = [...parentPath, ...ownPath.slice(0, remaining)];
  const depth = parentDepth + ownPath.length;
  candidates.push({
    code: issueCode(issue.code),
    path,
    reason: issueReason(issue.params),
    depth,
    order: nextOrder.value++,
  });

  if (issue.code !== "invalid_union" || unionDepth >= MAX_UNION_DEPTH) return;
  if (!Array.isArray(issue.errors)) return;
  for (const branch of issue.errors) {
    if (candidates.length >= MAX_CANDIDATES) return;
    if (!Array.isArray(branch)) continue;
    for (const nested of branch) {
      if (candidates.length >= MAX_CANDIDATES) return;
      collectIssue(nested, path, depth, unionDepth + 1, candidates, nextOrder);
    }
  }
}

function zodIssues(error: z.ZodError): GenerationDiagnosticIssue[] {
  const candidates: Candidate[] = [];
  const nextOrder = { value: 0 };
  for (const issue of error.issues) {
    if (candidates.length >= MAX_CANDIDATES) break;
    collectIssue(issue, [], 0, 0, candidates, nextOrder);
  }

  candidates.sort((a, b) => b.depth - a.depth || a.order - b.order);
  const seen = new Set<string>();
  const issues: GenerationDiagnosticIssue[] = [];
  for (const candidate of candidates) {
    const path = sanitizePath(candidate.path);
    const key = `${candidate.code}:${JSON.stringify(path)}:${candidate.reason ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({
      code: candidate.code,
      path,
      ...(candidate.reason ? { reason: candidate.reason } : {}),
    });
    if (issues.length >= MAX_ISSUES) break;
  }
  return issues;
}

function safeSceneIssues(value: unknown): GenerationDiagnosticIssue[] {
  if (!Array.isArray(value)) return [];
  const issues: GenerationDiagnosticIssue[] = [];
  for (const entry of value.slice(0, MAX_ISSUES)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const issue = entry as Record<string, unknown>;
    const path = Array.isArray(issue.path) ? sanitizePath(issue.path) : [];
    const reason =
      typeof issue.reason === "string" &&
      knownDiagnosticReasons.has(issue.reason)
        ? issue.reason
        : undefined;
    issues.push({
      code: issueCode(issue.code),
      path,
      ...(reason ? { reason } : {}),
    });
  }
  return issues;
}

function safeSceneDiagnostic(
  value: GenerationDiagnostic | undefined,
  operation: number,
): GenerationDiagnostic["diagnostic"] {
  const source = value?.diagnostic;
  if (!source) return { operation, issues: [] };
  const providerStatus =
    source.providerStatus === null ||
    (typeof source.providerStatus === "number" &&
      Number.isInteger(source.providerStatus) &&
      source.providerStatus >= 400 &&
      source.providerStatus <= 599)
      ? source.providerStatus
      : undefined;
  const protocolSubreason =
    source.protocolSubreason === undefined
      ? undefined
      : safeSceneProtocolSubreason(source.protocolSubreason);
  return {
    operation,
    issues: safeSceneIssues(source.issues),
    ...(providerStatus !== undefined ? { providerStatus } : {}),
    ...(source.finishReason !== undefined
      ? { finishReason: normalizeFinishReason(source.finishReason) }
      : {}),
    ...(protocolSubreason !== undefined ? { protocolSubreason } : {}),
  };
}

/** Return a bounded, schema-only diagnostic suitable for an error NDJSON line. */
export function generationDiagnostic(
  error: unknown,
  operationCount = 0,
  finishReason?: GenerationFinishReason,
): GenerationDiagnostic | undefined {
  const operation = Number.isFinite(operationCount)
    ? Math.min(MAX_OPERATION_COUNT, Math.max(0, Math.trunc(operationCount)))
    : 0;
  if (error instanceof ChatGPTGenerationError) {
    const scene = error.sceneDiagnostic;
    const sceneCode = scene?.code;
    const rpcCode = boundedRpcCode(error.rpcCode);
    const stage = (chatGPTGenerationStages as readonly unknown[]).includes(
      error.stage,
    )
      ? error.stage
      : "stream";
    const reason = (chatGPTGenerationReasons as readonly unknown[]).includes(
      error.reason,
    )
      ? error.reason
      : "unknown";
    return {
      code:
        sceneCode &&
        (generationDiagnosticCodes as readonly string[]).includes(sceneCode)
          ? sceneCode
          : chatGPTGenerationDiagnosticCode,
      diagnostic: {
        ...safeSceneDiagnostic(scene, operation),
        stage,
        reason,
        ...(rpcCode !== undefined ? { rpcCode } : {}),
      },
    };
  }
  if (error instanceof ProviderStreamError)
    return {
      code: "PROVIDER_STREAM_ERROR",
      diagnostic: {
        operation,
        issues: [],
        providerStatus: error.providerStatus,
        ...(error.finishReason !== undefined
          ? { finishReason: error.finishReason }
          : {}),
      },
    };
  if (error instanceof TruncatedSceneStreamError)
    return {
      code: "TRUNCATED_SCENE_STREAM",
      diagnostic: {
        operation,
        issues: [],
        finishReason: error.finishReason,
      },
    };
  if (error instanceof SceneProtocolError)
    return {
      code: "INVALID_SCENE_PROTOCOL",
      diagnostic: {
        operation,
        issues: [],
        protocolSubreason: safeSceneProtocolSubreason(error.protocolSubreason),
        finishReason: error.finishReason,
      },
    };
  if (error instanceof SceneJSONError)
    return {
      code:
        error.finishReason === "length"
          ? "TRUNCATED_SCENE_STREAM"
          : "INVALID_SCENE_JSON",
      diagnostic: {
        operation,
        issues: [],
        finishReason: error.finishReason,
      },
    };
  if (error instanceof z.ZodError) {
    const issues = zodIssues(error);
    return {
      code: "INVALID_SCENE_UPDATE",
      diagnostic: {
        operation,
        issues,
        ...(finishReason !== undefined ? { finishReason } : {}),
      },
    };
  }
  if (error instanceof SyntaxError)
    return {
      code: "INVALID_SCENE_JSON",
      diagnostic: { operation, issues: [] },
    };
  return undefined;
}
