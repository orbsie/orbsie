import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Project } from "../src/lib/protocol";
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock("../src/lib/generated-models", async () => ({
  ...(await vi.importActual("../src/lib/generated-models")),
  readGeneratedModel: mocks.read,
  saveGeneratedModel: mocks.save,
}));
import {
  uploadCloudGeneratedModels,
  downloadCloudGeneratedModels,
} from "../src/lib/cloud-generated-models";
const metadata = JSON.parse(
  readFileSync("docs/evidence/local-modeling/report.json", "utf8"),
).metadata;
const glb = readFileSync("docs/evidence/local-modeling/model.glb");
const project = {
  entities: [
    { geometry: { kind: "generated", model: metadata } },
    { geometry: { kind: "generated", model: metadata } },
  ],
} as Project;
const fetcher = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  mocks.read.mockReset();
  mocks.save.mockReset();
  mocks.read.mockResolvedValue({ metadata, glb });
  mocks.save.mockResolvedValue(metadata);
});
afterEach(() => vi.unstubAllGlobals());
it("uploads a shared asset once and verifies the returned provenance", async () => {
  fetcher.mockResolvedValue(Response.json({ metadata }));
  expect(await uploadCloudGeneratedModels(project)).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe("/api/generated-models");
  expect(options.credentials).toBe("same-origin");
  expect(JSON.parse(options.body).glb).toBe(glb.toString("base64"));
});
it("restores verified bytes only after an owner-authenticated response", async () => {
  fetcher.mockResolvedValue(
    Response.json({ metadata, glb: glb.toString("base64") }),
  );
  expect(await downloadCloudGeneratedModels(project)).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(mocks.save).toHaveBeenCalledWith(new Uint8Array(glb), metadata);
});
it("does not persist a response after the active account changes", async () => {
  let current = true;
  fetcher.mockImplementation(async () => {
    current = false;
    return Response.json({ metadata, glb: glb.toString("base64") });
  });
  expect(await downloadCloudGeneratedModels(project, () => current)).toBe(
    false,
  );
  expect(mocks.save).not.toHaveBeenCalled();
});
it("rejects tampered bytes before persistence", async () => {
  const tampered = Buffer.from(glb);
  tampered[tampered.length - 1] ^= 1;
  fetcher.mockResolvedValue(
    Response.json({ metadata, glb: tampered.toString("base64") }),
  );
  await expect(downloadCloudGeneratedModels(project)).rejects.toThrow(
    "integrity",
  );
  expect(mocks.save).not.toHaveBeenCalled();
});
it("never substitutes local cache for a rejected cloud access request", async () => {
  fetcher.mockResolvedValue(
    Response.json({ error: "Model not found." }, { status: 404 }),
  );
  await expect(downloadCloudGeneratedModels(project)).rejects.toThrow(
    "Model not found",
  );
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
it("rejects unresolved model references without a network request", async () => {
  const unresolved = {
    entities: [{ geometry: { kind: "generated" } }],
  } as Project;
  await expect(uploadCloudGeneratedModels(unresolved)).rejects.toThrow(
    "Finish building",
  );
  expect(fetcher).not.toHaveBeenCalled();
});
