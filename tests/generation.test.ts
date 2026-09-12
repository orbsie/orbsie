import { it, expect, vi, afterEach } from "vitest";
import { generateCommands } from "../src/lib/server/generation";
import { blankProject } from "../src/lib/protocol";
afterEach(() => vi.unstubAllGlobals());
it("routes OpenRouter Luna through OpenAI, Amazon Bedrock, then Azure", async () => {
  const encoder = new TextEncoder();
  const line = JSON.stringify({ type: "commit_revision", message: "Ready." });
  const fetcher = vi.fn(
    async (_url: string, _options?: RequestInit) =>
      new Response(
        new ReadableStream({
          start(c) {
            for (const fragment of [line.slice(0, 13), line.slice(13) + "\n"]) {
              const data =
                "data: " +
                JSON.stringify({
                  choices: [{ delta: { content: fragment } }],
                }) +
                "\n\n";
              c.enqueue(encoder.encode(data));
            }
            c.enqueue(encoder.encode("data: [DONE]\n\n"));
            c.close();
          },
        }),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  await generateCommands({
    provider: "openrouter",
    model: "openai/gpt-5.6-luna",
    key: "test-key-not-real",
    prompt: "Hello",
    project: blankProject(),
    signal: new AbortController().signal,
  });
  const submitted = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(submitted.provider).toEqual({
    order: ["OpenAI", "Amazon Bedrock", "Azure"],
    allow_fallbacks: false,
  });
});
it("keeps OpenRouter automatic provider routing for other models", async () => {
  const fetcher = vi.fn(
    async (_url: string, _options?: RequestInit) =>
      new Response(
        new ReadableStream({
          start(c) {
            const encoder = new TextEncoder();
            const line = JSON.stringify({
              type: "commit_revision",
              message: "Ready.",
            });
            c.enqueue(
              encoder.encode(
                "data: " +
                  JSON.stringify({ choices: [{ delta: { content: line } }] }) +
                  "\n\n",
              ),
            );
            c.enqueue(encoder.encode("data: [DONE]\n\n"));
            c.close();
          },
        }),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  await generateCommands({
    provider: "openrouter",
    model: "openai/gpt-6-astra",
    key: "test-key-not-real",
    prompt: "Hello",
    project: blankProject(),
    signal: new AbortController().signal,
  });
  const submitted = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(submitted.provider).toBeUndefined();
});
for (const provider of ["openrouter", "gateway"] as const) {
  it(`${provider} buffers fragments until a complete validated command arrives`, async () => {
    const encoder = new TextEncoder();
    const line = JSON.stringify({ type: "commit_revision", message: "Ready." });
    const fetcher = vi.fn(
      async (_url: string, _options?: RequestInit) =>
        new Response(
          new ReadableStream({
            start(c) {
              for (const fragment of [
                line.slice(0, 13),
                line.slice(13) + "\n",
              ]) {
                const data =
                  "data: " +
                  JSON.stringify({
                    choices: [{ delta: { content: fragment } }],
                  }) +
                  "\n\n";
                c.enqueue(encoder.encode(data.slice(0, 17)));
                c.enqueue(encoder.encode(data.slice(17)));
              }
              c.enqueue(encoder.encode("data: [DONE]\n\n"));
              c.close();
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const project = blankProject();
    project.messages = [{ role: "user", text: "Keep the garden pink" }];
    const stream = await generateCommands({
      provider,
      model: "openai/gpt-6-astra",
      key: "test-key-not-real",
      prompt: "Hello",
      project,
      signal: new AbortController().signal,
    });
    const text = await new Response(stream).text();
    expect(JSON.parse(text)).toEqual({
      type: "commit_revision",
      message: "Ready.",
    });
    expect(fetcher.mock.calls[0][0]).toContain(
      provider === "gateway" ? "ai-gateway.vercel.sh" : "openrouter.ai",
    );
    const submitted = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(submitted.model).toBe("openai/gpt-6-astra");
    expect(submitted.reasoning).toEqual({ effort: "low" });
    expect(
      JSON.parse(submitted.messages[1].content).recentConversation,
    ).toEqual(project.messages);
    expect(JSON.parse(submitted.messages[1].content).browserModeling).toBe(
      false,
    );
  });
}

for (const provider of ["openrouter", "gateway"] as const) {
  it.each([false, true])(
    `${provider} gates browser recipes by the advertised capability (%s)`,
    async (browserModeling) => {
      const commands = [
        {
          type: "reserve_entity",
          entity: {
            id: "browser-box",
            label: "Browser box",
            position: [0, 0, 0],
            scale: [1, 1, 1],
            color: "#6ead60",
            stage: "seed",
          },
        },
        {
          type: "set_geometry",
          id: "browser-box",
          geometry: {
            kind: "generated",
            detail: "refined",
            job: {
              backend: "browser-manifold",
              recipe: {
                version: 1,
                revision: 0,
                output: "box",
                nodes: [{ id: "box", kind: "box", size: [2, 2, 2] }],
              },
            },
          },
        },
        { type: "commit_revision", message: "Ready" },
      ];
      const encoder = new TextEncoder();
      const payload =
        commands.map((command) => JSON.stringify(command)).join("\n") + "\n";
      const fetcher = vi.fn(
        async (_url: string, _options?: RequestInit) =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ choices: [{ delta: { content: payload } }] })}\n\n`,
                  ),
                );
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
              },
            }),
          ),
      );
      vi.stubGlobal("fetch", fetcher);
      const stream = await generateCommands({
        provider,
        model: "catalog-model",
        key: "test-key",
        prompt: "Make a box",
        project: blankProject(),
        browserModeling,
        signal: new AbortController().signal,
      });
      const text = await new Response(stream).text();
      if (browserModeling) expect(text).toContain('"commit_revision"');
      else {
        expect(text).toContain("Browser modeling is unavailable");
        const records = text
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        expect(records[0]).toMatchObject({ type: "reserve_entity" });
        expect(records[1]).toMatchObject({
          code: "INVALID_SCENE_PROTOCOL",
          diagnostic: {
            operation: 2,
            issues: [],
            finishReason: null,
          },
        });
      }
      const request = JSON.parse(
        String((fetcher.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
      );
      expect(JSON.parse(request.messages[1].content).browserModeling).toBe(
        browserModeling,
      );
      expect(request.messages[0].content).toContain(
        browserModeling ? "browser-manifold" : "3D worlds",
      );
    },
  );
}

for (const provider of ["openrouter", "gateway"] as const) {
  it(`${provider} forwards browser modeling feedback to the model`, async () => {
    const feedback = {
      version: 1 as const,
      projectId: "project-a",
      entityId: "tree-0",
      backend: "browser-manifold" as const,
      nodeId: "compose",
      error:
        "[browser-modeling-kernel] node compose contains touching or overlapping solids.",
      recipe: {
        version: 1 as const,
        revision: 0,
        output: "box",
        nodes: [
          {
            id: "box",
            kind: "box" as const,
            size: [2, 2, 2] as [number, number, number],
          },
        ],
      },
    };
    const fetcher = vi.fn(
      async (_url: string, _options?: RequestInit) =>
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ type: "commit_revision", message: "Ready." }) + "\n" } }] })}\n\ndata: [DONE]\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const stream = await generateCommands({
      provider,
      model: "catalog-model",
      key: "test-key",
      prompt: "Fix the rejected shape",
      project: blankProject(),
      browserModeling: true,
      modelingFeedback: feedback,
      signal: new AbortController().signal,
    });
    await new Response(stream).text();
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(JSON.parse(request.messages[1].content).modelingFeedback).toEqual(
      feedback,
    );
  });
}

it("invalid generated operations fail closed without executing code", async () => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        "data: " +
          JSON.stringify({
            choices: [
              { delta: { content: '{"type":"eval","code":"alert(1)"}\n' } },
            ],
          }) +
          "\n\n",
      ),
  );
  const stream = await generateCommands({
    provider: "gateway",
    model: "catalog-model",
    key: "test-key",
    prompt: "Test",
    project: blankProject(),
    signal: new AbortController().signal,
  });
  expect(JSON.parse(await new Response(stream).text()).error).toContain(
    "invalid scene update",
  );
});

it("reports truncated generation after valid partial commands instead of claiming completion", async () => {
  const command = {
    type: "reserve_entity",
    entity: {
      id: "partial",
      label: "Unfinished tree",
      position: [0, 0, 0],
      scale: [1, 1, 1],
      color: "#88aa55",
      stage: "seed",
    },
  };
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        "data: " +
          JSON.stringify({
            choices: [
              {
                delta: { content: JSON.stringify(command) + "\n" },
                finish_reason: "length",
              },
            ],
          }) +
          "\n\n",
      ),
  );
  const stream = await generateCommands({
    provider: "gateway",
    model: "catalog-model",
    key: "test-key",
    prompt: "Test",
    project: blankProject(),
    signal: new AbortController().signal,
  });
  const records = (await new Response(stream).text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(records[0]).toEqual(command);
  expect(records[1].error).toContain("before committing");
  expect(records[1]).toMatchObject({
    code: "TRUNCATED_SCENE_STREAM",
    diagnostic: {
      operation: 1,
      issues: [],
      finishReason: "length",
    },
  });
});
