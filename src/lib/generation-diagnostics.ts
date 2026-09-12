import { z } from "zod";

const MAX_ISSUES = 8;
const MAX_PATH_DEPTH = 12;
const MAX_PATH_INDEX = 255;
const MAX_UNION_DEPTH = 4;
const MAX_CANDIDATES = 256;
const MAX_OPERATION_COUNT = 251;

const knownPathKeys = new Set([
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
]);

const knownIssueCodes = new Set([
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
]);

type DiagnosticCode =
  | "INVALID_SCENE_UPDATE"
  | "INVALID_SCENE_JSON"
  | "INVALID_SCENE_PROTOCOL"
  | "TRUNCATED_SCENE_STREAM"
  | "PROVIDER_STREAM_ERROR";

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
  constructor(
    finishReason: GenerationFinishReason,
    message = "The model returned a scene update that could not be applied.",
  ) {
    super(message);
    this.name = "SceneProtocolError";
    this.finishReason = finishReason;
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
}

export interface GenerationDiagnostic {
  readonly code: DiagnosticCode;
  readonly diagnostic: {
    readonly operation: number;
    readonly issues: readonly GenerationDiagnosticIssue[];
    readonly providerStatus?: number | null;
    readonly finishReason?: GenerationFinishReason;
  };
}

type Candidate = {
  code: string;
  path: unknown[];
  depth: number;
  order: number;
};

function issueCode(value: unknown): string {
  return typeof value === "string" && knownIssueCodes.has(value)
    ? value
    : "custom";
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
    const key = `${candidate.code}:${JSON.stringify(path)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({ code: candidate.code, path });
    if (issues.length >= MAX_ISSUES) break;
  }
  return issues;
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
