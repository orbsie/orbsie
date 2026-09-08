/** Server-owned output budget; client requests cannot raise this limit. */
export function generationMaxTokens(free = false): number {
  const configured = process.env.ORBSIE_GENERATION_MAX_TOKENS;
  if (configured === undefined || configured === "") return free ? 4096 : 10000;
  if (!/^[1-9]\d*$/.test(configured))
    throw new Error("Invalid generation output budget configuration.");
  const limit = Number(configured);
  if (!Number.isSafeInteger(limit) || limit > 10000)
    throw new Error("Invalid generation output budget configuration.");
  return Math.min(limit, free ? 4096 : 10000);
}
