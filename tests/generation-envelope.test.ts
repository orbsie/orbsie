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

function responseWithTrailingDataLine(content: string, data: string) {
  const encoder = new TextEncoder();
  const trailingLine = encoder.encode(`data: ${data}`);
  const splitAt = Math.floor(trailingLine.byteLength / 2);
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseEvent(content)));
        controller.enqueue(trailingLine.slice(0, splitAt));
        controller.enqueue(trailingLine.slice(splitAt));
        controller.close();
      },
    }),
  );
}

function responseWithTrailingDataLineError(content: string, data: string) {
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode(sseEvent(content)),
    encoder.encode(`data: ${data}`),
  ];
  let nextChunk = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        const chunk = chunks[nextChunk++];
        if (chunk) controller.enqueue(chunk);
        else controller.error(new Error("provider stream interrupted"));
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
  outputFormat: "json-object" | "json-schema" | "json-schema-strict" | "ndjson",
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

const strictReservation = {
  type: "reserve_entity" as const,
  entity: {
    id: "tree-0",
    label: "Tree",
    position: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
    rotation: { present: false },
    parentId: { present: false },
    color: "#88aa55",
    behavior: { present: false },
    assetPolicy: { present: false },
    stage: "seed" as const,
  },
};

const strictGeneratedRevolve = {
  type: "set_geometry" as const,
  id: "tree-0",
  geometry: {
    kind: "generated" as const,
    collision: "none" as const,
    detail: "refined" as const,
    job: {
      backend: "browser-manifold" as const,
      recipe: {
        version: 1 as const,
        revision: 0,
        output: "revolve",
        nodes: [
          {
            id: "revolve",
            kind: "revolve",
            profile: [
              { item0: 0.2, item1: -0.5 },
              { item0: 0.4, item1: 0.5 },
              { item0: 0.2, item1: 1 },
            ],
            segments: 16,
          },
        ],
      },
    },
    tint: { present: false },
  },
  assetPolicy: { present: false },
};

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

  it("adds only bounded retry feedback to the server correction instruction", async () => {
    const fetcher = vi.fn(async () =>
      responseFor(JSON.stringify({ commands: [commit] })),
    );
    vi.stubGlobal("fetch", fetcher);
    const project = blankProject();

    await generateCommands({
      ...generationOptions("json-object"),
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
    });

    const body = bodyOf(fetcher);
    expect(body.messages[0].content).toContain("INVALID_SCENE_UPDATE");
    expect(body.messages[0].content).toContain("unreachable_recipe_node");
    expect(body.messages[1].content).not.toContain("generationFeedback");
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

  it("requests the strict wire schema and decodes wrappers before applying commands", async () => {
    const fetcher = vi.fn(async () =>
      responseFor(
        JSON.stringify({
          commands: [strictReservation, strictGeneratedRevolve, commit],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);

    const records = await recordsOf(
      await generateCommands({
        ...generationOptions("json-schema-strict"),
        browserModeling: true,
      }),
    );
    expect(records).toEqual([
      reservation,
      {
        type: "set_geometry",
        id: "tree-0",
        geometry: {
          kind: "generated",
          collision: "none",
          detail: "refined",
          job: {
            backend: "browser-manifold",
            recipe: {
              version: 1,
              revision: 0,
              output: "revolve",
              nodes: [
                {
                  id: "revolve",
                  kind: "revolve",
                  profile: [
                    [0.2, -0.5],
                    [0.4, 0.5],
                    [0.2, 1],
                  ],
                  segments: 16,
                },
              ],
            },
          },
        },
      },
      commit,
    ]);

    const body = bodyOf(fetcher);
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "orbsie_scene_commands",
        strict: true,
        schema: {
          type: "object",
          properties: { commands: { type: "array" } },
          required: ["commands"],
          additionalProperties: false,
        },
      },
    });
    expect(
      body.response_format.json_schema.schema.properties.commands.items,
    ).toEqual(expect.objectContaining({ anyOf: expect.any(Array) }));
    expect(body.messages[0].content).toContain("present:false");
    expect(body.messages[0].content).toContain("item0");
    expect(body.messages[0].content).not.toContain('"$schema"');
    expect(body.messages[0].content).toContain(
      "canonical set_geometry example is conceptual only",
    );
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

  it("rejects an invalid strict wire wrapper without committing", async () => {
    const invalid = {
      type: "set_transform",
      id: "tree-0",
      position: { present: true, value: null },
      rotation: { present: false },
      scale: { present: false },
      assetPolicy: { present: false },
    };
    const fetcher = vi.fn(async () =>
      responseFor(
        JSON.stringify({ commands: [strictReservation, invalid, commit] }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);

    const records = await recordsOf(
      await generateCommands(generationOptions("json-schema-strict")),
    );
    expect(records[0]).toEqual(reservation);
    expect(records[1]).toMatchObject({
      code: "INVALID_SCENE_UPDATE",
      diagnostic: { operation: 2 },
    });
    expect(JSON.stringify(records[1])).not.toContain("tree-0");
    expect(JSON.stringify(records[1])).not.toContain('"value":null');
    expect(records.some((record) => record.type === "commit_revision")).toBe(
      false,
    );
  });

  it("holds a strict-wire commit when the envelope is truncated", async () => {
    const incomplete = JSON.stringify({
      commands: [strictReservation, commit],
    }).slice(0, -3);
    const fetcher = vi.fn(async () => responseFor(incomplete, "length"));
    vi.stubGlobal("fetch", fetcher);

    const records = await recordsOf(
      await generateCommands(generationOptions("json-schema-strict")),
    );
    expect(records[0]).toEqual(reservation);
    expect(records[1]).toMatchObject({
      code: "TRUNCATED_SCENE_STREAM",
      diagnostic: { operation: 1, finishReason: "length" },
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

  it("does not invent a commit after a complete structured envelope and normal stop", async () => {
    const command = { type: "set_environment", sky: "#123456" };
    const fetcher = vi.fn(async () =>
      responseFor(JSON.stringify({ commands: [command] }), "stop"),
    );
    vi.stubGlobal("fetch", fetcher);

    const records = await recordsOf(
      await generateCommands(generationOptions("json-object")),
    );
    expect(records[0]).toEqual(command);
    expect(records[1]).toMatchObject({
      error: "Generation ended before committing this turn.",
      failure: "clean-eof-without-commit",
      code: "INVALID_SCENE_PROTOCOL",
      diagnostic: { operation: 1, finishReason: "stop" },
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

  it("accepts a complete structured finish event at EOF without a newline", async () => {
    const terminalEvent = JSON.stringify({
      choices: [{ delta: {}, finish_reason: "stop" }],
    });
    const fetcher = vi.fn(async () =>
      responseWithTrailingDataLine(
        JSON.stringify({ commands: [commit] }),
        terminalEvent,
      ),
    );
    vi.stubGlobal("fetch", fetcher);

    const records = await recordsOf(
      await generateCommands(generationOptions("json-object")),
    );
    expect(records).toEqual([commit]);
  });

  it("does not commit when the trailing EOF finish event is truncated", async () => {
    const envelope = JSON.stringify({ commands: [reservation, commit] });
    const fetcher = vi.fn(async () =>
      responseWithTrailingDataLine(
        envelope,
        '{"choices":[{"delta":{},"finish_reason":"stop"',
      ),
    );
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

  it("does not accept a trailing finish fragment when the provider stream errors", async () => {
    const envelope = JSON.stringify({ commands: [reservation, commit] });
    const terminalEvent = JSON.stringify({
      choices: [{ delta: {}, finish_reason: "stop" }],
    });
    const fetcher = vi.fn(async () =>
      responseWithTrailingDataLineError(envelope, terminalEvent),
    );
    vi.stubGlobal("fetch", fetcher);

    const records = await recordsOf(
      await generateCommands(generationOptions("json-object")),
    );
    expect(records[0]).toEqual(reservation);
    expect(records[1]).toMatchObject({
      error: "The provider response was interrupted.",
      failure: "stream-error",
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
    expect(systemPromptForCapabilities(false, false)).toContain(
      "raw scale values across different catalog assets are not comparable",
    );
    expect(systemPromptForCapabilities(false, false)).toContain(
      "compare the replacement's transformed physical dimensions with the existing object's bounds",
    );
    const prompt = systemPromptForCapabilities(false, false);
    expect(prompt).toContain(
      "The final command must be one model-issued commit_revision; reserve enough output budget for it.",
    );
    expect(prompt).toContain(
      "Satisfy the request with the smallest complete set of scene commands",
    );
    expect(prompt).toContain(
      'keep the entity behavior.type as "bounce" and use a game-program move_path action on that same entity',
    );
    expect(prompt).toContain(
      "A set_position action only repositions the platform; it never launches the player",
    );
    expect(prompt).toContain("JUMP_SPEED 6 and gravity 15 (ideal rise 1.2");
  });
});
