import { afterEach, expect, test, vi } from "vitest";
const sdk = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn() }));
vi.mock("@vercel/sandbox", () => ({
  Sandbox: sdk,
  APIError: class extends Error {},
}));
import { createChatGPTSandboxBackend } from "../src/lib/server/chatgpt-sandbox-backend";
const name = "orbsie-chatgpt-11111111-1111-4111-8111-111111111111";
const host = {
  sandboxName: name,
  capability: "private-token",
  expiresAt: new Date(Date.now() + 600000),
};
const backend = createChatGPTSandboxBackend({
  artifactDirectory: "/missing-test-artifacts",
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("routes only to a running host without resuming its sandbox", async () => {
  sdk.get.mockResolvedValue({
    status: "running",
    domain: () => "https://sb-example.vercel.run",
  });
  const fetch = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  await backend.request(host, "status");
  expect(sdk.get).toHaveBeenCalledWith(
    expect.objectContaining({ name, resume: false }),
  );
  expect(fetch).toHaveBeenCalledWith(
    "https://sb-example.vercel.run/login/status",
    expect.objectContaining({
      method: "GET",
      redirect: "error",
      headers: { authorization: "Bearer private-token" },
    }),
  );
});
test("expired and stopped hosts do not receive a request", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    backend.request({ ...host, expiresAt: new Date(0) }, "start"),
  ).rejects.toThrow("expired");
  expect(sdk.get).not.toHaveBeenCalled();
  sdk.get.mockResolvedValue({ status: "stopped" });
  await expect(backend.request(host, "start")).rejects.toThrow("unavailable");
  expect(fetch).not.toHaveBeenCalled();
});
test("missing artifacts fail before creating a metered sandbox", async () => {
  await expect(
    backend.provision({
      name,
      capability: host.capability,
      expiresAt: host.expiresAt,
    }),
  ).rejects.toThrow();
  expect(sdk.create).not.toHaveBeenCalled();
});
test("unrelated sandbox names cannot be fetched or deleted", async () => {
  await expect(backend.destroy("another-project")).rejects.toThrow("Invalid");
  expect(sdk.get).not.toHaveBeenCalled();
});
