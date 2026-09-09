import { describe, it, expect, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
import { createChatGPTSceneStream } from "../src/lib/server/chatgpt-scene-stream";
type Input = Parameters<
  Parameters<typeof createChatGPTSceneStream>[1]["generate"]
>[0];
const request = () => ({
  model: "gpt-5.6-luna",
  effort: "low",
  prompt: "Create an orb",
  project: blankProject(),
  browserModeling: true,
});
const commit = JSON.stringify({ type: "commit_revision", message: "Ready" });
const reserve = {
  type: "reserve_entity",
  entity: {
    id: "orb-1",
    label: "Orb",
    position: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#abcdef",
    stage: "seed",
  },
};
const output = (stream: ReadableStream<Uint8Array>) =>
  new Response(stream).text();
describe("hosted ChatGPT scene stream", () => {
  it("streams validated reservations early and withholds final commit until generation succeeds", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    const generator = {
      generate: vi.fn(async (i: Input) => {
        i.onText(JSON.stringify(reserve) + "\n" + commit + "\n");
        await gate;
      }),
    };
    const reader = createChatGPTSceneStream(request(), generator).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      '"reserve_entity"',
    );
    let resolved = false;
    const pending = reader.read().then((v) => {
      resolved = true;
      return v;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    finish();
    expect(new TextDecoder().decode((await pending).value)).toBe(commit + "\n");
    expect((await reader.read()).done).toBe(true);
    const input = generator.generate.mock.calls[0][0];
    expect(JSON.parse(input.input).localModeling).toBe(false);
    expect(input.model).toBe("gpt-5.6-luna");
  });
  it("never emits a pending final commit after provider failure", async () => {
    const result = await output(
      createChatGPTSceneStream(request(), {
        generate: async (i) => {
          i.onText(commit + "\n");
          throw Error("secret provider token");
        },
      }),
    );
    expect(result).toContain('"error":');
    expect(result).not.toContain('"commit_revision"');
    expect(result).not.toContain("secret");
  });
  it("rejects invalid scene commands and missing commits", async () => {
    for (const text of [
      '{"type":"execute_shell","command":"id"}',
      JSON.stringify(reserve),
    ]) {
      const result = await output(
        createChatGPTSceneStream(request(), {
          generate: async (i) => {
            i.onText(text);
          },
        }),
      );
      expect(result).toContain('"error":');
    }
  });
  it("rejects native modeling and nonexistent selection before invoking generation", () => {
    const generator = { generate: vi.fn() };
    expect(() =>
      createChatGPTSceneStream(
        { ...request(), localModeling: true },
        generator,
      ),
    ).toThrow();
    expect(() =>
      createChatGPTSceneStream(
        { ...request(), selected: "missing" },
        generator,
      ),
    ).toThrow();
    expect(generator.generate).not.toHaveBeenCalled();
  });
  it("cancels the model when the browser cancels its stream", async () => {
    let signal: AbortSignal | undefined;
    const stream = createChatGPTSceneStream(request(), {
      generate: async (i) => {
        signal = i.signal;
        await new Promise<void>((r) =>
          i.signal?.addEventListener("abort", () => r(), { once: true }),
        );
      },
    });
    await stream.cancel();
    expect(signal?.aborted).toBe(true);
  });
});
