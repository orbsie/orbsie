export const MAX_INPUT_MODALITIES = 16;
export const MAX_INPUT_MODALITY_LENGTH = 32;

function boundedModality(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_INPUT_MODALITY_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

/**
 * Return only bounded, nonempty catalog modalities. An invalid optional field
 * is represented as undefined so callers can preserve an otherwise usable
 * text model while treating image support as unknown.
 */
export function normalizeInputModalities(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_INPUT_MODALITIES
  )
    return undefined;
  const modalities: string[] = [];
  for (const modality of value) {
    if (!boundedModality(modality)) return undefined;
    if (!modalities.includes(modality)) modalities.push(modality);
  }
  return modalities;
}

export function imageInputSupport(value: unknown): boolean | "unknown" {
  const modalities = normalizeInputModalities(value);
  return modalities === undefined ? "unknown" : modalities.includes("image");
}
