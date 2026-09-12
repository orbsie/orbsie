import { z } from "zod";
import {
  generationDiagnosticCodes,
  generationDiagnosticIssueCodes,
  generationDiagnosticPathKeys,
  generationDiagnosticReasons,
} from "./generation-diagnostics";

const finishReasons = [
  "stop",
  "length",
  "tool_calls",
  "content_filter",
  "error",
  "other",
] as const;

const pathSegmentSchema = z.union([
  z.enum(["?", ...generationDiagnosticPathKeys]),
  z.number().int().min(0).max(255),
]);

export const generationFeedbackIssueSchema = z
  .object({
    code: z.enum(generationDiagnosticIssueCodes),
    path: z.array(pathSegmentSchema).max(12),
    reason: z.enum(generationDiagnosticReasons).optional(),
  })
  .strict();

export const generationFeedbackSchema = z
  .object({
    version: z.literal(1),
    projectId: z.string().regex(/^[\w-]{1,80}$/),
    code: z.enum(generationDiagnosticCodes),
    finishReason: z.enum(finishReasons).nullable(),
    issues: z.array(generationFeedbackIssueSchema).max(8),
  })
  .strict();

export type GenerationFeedback = z.infer<typeof generationFeedbackSchema>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Extract only the existing bounded diagnostic fields from a stream record. */
export function generationFeedbackForFailure(
  projectId: string,
  value: unknown,
): GenerationFeedback | undefined {
  const source = record(value);
  if (!source || typeof source.error !== "string") return undefined;
  const diagnostic = record(source?.diagnostic);
  const candidate = {
    version: 1 as const,
    projectId,
    code: source?.code,
    finishReason: diagnostic?.finishReason ?? null,
    issues: diagnostic?.issues,
  };
  const parsed = generationFeedbackSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

/** Build a short, allowlisted instruction without forwarding raw diagnostics. */
export function generationFeedbackInstruction(
  value: GenerationFeedback | undefined,
): string {
  if (!value) return "";
  const parsed = generationFeedbackSchema.safeParse(value);
  if (!parsed.success) return "";
  const { code, finishReason, issues } = parsed.data;
  const issueText = issues.length
    ? issues
        .map(
          ({ code: issueCode, path, reason }) =>
            `${issueCode} at ${path.join(".")}${reason ? ` (${reason})` : ""}`,
        )
        .join("; ")
    : "no issue details";
  return `A previous explicit attempt for this same project failed local scene validation (${code}, finish ${finishReason ?? "unknown"}; ${issueText}). Correct the reported structure using the current project and instruction, preserve valid unrelated work, and finish with a commit_revision.`;
}

export function generationFeedbackMatchesProject(
  value: GenerationFeedback | undefined,
  projectId: string,
): value is GenerationFeedback {
  return Boolean(value && value.projectId === projectId);
}
