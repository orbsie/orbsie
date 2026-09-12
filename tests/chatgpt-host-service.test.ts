import { describe, expect, it, vi } from "vitest";
import {
  ChatGPTHostStaleError,
  createChatGPTHostService,
  type ChatGPTHostServiceDeps,
} from "../src/lib/server/chatgpt-host-service";

const identity = { ownerId: "owner-1", sessionId: "session-1" };
const artifactDigest = "d".repeat(64);
const future = () => new Date(Date.now() + 60_000);

function deps(overrides: Partial<ChatGPTHostServiceDeps> = {}) {
  return {
    read: vi.fn(() => null),
    claim: vi.fn(() => ({ attemptId: "attempt-1", expiresAt: future() })),
    complete: vi.fn(() => true),
    release: vi.fn(() => true),
    provision: vi.fn(async () => artifactDigest),
    destroy: vi.fn(async () => undefined),
    ...overrides,
  } satisfies ChatGPTHostServiceDeps;
}

describe("ChatGPT host service", () => {
  it("reuses a valid unexpired host without claiming or provisioning", async () => {
    const host = {
      attemptId: "attempt-1",
      sandboxName: "orbsie-chatgpt-attempt-1",
      capability: "a".repeat(64),
      expiresAt: future(),
      artifactDigest,
    };
    const d = deps({ read: vi.fn(() => host) });
    await expect(createChatGPTHostService(d).ensure(identity)).resolves.toBe(
      host,
    );
    expect(d.claim).not.toHaveBeenCalled();
    expect(d.provision).not.toHaveBeenCalled();
  });

  it("claims, provisions, then finalizes with a deterministic sandbox name", async () => {
    const order: string[] = [];
    const d = deps({
      provision: vi.fn(async (input) => {
        order.push("provision");
        expect(input.name).toBe("orbsie-chatgpt-attempt-1");
        expect(input.capability).toMatch(/^[a-f0-9]{64}$/);
        return artifactDigest;
      }),
      complete: vi.fn((owner, attempt, name, capability, digest) => {
        order.push("complete");
        expect(owner).toEqual(identity);
        expect(attempt).toBe("attempt-1");
        expect(name).toBe("orbsie-chatgpt-attempt-1");
        expect(capability).toMatch(/^[a-f0-9]{64}$/);
        expect(digest).toBe(artifactDigest);
        return true;
      }),
    });
    const host = await createChatGPTHostService(d).ensure(identity);
    expect(order).toEqual(["provision", "complete"]);
    expect(host.sandboxName).toBe("orbsie-chatgpt-attempt-1");
    expect(host.capability).toMatch(/^[a-f0-9]{64}$/);
    expect(d.destroy).not.toHaveBeenCalled();
  });

  it("reports claim conflicts without exposing provider details", async () => {
    const d = deps({ claim: vi.fn(() => null) });
    await expect(createChatGPTHostService(d).ensure(identity)).rejects.toThrow(
      "Another ChatGPT host attempt is already active.",
    );
    expect(d.provision).not.toHaveBeenCalled();
  });

  it("does not replace a host when the guarded read marks it stale", async () => {
    const d = deps({
      read: vi.fn(() => {
        throw new ChatGPTHostStaleError();
      }),
    });
    await expect(createChatGPTHostService(d).ensure(identity)).rejects.toThrow(
      "needs an update",
    );
    expect(d.claim).not.toHaveBeenCalled();
    expect(d.provision).not.toHaveBeenCalled();
  });

  it("destroys before releasing when provisioning fails", async () => {
    const order: string[] = [];
    const d = deps({
      provision: vi.fn(async () => {
        order.push("provision");
        throw Error("sandbox provider secret");
      }),
      destroy: vi.fn(async () => {
        order.push("destroy");
      }),
      release: vi.fn(() => {
        order.push("release");
        return true;
      }),
    });
    await expect(createChatGPTHostService(d).ensure(identity)).rejects.toThrow(
      "ChatGPT host could not be provisioned.",
    );
    expect(order).toEqual(["provision", "destroy", "release"]);
  });

  it("does not claim success when finalization is false", async () => {
    const d = deps({ complete: vi.fn(() => false) });
    await expect(createChatGPTHostService(d).ensure(identity)).rejects.toThrow(
      "ChatGPT host could not be finalized.",
    );
    expect(d.destroy).toHaveBeenCalledWith("orbsie-chatgpt-attempt-1");
    expect(d.release).toHaveBeenCalledWith(identity, "attempt-1");
  });

  it("retains the claim when destruction cannot be proven", async () => {
    const d = deps({
      provision: vi.fn(async () => {
        throw Error("provider failure");
      }),
      destroy: vi.fn(async () => {
        throw Error("provider diagnostic with capability");
      }),
    });
    await expect(createChatGPTHostService(d).ensure(identity)).rejects.toThrow(
      "ChatGPT host cleanup is pending.",
    );
    expect(d.release).not.toHaveBeenCalled();
  });

  it("disconnects a live host in destroy-then-release order", async () => {
    const order: string[] = [];
    const host = {
      attemptId: "attempt-1",
      sandboxName: "orbsie-chatgpt-attempt-1",
      capability: "b".repeat(64),
      expiresAt: future(),
      artifactDigest,
    };
    const d = deps({
      read: vi.fn(() => host),
      destroy: vi.fn(async () => {
        order.push("destroy");
      }),
      release: vi.fn(() => {
        order.push("release");
        return true;
      }),
    });
    await expect(
      createChatGPTHostService(d).disconnect(identity),
    ).resolves.toBe(true);
    expect(order).toEqual(["destroy", "release"]);
  });

  it("awaits asynchronous registry operations and rejects failed finalization", async () => {
    const d = deps({
      read: vi.fn(async () => null),
      claim: vi.fn(async () => ({
        attemptId: "async-attempt",
        expiresAt: future(),
      })),
      complete: vi.fn(async () => false),
      release: vi.fn(async () => true),
    });
    await expect(createChatGPTHostService(d).ensure(identity)).rejects.toThrow(
      "could not be finalized",
    );
    expect(d.destroy).toHaveBeenCalledWith("orbsie-chatgpt-async-attempt");
    expect(d.release).toHaveBeenCalledWith(identity, "async-attempt");
  });

  it("returns false when disconnect cleanup finds a stale registry attempt", async () => {
    const d = deps({
      read: vi.fn(async () => ({
        attemptId: "attempt-1",
        sandboxName: "orbsie-chatgpt-attempt-1",
        capability: "b".repeat(64),
        expiresAt: future(),
        artifactDigest,
      })),
      release: vi.fn(async () => false),
    });
    await expect(
      createChatGPTHostService(d).disconnect(identity),
    ).resolves.toBe(false);
  });

  it("allows disconnect to remove a legacy host without provenance", async () => {
    const d = deps({
      read: vi.fn(async () => ({
        attemptId: "attempt-1",
        sandboxName: "orbsie-chatgpt-attempt-1",
        capability: "b".repeat(64),
        expiresAt: future(),
        artifactDigest: null,
      })),
    });
    await expect(
      createChatGPTHostService(d).disconnect(identity),
    ).resolves.toBe(true);
    expect(d.destroy).toHaveBeenCalledWith("orbsie-chatgpt-attempt-1");
  });

  it("leaves expired hosts for later cleanup and does not release them", async () => {
    const host = {
      attemptId: "attempt-1",
      sandboxName: "orbsie-chatgpt-attempt-1",
      capability: "c".repeat(64),
      expiresAt: new Date(Date.now() - 1),
      artifactDigest,
    };
    const d = deps({ read: vi.fn(() => host) });
    await expect(
      createChatGPTHostService(d).disconnect(identity),
    ).resolves.toBe(false);
    expect(d.destroy).not.toHaveBeenCalled();
    expect(d.release).not.toHaveBeenCalled();
  });
});
