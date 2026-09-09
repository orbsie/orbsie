import { EventEmitter } from "node:events";
import { access, rm, stat } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import {
  CHATGPT_GENERATION_CONFIG,
  CHATGPT_READ_POLICY,
} from "../src/lib/server/chatgpt-generation-policy";
import { createIsolatedChatGPTRpc } from "../src/lib/server/chatgpt-runtime";

class FakeChild extends EventEmitter {
  readonly stdin = Object.assign(new EventEmitter(), {
    writes: [] as string[],
    write: (value: string) => {
      this.stdin.writes.push(value);
      const message = JSON.parse(value);
      if (message.method === "initialize")
        queueMicrotask(() =>
          this.stdout.emit(
            "data",
            this.line({
              id: message.id,
              result: { protocolVersion: 1 },
            }),
          ),
        );
      return true;
    },
  });
  readonly stdout = new EventEmitter();
  readonly kills: string[] = [];
  autoExit = false;

  kill(signal: string) {
    this.kills.push(signal);
    if (this.autoExit || signal === "SIGKILL")
      queueMicrotask(() => this.emit("exit", null, signal));
    return true;
  }

  line(value: unknown) {
    return Buffer.from(JSON.stringify(value) + "\n");
  }
}

describe("isolated ChatGPT App Server runtime", () => {
  const live: Array<{ runtime: { close(): Promise<void> }; child: FakeChild }> =
    [];

  afterEach(async () => {
    for (const { runtime, child } of live.splice(0)) {
      const closing = runtime.close();
      child.emit("exit", 0, null);
      await closing;
    }
    spawnMock.mockReset();
  });

  async function start(autoExit = false, allowGeneration = false) {
    const child = new FakeChild();
    child.autoExit = autoExit;
    spawnMock.mockReturnValueOnce(child);
    const runtime = await createIsolatedChatGPTRpc({ allowGeneration });
    live.push({ runtime, child });
    const call = spawnMock.mock.calls.at(-1)!;
    return { runtime, child, spawnOptions: call[2] as Record<string, unknown> };
  }

  async function finish(runtime: { close(): Promise<void> }, child: FakeChild) {
    const closing = runtime.close();
    child.emit("exit", 0, null);
    await closing;
  }

  it("allows only bounded catalog requests and still rejects execution methods", async () => {
    const { runtime, child } = await start();
    await expect(
      runtime.request("model/list", { limit: 1000, includeHidden: true }),
    ).rejects.toThrow();
    await expect(
      runtime.request("command/exec", { command: "id" }),
    ).rejects.toThrow();
    const pending = runtime.request("model/list", {
      limit: 20,
      includeHidden: false,
    });
    const sent = JSON.parse(child.stdin.writes.at(-1)!);
    expect(sent.method).toBe("model/list");
    child.stdout.emit(
      "data",
      child.line({ id: sent.id, result: { data: [], nextCursor: null } }),
    );
    await expect(pending).resolves.toEqual({ data: [], nextCursor: null });
  });

  it("tracks owned generation IDs and forwards bounded runtime notifications", async () => {
    const { runtime, child } = await start(false, true);
    const notices: unknown[] = [];
    runtime.subscribe!((event) => notices.push(event));
    const thread = runtime.request("thread/start", {
      model: "gpt-5.6-luna",
      serviceTier: "default",
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "read-only",
      baseInstructions: "Return commands",
      config: CHATGPT_GENERATION_CONFIG,
    });
    let sent = JSON.parse(child.stdin.writes.at(-1)!);
    child.stdout.emit(
      "data",
      child.line({ id: sent.id, result: { thread: { id: "thread-1" } } }),
    );
    await thread;
    const params = {
      threadId: "thread-1",
      model: "gpt-5.6-luna",
      effort: "low",
      serviceTier: "default",
      input: [{ type: "text", text: "create" }],
      sandboxPolicy: CHATGPT_READ_POLICY,
      approvalPolicy: "never",
    };
    await expect(
      runtime.request("turn/start", { ...params, threadId: "other" }),
    ).rejects.toThrow();
    const turn = runtime.request("turn/start", params);
    sent = JSON.parse(child.stdin.writes.at(-1)!);
    child.stdout.emit(
      "data",
      child.line({ id: sent.id, result: { turn: { id: "turn-1" } } }),
    );
    await turn;
    const event = {
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", delta: "hello" },
    };
    child.stdout.emit("data", child.line(event));
    expect(notices).toEqual([event]);
    await expect(
      runtime.request("turn/interrupt", {
        threadId: "thread-1",
        turnId: "other",
      }),
    ).rejects.toThrow();
    const interrupt = runtime.request("turn/interrupt", {
      threadId: "thread-1",
      turnId: "turn-1",
    });
    sent = JSON.parse(child.stdin.writes.at(-1)!);
    child.stdout.emit("data", child.line({ id: sent.id, result: {} }));
    await interrupt;
    await finish(runtime, child);
    expect(notices.at(-1)).toEqual({
      method: "orbsie/runtime/closed",
      params: {},
    });
  });

  it("starts with a private cwd and an explicit environment and a dedicated CODEX_HOME", async () => {
    const { runtime, child, spawnOptions } = await start();
    const cwd = String(spawnOptions.cwd);
    const env = spawnOptions.env as Record<string, string>;
    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      ["app-server", "--stdio"],
      expect.objectContaining({ stdio: ["pipe", "pipe", "ignore"] }),
    );
    expect(Object.keys(env).sort()).toEqual(["CODEX_HOME", "NODE_ENV", "PATH"]);
    expect(env.PATH).toBe(process.env.PATH ?? "");
    expect(env.CODEX_HOME).toBe(`${cwd}/codex-home`);
    expect((await stat(cwd)).mode & 0o777).toBe(0o700);
    expect((await stat(env.CODEX_HOME)).mode & 0o777).toBe(0o700);
    const messages = child.stdin.writes.map((line) => JSON.parse(line));
    expect(messages.slice(0, 2)).toEqual([
      expect.objectContaining({
        method: "initialize",
        params: { clientInfo: { name: "orbsie", version: "0.1.0" } },
      }),
      { method: "initialized", params: {} },
    ]);
    await finish(runtime, child);
    await expect(access(cwd)).rejects.toThrow();
  });

  it("allows only auth operations and only the device login mode", async () => {
    const { runtime, child } = await start();
    await expect(runtime.request("thread/start")).rejects.toThrow(
      "operation is not supported",
    );
    await expect(
      runtime.request("account/login/start", { type: "chatgpt" }),
    ).rejects.toThrow("login mode is not supported");
    expect(child.stdin.writes).toHaveLength(2);
  });

  it("frames split UTF-8 responses and forwards completion notifications", async () => {
    const { runtime, child } = await start();
    const notifications: unknown[] = [];
    const unsubscribe = runtime.subscribe!((value) =>
      notifications.push(value),
    )!;
    const pending = runtime.request("account/read");
    const id = JSON.parse(child.stdin.writes.at(-1)!).id;
    const line = child.line({
      id,
      result: { account: { type: "chatgpt", label: "é" } },
    });
    child.stdout.emit("data", line.subarray(0, 4));
    child.stdout.emit("data", line.subarray(4));
    await expect(pending).resolves.toEqual({
      account: { type: "chatgpt", label: "é" },
    });
    child.stdout.emit(
      "data",
      child.line({
        method: "account/login/completed",
        params: { loginId: "login-1", success: true },
      }),
    );
    expect(notifications).toEqual([{ loginId: "login-1", success: true }]);
    unsubscribe();
    await finish(runtime, child);
  });

  it("redacts provider errors and rejects server initiated tool calls", async () => {
    const { runtime, child } = await start();
    const pending = runtime.request("account/read");
    const id = JSON.parse(child.stdin.writes.at(-1)!).id;
    child.stdout.emit(
      "data",
      child.line({ id, error: { code: 401, message: "access_token=secret" } }),
    );
    await expect(pending).rejects.toThrow("request failed");
    await expect(pending).rejects.not.toThrow("secret");
    child.stdout.emit(
      "data",
      child.line({
        id: 99,
        method: "item/commandExecution/request",
        params: { secret: "x" },
      }),
    );
    const response = JSON.parse(child.stdin.writes.at(-1)!);
    expect(response).toEqual({
      id: 99,
      error: { code: -32601, message: "Server requests are not supported." },
    });
  });

  it("bounds pending requests at sixteen and rejects malformed UTF-8", async () => {
    const { runtime, child } = await start();
    const pending = Array.from({ length: 16 }, () =>
      runtime.request("account/read"),
    );
    await expect(runtime.request("account/read")).rejects.toThrow("busy");
    child.stdout.emit("data", Buffer.from([0xc3, 0x28, 0x0a]));
    await expect(Promise.all(pending)).rejects.toThrow("invalid data");
  });

  it("cleans up startup failures and removes only the owned directory", async () => {
    const child = new FakeChild();
    child.autoExit = true;
    spawnMock.mockReturnValueOnce(child);
    child.stdin.write = (value: string) => {
      child.stdin.writes.push(value);
      const message = JSON.parse(value);
      if (message.method === "initialize")
        queueMicrotask(() =>
          child.stdout.emit(
            "data",
            child.line({
              id: message.id,
              error: { message: "developer credential leaked" },
            }),
          ),
        );
      return true;
    };
    await expect(createIsolatedChatGPTRpc()).rejects.toThrow("could not start");
    const cwd = String(spawnMock.mock.calls[0][2].cwd);
    await expect(access(cwd)).rejects.toThrow();
  });

  it("close is idempotent, rejects pending work, and waits for actual exit", async () => {
    const { runtime, child } = await start();
    const pending = runtime.request("account/read");
    const first = runtime.close();
    const second = runtime.close();
    expect(child.kills).toEqual(["SIGTERM"]);
    await expect(pending).rejects.toThrow("closed");
    let done = false;
    void first.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    child.emit("exit", 0, null);
    await first;
    await second;
    expect(child.kills).toEqual(["SIGTERM"]);
  });

  it("does not correlate a numeric server request as a client reply", async () => {
    const { runtime, child } = await start();
    const pending = runtime.request("account/read");
    const id = JSON.parse(child.stdin.writes.at(-1)!).id;
    child.stdout.emit(
      "data",
      child.line({ id, method: "tool/call", params: {} }),
    );
    expect(JSON.parse(child.stdin.writes.at(-1)!).error.code).toBe(-32601);
    child.stdout.emit("data", child.line({ id, result: { account: null } }));
    await expect(pending).resolves.toEqual({ account: null });
  });

  it("cleans a failed spawn without waiting for an exit event", async () => {
    const child = new FakeChild();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit("error", Error("ENOENT private path")));
      return child;
    });
    await expect(createIsolatedChatGPTRpc()).rejects.toThrow("could not start");
    await expect(
      access(String(spawnMock.mock.calls[0][2].cwd)),
    ).rejects.toThrow();
  });

  it("rejects null JSON and permanently closes on stdin errors", async () => {
    const first = await start(true);
    const pending = first.runtime.request("account/read");
    first.child.stdout.emit("data", first.child.line(null));
    await expect(pending).rejects.toThrow("invalid data");
    await first.runtime.close();
    const second = await start(true);
    second.child.stdin.emit("error", Error("EPIPE"));
    await expect(second.runtime.request("account/read")).rejects.toThrow(
      "closed",
    );
    await second.runtime.close();
  });

  it("disposes the runtime when an RPC times out", async () => {
    const { runtime, child, spawnOptions } = await start(true);
    vi.useFakeTimers();
    try {
      const pending = runtime.request("account/read");
      const rejected = expect(pending).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;
      await runtime.close();
      expect(child.kills).toContain("SIGTERM");
      await expect(runtime.request("account/read")).rejects.toThrow("closed");
      await expect(access(String(spawnOptions.cwd))).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
