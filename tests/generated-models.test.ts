import { readFile } from "node:fs/promises";
import { beforeEach, expect, it, vi } from "vitest";
const records = vi.hoisted(() => new Map<string, unknown>());
vi.mock("idb-keyval", () => ({
  get: async (key: string) => structuredClone(records.get(key)),
  update: async (key: string, updater: (value: unknown) => unknown) => {
    records.set(
      key,
      structuredClone(updater(structuredClone(records.get(key)))),
    );
  },
}));
import {
  saveGeneratedModel,
  readGeneratedModel,
  generatedModelPath,
  validateGeneratedGLB,
} from "../src/lib/generated-models";
beforeEach(() => records.clear());
const bytes = () =>
  readFile("public/models/kenney/nature-kit/tree_default.glb");
it("persists validated bytes by content hash and reloads an independent copy", async () => {
  const input = await bytes();
  const metadata = await saveGeneratedModel(input, {
    blenderVersion: "test-validator-only",
    bounds: { min: [0, 0, 0], max: [1, 2, 1] },
  });
  const restored = await readGeneratedModel(metadata.sha256);
  expect(restored.glb).toEqual(new Uint8Array(input));
  expect(generatedModelPath(metadata.sha256)).toMatch(
    /^models\/generated\/[a-f0-9]{64}\.glb$/,
  );
  input[0] = 0;
  expect((await readGeneratedModel(metadata.sha256)).glb[0]).not.toBe(0);
});
it("fails on corrupted persistence rather than silently replacing the model", async () => {
  const metadata = await saveGeneratedModel(await bytes(), {
    blenderVersion: "test-validator-only",
    bounds: { min: [0, 0, 0], max: [1, 2, 1] },
  });
  const record = records.get(`orbsie-model:${metadata.sha256}`) as {
    glb: Uint8Array;
  };
  record.glb[record.glb.length - 1] ^= 1;
  await expect(readGeneratedModel(metadata.sha256)).rejects.toThrow(
    "integrity",
  );
});
it("rejects arbitrary identities and malformed model data", async () => {
  expect(() => generatedModelPath("../../secret")).toThrow();
  expect(() => validateGeneratedGLB(new Uint8Array(20))).toThrow();
  await expect(readGeneratedModel("0".repeat(64))).rejects.toThrow(
    "not available",
  );
});

it("snapshots caller bytes before asynchronous hashing", async () => {
  const input = await bytes();
  const original = new Uint8Array(input);
  const pending = saveGeneratedModel(input, {
    blenderVersion: "test-validator-only",
    bounds: { min: [0, 0, 0], max: [1, 2, 1] },
  });
  input.fill(0);
  const saved = await pending;
  expect((await readGeneratedModel(saved.sha256)).glb).toEqual(original);
});
it("preserves the first record and rejects conflicting provenance", async () => {
  const input = await bytes();
  const provenance = {
    blenderVersion: "test-validator-only",
    bounds: {
      min: [0, 0, 0] as [number, number, number],
      max: [1, 2, 1] as [number, number, number],
    },
  };
  const first = await saveGeneratedModel(input, provenance);
  expect(await saveGeneratedModel(input, provenance)).toEqual(first);
  await expect(
    saveGeneratedModel(input, { ...provenance, blenderVersion: "different" }),
  ).rejects.toThrow("provenance conflicts");
  expect((await readGeneratedModel(first.sha256)).metadata).toEqual(first);
});
