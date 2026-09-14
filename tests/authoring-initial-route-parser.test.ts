const deps = vi.hoisted(() => ({
  preflight: vi.fn(),
  issue: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  trialIdentity: vi.fn(),
  getAuth: vi.fn(() => null),
}));

vi.mock("../src/lib/server/model-preflight", () => ({
  requireGenerationModel: deps.preflight,
}));
vi.mock("../src/lib/server/authoring-run-ledger", () => ({
  issueAuthoringRun: deps.issue,
  completeInitialAuthoringRun: deps.complete,
  failAuthoringRun: deps.fail,
}));
vi.mock("../src/lib/server/auth", async () => ({
  ...(await vi.importActual("../src/lib/server/auth")),
  getAuth: deps.getAuth,
}));
vi.mock("../src/lib/server/trial", async () => ({
  ...(await vi.importActual("../src/lib/server/trial")),
  trialIdentity: deps.trialIdentity,
}));

import { afterEach, expect, it, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
import { POST } from "../src/app/api/generate/route";

const encoder = new TextEncoder();
const commit = JSON.stringify({ type: "commit_revision", message: "Ready" });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function request(signal?: AbortSignal) {
  vi.stubEnv("BETTER_AUTH_URL", "https://orbsie.test");
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-authoring-secret");
  vi.stubEnv("DATABASE_URL", "synthetic");
  return new Request("https://orbsie.test/api/generate", {
    method: "POST",
    ...(signal ? { signal } : {}),
    headers: {
      origin: "https://orbsie.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider: "gateway",
      model: "openai/gpt-5.6-luna",
      key: "synthetic-provider-key",
      prompt: "Make a garden",
      project: blankProject(),
      authoringReview: true,
    }),
  });
}

function providerStream(...events: string[]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events)
          controller.enqueue(encoder.encode(`data: ${event}\n\n`));
        controller.close();
      },
    }),
  );
}

function setup() {
  vi.stubEnv("ORBSIE_AUTHORING_REVIEW", "1");
  deps.preflight.mockResolvedValue({
    id: "openai/gpt-5.6-luna",
    capabilities: {
      jsonObject: { supported: false, source: "catalog" },
      jsonSchema: { supported: false, source: "catalog" },
      structuredOutput: { supported: false, source: "catalog" },
    },
  });
  deps.trialIdentity.mockReturnValue({
    identityHash: "a".repeat(64),
    cookie: "orbsie_trial=synthetic",
    buckets: [],
  });
  deps.issue.mockResolvedValue({
    runId: "11111111-1111-4111-8111-111111111111",
    phaseToken: "22222222-2222-4222-8222-222222222222",
    trialRemaining: null,
    expiresAt: new Date(),
  });
}

it("uses the production parser and records authoritative completion", async () => {
  setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      providerStream(
        JSON.stringify({ choices: [{ delta: { content: `${commit}\n` } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        "[DONE]",
      ),
    ),
  );
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('"type":"commit_revision"');
  expect(deps.complete).toHaveBeenCalledOnce();
  expect(deps.fail).not.toHaveBeenCalled();
});

it("fails the admitted phase on incomplete EOF, trailing commands, and provider errors", async () => {
  setup();
  for (const [label, events] of [
    [
      "EOF",
      [JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })],
    ],
    [
      "trailing",
      [
        JSON.stringify({ choices: [{ delta: { content: `${commit}\n` } }] }),
        JSON.stringify({
          choices: [
            {
              delta: {
                content: `${JSON.stringify({ type: "set_environment", sky: "#000000" })}\n`,
              },
            },
          ],
        }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      ],
    ],
    [
      "provider-error",
      [
        JSON.stringify({ choices: [{ delta: { content: `${commit}\n` } }] }),
        JSON.stringify({
          error: { code: "provider-private" },
          choices: [{ delta: {}, finish_reason: "stop" }],
        }),
      ],
    ],
  ] as const) {
    deps.complete.mockReset();
    deps.fail.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => providerStream(...events)),
    );
    const response = await POST(request());
    await response.text();
    expect(deps.complete, label).not.toHaveBeenCalled();
    expect(deps.fail, label).toHaveBeenCalledOnce();
  }
});

it("fences an admitted phase when the route consumer cancels the production stream", async () => {
  setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ choices: [{ delta: { content: `${commit}\n` } }] })}\n\n`,
                ),
              );
            },
          }),
        ),
    ),
  );
  const response = await POST(request());
  const reader = response.body!.getReader();
  await reader.cancel("synthetic consumer cancellation");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(deps.complete).not.toHaveBeenCalled();
  expect(deps.fail).toHaveBeenCalledOnce();
});

it("fails the phase when completion is durable but its callback settles after cancellation", async () => {
  setup();
  let durable = false;
  let releaseCompletion!: () => void;
  const completionSettled = new Promise<void>((resolve) => {
    releaseCompletion = resolve;
  });
  deps.complete.mockImplementation(async () => {
    durable = true;
    await completionSettled;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      providerStream(
        JSON.stringify({ choices: [{ delta: { content: `${commit}\n` } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        "[DONE]",
      ),
    ),
  );
  const abort = new AbortController();
  const response = await POST(request(abort.signal));
  const body = response.text();
  for (let attempt = 0; attempt < 100 && !durable; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  expect(durable).toBe(true);
  abort.abort(Error("cancelled after durable completion"));
  releaseCompletion();
  await body;
  expect(deps.complete).toHaveBeenCalledOnce();
  expect(deps.fail).toHaveBeenCalledOnce();
});

it("scrubs completion-writer rejection and closes the admitted phase", async () => {
  setup();
  deps.complete.mockRejectedValueOnce(
    Error("private database credential detail"),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      providerStream(
        JSON.stringify({ choices: [{ delta: { content: `${commit}\n` } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        "[DONE]",
      ),
    ),
  );
  const response = await POST(request());
  const text = await response.text();
  expect(text).toContain("The scene completion could not be recorded");
  expect(text).not.toContain("private database credential detail");
  expect(text).not.toContain("22222222-2222-4222-8222-222222222222");
  expect(deps.fail).toHaveBeenCalledOnce();
});

it("closes the admitted phase on malformed model output", async () => {
  setup();
  deps.complete.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      providerStream(
        JSON.stringify({
          choices: [{ delta: { content: '{"type":broken}\n' } }],
        }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        "[DONE]",
      ),
    ),
  );
  const response = await POST(request());
  expect(await response.text()).toContain('"error"');
  expect(deps.complete).not.toHaveBeenCalled();
  expect(deps.fail).toHaveBeenCalledOnce();
});
