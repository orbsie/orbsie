import { describe, it, expect } from "vitest";
import {
  CHATGPT_GENERATION_CONFIG,
  CHATGPT_READ_POLICY,
  validChatGPTGenerationRequest as valid,
} from "../src/lib/server/chatgpt-generation-policy";
const threads = new Set(["thread-1"]),
  turns = new Map([["thread-1", new Set(["turn-1"])]]);
const start = {
  model: "gpt-5.6-luna",
  serviceTier: "default",
  ephemeral: true,
  approvalPolicy: "never",
  sandbox: "read-only",
  baseInstructions: "Return scene commands.",
  config: CHATGPT_GENERATION_CONFIG,
};
const turn = {
  threadId: "thread-1",
  model: "gpt-5.6-luna",
  effort: "low",
  serviceTier: "default",
  input: [{ type: "text", text: "Create an orb" }],
  sandboxPolicy: CHATGPT_READ_POLICY,
  approvalPolicy: "never",
};
describe("hosted generation process policy", () => {
  it("accepts fixed regular-processing requests", () => {
    expect(valid("thread/start", start, threads, turns)).toBe(true);
    expect(valid("turn/start", turn, threads, turns)).toBe(true);
  });
  it("rejects tool or file-access overrides", () => {
    for (const overrides of [
      { config: {} },
      { config: { ...CHATGPT_GENERATION_CONFIG, "features.shell_tool": true } },
      { cwd: "/tmp" },
      { sandbox: "danger-full-access" },
      { serviceTier: "fast" },
    ])
      expect(
        valid("thread/start", { ...start, ...overrides }, threads, turns),
      ).toBe(false);
    expect(
      valid(
        "turn/start",
        {
          ...turn,
          sandboxPolicy: { type: "readOnly", access: { type: "fullAccess" } },
        },
        threads,
        turns,
      ),
    ).toBe(false);
    expect(valid("command/exec", { command: "id" }, threads, turns)).toBe(
      false,
    );
  });
  it("requires owned thread and turn IDs", () => {
    expect(
      valid("turn/start", { ...turn, threadId: "other" }, threads, turns),
    ).toBe(false);
    expect(
      valid(
        "turn/interrupt",
        { threadId: "thread-1", turnId: "turn-1" },
        threads,
        turns,
      ),
    ).toBe(true);
    expect(
      valid(
        "turn/interrupt",
        { threadId: "thread-1", turnId: "other" },
        threads,
        turns,
      ),
    ).toBe(false);
  });
  it("bounds input bytes and ephemeral threads", () => {
    expect(
      valid(
        "thread/start",
        { ...start, baseInstructions: "é".repeat(33000) },
        threads,
        turns,
      ),
    ).toBe(false);
    expect(
      valid(
        "turn/start",
        { ...turn, input: [{ type: "text", text: "x".repeat(262145) }] },
        threads,
        turns,
      ),
    ).toBe(false);
    expect(
      valid(
        "thread/start",
        start,
        new Set(Array.from({ length: 16 }, (_, i) => String(i))),
        turns,
      ),
    ).toBe(false);
  });
});
