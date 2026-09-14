import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const sdk = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn() }));
vi.mock("@vercel/sandbox", () => ({
  Sandbox: sdk,
  APIError: class extends Error {},
}));
import {
  computeChatGPTArtifactDigest,
  createChatGPTSandboxBackend,
} from "../src/lib/server/chatgpt-sandbox-backend";
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

test("routes private operations to explicit server-only paths", async () => {
  sdk.get.mockResolvedValue({
    status: "running",
    domain: () => "https://sb-example.vercel.run",
  });
  const fetch = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
  vi.stubGlobal("fetch", fetch);
  await backend.privateOperation(host, "loginSeal", {});
  expect(sdk.get).toHaveBeenCalledWith(
    expect.objectContaining({ name, resume: false }),
  );
  expect(fetch).toHaveBeenCalledWith(
    "https://sb-example.vercel.run/private/login/seal",
    expect.objectContaining({
      method: "POST",
      body: "{}",
      redirect: "error",
      headers: {
        authorization: "Bearer private-token",
        "content-type": "application/json",
      },
    }),
  );
});

test("bounds private control bodies before contacting a sandbox", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    backend.privateOperation(host, "status", {
      operationId: "x",
      epoch: 1,
      extra: "x".repeat(130 * 1024),
    }),
  ).rejects.toThrow("too large");
  await expect(
    backend.privateOperation(host, "status", undefined),
  ).rejects.toThrow("Invalid private operation request");
  expect(sdk.get).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
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

test("derives provenance from the exact traced host artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orbsie-chatgpt-artifact-"));
  try {
    const server = Buffer.from("server-v1");
    const packageJSON = Buffer.from('{"version":"1"}');
    await writeFile(join(directory, "server.mjs"), server);
    await writeFile(join(directory, "package.json"), packageJSON);
    const backend = createChatGPTSandboxBackend({
      artifactDirectory: directory,
    });
    const expected = computeChatGPTArtifactDigest([
      { path: "server.mjs", content: server },
      { path: "package.json", content: packageJSON },
    ]);
    await expect(backend.artifactDigest()).resolves.toBe(expected);
    await writeFile(join(directory, "server.mjs"), "server-v2");
    await expect(backend.artifactDigest()).resolves.not.toBe(expected);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("unrelated sandbox names cannot be fetched or deleted", async () => {
  await expect(backend.destroy("another-project")).rejects.toThrow("Invalid");
  expect(sdk.get).not.toHaveBeenCalled();
});

test("renews only a running sandbox and sends a positive timeout delta", async () => {
  let expiresAt = new Date(Date.now() + 60_000);
  const extendTimeout = vi.fn(async (delta: number) => {
    expiresAt = new Date(expiresAt.getTime() + delta);
  });
  const sandbox = {
    status: "running",
    get expiresAt() {
      return expiresAt;
    },
    currentSession: () => ({ extendTimeout }),
  };
  sdk.get.mockResolvedValue(sandbox);
  const target = new Date(Date.now() + 600_000);
  const renewed = await backend.renew(host, target);
  expect(renewed).toEqual(expiresAt);
  expect(extendTimeout).toHaveBeenCalledWith(
    expect.any(Number),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(extendTimeout.mock.calls[0][0]).toBeGreaterThan(0);
  expect(sdk.get).toHaveBeenCalledWith(
    expect.objectContaining({ name, resume: false }),
  );
});

test("does not extend a sandbox that already has verified headroom", async () => {
  const expiresAt = new Date(Date.now() + 600_000);
  const extendTimeout = vi.fn();
  sdk.get.mockResolvedValue({
    status: "running",
    expiresAt,
    currentSession: () => ({ extendTimeout }),
  });
  await expect(
    backend.renew(host, new Date(Date.now() + 120_000)),
  ).resolves.toEqual(expiresAt);
  expect(extendTimeout).not.toHaveBeenCalled();
});

test("rejects expired actual sandbox metadata before extending", async () => {
  const extendTimeout = vi.fn();
  sdk.get.mockResolvedValue({
    status: "running",
    expiresAt: new Date(Date.now() - 1),
    currentSession: () => ({ extendTimeout }),
  });
  await expect(
    backend.renew(host, new Date(Date.now() + 120_000)),
  ).rejects.toThrow("expired");
  expect(extendTimeout).not.toHaveBeenCalled();
});

test("rejects metadata that expires while the non-resuming lookup is pending", async () => {
  const base = Date.now();
  let clock = base;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const extendTimeout = vi.fn();
  sdk.get.mockImplementation(async () => {
    clock = base + 5_000;
    return {
      status: "running",
      expiresAt: new Date(base + 1_000),
      currentSession: () => ({ extendTimeout }),
    };
  });
  await expect(backend.renew(host, new Date(base + 120_000))).rejects.toThrow(
    "expired",
  );
  expect(extendTimeout).not.toHaveBeenCalled();
});

test("does not resume or hide a failed timeout extension", async () => {
  const extendTimeout = vi.fn(async () => {
    throw Error("provider extension failure");
  });
  sdk.get.mockResolvedValue({
    status: "running",
    expiresAt: new Date(Date.now() + 60_000),
    currentSession: () => ({ extendTimeout }),
  });
  await expect(
    backend.renew(host, new Date(Date.now() + 600_000)),
  ).rejects.toThrow("provider extension failure");
  expect(extendTimeout).toHaveBeenCalledOnce();
});
