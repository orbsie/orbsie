import { expect, test } from "vitest";
import { selectAstra } from "../scripts/local-chatgpt.mjs";
test("uses exact Astra catalog model identifier with low support", () => {
  expect(
    selectAstra([
      {
        id: "entry",
        model: "actual-astra-id",
        displayName: "Astra",
        supportedReasoningEfforts: [{ reasoningEffort: "low" }],
      },
    ]),
  ).toBe("actual-astra-id");
});
test("never falls back to other models or unsupported reasoning", () => {
  expect(() =>
    selectAstra([
      {
        id: "other",
        model: "other",
        supportedReasoningEfforts: [{ reasoningEffort: "low" }],
      },
    ]),
  ).toThrow("no fallback");
  expect(() =>
    selectAstra([
      {
        id: "astra",
        model: "astra",
        supportedReasoningEfforts: [{ reasoningEffort: "high" }],
      },
    ]),
  ).toThrow("no fallback");
});
