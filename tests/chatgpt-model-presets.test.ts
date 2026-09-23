import { describe, expect, it } from "vitest";
import {
  defaultChatGPTPresetSelection,
  resolveChatGPTPresetOptions,
} from "../src/lib/chatgpt-model-presets";

const catalog = [
  {
    model: "gpt-6-astra",
    supportedReasoningEfforts: ["low", "high"],
    defaultReasoningEffort: "low",
  },
  {
    model: "gpt-6-luna",
    supportedReasoningEfforts: ["low", "medium"],
    defaultReasoningEffort: "low",
  },
] as const;

describe("ChatGPT model presets", () => {
  it("resolves Quality, Balanced, and Budget to catalog models and efforts", () => {
    expect(resolveChatGPTPresetOptions(catalog)).toEqual([
      {
        label: "Quality",
        model: "gpt-6-astra",
        effort: "high",
        preferredEffort: "high",
        available: true,
      },
      {
        label: "Balanced",
        model: "gpt-6-luna",
        effort: "medium",
        preferredEffort: "medium",
        available: true,
      },
      {
        label: "Budget",
        model: "gpt-6-luna",
        effort: "low",
        preferredEffort: "low",
        available: true,
      },
    ]);
    expect(defaultChatGPTPresetSelection(catalog)).toEqual({
      model: "gpt-6-luna",
      effort: "medium",
      preset: "Balanced",
    });
  });

  it("uses a supported effort fallback and disables absent preset models", () => {
    const options = resolveChatGPTPresetOptions([
      {
        model: "gpt-6-luna",
        supportedReasoningEfforts: ["xhigh"],
        defaultReasoningEffort: "xhigh",
      },
      {
        model: "unrelated-model",
        supportedReasoningEfforts: ["low"],
        defaultReasoningEffort: "low",
      },
    ]);
    expect(options).toEqual([
      {
        label: "Quality",
        model: null,
        effort: null,
        preferredEffort: "high",
        available: false,
      },
      {
        label: "Balanced",
        model: "gpt-6-luna",
        effort: "xhigh",
        preferredEffort: "medium",
        available: true,
      },
      {
        label: "Budget",
        model: "gpt-6-luna",
        effort: "xhigh",
        preferredEffort: "low",
        available: true,
      },
    ]);
    expect(defaultChatGPTPresetSelection([])).toBeNull();
    expect(
      defaultChatGPTPresetSelection([
        {
          model: "account-model",
          supportedReasoningEfforts: ["low"],
          defaultReasoningEffort: "low",
        },
      ]),
    ).toEqual({ model: "account-model", effort: "low", preset: null });
    expect(
      resolveChatGPTPresetOptions([
        {
          model: "z-ai/glm-5.3-flash",
          supportedReasoningEfforts: ["low"],
          defaultReasoningEffort: "low",
        },
      ]).every((option) => option.model === null),
    ).toBe(true);
  });
});
