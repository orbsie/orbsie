import { describe, expect, it } from "vitest";
import {
  generationFeedbackForFailure,
  generationFeedbackInstruction,
  generationFeedbackSchema,
} from "../src/lib/generation-feedback";

const diagnosticRecord = {
  error: "provider secret and raw node id must never be forwarded",
  code: "INVALID_SCENE_UPDATE",
  diagnostic: {
    operation: 2,
    finishReason: "stop",
    issues: [
      {
        code: "invalid_type",
        path: ["geometry", "job", "recipe", "nodes", 2],
        reason: "unreachable_recipe_node",
      },
    ],
    raw: "must be ignored",
  },
};

describe("generation retry feedback", () => {
  it("extracts only bounded diagnostic fields and builds a safe correction instruction", () => {
    const feedback = generationFeedbackForFailure(
      "project-a",
      diagnosticRecord,
    );
    expect(feedback).toEqual({
      version: 1,
      projectId: "project-a",
      code: "INVALID_SCENE_UPDATE",
      finishReason: "stop",
      issues: [
        {
          code: "invalid_type",
          path: ["geometry", "job", "recipe", "nodes", 2],
          reason: "unreachable_recipe_node",
        },
      ],
    });
    const instruction = generationFeedbackInstruction(feedback);
    expect(instruction).toContain("INVALID_SCENE_UPDATE");
    expect(instruction).toContain("unreachable_recipe_node");
    expect(instruction).not.toContain("provider secret");
    expect(instruction).not.toContain("must be ignored");
  });

  it("drops malformed or unallowlisted feedback instead of forwarding it", () => {
    expect(
      generationFeedbackForFailure("project-a", {
        code: "INVALID_SCENE_UPDATE",
        diagnostic: {
          finishReason: "stop",
          issues: [{ code: "arbitrary", path: ["secret-node"] }],
        },
      }),
    ).toBeUndefined();
    expect(
      generationFeedbackSchema.safeParse({
        version: 1,
        projectId: "project-a",
        code: "INVALID_SCENE_UPDATE",
        finishReason: "stop",
        issues: [],
        rawProviderBody: "secret",
      }).success,
    ).toBe(false);
  });

  it("does not create feedback for unrelated projects", () => {
    const feedback = generationFeedbackForFailure(
      "project-b",
      diagnosticRecord,
    );
    expect(feedback?.projectId).toBe("project-b");
    expect(generationFeedbackInstruction(undefined)).toBe("");
  });
});
