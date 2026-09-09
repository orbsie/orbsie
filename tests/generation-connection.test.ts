import { describe, expect, it } from "vitest";
import {
  companionOrigin,
  generationRequest,
  isGenerationReady,
} from "../src/lib/generation-connection";
it.each([
  "https://example.com",
  "http://localhost:41000",
  "http://127.0.0.1:41000/elsewhere",
  "http://user:pass@127.0.0.1:41000",
  "http://127.0.0.1:41000?redirect=evil",
  "http://127.0.0.1",
])("rejects a companion outside its exact loopback origin: %s", (url) => {
  expect(() => companionOrigin(url)).toThrow();
});
it("keeps API-provider keys on the hosted provider route", () => {
  const request = generationRequest(
    {
      provider: "gateway",
      model: "test-model",
      key: "test-api-key",
    },
    { prompt: "test" },
  );
  expect(request.url).toBe("/api/generate");
  expect(request.init.headers).not.toHaveProperty("Authorization");
  expect(JSON.parse(request.init.body as string)).toEqual({
    provider: "gateway",
    model: "test-model",
    key: "test-api-key",
    prompt: "test",
  });
});
it("rejects the removed local ChatGPT provider before constructing a request", () => {
  expect(() =>
    generationRequest(
      { provider: "chatgpt-local", model: "gpt-6-astra", key: "a".repeat(64) },
      { prompt: "test" },
    ),
  ).toThrow("supported");
  expect(
    isGenerationReady({
      provider: "chatgpt-local",
      model: "gpt-6-astra",
      key: "a".repeat(64),
    }),
  ).toBe(false);
});
it("never falls back to free generation for unknown connections", () => {
  expect(() =>
    generationRequest({ provider: "unknown", model: "", key: "" }, {}),
  ).toThrow("supported");
});

describe("hosted ChatGPT generation", () => {
  it("requires an explicit model and effort without using a fake key", () => {
    expect(
      isGenerationReady({
        provider: "chatgpt-hosted",
        model: "",
        effort: "low",
        key: "",
      }),
    ).toBe(false);
    expect(
      isGenerationReady({
        provider: "chatgpt-hosted",
        model: "gpt-5.1",
        key: "",
      }),
    ).toBe(false);
    expect(
      isGenerationReady({
        provider: "chatgpt-hosted",
        model: "gpt-5.1",
        effort: "low",
        key: "",
      }),
    ).toBe(true);
  });

  it("uses the fixed same-origin route and strips keys, URLs, and provider fields", () => {
    const request = generationRequest(
      {
        provider: "chatgpt-hosted",
        model: "gpt-5.1",
        effort: "low",
        key: "should-not-send",
      },
      {
        prompt: "Make a garden",
        project: { id: "world" },
        selected: "tree",
        browserModeling: true,
        localModeling: true,
        provider: "gateway",
        key: "payload-secret",
        url: "https://evil.example",
      },
    );
    expect(request.url).toBe("/api/chatgpt/generate");
    expect(request.init.headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(request.init.credentials).toBe("same-origin");
    expect(request.init.redirect).toBe("error");
    expect(request.init.cache).toBe("no-store");
    expect(JSON.parse(request.init.body as string)).toEqual({
      model: "gpt-5.1",
      effort: "low",
      prompt: "Make a garden",
      project: { id: "world" },
      selected: "tree",
      browserModeling: true,
      localModeling: false,
    });
    expect(request.init.body).not.toContain("should-not-send");
    expect(request.init.body).not.toContain("evil.example");
    expect(request.init.body).not.toContain("payload-secret");
  });

  it("does not construct a hosted request without the selected effort", () => {
    expect(() =>
      generationRequest(
        { provider: "chatgpt-hosted", model: "gpt-5.1", key: "" },
        { prompt: "test" },
      ),
    ).toThrow("complete");
  });
});
