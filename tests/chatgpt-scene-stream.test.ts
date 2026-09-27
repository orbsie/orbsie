import { describe, it, expect, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
import { createChatGPTSceneStream } from "../src/lib/server/chatgpt-scene-stream";
import { createGenerationObservation } from "../src/lib/server/generation-observability";
import { generationFeedbackForFailure } from "../src/lib/generation-feedback";
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
const reserveSecond = {
  ...reserve,
  entity: { ...reserve.entity, id: "orb-2", label: "Second orb" },
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
    expect(input.instructions).toContain(
      "Lathe profile heights are part-local Y",
    );
    expect(input.model).toBe("gpt-5.6-luna");
  });
  it("records completed hosted generation before local cleanup", async () => {
    const events: unknown[] = [];
    const observation = createGenerationObservation({
      layer: "provider",
      requestId: "11111111-1111-4111-8111-111111111111",
      provider: "chatgpt",
      admittedModel: "gpt-5.6-luna",
      sink: (event) => events.push(event),
    });
    const result = await output(
      createChatGPTSceneStream(
        request(),
        {
          generate: async (i) => i.onText(`${commit}\n`),
        },
        undefined,
        { observability: observation },
      ),
    );
    expect(result).toContain("commit_revision");
    expect(
      events.filter(
        (event) => (event as Record<string, unknown>).event === "terminal",
      ),
    ).toEqual([expect.objectContaining({ terminalReason: "completed" })]);
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
  it("rejects a valid command after a pending commit without emitting the commit", async () => {
    const result = await output(
      createChatGPTSceneStream(request(), {
        generate: async (i) => {
          i.onText(
            `${JSON.stringify(reserve)}\n${commit}\n${JSON.stringify(reserveSecond)}\n`,
          );
        },
      }),
    );
    expect(result).toContain('"reserve_entity"');
    expect(result).toContain('"error":');
    expect(result).not.toContain('"commit_revision"');
    expect(result).not.toContain('"orb-2"');
  });
  it.each([
    ["malformed command after commit", "not-json", "INVALID_SCENE_JSON"],
    ["duplicate commit", `${commit}\n`, "INVALID_SCENE_PROTOCOL"],
  ])(
    "rejects %s without emitting the pending commit",
    async (_label, extra, code) => {
      const result = await output(
        createChatGPTSceneStream(request(), {
          generate: async (i) => {
            i.onText(`${commit}\n${extra}`);
          },
        }),
      );
      expect(result).toContain('"error":');
      expect(result).toContain(`"code":"${code}"`);
      expect(result).not.toContain('"commit_revision"');
    },
  );
  it("forwards bounded browser modeling feedback to hosted ChatGPT", async () => {
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
    let input: Input | undefined;
    const result = await output(
      createChatGPTSceneStream(
        { ...request(), modelingFeedback: feedback },
        {
          generate: async (value) => {
            input = value;
            value.onText(commit + "\n");
          },
        },
      ),
    );
    expect(result).toContain('"commit_revision"');
    expect(JSON.parse(input!.input).modelingFeedback).toEqual(feedback);
  });
  it("forwards safe generation feedback as a correction instruction", async () => {
    const project = blankProject();
    let input: Input | undefined;
    const result = await output(
      createChatGPTSceneStream(
        {
          ...request(),
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
        },
        {
          generate: async (value) => {
            input = value;
            value.onText(commit + "\n");
          },
        },
      ),
    );
    expect(result).toContain('"commit_revision"');
    expect(input?.instructions).toContain("INVALID_SCENE_UPDATE");
    expect(input?.instructions).toContain("unreachable_recipe_node");
    expect(input?.input).not.toContain("generationFeedback");
  });
  it("turns a hosted validation failure into safe feedback for an explicit retry", async () => {
    const project = blankProject();
    const failed = JSON.parse(
      await output(
        createChatGPTSceneStream(
          { ...request(), project },
          {
            generate: async (value) => {
              value.onText(
                JSON.stringify({
                  type: "execute_shell",
                  command: "private-secret",
                }),
              );
            },
          },
        ),
      ),
    );
    expect(failed.code).toBe("INVALID_SCENE_UPDATE");
    expect(failed.diagnostic).toBeDefined();
    expect(failed.diagnostic.stage).toBe("stream");
    expect(failed.diagnostic.reason).toBe("callback-validation");
    expect(JSON.stringify(failed)).not.toContain("private-secret");

    const feedback = generationFeedbackForFailure(project.id, failed);
    expect(feedback).toBeDefined();
    let retryInput: Input | undefined;
    const retried = await output(
      createChatGPTSceneStream(
        { ...request(), project, generationFeedback: feedback },
        {
          generate: async (value) => {
            retryInput = value;
            value.onText(commit + "\n");
          },
        },
      ),
    );
    expect(retried).toContain('"commit_revision"');
    expect(retryInput?.instructions).toContain("INVALID_SCENE_UPDATE");
    expect(retryInput?.input).not.toContain("generationFeedback");
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

  it("marks missing commit as safe stream validation without leaking command text", async () => {
    const result = await output(
      createChatGPTSceneStream(request(), {
        generate: async (i) => {
          i.onText(JSON.stringify(reserve));
        },
      }),
    );
    const failed = JSON.parse(result.split("\n").at(-2)!);
    expect(failed).toMatchObject({
      code: "INVALID_SCENE_PROTOCOL",
      diagnostic: {
        stage: "stream",
        reason: "callback-validation",
      },
    });
    expect(result).not.toContain("access_token");
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
