import { afterEach, expect, it, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
import {
  createAuthoringLifecycle,
  type SceneProvenanceMap,
} from "../src/lib/scene-binding";
import { generateCommands } from "../src/lib/server/generation";
import { createChatGPTSceneStream } from "../src/lib/server/chatgpt-scene-stream";
import { createGenerationObservation } from "../src/lib/server/generation-observability";

const encoder = new TextEncoder();
const commit = JSON.stringify({ type: "commit_revision", message: "Ready" });
const record =
  <T>(target: T[]) =>
  (value: T): void => {
    target.push(value);
  };

function providerStream(...events: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events)
        controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      controller.close();
    },
  });
}

function contentEvent(content: string) {
  return JSON.stringify({ choices: [{ delta: { content } }] });
}

afterEach(() => vi.unstubAllGlobals());

it("cannot complete a failed or aborted lifecycle with failure-only hooks", async () => {
  const failed: unknown[] = [];
  const lifecycle = createAuthoringLifecycle(
    { onFailure: record(failed) },
    new AbortController().signal,
    (): {
      project: ReturnType<typeof blankProject>;
      provenance: SceneProvenanceMap;
    } => ({
      project: blankProject(),
      provenance: new Map(),
    }),
  );

  await lifecycle.fail(Error("stream failed"));
  await expect(lifecycle.complete()).rejects.toThrow("no longer open");
  expect(failed).toHaveLength(1);

  const abort = new AbortController();
  const aborted: unknown[] = [];
  const abortedLifecycle = createAuthoringLifecycle(
    { onFailure: record(aborted) },
    abort.signal,
    (): {
      project: ReturnType<typeof blankProject>;
      provenance: SceneProvenanceMap;
    } => ({
      project: blankProject(),
      provenance: new Map(),
    }),
  );
  abort.abort(Error("cancelled"));
  await expect(abortedLifecycle.complete()).rejects.toThrow("cancelled");
  expect(aborted).toHaveLength(1);
});

it("completes a generation only after a clean committed provider stream", async () => {
  const completed: unknown[] = [];
  const failed: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          providerStream(
            contentEvent(`${commit}\n`),
            JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
            "[DONE]",
          ),
        ),
    ),
  );
  const project = blankProject();
  const stream = await generateCommands({
    provider: "gateway",
    model: "test-model",
    key: "test-key",
    prompt: "Make a shape",
    project,
    signal: new AbortController().signal,
    lifecycle: {
      onComplete: record(completed),
      onFailure: record(failed),
    },
  });
  await new Response(stream).text();
  expect(completed).toHaveLength(1);
  expect(failed).toHaveLength(0);
  expect(completed[0]).toMatchObject({
    project: { id: project.id, revision: project.revision + 1 },
    binding: { projectId: project.id, revision: project.revision + 1 },
  });
});

it("does not complete when the provider fails after emitting a commit", async () => {
  const completed: unknown[] = [];
  const failed: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          providerStream(
            contentEvent(`${commit}\n`),
            JSON.stringify({ error: { code: 502 } }),
          ),
        ),
    ),
  );
  const stream = await generateCommands({
    provider: "gateway",
    model: "test-model",
    key: "test-key",
    prompt: "Make a shape",
    project: blankProject(),
    signal: new AbortController().signal,
    lifecycle: {
      onComplete: record(completed),
      onFailure: record(failed),
    },
  });
  const text = await new Response(stream).text();
  expect(text).not.toContain('"type":"commit_revision"');
  expect(text).toContain('"error"');
  expect(text).toContain('"failure":"provider-error"');
  expect(completed).toHaveLength(0);
  expect(failed).toHaveLength(1);
});

it("rejects NDJSON commands and non-stop termination after an emitted commit", async () => {
  for (const events of [
    [
      contentEvent(
        `${commit}\n${JSON.stringify({ type: "set_environment", sky: "#123456" })}\n${commit}\n`,
      ),
      "[DONE]",
    ],
    [
      contentEvent(`${commit}\n`),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] }),
      "[DONE]",
    ],
  ]) {
    const completed: unknown[] = [];
    const failed: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(providerStream(...events))),
    );
    const stream = await generateCommands({
      provider: "gateway",
      model: "test-model",
      key: "test-key",
      prompt: "Make a shape",
      project: blankProject(),
      signal: new AbortController().signal,
      lifecycle: {
        onComplete: record(completed),
        onFailure: record(failed),
      },
    });
    const text = await new Response(stream).text();
    expect(text).toContain('"error"');
    expect(completed).toHaveLength(0);
    expect(failed).toHaveLength(1);
  }
});

it("reports a provider read failure after commit without completion", async () => {
  const completed: unknown[] = [];
  const failed: unknown[] = [];
  const provisional = JSON.stringify({
    type: "set_environment",
    sky: "#123456",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(`data: ${contentEvent(`${provisional}\n`)}\n\n`),
              );
              controller.error(Error("provider socket closed"));
            },
          }),
        ),
    ),
  );
  const stream = await generateCommands({
    provider: "gateway",
    model: "test-model",
    key: "test-key",
    prompt: "Make a shape",
    project: blankProject(),
    signal: new AbortController().signal,
    lifecycle: {
      onComplete: record(completed),
      onFailure: record(failed),
    },
  });
  await new Response(stream).text();
  expect(completed).toHaveLength(0);
  expect(failed).toHaveLength(1);
});

it("reports a completion-hook failure once without exposing its error text", async () => {
  const failed: unknown[] = [];
  const events: unknown[] = [];
  const streamError = "private persistence detail";
  const observation = createGenerationObservation({
    layer: "provider",
    requestId: "11111111-1111-4111-8111-111111111111",
    clientRunId: "22222222-2222-4222-8222-222222222222",
    provider: "gateway",
    sink: (event) => events.push(event),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(providerStream(contentEvent(`${commit}\n`), "[DONE]")),
    ),
  );
  const stream = await generateCommands({
    provider: "gateway",
    model: "test-model",
    key: "test-key",
    prompt: "Make a shape",
    project: blankProject(),
    signal: new AbortController().signal,
    lifecycle: {
      onComplete: async () => {
        throw Error(streamError);
      },
      onFailure: record(failed),
    },
    observability: observation,
  });
  const text = await new Response(stream).text();
  expect(text).not.toContain(streamError);
  expect(text).toContain("completion could not be recorded");
  expect(text).toContain('"failure":"completion-record-failure"');
  expect(text).not.toContain('"type":"commit_revision"');
  expect(failed).toHaveLength(1);
  expect(events).not.toContainEqual(
    expect.objectContaining({ event: "phase", phase: "commit" }),
  );
  expect(events.at(-1)).toMatchObject({
    event: "terminal",
    terminalReason: "completion-record-failure",
    commandCount: 1,
  });
});

it("does not complete when cancellation races a pending completion hook", async () => {
  let begin!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => (begin = resolve));
  const pending = new Promise<void>((resolve) => (release = resolve));
  const completed: unknown[] = [];
  const failed: unknown[] = [];
  const abort = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(providerStream(contentEvent(`${commit}\n`), "[DONE]")),
    ),
  );
  const stream = await generateCommands({
    provider: "gateway",
    model: "test-model",
    key: "test-key",
    prompt: "Make a shape",
    project: blankProject(),
    signal: abort.signal,
    lifecycle: {
      onComplete: async ({ signal }) => {
        begin();
        await pending;
        if (!signal.aborted) completed.push("committed");
      },
      onFailure: record(failed),
    },
  });
  const output = new Response(stream).text();
  await started;
  abort.abort(Error("cancelled"));
  await output;
  expect(completed).toHaveLength(0);
  expect(failed).toHaveLength(1);
  release();
  await Promise.resolve();
});

it("lets consumer cancellation fail promptly and consumes a rejected failure hook", async () => {
  const failed: unknown[] = [];
  let bodyCancelled = false;
  const provisional = JSON.stringify({
    type: "set_environment",
    sky: "#123456",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(`data: ${contentEvent(`${provisional}\n`)}\n\n`),
              );
            },
            cancel() {
              bodyCancelled = true;
            },
          }),
        ),
    ),
  );
  const stream = await generateCommands({
    provider: "gateway",
    model: "test-model",
    key: "test-key",
    prompt: "Make a shape",
    project: blankProject(),
    signal: new AbortController().signal,
    lifecycle: {
      onFailure: async (value) => {
        failed.push(value);
        throw Error("failure writer unavailable");
      },
    },
  });
  const reader = stream.getReader();
  await reader.read();
  await reader.cancel("consumer closed");
  expect(bodyCancelled).toBe(true);
  expect(failed).toHaveLength(1);
});

it("uses the same lifecycle contract for hosted ChatGPT streams", async () => {
  const completed: unknown[] = [];
  const failed: unknown[] = [];
  const project = blankProject();
  const request = {
    model: "gpt-5.6-luna",
    effort: "low",
    prompt: "Make a shape",
    project,
    browserModeling: true,
  };
  const stream = createChatGPTSceneStream(
    request,
    {
      generate: async (input) => input.onText(`${commit}\n`),
    },
    undefined,
    {
      lifecycle: {
        onComplete: record(completed),
        onFailure: record(failed),
      },
    },
  );
  await new Response(stream).text();
  expect(completed).toHaveLength(1);
  expect(failed).toHaveLength(0);
  expect(completed[0]).toMatchObject({
    project: { id: project.id, revision: project.revision + 1 },
    binding: { projectId: project.id, revision: project.revision + 1 },
  });
});

it("does not complete hosted ChatGPT after a trailing provider failure", async () => {
  const completed: unknown[] = [];
  const failed: unknown[] = [];
  const stream = createChatGPTSceneStream(
    {
      model: "gpt-5.6-luna",
      effort: "low",
      prompt: "Make a shape",
      project: blankProject(),
      browserModeling: true,
    },
    {
      generate: async (input) => {
        input.onText(`${commit}\n`);
        throw Error("provider ended after output");
      },
    },
    undefined,
    { lifecycle: { onComplete: record(completed), onFailure: record(failed) } },
  );
  const text = await new Response(stream).text();
  expect(text).toContain('"error"');
  expect(completed).toHaveLength(0);
  expect(failed).toHaveLength(1);
});

it("fences a hosted completion when cancellation races its pending hook", async () => {
  let begin!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => (begin = resolve));
  const pending = new Promise<void>((resolve) => (release = resolve));
  const completed: unknown[] = [];
  const failed: unknown[] = [];
  const abort = new AbortController();
  const stream = createChatGPTSceneStream(
    {
      model: "gpt-5.6-luna",
      effort: "low",
      prompt: "Make a shape",
      project: blankProject(),
      browserModeling: true,
    },
    { generate: async (input) => input.onText(`${commit}\n`) },
    abort.signal,
    {
      lifecycle: {
        onComplete: async ({ signal }) => {
          begin();
          await pending;
          if (!signal.aborted) completed.push("committed");
        },
        onFailure: record(failed),
      },
    },
  );
  const output = new Response(stream).text();
  await started;
  abort.abort(Error("cancelled"));
  await output;
  expect(completed).toHaveLength(0);
  expect(failed).toHaveLength(1);
  release();
  await Promise.resolve();
});

it("reports hosted missing commit as failure and never completion", async () => {
  const completed: unknown[] = [];
  const failed: unknown[] = [];
  const stream = createChatGPTSceneStream(
    {
      model: "gpt-5.6-luna",
      effort: "low",
      prompt: "Make a shape",
      project: blankProject(),
      browserModeling: true,
    },
    {
      generate: async (input) =>
        input.onText(
          JSON.stringify({
            type: "reserve_entity",
            entity: {
              id: "body",
              label: "Body",
              position: [0, 0, 0],
              scale: [1, 1, 1],
              color: "#abcdef",
              stage: "seed",
            },
          }),
        ),
    },
    undefined,
    {
      lifecycle: {
        onComplete: record(completed),
        onFailure: record(failed),
      },
    },
  );
  const text = await new Response(stream).text();
  expect(text).toContain('"error"');
  expect(completed).toHaveLength(0);
  expect(failed).toHaveLength(1);
});

it("reports cancellation once and never completes a hosted stream", async () => {
  const completed: unknown[] = [];
  const failed: unknown[] = [];
  const abort = new AbortController();
  const stream = createChatGPTSceneStream(
    {
      model: "gpt-5.6-luna",
      effort: "low",
      prompt: "Make a shape",
      project: blankProject(),
      browserModeling: true,
    },
    {
      generate: async (input) => {
        if (input.signal?.aborted) return;
        await new Promise<void>((resolve) =>
          input.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
      },
    },
    abort.signal,
    {
      lifecycle: {
        onComplete: record(completed),
        onFailure: record(failed),
      },
    },
  );
  const reading = new Response(stream).text();
  await Promise.resolve();
  abort.abort();
  await reading;
  expect(completed).toHaveLength(0);
  expect(failed).toHaveLength(1);
});

it("fails promptly when the hosted consumer cancels its stream", async () => {
  const failed: unknown[] = [];
  const stream = createChatGPTSceneStream(
    {
      model: "gpt-5.6-luna",
      effort: "low",
      prompt: "Make a shape",
      project: blankProject(),
      browserModeling: true,
    },
    { generate: vi.fn(async () => new Promise<void>(() => {})) },
    undefined,
    { lifecycle: { onFailure: record(failed) } },
  );
  await stream.cancel("consumer closed");
  expect(failed).toHaveLength(1);
});
