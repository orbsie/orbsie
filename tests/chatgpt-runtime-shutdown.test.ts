import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

type CredentialStore = {
  path: string;
  initialize(initialCache?: Uint8Array): Promise<void>;
  snapshot(): Promise<Uint8Array | null>;
};

const state = vi.hoisted(() => ({
  factory: undefined as ((directory: string) => CredentialStore) | undefined,
}));
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("../src/lib/server/chatgpt-managed-credential-store", async () => {
  const actual = await vi.importActual<
    typeof import("../src/lib/server/chatgpt-managed-credential-store")
  >("../src/lib/server/chatgpt-managed-credential-store");
  return {
    ...actual,
    createChatGPTManagedCredentialStore: (directory: string) =>
      state.factory?.(directory) ??
      actual.createChatGPTManagedCredentialStore(directory),
  };
});

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
            Buffer.from(
              JSON.stringify({
                id: message.id,
                result: { protocolVersion: 1 },
              }) + "\n",
            ),
          ),
        );
      return true;
    },
  });
  readonly stdout = new EventEmitter();
  readonly kills: string[] = [];

  kill(signal: string) {
    this.kills.push(signal);
    if (signal === "SIGKILL")
      queueMicrotask(() => this.emit("exit", null, signal));
    return true;
  }
}

describe("runtime shutdown with managed credential capture", () => {
  afterEach(() => {
    state.factory = undefined;
    spawnMock.mockReset();
    vi.useRealTimers();
  });

  it("escalates at the grace deadline while a credential snapshot is stalled", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    spawnMock.mockReturnValueOnce(child);
    let resolveSnapshot!: (value: Uint8Array | null) => void;
    const delayedSnapshot = new Promise<Uint8Array | null>((resolve) => {
      resolveSnapshot = resolve;
    });
    state.factory = (directory) => ({
      path: `${directory}/auth.json`,
      initialize: async () => undefined,
      snapshot: () => delayedSnapshot,
    });

    const runtime = await createIsolatedChatGPTRpc();
    const closing = runtime.close();
    expect(child.kills).toEqual(["SIGTERM"]);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
    await vi.advanceTimersByTimeAsync(1_000);
    await closing;

    resolveSnapshot(new TextEncoder().encode("late-cache"));
    await Promise.resolve();
    await expect(runtime.getCredentialSnapshot()).resolves.toBeNull();
  });
});
