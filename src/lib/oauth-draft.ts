import { z } from "zod";
import { OPENROUTER_OAUTH_TTL_MS } from "./openrouter-oauth";

const draftSchema = z
  .object({
    version: z.literal(1),
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    createdAt: z.number().int().nonnegative(),
    prompt: z.string().max(4000),
    projectId: z.string().min(1).max(100),
    selectedId: z.string().min(1).max(80).optional(),
  })
  .strict();
export type OAuthDraft = z.infer<typeof draftSchema>;

/** Session-only authoring context, separate from the provider credential. */
export function encodeOAuthDraft(draft: OAuthDraft): string {
  return JSON.stringify(draftSchema.parse(draft));
}

/** Ignore corrupt, expired, or unrelated return context without replacing input. */
export function decodeOAuthDraft(
  raw: string | null,
  state: string,
  now = Date.now(),
): OAuthDraft | null {
  if (!raw || raw.length > 30000) return null;
  try {
    const result = draftSchema.safeParse(JSON.parse(raw));
    if (
      !result.success ||
      result.data.state !== state ||
      result.data.createdAt > now ||
      now - result.data.createdAt > OPENROUTER_OAUTH_TTL_MS
    )
      return null;
    return result.data;
  } catch {
    return null;
  }
}
