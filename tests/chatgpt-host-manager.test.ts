import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  expired: vi.fn(),
  sessionHost: vi.fn(),
  release: vi.fn(),
  destroy: vi.fn(),
  ensure: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("../src/lib/server/chatgpt-host-registry", () => ({
  readExpiredChatGPTHost: mocks.expired,
  readSessionChatGPTHost: mocks.sessionHost,
  releaseChatGPTHost: mocks.release,
  claimChatGPTHost: vi.fn(),
  completeChatGPTHost: vi.fn(),
  readChatGPTHost: vi.fn(),
}));
vi.mock("../src/lib/server/chatgpt-sandbox-backend", () => ({
  createChatGPTSandboxBackend: () => ({
    destroy: mocks.destroy,
    provision: vi.fn(),
    request: vi.fn(),
  }),
}));
vi.mock("../src/lib/server/chatgpt-host-service", () => ({
  createChatGPTHostService: () => ({
    ensure: mocks.ensure,
    disconnect: mocks.disconnect,
  }),
}));
import { createChatGPTHostManager } from "../src/lib/server/chatgpt-host-manager";
const identity = { ownerId: "owner", sessionId: "session" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.expired.mockResolvedValue({
    attemptId: "old",
    sandboxName: "orbsie-chatgpt-old",
  });
  mocks.release.mockResolvedValue(true);
});
test("expired host is destroyed and released before a new host is ensured", async () => {
  const events: string[] = [];
  mocks.destroy.mockImplementation(async () => {
    events.push("destroy");
  });
  mocks.release.mockImplementation(async () => {
    events.push("release");
    return true;
  });
  mocks.ensure.mockImplementation(async () => {
    events.push("ensure");
  });
  await createChatGPTHostManager({ artifactDirectory: "unused" }).ensure(
    identity,
  );
  expect(events).toEqual(["destroy", "release", "ensure"]);
  expect(mocks.release).toHaveBeenCalledWith(identity, "old");
});
test("failed deletion retains the expired claim and blocks provisioning", async () => {
  mocks.destroy.mockRejectedValue(Error("cleanup unavailable"));
  await expect(
    createChatGPTHostManager({ artifactDirectory: "unused" }).ensure(identity),
  ).rejects.toThrow();
  expect(mocks.release).not.toHaveBeenCalled();
  expect(mocks.ensure).not.toHaveBeenCalled();
});
test("disconnect cleans an expired host without reading its capability", async () => {
  await expect(
    createChatGPTHostManager({ artifactDirectory: "unused" }).disconnect(
      identity,
    ),
  ).resolves.toBe(true);
  expect(mocks.disconnect).not.toHaveBeenCalled();
});

test("session teardown destroys provisioning or expired runtime before releasing its claim", async () => {
  mocks.sessionHost.mockResolvedValue({
    attemptId: "pending",
    sandboxName: "orbsie-chatgpt-pending",
  });
  const events: string[] = [];
  mocks.destroy.mockImplementation(async () => {
    events.push("destroy");
  });
  mocks.release.mockImplementation(async () => {
    events.push("release");
    return true;
  });
  await expect(
    createChatGPTHostManager({ artifactDirectory: "unused" }).teardownSession(
      identity,
    ),
  ).resolves.toBe(true);
  expect(mocks.sessionHost).toHaveBeenCalledWith(identity);
  expect(mocks.destroy).toHaveBeenCalledWith("orbsie-chatgpt-pending");
  expect(mocks.release).toHaveBeenCalledWith(identity, "pending");
  expect(events).toEqual(["destroy", "release"]);
});
test("session teardown is a no-op without a host and retains metadata on API failure", async () => {
  mocks.sessionHost.mockResolvedValue(null);
  const manager = createChatGPTHostManager({ artifactDirectory: "unused" });
  await expect(manager.teardownSession(identity)).resolves.toBe(false);
  expect(mocks.destroy).not.toHaveBeenCalled();
  mocks.sessionHost.mockResolvedValue({
    attemptId: "pending",
    sandboxName: "orbsie-chatgpt-pending",
  });
  mocks.destroy.mockRejectedValue(Error("unavailable"));
  await expect(manager.teardownSession(identity)).rejects.toThrow(
    "unavailable",
  );
  expect(mocks.release).not.toHaveBeenCalled();
});
