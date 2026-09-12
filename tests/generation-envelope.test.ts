import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateCommands,
  systemPromptForCapabilities,
} from "../src/lib/server/generation";
import {
  modelCommandJSONSchemaForCapabilities,
  blankProject,
} from "../src/lib/protocol";

const reservation = {
  type: "reserve_entity" as const,
  entity: {
    id: "tree-0",
    label: "Tree",
    position: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
    color: "#88aa55",
    stage: "seed" as const,
  },
};
const commit = { type: "commit_revision" as const, message: "Ready." };

function sseEvent(content?: string, finishReason?: string) {
  return `data: ${JSON.stringify({
    choices: [
      {
        delta: content === undefined ? {} : { content },
        ...(finishReason === undefined ? {} : { finish_reason: finishReason }),
      },
    ],
  })}\n\n`;
}

function responseFor(content: string, finishReason = "stop", splitAt?: number) {
  const encoder = new TextEncoder();
  const event = sseEvent(content);
  const finish = sseEvent(undefined, finishReason);
  return new Response(
    new ReadableStream({
      start(controller) {
        if (splitAt === undefined) controller.enqueue(encoder.encode(event));
        else {
          const bytes = encoder.encode(event);
          controller.enqueue(bytes.slice(0, splitAt));
          controller.enqueue(bytes.slice(splitAt));
        }
        controller.enqueue(encoder.encode(finish));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
  );
}

function responseWithoutFinish(content: string) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseEvent(content)));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
  );
}

function bodyOf(fetcher: ReturnType<typeof vi.fn>) {
  return JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
}

async function recordsOf(stream: ReadableStream<Uint8Array>) {
  return (await new Response(stream).text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function generationOptions(
  outputFormat: "json-object" | "json-schema" | "ndjson",
  provider: "openrouter" | "gateway" = "openrouter",
) {
  return {
    provider,
    model: "openai/gpt-5.6-luna",
    key: "test-key",
    prompt: "Make a shape",
    project: blankProject(),
    signal: new AbortController().signal,
    outputFormat,
  } as const;
}

afterEach(() => vi.unstubAllGlobals());

describe("structured generation envelopes", () => {
  it("requests JSON object output and removes NDJSON-only prompt guidance", async () => {
    const fetcher = vi.fn(async () =>
      responseFor(JSON.stringify({ commands: [commit] })),
    );
    vi.stubGlobal("fetch", fetcher);

    const stream = await generateCommands(generationOptions("json-object"));
    expect(await recordsOf(stream)).toEqual([commit]);

    const body = bodyOf(fetcher);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.provider).toEqual({
      order: ["OpenAI", "Amazon Bedrock", "Azure"],
      allow_fallbacks: false,
      require_parameters: true,
    });
    expect(body.messages[0].content).not.toContain("NDJSON");
    expect(body.messages[0].content).not.toContain("before the newline");
    expect(body.messages[0].content).toContain("commands array");
    expect(body.messages[0].content).toContain('"$schema"');
    expect(body.messages[0].content).toContain("unscaled local bounds");
  });

  it("requests the capability-specific non-strict JSON schema", async () => {
    const fetcher = vi.fn(async () =>
      responseFor(JSON.stringify({ commands: [commit] })),
    );
    vi.stubGlobal("fetch", fetcher);

    const stream = await generateCommands({
      ...generationOptions("json-schema"),
      browserModeling: true,
    });
    await recordsOf(stream);

    const body = bodyOf(fetcher);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "orbsie_scene_commands",
        strict: false,
        schema: {
          type: "object",
          properties: {
            commands: {
              type: "array",
              items: modelCommandJSONSchemaForCapabilities(false, true),
            },
          },
          required: ["commands"],
          additionalProperties: false,
        },
      },
    });
    expect(body.provider.require_parameters).toBe(true);
    expect(body.messages[0].content).not.toContain("NDJSON");
    expect(body.messages[0].content).not.toContain('"$schema"');
    expect(body.messages[0].content).toContain("response_format");
    expect(body.messages[0].content).toContain("unscaled local bounds");
    expect(body.messages[0].content).toContain("parent transform");
  });

  it("emits a reservation before the envelope closes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const envelopePrefix = `{"commands":[${JSON.stringify(reservation)},`;
    const envelopeSuffix = `${JSON.stringify(commit)}]}`;
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode(sseEvent(envelopePrefix)));
              void gate.then(() => {
                controller.enqueue(encoder.encode(sseEvent(envelopeSuffix)));
                controller.enqueue(encoder.encode(sseEvent(undefined, "stop")));
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
              });
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetcher);

    const stream = await generateCommands(generationOptions("json-object"));
    const reader = stream.getReader();
    const first = await reader.read();
    expect(JSON.parse(new TextDecoder().decode(first.value))).toEqual(
      reservation,
    );
    release();
    const rest: string[] = [];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      rest.push(new TextDecoder().decode(next.value));
    }
    expect(rest.map((line) => JSON.parse(line))).toEqual([commit]);
  });

  it("preserves early commands but never commits a malformed remainder", async () => {
    const malformed = `{"commands":[${JSON.stringify(reservation)},]}`;
    const fetcher = vi.fn(async () => responseFor(malformed));
    vi.stubGlobal("fetch", fetcher);

    const records = await recordsOf(
      await generateCommands(generationOptions("json-object")),
    );
    expect(records[0]).toEqual(reservation);
    expect(records[1]).toMatchObject({
      code: "INVALID_SCENE_JSON",
      diagnostic: { operation: 1, finishReason: null },
    });
    expect(records.some((record) => record.type === "commit_revision")).toBe(
      false,
    );
  });

  it("classifies an incomplete envelope with a length finish as truncated", async () => {
    const incomplete = `{"commands":[${JSON.stringify(reservation)},`;
    const fetcher = vi.fn(async () => responseFor(incomplete, "length"));
    vi.stubGlobal("fetch", fetcher);

    const records = await recordsOf(
      await generateCommands(generationOptions("json-object")),
    );
    expect(records[0]).toEqual(reservation);
    expect(records[1]).toMatchObject({
      code: "TRUNCATED_SCENE_STREAM",
      diagnostic: { operation: 1, finishReason: "length" },
    });
  });

  it("does not commit a complete envelope when the provider truncates", async () => {
    const envelope = JSON.stringify({ commands: [reservation, commit] });
    const fetcher = vi.fn(async () => responseFor(envelope, "length"));
    vi.stubGlobal("fetch", fetcher);

    const records = await recordsOf(
      await generateCommands(generationOptions("json-schema")),
    );
    expect(records[0]).toEqual(reservation);
    expect(records[1]).toMatchObject({
      code: "TRUNCATED_SCENE_STREAM",
      diagnostic: { operation: 2, finishReason: "length" },
    });
    expect(records.some((record) => record.type === "commit_revision")).toBe(
      false,
    );
  });

  it("does not commit when the provider marks the response as a refusal", async () => {
    const envelope = JSON.stringify({ commands: [reservation, commit] });
    const fetcher = vi.fn(async () => responseFor(envelope, "refusal"));
    vi.stubGlobal("fetch", fetcher);

    const records = await recordsOf(
      await generateCommands(generationOptions("json-object")),
    );
    expect(records[0]).toEqual(reservation);
    expect(records[1]).toMatchObject({
      code: "INVALID_SCENE_PROTOCOL",
      diagnostic: { operation: 2, finishReason: "other" },
    });
    expect(records.some((record) => record.type === "commit_revision")).toBe(
      false,
    );
  });

  it("does not commit on a non-success terminal finish reason", async () => {
    const envelope = JSON.stringify({ commands: [reservation, commit] });
    const fetcher = vi.fn(async () => responseFor(envelope, "content_filter"));
    vi.stubGlobal("fetch", fetcher);

    const records = await recordsOf(
      await generateCommands(generationOptions("json-object")),
    );
    expect(records[0]).toEqual(reservation);
    expect(records[1]).toMatchObject({
      code: "INVALID_SCENE_PROTOCOL",
      diagnostic: { operation: 2, finishReason: "content_filter" },
    });
    expect(records.some((record) => record.type === "commit_revision")).toBe(
      false,
    );
  });

  it("does not commit without a successful terminal finish reason", async () => {
    const envelope = JSON.stringify({ commands: [reservation, commit] });
    const fetcher = vi.fn(async () => responseWithoutFinish(envelope));
    vi.stubGlobal("fetch", fetcher);

    const records = await recordsOf(
      await generateCommands(generationOptions("json-object")),
    );
    expect(records[0]).toEqual(reservation);
    expect(records[1]).toMatchObject({
      code: "INVALID_SCENE_PROTOCOL",
      diagnostic: { operation: 2, finishReason: null },
    });
    expect(records.some((record) => record.type === "commit_revision")).toBe(
      false,
    );
  });

  it("does not commit when the closed envelope has trailing garbage", async () => {
    const envelope = `${JSON.stringify({ commands: [reservation, commit] })} trailing`;
    const fetcher = vi.fn(async () => responseFor(envelope));
    vi.stubGlobal("fetch", fetcher);

    const records = await recordsOf(
      await generateCommands(generationOptions("json-object")),
    );
    expect(records[0]).toEqual(reservation);
    expect(records[1]).toMatchObject({
      code: "INVALID_SCENE_JSON",
      diagnostic: { operation: 2, finishReason: null },
    });
    expect(records.some((record) => record.type === "commit_revision")).toBe(
      false,
    );
  });

  it("rejects duplicate commits and commands after a pending commit", async () => {
    const envelope = JSON.stringify({
      commands: [reservation, commit, commit],
    });
    const fetcher = vi.fn(async () => responseFor(envelope));
    vi.stubGlobal("fetch", fetcher);

    const records = await recordsOf(
      await generateCommands(generationOptions("json-object")),
    );
    expect(records[0]).toEqual(reservation);
    expect(records[1]).toMatchObject({
      code: "INVALID_SCENE_PROTOCOL",
      diagnostic: { operation: 3, finishReason: null },
    });
    expect(records.some((record) => record.type === "commit_revision")).toBe(
      false,
    );
  });

  it("accepts a generated browser recipe through the existing pipeline", async () => {
    const geometry = {
      kind: "generated" as const,
      collision: "none" as const,
      detail: "refined" as const,
      job: {
        backend: "browser-manifold" as const,
        recipe: {
          version: 1 as const,
          revision: 0,
          output: "box",
          nodes: [{ id: "box", kind: "box", size: [2, 2, 2] }],
        },
      },
    };
    const command = { type: "set_geometry" as const, id: "tree-0", geometry };
    const envelope = JSON.stringify({
      commands: [reservation, command, commit],
    });
    const fetcher = vi.fn(async () => responseFor(envelope));
    vi.stubGlobal("fetch", fetcher);

    const records = await recordsOf(
      await generateCommands({
        ...generationOptions("json-schema"),
        browserModeling: true,
      }),
    );
    expect(records).toEqual([reservation, command, commit]);
  });

  it("keeps the existing NDJSON request and stream behavior by default", async () => {
    const line = JSON.stringify(commit);
    const fetcher = vi.fn(async () => responseFor(`${line}\n`));
    vi.stubGlobal("fetch", fetcher);

    const records = await recordsOf(
      await generateCommands(generationOptions("ndjson")),
    );
    expect(records).toEqual([commit]);
    const body = bodyOf(fetcher);
    expect(body.response_format).toBeUndefined();
    expect(body.provider.require_parameters).toBeUndefined();
    expect(systemPromptForCapabilities(false, false)).toContain(
      "newline-delimited JSON",
    );
    expect(systemPromptForCapabilities(false, true)).toContain('"$schema"');
    expect(systemPromptForCapabilities(false, true)).toContain(
      "meters in a Y-up world",
    );
  });
});
