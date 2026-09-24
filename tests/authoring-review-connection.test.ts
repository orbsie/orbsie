import { describe, expect, it } from "vitest";
import {
  authoringReviewRequest,
  authoringReviewStartRequest,
} from "../src/lib/authoring-review-connection";
import { blankProject } from "../src/lib/protocol";

const runId = "11111111-1111-4111-8111-111111111111";
const clientRunId = "22222222-2222-4222-8222-222222222222";
const project = blankProject();
const input = {
  runId,
  phase: "review" as const,
  prompt: "Make the tree taller",
  project,
  browserModeling: true,
  structuralObservations: {
    projectId: project.id,
    revision: project.revision,
    renderer: "software" as const,
  },
};

describe("authoring review request", () => {
  it("builds a review-only API start request from the saved binding", () => {
    const request = authoringReviewStartRequest(
      { provider: "gateway", model: "openai/gpt-5.6-luna", key: "api-key" },
      {
        priorRunId: runId,
        prompt: input.prompt,
        project,
        selected: "tree-id",
        browserModeling: true,
      },
      clientRunId,
    );
    expect(request.url).toBe("/api/generate/review/start");
    expect(request.init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
    });
    expect(request.init.headers).toEqual({
      "Content-Type": "application/json",
      "X-Orbsie-Client-Run-Id": clientRunId,
    });
    expect(JSON.parse(request.init.body as string)).toEqual({
      priorRunId: runId,
      prompt: input.prompt,
      project,
      selected: "tree-id",
      browserModeling: true,
      localModeling: false,
      provider: "gateway",
      model: "openai/gpt-5.6-luna",
      key: "api-key",
    });
  });

  it("keeps hosted start requests free of provider credentials", () => {
    const request = authoringReviewStartRequest(
      {
        provider: "chatgpt-hosted",
        model: "gpt-6-astra",
        effort: "low",
        key: "stale-key-must-not-leak",
      },
      {
        priorRunId: runId,
        prompt: input.prompt,
        project,
        browserModeling: false,
      },
      clientRunId,
    );
    expect(request.url).toBe("/api/chatgpt/review/start");
    const body = JSON.parse(request.init.body as string);
    expect(body).toMatchObject({
      priorRunId: runId,
      prompt: input.prompt,
      model: "gpt-6-astra",
      effort: "low",
      browserModeling: false,
      localModeling: false,
    });
    expect(body).not.toHaveProperty("provider");
    expect(body).not.toHaveProperty("key");
    expect(request.init.body).not.toContain("stale-key-must-not-leak");
  });

  it("preserves API provider authority and client correlation", () => {
    const request = authoringReviewRequest(
      { provider: "gateway", model: "openai/gpt-5.6-luna", key: "api-key" },
      input,
      clientRunId,
    );
    expect(request.url).toBe("/api/generate/review");
    expect(request.init.headers).toEqual({
      "Content-Type": "application/json",
      "X-Orbsie-Client-Run-Id": clientRunId,
    });
    expect(request.init.credentials).toBe("same-origin");
    expect(request.init.redirect).toBe("error");
    const body = JSON.parse(request.init.body as string);
    expect(body).toMatchObject({
      runId,
      phase: "review",
      provider: "gateway",
      model: "openai/gpt-5.6-luna",
      key: "api-key",
      prompt: input.prompt,
      browserModeling: true,
      localModeling: false,
    });
    expect(body).not.toHaveProperty("effort");
  });

  it("never sends a provider key or client provider override to ChatGPT", () => {
    const request = authoringReviewRequest(
      {
        provider: "chatgpt-hosted",
        model: "gpt-6-astra",
        effort: "low",
        key: "stale-key-must-not-leak",
      },
      { ...input, phase: "final-review" },
      clientRunId,
    );
    expect(request.url).toBe("/api/chatgpt/review");
    const body = JSON.parse(request.init.body as string);
    expect(body).toMatchObject({
      runId,
      phase: "final-review",
      model: "gpt-6-astra",
      effort: "low",
    });
    expect(body).not.toHaveProperty("provider");
    expect(body).not.toHaveProperty("key");
    expect(request.init.body).not.toContain("stale-key-must-not-leak");
  });

  it("omits stale credentials for a free run", () => {
    const request = authoringReviewRequest(
      { provider: "free", model: "old-model", key: "stale-key" },
      input,
      clientRunId,
    );
    const body = JSON.parse(request.init.body as string);
    expect(body.provider).toBe("free");
    expect(body).not.toHaveProperty("model");
    expect(body).not.toHaveProperty("key");
  });

  it("rejects missing connection and invalid run IDs before making a request", () => {
    expect(() =>
      authoringReviewRequest(
        { provider: "unknown", model: "", key: "" },
        input,
        clientRunId,
      ),
    ).toThrow("complete");
    expect(() =>
      authoringReviewRequest(
        { provider: "free", model: "", key: "" },
        { ...input, runId: "not-a-run" },
        clientRunId,
      ),
    ).toThrow("run is unavailable");
    expect(() =>
      authoringReviewRequest(
        { provider: "free", model: "", key: "" },
        input,
        "not-a-client-run",
      ),
    ).toThrow("request is unavailable");
  });
});
