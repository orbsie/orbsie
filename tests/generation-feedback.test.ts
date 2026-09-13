import { describe, expect, it } from "vitest";
import {
  generationFeedbackForFailure,
  generationFeedbackInstruction,
  generationFeedbackSchema,
} from "../src/lib/generation-feedback";
import {
  ChatGPTGenerationError,
  generationDiagnostic,
} from "../src/lib/generation-diagnostics";

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

  it("retains safe callback and transport metadata without scene correction", () => {
    const callbackFailure = generationDiagnostic(
      new ChatGPTGenerationError("stream", "callback-validation", {
        rpcCode: 400,
        sceneDiagnostic: {
          code: "INVALID_SCENE_UPDATE",
          diagnostic: { operation: 3, issues: [] },
        },
      }),
      3,
    );
    const feedback = generationFeedbackForFailure("project-a", {
      error: "safe public error",
      ...callbackFailure!,
    });
    expect(feedback).toEqual({
      version: 1,
      projectId: "project-a",
      code: "INVALID_SCENE_UPDATE",
      finishReason: null,
      issues: [],
      stage: "stream",
      reason: "callback-validation",
      rpcCode: 400,
    });
    const providerFailure = generationDiagnostic(
      new ChatGPTGenerationError("turn-start", "rpc-rejection", {
        rpcCode: 401,
      }),
    );
    const providerFeedback = generationFeedbackForFailure("project-a", {
      error: "access_token=provider-secret",
      ...providerFailure!,
    });
    expect(providerFeedback).toEqual({
      version: 1,
      projectId: "project-a",
      code: "CHATGPT_GENERATION_ERROR",
      finishReason: null,
      issues: [],
      stage: "turn-start",
      reason: "rpc-rejection",
      rpcCode: 401,
    });
    expect(generationFeedbackInstruction(providerFeedback)).toBe("");
    expect(JSON.stringify(providerFeedback)).not.toContain("provider-secret");
  });
});
