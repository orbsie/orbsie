import { z } from "zod";
import {
  parseBrowserModelRecipe,
  type BrowserModelRecipe,
} from "./browser-modeling";

export const BROWSER_PROCEDURAL_SOURCE_MAX_BYTES = 32 * 1024;
export const BROWSER_PROCEDURAL_OUTPUT_MAX_BYTES = 256 * 1024;
export const BROWSER_PROCEDURAL_MEMORY_LIMIT_BYTES = 8 * 1024 * 1024;
export const BROWSER_PROCEDURAL_STACK_LIMIT_BYTES = 512 * 1024;
export const BROWSER_PROCEDURAL_DEADLINE_MS = 2_000;
export const BROWSER_PROCEDURAL_WORKER_DEADLINE_MS = 10_000;

const rawBrowserProceduralSourceSchema = z
  .object({
    version: z.literal(1),
    language: z.literal("quickjs"),
    code: z.string().min(1),
    seed: z.number().int().min(0).max(0xffffffff),
  })
  .strict();
export const browserProceduralSourceSchema =
  rawBrowserProceduralSourceSchema.superRefine((source, context) => {
    if (
      new TextEncoder().encode(source.code).byteLength >
      BROWSER_PROCEDURAL_SOURCE_MAX_BYTES
    )
      context.addIssue({
        code: "custom",
        path: ["code"],
        message: "Procedural source exceeds its byte limit.",
      });
  });

export type BrowserProceduralSource = z.infer<
  typeof browserProceduralSourceSchema
>;

export class BrowserProceduralError extends Error {
  readonly code:
    | "invalid-source"
    | "source-limit"
    | "execution"
    | "timeout"
    | "aborted"
    | "output-limit"
    | "invalid-recipe";

  constructor(
    code: BrowserProceduralError["code"],
    message = "Procedural authoring failed.",
  ) {
    super(message);
    this.name = "BrowserProceduralError";
    this.code = code;
  }
}

export function parseBrowserProceduralSource(
  input: unknown,
): BrowserProceduralSource {
  // Keep the parser's source-limit diagnostic distinct from ordinary schema
  // errors; exported schemas still reject the same oversized value.
  const parsed = rawBrowserProceduralSourceSchema.safeParse(input);
  if (!parsed.success) throw new BrowserProceduralError("invalid-source");
  const bytes = new TextEncoder().encode(parsed.data.code).byteLength;
  if (bytes > BROWSER_PROCEDURAL_SOURCE_MAX_BYTES)
    throw new BrowserProceduralError("source-limit");
  return Object.freeze(parsed.data);
}

export function canonicalBrowserProceduralSource(
  input: unknown,
): BrowserProceduralSource {
  const source = parseBrowserProceduralSource(input);
  return {
    version: 1,
    language: "quickjs",
    code: source.code,
    seed: source.seed,
  };
}

export async function hashBrowserProceduralSource(
  input: unknown,
): Promise<string> {
  const source = canonicalBrowserProceduralSource(input);
  const bytes = new TextEncoder().encode(JSON.stringify(source));
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface BrowserProceduralEvaluationOptions {
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
  readonly now?: () => number;
}

export interface BrowserProceduralEvaluationResult {
  readonly recipe: BrowserModelRecipe;
}

export function validateProceduralRecipe(value: unknown): BrowserModelRecipe {
  try {
    return parseBrowserModelRecipe(value);
  } catch {
    throw new BrowserProceduralError("invalid-recipe");
  }
}
