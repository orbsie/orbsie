import { afterEach, describe, expect, it, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
import {
  MAX_REVIEW_IMAGE_BYTES,
  validateReviewImageDataUrl,
  validateSceneReviewImage,
  ReviewImageValidationError,
  UnsupportedReviewImageError,
} from "../src/lib/review-image";
import { generateCommands } from "../src/lib/server/generation";
import { createChatGPTGeneration } from "../src/lib/server/chatgpt-generation";
import { createChatGPTSceneStream } from "../src/lib/server/chatgpt-scene-stream";
import {
  CHATGPT_GENERATION_CONFIG,
  CHATGPT_READ_POLICY,
  validChatGPTGenerationRequest,
} from "../src/lib/server/chatgpt-generation-policy";

const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const capture = {
  projectId: "project",
  revision: 0,
  renderer: "webgl" as const,
  width: 1,
  height: 1,
  image,
};

const imageCapability = {
  text: { supported: true as const, source: "catalog" as const },
  streamingText: {
    supported: true as const,
    source: "provider-contract" as const,
  },
  tools: { supported: false as const, source: "catalog" as const },
  structuredOutput: {
    supported: false as const,
    source: "catalog" as const,
  },
  imageInput: { supported: true as const, source: "catalog" as const },
};

function response() {
  const command = JSON.stringify({
    type: "commit_revision",
    message: "Reviewed.",
  });
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: `${command}\n` } }] })}\n\ndata: [DONE]\n\n`,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("scene review image validation", () => {
  it("validates a bounded PNG and binds it to the requested project revision", () => {
    expect(validateSceneReviewImage(capture, capture)).toEqual(capture);
    expect(validateReviewImageDataUrl(image)).toEqual({
      width: 1,
      height: 1,
      byteLength: image.length,
    });
  });

  it("rejects stale identity, mismatched dimensions, extra fields and non-PNG data", () => {
    expect(() =>
      validateSceneReviewImage(capture, { projectId: "other", revision: 0 }),
    ).toThrowError(ReviewImageValidationError);
    expect(() => validateSceneReviewImage({ ...capture, width: 2 })).toThrow(
      "dimensions do not match",
    );
    expect(() => validateSceneReviewImage({ ...capture, extra: true })).toThrow(
      "metadata is invalid",
    );
    for (const value of [
      "https://example.test/image.png",
      "data:image/jpeg;base64,AAAA",
      `${image} `,
      `data:image/png;base64,${"A".repeat(MAX_REVIEW_IMAGE_BYTES)}`,
    ])
      expect(() => validateReviewImageDataUrl(value)).toThrow();
  });

  it("rejects incomplete or malformed PNG structure", () => {
    const bytes = Uint8Array.from(
      atob(image.slice("data:image/png;base64,".length)),
      (char) => char.charCodeAt(0),
    );
    const malformed = `data:image/png;base64,${btoa(
      String.fromCharCode(...bytes.slice(0, 33)),
    )}`;
    expect(() => validateReviewImageDataUrl(malformed)).toThrow();

    const badFormat = new Uint8Array(bytes);
    badFormat[24] = 3;
    const encoded = btoa(String.fromCharCode(...badFormat));
    expect(() =>
      validateReviewImageDataUrl(`data:image/png;base64,${encoded}`),
    ).toThrow();
  });
});

describe("provider image transport", () => {
  it.each(["openrouter", "gateway"] as const)(
    "preserves text-only content while appending the exact bounded image item for %s",
    async (provider) => {
      const fetcher = vi.fn<typeof fetch>(async () => response());
      vi.stubGlobal("fetch", fetcher);
      const project = blankProject();
      const boundCapture = {
        ...capture,
        projectId: project.id,
        revision: project.revision,
      };
      await generateCommands({
        provider,
        model: "catalog-model",
        key: "test-key",
        prompt: "Review this world",
        project,
        signal: new AbortController().signal,
        reviewImage: boundCapture,
        capabilities: imageCapability,
      });
      const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
      expect(request.messages[1].content).toEqual([
        {
          type: "text",
          text: expect.any(String),
        },
        { type: "image_url", image_url: { url: image } },
      ]);
      expect(JSON.parse(request.messages[1].content[0].text).instruction).toBe(
        "Review this world",
      );

      await generateCommands({
        provider,
        model: "catalog-model",
        key: "test-key",
        prompt: "Text only",
        project,
        signal: new AbortController().signal,
      });
      const textOnly = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
      expect(typeof textOnly.messages[1].content).toBe("string");
    },
  );

  it("rejects stale, false or unknown capability before contacting the provider", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response());
    vi.stubGlobal("fetch", fetcher);
    const project = blankProject();
    const boundCapture = {
      ...capture,
      projectId: project.id,
      revision: project.revision,
    };
    await expect(
      generateCommands({
        provider: "gateway",
        model: "catalog-model",
        key: "test-key",
        prompt: "Review",
        project,
        signal: new AbortController().signal,
        reviewImage: { ...capture, projectId: "stale" },
        capabilities: imageCapability,
      }),
    ).rejects.toMatchObject({ code: "identity-mismatch" });
    for (const capability of [
      undefined,
      { supported: false as const, source: "catalog" as const },
      { supported: "unknown" as const, source: "unspecified" as const },
    ])
      await expect(
        generateCommands({
          provider: "gateway",
          model: "catalog-model",
          key: "test-key",
          prompt: "Review",
          project,
          signal: new AbortController().signal,
          reviewImage: boundCapture,
          capabilities: capability
            ? { ...imageCapability, imageInput: capability }
            : undefined,
        }),
      ).rejects.toBeInstanceOf(UnsupportedReviewImageError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("trusted hosted scene-stream image option", () => {
  it("binds the optional image to the stream project revision before forwarding it", async () => {
    const project = blankProject();
    const boundCapture = {
      ...capture,
      projectId: project.id,
      revision: project.revision,
    };
    const generate = vi.fn(async (input: { onText(value: string): void }) => {
      input.onText(
        JSON.stringify({ type: "commit_revision", message: "Reviewed." }) +
          "\n",
      );
    });
    const stream = createChatGPTSceneStream(
      {
        model: "gpt-5.6-luna",
        effort: "low",
        prompt: "Review this world",
        project,
        browserModeling: false,
      },
      { generate },
      undefined,
      { reviewImage: boundCapture },
    );
    await new Response(stream).text();
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ reviewImage: boundCapture }),
    );
  });

  it("rejects an image from another project before creating a stream", () => {
    const project = blankProject();
    expect(() =>
      createChatGPTSceneStream(
        {
          model: "gpt-5.6-luna",
          effort: "low",
          prompt: "Review this world",
          project,
          browserModeling: false,
        },
        { generate: vi.fn() },
        undefined,
        { reviewImage: { ...capture, projectId: "other" } },
      ),
    ).toThrow("another project");
  });
});

describe("hosted process policy image shape", () => {
  const threads = new Set(["thread-1"]);
  const turns = new Map<string, Set<string>>([
    ["thread-1", new Set<string>(["turn-1"])],
  ]);
  const base = {
    threadId: "thread-1",
    model: "gpt-5.6-luna",
    effort: "low",
    serviceTier: "default",
    sandboxPolicy: CHATGPT_READ_POLICY,
    approvalPolicy: "never",
  };

  it("accepts exactly text or text followed by one validated image", () => {
    expect(
      validChatGPTGenerationRequest(
        "turn/start",
        { ...base, input: [{ type: "text", text: "Review" }] },
        threads,
        turns,
      ),
    ).toBe(true);
    expect(
      validChatGPTGenerationRequest(
        "turn/start",
        {
          ...base,
          input: [
            { type: "text", text: "Review" },
            { type: "image", url: image },
          ],
        },
        threads,
        turns,
      ),
    ).toBe(true);
    // The raw UTF-8 text-only byte limit remains independent of optional JSON
    // image framing.
    expect(
      validChatGPTGenerationRequest(
        "turn/start",
        { ...base, input: [{ type: "text", text: "é".repeat(131072) }] },
        threads,
        turns,
      ),
    ).toBe(true);
  });

  it("rejects image-only, extra entries, overrides, malformed image and oversized aggregate input", () => {
    const valid = {
      ...base,
      input: [
        { type: "text", text: "Review" },
        { type: "image", url: image },
      ],
    };
    for (const input of [
      [{ type: "image", url: image }],
      [...valid.input, { type: "image", url: image }],
      [
        { type: "text", text: "Review" },
        { type: "image", url: "https://example.test/image.png" },
      ],
    ])
      expect(
        validChatGPTGenerationRequest(
          "turn/start",
          { ...base, input },
          threads,
          turns,
        ),
      ).toBe(false);
    expect(
      validChatGPTGenerationRequest(
        "turn/start",
        {
          ...valid,
          input: valid.input.map((item) => ({ ...item, extra: true })),
        },
        threads,
        turns,
      ),
    ).toBe(false);
    expect(
      validChatGPTGenerationRequest(
        "turn/start",
        {
          ...valid,
          input: [
            { type: "text", text: "x".repeat(256 * 1024) },
            { type: "image", url: image },
          ],
        },
        threads,
        turns,
      ),
    ).toBe(false);
  });

  it("keeps the fixed thread policy alongside image input", () => {
    expect(CHATGPT_GENERATION_CONFIG["features.shell_tool"]).toBe(false);
  });
});

describe("hosted image transport", () => {
  it("sends text first and the capture URL second after explicit catalog capability", async () => {
    const listeners = new Set<(event: unknown) => void>();
    const calls: Array<{ method: string; params?: unknown }> = [];
    const rpc = {
      request: vi.fn(async (method: string, params?: unknown) => {
        calls.push({ method, params });
        if (method === "thread/start") return { thread: { id: "thread-1" } };
        if (method === "turn/start") return { turn: { id: "turn-1" } };
        return {};
      }),
      subscribe(listener: (event: unknown) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const generation = createChatGPTGeneration({
      rpc,
      models: async () => [
        {
          id: "catalog-1",
          model: "gpt-5.6-luna",
          displayName: "Luna",
          supportedReasoningEfforts: ["low"],
          defaultReasoningEffort: "low",
          inputModalities: ["text", "image"],
        },
      ],
      dispose: async () => undefined,
    });
    const projectCapture = { ...capture, projectId: "project" };
    const run = generation.generate({
      model: "gpt-5.6-luna",
      effort: "low",
      instructions: "Return scene commands.",
      input: "Review this world.",
      reviewImage: projectCapture,
      onText: () => undefined,
    });
    for (let index = 0; index < 40; index++) await Promise.resolve();
    const turn = calls.find((call) => call.method === "turn/start");
    expect(turn?.params).toMatchObject({
      input: [
        { type: "text", text: "Review this world." },
        { type: "image", url: image },
      ],
      serviceTier: "default",
      sandboxPolicy: CHATGPT_READ_POLICY,
      approvalPolicy: "never",
    });
    for (const listener of listeners)
      listener({
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: { id: "turn-1", status: "completed" },
        },
      });
    await run;
  });

  it("preserves the existing raw text-only limit when JSON escaping expands the request", async () => {
    const listeners = new Set<(event: unknown) => void>();
    const calls: Array<{ method: string; params?: unknown }> = [];
    const rpc = {
      request: vi.fn(async (method: string, params?: unknown) => {
        calls.push({ method, params });
        if (method === "thread/start") return { thread: { id: "thread-1" } };
        if (method === "turn/start") return { turn: { id: "turn-1" } };
        return {};
      }),
      subscribe(listener: (event: unknown) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const generation = createChatGPTGeneration({
      rpc,
      models: async () => [
        {
          id: "catalog-1",
          model: "gpt-5.6-luna",
          displayName: "Luna",
          supportedReasoningEfforts: ["low"],
          defaultReasoningEffort: "low",
        },
      ],
      dispose: async () => undefined,
    });
    const rawText = "\\".repeat(131000);
    const run = generation.generate({
      model: "gpt-5.6-luna",
      effort: "low",
      instructions: "Return scene commands.",
      input: rawText,
      onText: () => undefined,
    });
    for (let index = 0; index < 40; index++) await Promise.resolve();
    const turn = calls.find((call) => call.method === "turn/start");
    expect(turn?.params).toMatchObject({
      input: [{ type: "text", text: rawText }],
    });
    for (const listener of listeners)
      listener({
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: { id: "turn-1", status: "completed" },
        },
      });
    await run;
  });

  it.each([undefined, ["text"]] as const)(
    "returns a typed unsupported-image outcome for %s catalog support",
    async (inputModalities) => {
      const rpc = {
        request: vi.fn(async (method: string) =>
          method === "thread/start"
            ? { thread: { id: "thread-1" } }
            : { turn: { id: "turn-1" } },
        ),
        subscribe: () => () => undefined,
      };
      const generation = createChatGPTGeneration({
        rpc,
        models: async () => [
          {
            id: "catalog-1",
            model: "gpt-5.6-luna",
            displayName: "Luna",
            supportedReasoningEfforts: ["low"],
            defaultReasoningEffort: "low",
            ...(inputModalities
              ? { inputModalities: [...inputModalities] }
              : {}),
          },
        ],
        dispose: async () => undefined,
      });
      await expect(
        generation.generate({
          model: "gpt-5.6-luna",
          effort: "low",
          instructions: "Return scene commands.",
          input: "Review this world.",
          reviewImage: capture,
          onText: () => undefined,
        }),
      ).rejects.toMatchObject({
        name: "ChatGPTGenerationError",
        reason: "image-unsupported",
      });
    },
  );

  it("honors cancellation before image transport without catalog or RPC work", async () => {
    const controller = new AbortController();
    controller.abort();
    const models = vi.fn(async () => [
      {
        id: "catalog-1",
        model: "gpt-5.6-luna",
        displayName: "Luna",
        supportedReasoningEfforts: ["low"],
        defaultReasoningEffort: "low",
        inputModalities: ["text", "image"],
      },
    ]);
    const rpc = { request: vi.fn(), subscribe: () => () => undefined };
    await expect(
      createChatGPTGeneration({
        rpc,
        models,
        dispose: async () => undefined,
      }).generate({
        model: "gpt-5.6-luna",
        effort: "low",
        instructions: "Return scene commands.",
        input: "Review this world.",
        reviewImage: capture,
        signal: controller.signal,
        onText: () => undefined,
      }),
    ).rejects.toThrow("canceled");
    expect(models).not.toHaveBeenCalled();
    expect(rpc.request).not.toHaveBeenCalled();
  });

  it("classifies malformed capture input without exposing its contents", async () => {
    const generation = createChatGPTGeneration({
      rpc: {
        request: vi.fn(),
        subscribe: () => () => undefined,
      },
      models: async () => [],
      dispose: async () => undefined,
    });
    const secretImage = "https://private.example/review.png";
    const error = await generation
      .generate({
        model: "gpt-5.6-luna",
        effort: "low",
        instructions: "Return scene commands.",
        input: "Review this world.",
        reviewImage: { ...capture, image: secretImage } as never,
        onText: () => undefined,
      })
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      name: "ChatGPTGenerationError",
      reason: "invalid-input",
    });
    expect(JSON.stringify(error)).not.toContain(secretImage);
  });
});
