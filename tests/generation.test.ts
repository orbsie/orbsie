import { it, expect, vi, afterEach } from "vitest";
import { generateCommands } from "../src/lib/server/generation";
import { blankProject } from "../src/lib/protocol";
afterEach(() => vi.unstubAllGlobals());
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
    const stream = await generateCommands({
      provider,
      model: "openai/gpt-6-astra",
      key: "test-key-not-real",
      prompt: "Hello",
      project: blankProject(),
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
});
