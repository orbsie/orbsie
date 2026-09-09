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

export const browserProceduralSourceSchema = z
  .object({
    version: z.literal(1),
    language: z.literal("quickjs"),
    code: z.string().min(1),
    seed: z.number().int().min(0).max(0xffffffff),
  })
  .strict();

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
  const parsed = browserProceduralSourceSchema.safeParse(input);
  if (!parsed.success) throw new BrowserProceduralError("invalid-source");
  const bytes = new TextEncoder().encode(parsed.data.code).byteLength;
  if (bytes > BROWSER_PROCEDURAL_SOURCE_MAX_BYTES)
    throw new BrowserProceduralError("source-limit");
  return Object.freeze(parsed.data);
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
