import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  GeneratedModel,
  GeneratedModelMetadata,
} from "../src/lib/generated-models";

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(async () => "test-oidc-token"),
}));

const transport = vi.fn();

function triangleGlb(): Uint8Array {
  const document = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const binary = new Uint8Array(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer,
  );
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(28 + jsonLength + binary.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + jsonLength);
  bytes.set(json, 20);
  view.setUint32(20 + jsonLength, binary.length, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  bytes.set(binary, 28 + jsonLength);
  return bytes;
}

function model(): GeneratedModel {
  const glb = triangleGlb();
  const sha256 = createHash("sha256").update(glb).digest("hex");
  const metadata: GeneratedModelMetadata = {
    version: 1,
    sha256,
    bytes: glb.byteLength,
    source: "local-blender",
    blenderVersion: "4.0.2",
    bounds: { min: [0, 0, 0], max: [1, 1, 0] },
    createdAt: "2026-09-07T00:00:00.000Z",
  };
  return { metadata, glb };
}

function responseBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function loadStorage(configured = true) {
  vi.resetModules();
  vi.stubEnv("GCS_BUCKET", configured ? "test-bucket" : "");
  vi.stubEnv(
    "GCP_WORKLOAD_IDENTITY_PROVIDER",
    configured ? "test-audience" : "",
  );
  return import("../src/lib/server/generated-storage");
}

beforeEach(() => {
  vi.stubGlobal("fetch", transport);
  transport.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("reports configuration and rejects missing owners without network access", async () => {
  const disabled = await loadStorage(false);
  expect(disabled.cloudGeneratedModelsEnabled()).toBe(false);
  await expect(
    disabled.writeCloudGeneratedModel("owner", model()),
  ).rejects.toMatchObject({ status: 503 });
  expect(transport).not.toHaveBeenCalled();

  const enabled = await loadStorage(true);
  expect(enabled.cloudGeneratedModelsEnabled()).toBe(true);
  await expect(
    enabled.writeCloudGeneratedModel("", model()),
  ).rejects.toMatchObject({ status: 400 });
  expect(transport).not.toHaveBeenCalled();
});

it("writes create-only owner-isolated objects after validating bytes and metadata", async () => {
  const storage = await loadStorage();
  const value = model();
  transport.mockImplementation(async (url: string) =>
    url.includes("sts.googleapis.com")
      ? Response.json({ access_token: "test-access" })
      : Response.json({ generation: "123" }),
  );
  await storage.writeCloudGeneratedModel("owner-a", value);
  await storage.writeCloudGeneratedModel("owner-b", value);
  const uploadCalls = transport.mock.calls.filter(([url]) =>
    String(url).includes("/upload/storage/v1/"),
  );
  expect(uploadCalls).toHaveLength(2);
  const firstUrl = new URL(uploadCalls[0][0]);
  const secondUrl = new URL(uploadCalls[1][0]);
  expect(firstUrl.searchParams.get("uploadType")).toBe("media");
  expect(firstUrl.searchParams.get("ifGenerationMatch")).toBe("0");
  expect(firstUrl.searchParams.get("name")).toMatch(
    /^generated\/[a-f0-9]{64}\/[a-f0-9]{64}\.glb$/,
  );
  expect(firstUrl.searchParams.get("name")).toBe(
    `generated/${createHash("sha256").update("owner-a").digest("hex")}/${value.metadata.sha256}.glb`,
  );
  expect(firstUrl.searchParams.get("name")).not.toBe(
    secondUrl.searchParams.get("name"),
  );
  expect(uploadCalls[0][1].headers.Authorization).toBe("Bearer test-access");
  expect(
    new Uint8Array(await new Response(uploadCalls[0][1].body).arrayBuffer()),
  ).toEqual(value.glb);
});

it("sanitizes auth failures and rejects invalid model bytes before STS", async () => {
  const storage = await loadStorage();
  const value = model();
  transport.mockResolvedValue(
    Response.json({ error: "denied" }, { status: 403 }),
  );
  await expect(
    storage.writeCloudGeneratedModel("owner", value),
  ).rejects.toMatchObject({ status: 502 });
  expect(transport).toHaveBeenCalledTimes(1);
  transport.mockReset();
  const bad = { ...value, glb: new Uint8Array(value.glb) };
  bad.glb[bad.glb.length - 1] ^= 1;
  await expect(
    storage.writeCloudGeneratedModel("owner", bad),
  ).rejects.toMatchObject({ status: 400 });
  expect(transport).not.toHaveBeenCalled();
});

it("reads bounded bytes and validates metadata, digest, and GLB", async () => {
  const storage = await loadStorage();
  const value = model();
  transport.mockImplementation(async (url: string) =>
    url.includes("sts.googleapis.com")
      ? Response.json({ access_token: "test-access" })
      : new Response(responseBytes(value.glb), { status: 200 }),
  );
  const restored = await storage.readCloudGeneratedModel(
    "owner",
    value.metadata,
  );
  expect(restored.metadata).toEqual(value.metadata);
  expect(restored.glb).toEqual(value.glb);
  const readUrl = new URL(transport.mock.calls[1][0]);
  expect(readUrl.searchParams.get("alt")).toBe("media");

  transport.mockReset();
  transport.mockImplementation(async (url: string) =>
    url.includes("sts.googleapis.com")
      ? Response.json({ access_token: "test-access" })
      : new Response(responseBytes(new Uint8Array(value.glb).fill(0)), {
          status: 200,
        }),
  );
  await expect(
    storage.readCloudGeneratedModel("owner", value.metadata),
  ).rejects.toMatchObject({ status: 502 });
});

it("rejects oversized cloud responses before reading or allocating the body", async () => {
  const storage = await loadStorage();
  const value = model();
  transport.mockImplementation(async (url: string) =>
    url.includes("sts.googleapis.com")
      ? Response.json({ access_token: "test-access" })
      : new Response(null, {
          status: 200,
          headers: { "content-length": String(2 * 1024 * 1024 + 1) },
        }),
  );
  await expect(
    storage.readCloudGeneratedModel("owner", value.metadata),
  ).rejects.toMatchObject({ status: 502 });
});

it("verifies the existing immutable bytes after a create-only conflict", async () => {
  const storage = await loadStorage();
  const value = model();
  let readExisting = false;
  transport.mockImplementation(async (url: string) => {
    if (url.includes("sts.googleapis.com"))
      return Response.json({ access_token: "test-access" });
    if (!readExisting) {
      readExisting = true;
      return new Response(null, { status: 412 });
    }
    return new Response(responseBytes(value.glb), { status: 200 });
  });
  await expect(
    storage.writeCloudGeneratedModel("owner", value),
  ).resolves.toBeUndefined();
  expect(transport).toHaveBeenCalledTimes(3);

  transport.mockReset();
  readExisting = false;
  transport.mockImplementation(async (url: string) => {
    if (url.includes("sts.googleapis.com"))
      return Response.json({ access_token: "test-access" });
    if (!readExisting) {
      readExisting = true;
      return new Response(null, { status: 412 });
    }
    const tampered = new Uint8Array(value.glb);
    tampered[tampered.length - 1] ^= 1;
    return new Response(responseBytes(tampered), { status: 200 });
  });
  await expect(
    storage.writeCloudGeneratedModel("owner", value),
  ).rejects.toMatchObject({ status: 502 });
});

it("rejects fabricated bounds before upload and after downloading valid bytes", async () => {
  const storage = await loadStorage();
  const value = model();
  value.metadata.bounds.max[0] = 10;
  await expect(
    storage.writeCloudGeneratedModel("owner", value),
  ).rejects.toMatchObject({ status: 400 });
  expect(transport).not.toHaveBeenCalled();
  transport.mockImplementation(async (url: string) =>
    url.includes("sts.googleapis.com")
      ? Response.json({ access_token: "test-access" })
      : new Response(responseBytes(value.glb), { status: 200 }),
  );
  await expect(
    storage.readCloudGeneratedModel("owner", value.metadata),
  ).rejects.toMatchObject({ status: 502 });
});
