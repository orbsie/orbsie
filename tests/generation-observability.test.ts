import { afterEach, describe, expect, it, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
import { generateCommands } from "../src/lib/server/generation";
import { createChatGPTHostHandler } from "../src/lib/server/chatgpt-host";
import {
  createGenerationObservation,
  observeGenerationStream,
} from "../src/lib/server/generation-observability";

const requestId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";

describe("generation observability", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("emits allowlisted phases and exactly one terminal per layer", () => {
    const events: unknown[] = [];
    let clock = 100;
    const observation = createGenerationObservation({
      layer: "provider",
      requestId,
      clientRunId: runId,
      provider: "gateway",
      admittedModel: "~gateway/luna",
      reasoningEffort: "low",
      buildId: "local",
      now: () => clock,
      sink: (event) => events.push(event),
    });
    observation.phase("provider-start");
    observation.phase("provider-start");
    observation.noteInputBytes(30);
    observation.noteCommand();
    observation.commit();
    clock += 12;
    observation.terminal({
      reason: "completed",
      finishReason: "stop",
    });
    observation.terminal({ reason: "transport-error" });

    const records = events as Array<Record<string, unknown>>;
    expect(records.filter((event) => event.event === "terminal")).toHaveLength(
      1,
    );
    expect(records.map((event) => event.phase).filter(Boolean)).toEqual([
      "admission",
      "provider-start",
      "first-valid-command",
      "commit",
    ]);
    expect(records.at(-1)).toMatchObject({
      requestId,
      clientRunId: runId,
      provider: "gateway",
      model: "~gateway/luna",
      reasoningEffort: "low",
      buildId: "local",
      terminalReason: "completed",
      finishReason: "stop",
      durationMs: 12,
      inputBytes: 30,
      commandCount: 1,
    });
  });

  it("drops malformed correlation and model metadata without throwing", () => {
    const events: unknown[] = [];
    const observation = createGenerationObservation({
      layer: "provider",
      requestId: "private-request",
      clientRunId: "private-run",
      provider: "private-provider" as never,
      admittedModel: "provider-secret\n",
      buildId: "untrusted-release",
      sink: (event) => events.push(event),
    });
    observation.terminal({
      reason: "unknown",
      abortSource: "unknown",
      credentialFinalization: "unknown",
      finishReason: "other",
    });
    const json = JSON.stringify(events);
    expect(json).not.toContain("private");
    expect(json).not.toContain("provider-secret");
    expect(json).not.toContain("untrusted-release");
    expect(events).toHaveLength(2);
  });

  it("keeps failure classification and provider status bounded", () => {
    const events: unknown[] = [];
    const observation = createGenerationObservation({
      layer: "route",
      requestId,
      sink: (event) => events.push(event),
    });
    observation.terminal({
      reason: "provider-error",
      failureCode: "quota",
      httpStatus: 402,
    });
    const terminal = events.at(-1) as Record<string, unknown>;
    expect(terminal).toMatchObject({
      terminalReason: "provider-error",
      failureCode: "quota",
      httpStatus: 402,
    });

    const invalidEvents: unknown[] = [];
    const invalid = createGenerationObservation({
      layer: "route",
      requestId,
      sink: (event) => invalidEvents.push(event),
    });
    invalid.terminal({
      reason: "unknown",
      failureCode: "provider-secret" as never,
      httpStatus: 700,
    });
    expect(JSON.stringify(invalidEvents.at(-1))).not.toContain(
      "provider-secret",
    );
    expect(invalidEvents.at(-1)).not.toHaveProperty("httpStatus");
  });

  it("emits one parseable JSON line through the default sink", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const observation = createGenerationObservation({
      layer: "route",
      requestId,
    });
    observation.terminal({ reason: "completed" });
    expect(info).toHaveBeenCalledTimes(2);
    expect(info.mock.calls.every((call) => call.length === 1)).toBe(true);
    expect(JSON.parse(String(info.mock.calls[1][0]))).toMatchObject({
      event: "terminal",
      requestId,
      terminalReason: "completed",
    });
    info.mockRestore();
  });

  it("classifies route EOF without a commit while preserving bytes", async () => {
    const events: unknown[] = [];
    const observation = createGenerationObservation({
      layer: "route",
      requestId,
      sink: (event) => events.push(event),
    });
    const bytes = new TextEncoder().encode(
      '{"type":"reserve_entity","id":"safe"}\n',
    );
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 9));
        controller.enqueue(bytes.slice(9));
        controller.close();
      },
    });
    const observed = observeGenerationStream(source, observation);
    expect(await new Response(observed).text()).toBe(
      new TextDecoder().decode(bytes),
    );
    expect((events.at(-1) as Record<string, unknown>).terminalReason).toBe(
      "clean-eof-without-commit",
    );
  });

  it("handles split UTF-8 and a final record without a newline", async () => {
    const events: unknown[] = [];
    const observation = createGenerationObservation({
      layer: "route",
      requestId,
      sink: (event) => events.push(event),
    });
    const bytes = new TextEncoder().encode(
      JSON.stringify({ type: "commit_revision", message: "café" }),
    );
    const split = new TextEncoder().encode("é");
    const splitAt = bytes.indexOf(split[0]);
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt + 1));
        controller.enqueue(bytes.slice(splitAt + 1));
        controller.close();
      },
    });
    expect(
      await new Response(observeGenerationStream(source, observation)).text(),
    ).toBe(new TextDecoder().decode(bytes));
    expect(events.at(-1)).toMatchObject({ terminalReason: "completed" });
  });

  it("classifies malformed final records as parser failure", async () => {
    const events: unknown[] = [];
    const observation = createGenerationObservation({
      layer: "route",
      requestId,
      sink: (event) => events.push(event),
    });
    const malformed = new TextEncoder().encode('{"type":"commit_revision"');
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(malformed);
        controller.close();
      },
    });
    await new Response(observeGenerationStream(source, observation)).text();
    expect(events.at(-1)).toMatchObject({
      terminalReason: "parser-failure",
      failureCode: "parser",
    });
  });

  it("separates an overlong record from transport failure and discards its continuation", async () => {
    const events: unknown[] = [];
    const observation = createGenerationObservation({
      layer: "route",
      requestId,
      sink: (event) => events.push(event),
    });
    const oversized = `${JSON.stringify({
      type: "set_geometry",
      id: "shape",
      geometry: {
        kind: "generated",
        detail: "refined",
        job: {
          backend: "browser-manifold",
          recipe: {
            version: 1,
            revision: 0,
            output: "box",
            nodes: [
              {
                id: "box",
                kind: "box",
                size: [1, 1, 1],
                detail: "x".repeat(70 * 1024),
              },
            ],
          },
        },
      },
    })}\n`;
    const commitLine = `${JSON.stringify({ type: "commit_revision" })}\n`;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(oversized.slice(0, 30 * 1024)),
        );
        controller.enqueue(
          new TextEncoder().encode(oversized.slice(30 * 1024)),
        );
        controller.enqueue(new TextEncoder().encode(commitLine));
        controller.close();
      },
    });
    const responseText = await new Response(
      observeGenerationStream(source, observation),
    ).text();
    expect(responseText).toBe(oversized + commitLine);
    expect(events.at(-1)).toMatchObject({
      terminalReason: "observation-limit",
      failureCode: "observation-limit",
    });
  });

  it("preserves a thrown source error and emits one terminal", async () => {
    const events: unknown[] = [];
    const observation = createGenerationObservation({
      layer: "route",
      requestId,
      sink: (event) => events.push(event),
    });
    const sourceError = Error("private source detail");
    const source = new ReadableStream<Uint8Array>({
      pull() {
        throw sourceError;
      },
    });
    const reader = observeGenerationStream(source, observation).getReader();
    await expect(reader.read()).rejects.toBe(sourceError);
    expect(
      events.filter(
        (event) => (event as Record<string, unknown>).event === "terminal",
      ),
    ).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      terminalReason: "transport-error",
      failureCode: "transport",
    });
  });

  it("keeps cancellation/read races single-terminal and releases the source lock", async () => {
    const events: unknown[] = [];
    const observation = createGenerationObservation({
      layer: "route",
      requestId,
      sink: (event) => events.push(event),
    });
    let releasePull!: () => void;
    const source = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>((resolve) => {
          releasePull = resolve;
        });
      },
      cancel() {
        releasePull?.();
      },
    });
    const observed = observeGenerationStream(source, observation);
    const reader = observed.getReader();
    const pendingRead = reader.read();
    await Promise.resolve();
    await reader.cancel("client stop");
    await pendingRead;
    expect(
      events.filter(
        (event) => (event as Record<string, unknown>).event === "terminal",
      ),
    ).toHaveLength(1);
    const sourceReader = source.getReader();
    await sourceReader.cancel();
    sourceReader.releaseLock();
  });

  it("does not let a sink failure affect stream processing", async () => {
    const observation = createGenerationObservation({
      layer: "route",
      requestId,
      sink: () => {
        throw Error("sink failed");
      },
    });
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `${JSON.stringify({ type: "commit_revision" })}\n`,
          ),
        );
        controller.close();
      },
    });
    await expect(
      new Response(observeGenerationStream(source, observation)).text(),
    ).resolves.toContain("commit_revision");
  });

  it("records provider start, first byte, command, commit and completion", async () => {
    const events: unknown[] = [];
    const observation = createGenerationObservation({
      layer: "provider",
      requestId,
      provider: "gateway",
      admittedModel: "gateway/luna",
      sink: (event) => events.push(event),
    });
    const commandLine = JSON.stringify({
      type: "commit_revision",
      message: "Ready",
    });
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: `${commandLine}\n` } }] })}\n\ndata: [DONE]\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    const stream = await generateCommands({
      provider: "gateway",
      model: "gateway/luna",
      key: "test-key",
      prompt: "Create a shape",
      project: blankProject(),
      signal: new AbortController().signal,
      observability: observation,
    });
    await new Response(stream).text();
    const records = events as Array<Record<string, unknown>>;
    expect(records.map((event) => event.phase).filter(Boolean)).toEqual([
      "admission",
      "provider-start",
      "first-byte",
      "first-valid-command",
      "commit",
    ]);
    expect(records.filter((event) => event.event === "terminal")).toHaveLength(
      1,
    );
    expect(records.at(-1)).toMatchObject({ terminalReason: "completed" });
  });

  it("classifies an invalid scene recipe as parser failure rather than transport", async () => {
    const events: unknown[] = [];
    const observation = createGenerationObservation({
      layer: "provider",
      requestId,
      provider: "gateway",
      admittedModel: "gateway/luna",
      sink: (event) => events.push(event),
    });
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: '{"type":"invalid_recipe"}\\n' } }] })}\n\ndata: [DONE]\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    const stream = await generateCommands({
      provider: "gateway",
      model: "gateway/luna",
      key: "test-key",
      prompt: "Create a shape",
      project: blankProject(),
      signal: new AbortController().signal,
      observability: observation,
    });
    await new Response(stream).text();
    expect(events.at(-1)).toMatchObject({
      terminalReason: "parser-failure",
      failureCode: "parser",
    });
  });

  it("classifies a bounded provider rejection without logging its body", async () => {
    const events: unknown[] = [];
    const observation = createGenerationObservation({
      layer: "provider",
      requestId,
      provider: "gateway",
      admittedModel: "gateway/luna",
      sink: (event) => events.push(event),
    });
    vi.stubGlobal(
      "fetch",
      async () => new Response("private provider body", { status: 402 }),
    );
    await expect(
      generateCommands({
        provider: "gateway",
        model: "gateway/luna",
        key: "test-key",
        prompt: "Create a shape",
        project: blankProject(),
        signal: new AbortController().signal,
        observability: observation,
      }),
    ).rejects.toMatchObject({ status: 402 });
    const terminal = events.at(-1) as Record<string, unknown>;
    expect(terminal).toMatchObject({
      terminalReason: "provider-error",
      failureCode: "quota",
      httpStatus: 402,
    });
    expect(JSON.stringify(events)).not.toContain("private provider body");
  });

  it("terminates observation when a provider omits its response body", async () => {
    const events: unknown[] = [];
    const observation = createGenerationObservation({
      layer: "provider",
      requestId,
      provider: "gateway",
      admittedModel: "gateway/luna",
      sink: (event) => events.push(event),
    });
    vi.stubGlobal("fetch", async () => new Response(null));
    await expect(
      generateCommands({
        provider: "gateway",
        model: "gateway/luna",
        key: "test-key",
        prompt: "Create a shape",
        project: blankProject(),
        signal: new AbortController().signal,
        observability: observation,
      }),
    ).rejects.toThrow("response body is missing");
    expect(events.at(-1)).toMatchObject({
      terminalReason: "transport-error",
      failureCode: "transport",
    });
  });

  it("passes only validated correlation through the private hosted HTTP boundary", async () => {
    const generate = vi.fn(async () => new ReadableStream<Uint8Array>());
    const handler = createChatGPTHostHandler({
      session: {
        start: vi.fn(),
        getSnapshot: vi.fn(),
        readAuthStatus: vi.fn(),
        cancel: vi.fn(),
        logout: vi.fn(),
      } as never,
      token: "a".repeat(64),
      managedOperation: {
        generate,
      } as never,
      legacyRouteAllowed: () => false,
    });
    const response = await handler(
      new Request("https://private-host.test/private/operation/generate", {
        method: "POST",
        headers: {
          authorization: `Bearer ${"a".repeat(64)}`,
          "content-type": "application/json",
          "x-orbsie-request-id": requestId,
          "x-orbsie-client-run-id": runId,
        },
        body: JSON.stringify({
          operationId: "operation-1",
          epoch: 1,
          input: { model: "gpt-5.6-luna" },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledWith(
      { operationId: "operation-1", epoch: 1 },
      { model: "gpt-5.6-luna" },
      expect.any(AbortSignal),
      { requestId, clientRunId: runId },
    );
    const invalid = await handler(
      new Request("https://private-host.test/private/operation/generate", {
        method: "POST",
        headers: {
          authorization: `Bearer ${"a".repeat(64)}`,
          "content-type": "application/json",
          "x-orbsie-request-id": "sentinel-secret",
        },
        body: JSON.stringify({
          operationId: "operation-1",
          epoch: 1,
          input: { model: "gpt-5.6-luna" },
        }),
      }),
    );
    expect(invalid.status).toBe(400);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
