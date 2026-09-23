export type ChatGPTPresetModel = {
  model: string;
  supportedReasoningEfforts: readonly string[];
  defaultReasoningEffort: string;
};

export type ChatGPTPresetLabel = "Quality" | "Balanced" | "Budget";

type PresetSpec = {
  label: ChatGPTPresetLabel;
  model: string;
  preferredEfforts: readonly string[];
};

/**
 * ChatGPT's default choices stay on models returned by its own catalog. Luna
 * is intentionally used for both everyday and cost-sensitive choices because
 * GLM is an OpenRouter/Gateway model and must never be sent to ChatGPT.
 */
export const chatGPTPresetSpecs: readonly PresetSpec[] = [
  {
    label: "Quality",
    model: "gpt-6-astra",
    preferredEfforts: ["high", "medium", "low"],
  },
  {
    label: "Balanced",
    model: "gpt-6-luna",
    preferredEfforts: ["medium", "low", "high"],
  },
  {
    label: "Budget",
    model: "gpt-6-luna",
    preferredEfforts: ["low", "medium", "high"],
  },
] as const;

export type ChatGPTPresetOption = {
  label: ChatGPTPresetLabel;
  model: string | null;
  effort: string | null;
  preferredEffort: string;
  available: boolean;
};

function resolveEffort(
  model: ChatGPTPresetModel,
  preferredEfforts: readonly string[],
): string | null {
  const supported = model.supportedReasoningEfforts;
  return (
    preferredEfforts.find((effort) => supported.includes(effort)) ??
    (supported.includes(model.defaultReasoningEffort)
      ? model.defaultReasoningEffort
      : (supported[0] ?? null))
  );
}

/** Resolve each visible preset against the current, validated ChatGPT catalog. */
export function resolveChatGPTPresetOptions(
  models: readonly ChatGPTPresetModel[],
): ChatGPTPresetOption[] {
  return chatGPTPresetSpecs.map((spec) => {
    const model = models.find((entry) => entry.model === spec.model);
    const effort = model ? resolveEffort(model, spec.preferredEfforts) : null;
    return {
      label: spec.label,
      model: model?.model ?? null,
      effort,
      preferredEffort: spec.preferredEfforts[0],
      available: Boolean(model && effort),
    };
  });
}

/**
 * Prefer Balanced on first catalog load. If that model is absent, use the
 * first available preset or first catalog model so a valid catalog remains
 * usable; every returned value still comes from the catalog.
 */
export function defaultChatGPTPresetSelection(
  models: readonly ChatGPTPresetModel[],
): { model: string; effort: string; preset: ChatGPTPresetLabel | null } | null {
  const options = resolveChatGPTPresetOptions(models);
  const preset =
    options.find((option) => option.label === "Balanced" && option.available) ??
    options.find((option) => option.available);
  if (preset?.model && preset.effort)
    return { model: preset.model, effort: preset.effort, preset: preset.label };

  const first = models[0];
  if (!first) return null;
  const effort = resolveEffort(first, []);
  return effort ? { model: first.model, effort, preset: null } : null;
}
