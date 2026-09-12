const deps = vi.hoisted(() => ({
  preflight: vi.fn(),
  generate: vi.fn(),
  claim: vi.fn(async () => 2),
  identity: vi.fn(() => ({ cookie: "synthetic-cookie", buckets: [] })),
  trialEnabled: vi.fn(() => true),
}));

vi.mock("../src/lib/server/model-preflight", () => ({
  requireGenerationModel: deps.preflight,
}));
vi.mock("../src/lib/server/generation", async () => ({
  ...(await vi.importActual("../src/lib/server/generation")),
  generateCommands: deps.generate,
}));
vi.mock("@/lib/server/trial", async () => ({
  ...(await vi.importActual("@/lib/server/trial")),
  claimTrial: deps.claim,
  trialIdentity: deps.identity,
  trialEnabled: deps.trialEnabled,
}));

import { afterEach, expect, it, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
import { FREE_MODEL } from "../src/lib/server/trial";
import { POST } from "../src/app/api/generate/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  deps.claim.mockResolvedValue(2);
  deps.trialEnabled.mockReturnValue(true);
});

function request(
  provider: "free" | "openrouter" | "gateway",
  extra: Record<string, unknown> = {},
) {
  vi.stubEnv("BETTER_AUTH_URL", "https://orbsie.test");
  vi.stubEnv("AI_GATEWAY_API_KEY_FREE", "private-synthetic-shared-key");
  vi.stubEnv("DATABASE_URL", "synthetic");
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic");
  return new Request("https://orbsie.test/api/generate", {
    method: "POST",
    headers: {
      origin: "https://orbsie.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider,
      model: provider === "free" ? undefined : "openai/gpt-5.6-luna",
      key: provider === "free" ? undefined : "synthetic-provider-key",
      prompt: "A tiny orb",
      project: blankProject(),
      ...extra,
    }),
  });
}

function modelWith(
  jsonObject: boolean | "unknown" = "unknown",
  jsonSchema: boolean | "unknown" = "unknown",
) {
  return {
    id: "openai/gpt-5.6-luna",
    capabilities: {
      text: { supported: true, source: "catalog" },
      streamingText: { supported: true, source: "provider-contract" },
      tools: { supported: true, source: "catalog" },
      structuredOutput: {
        supported:
          jsonObject === true || jsonSchema === true ? true : jsonObject,
        source: "catalog",
      },
      jsonObject: { supported: jsonObject, source: "catalog" },
      jsonSchema: { supported: jsonSchema, source: "catalog" },
    },
  };
}

function setup(model = modelWith()) {
  deps.preflight.mockResolvedValue(model);
  deps.generate.mockResolvedValue(new ReadableStream<Uint8Array>());
}

it("selects the advertised format for anonymous OpenRouter BYOK", async () => {
  setup(modelWith(true, false));
  const response = await POST(request("openrouter"));
  expect(response.status).toBe(200);
  expect(deps.claim).not.toHaveBeenCalled();
  expect(deps.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: "openrouter",
      model: "openai/gpt-5.6-luna",
      outputFormat: "json-object",
    }),
  );
});

it("selects schema output when OpenRouter advertises only structured_outputs", async () => {
  setup(modelWith(false, true));
  const response = await POST(request("openrouter"));
  expect(response.status).toBe(200);
  expect(deps.generate).toHaveBeenCalledWith(
    expect.objectContaining({ outputFormat: "json-schema" }),
  );
});

it("keeps unsupported and unknown models on NDJSON", async () => {
  setup(modelWith(false, false));
  await POST(request("openrouter"));
  expect(deps.generate).toHaveBeenCalledWith(
    expect.objectContaining({ outputFormat: "ndjson" }),
  );

  deps.generate.mockClear();
  setup(modelWith(true, true));
  await POST(request("gateway"));
  expect(deps.generate).toHaveBeenCalledWith(
    expect.objectContaining({ outputFormat: "ndjson" }),
  );
});

it("uses the same preflight selector for free generation before claiming a trial", async () => {
  setup(modelWith(true, true));
  const response = await POST(request("free"));
  expect(response.status).toBe(200);
  expect(deps.preflight).toHaveBeenCalledWith(
    "gateway",
    FREE_MODEL,
    expect.any(AbortSignal),
  );
  expect(deps.claim).toHaveBeenCalledOnce();
  expect(deps.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: "gateway",
      model: FREE_MODEL,
      outputFormat: "ndjson",
    }),
  );
  expect(deps.preflight.mock.invocationCallOrder[0]).toBeLessThan(
    deps.claim.mock.invocationCallOrder[0],
  );
});

it("applies only an exact operator override", async () => {
  vi.stubEnv(
    "ORBSIE_GENERATION_FORMAT_OVERRIDES",
    '{"openrouter:openai/gpt-5.6-luna":"json-schema-strict"}',
  );
  setup(modelWith(false, false));
  await POST(request("openrouter"));
  expect(deps.generate).toHaveBeenCalledWith(
    expect.objectContaining({ outputFormat: "json-schema-strict" }),
  );

  deps.generate.mockClear();
  setup(modelWith(false, false));
  await POST(request("openrouter", { model: "openai/gpt-6-astra" }));
  expect(deps.generate).toHaveBeenCalledWith(
    expect.objectContaining({ outputFormat: "ndjson" }),
  );
});

it("passes the strict Gateway operator assertion through the route", async () => {
  vi.stubEnv(
    "ORBSIE_GENERATION_FORMAT_OVERRIDES",
    '{"gateway:openai/gpt-5.6-luna":"json-schema-strict"}',
  );
  setup(modelWith(false, false));
  const response = await POST(request("gateway"));
  expect(response.status).toBe(200);
  expect(deps.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: "gateway",
      outputFormat: "json-schema-strict",
    }),
  );
});

it("accepts project-scoped bounded retry feedback", async () => {
  const project = blankProject();
  setup(modelWith(false, false));
  const response = await POST(
    request("openrouter", {
      project,
      generationFeedback: {
        version: 1,
        projectId: project.id,
        code: "INVALID_SCENE_UPDATE",
        finishReason: "stop",
        issues: [
          {
            code: "invalid_type",
            path: ["geometry", "job", "recipe"],
            reason: "unreachable_recipe_node",
          },
        ],
      },
    }),
  );
  expect(response.status).toBe(200);
  expect(deps.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      generationFeedback: expect.objectContaining({ projectId: project.id }),
    }),
  );
});

it("rejects malformed or cross-project retry feedback before preflight", async () => {
  const project = blankProject();
  setup();
  const response = await POST(
    request("openrouter", {
      project,
      generationFeedback: {
        version: 1,
        projectId: "other-project",
        code: "INVALID_SCENE_UPDATE",
        finishReason: "stop",
        issues: [{ code: "secret", path: ["raw-node"] }],
      },
    }),
  );
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain("raw-node");
  expect(deps.preflight).not.toHaveBeenCalled();
  expect(deps.generate).not.toHaveBeenCalled();
});

it("rejects malformed operator configuration before preflight, trial, or inference", async () => {
  vi.stubEnv("ORBSIE_GENERATION_FORMAT_OVERRIDES", "not-json");
  setup();
  const response = await POST(request("free"));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "Generation format configuration is invalid.",
  });
  expect(deps.preflight).not.toHaveBeenCalled();
  expect(deps.claim).not.toHaveBeenCalled();
  expect(deps.generate).not.toHaveBeenCalled();
});
