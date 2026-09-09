import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluate: vi.fn(),
  bake: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../src/lib/browser-modeling-queue", () => ({
  evaluateBrowserModelRecipeInWorker: mocks.evaluate,
}));
vi.mock("../src/lib/browser-modeling-glb", () => ({
  bakeBrowserModelGLB: mocks.bake,
}));
vi.mock("../src/lib/generated-models", () => ({
  saveGeneratedModel: mocks.save,
}));

import { buildBrowserModel } from "../src/lib/browser-modeling-connection";

const recipe = {
  version: 1 as const,
  revision: 4,
  output: "box",
  nodes: [
    {
      id: "box",
      kind: "box" as const,
      size: [2, 2, 2] as [number, number, number],
    },
  ],
};
const evaluation = {
  vertices: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
  indices: new Uint32Array([0, 1, 2]),
  bounds: {
    min: [-1, -1, 0] as [number, number, number],
    max: [1, 1, 0] as [number, number, number],
  },
  statistics: { triangles: 1, vertices: 3, bytes: 48 },
};
const glb = new Uint8Array([1, 2, 3]);
const metadata = {
  version: 1,
  sha256: "c".repeat(64),
  bytes: 3,
  source: "browser-manifold" as const,
  kernelVersion: "3.3.2",
  bounds: evaluation.bounds,
  createdAt: "2026-09-08T00:00:00.000Z",
};

beforeEach(() => {
  mocks.evaluate.mockReset().mockResolvedValue(evaluation);
  mocks.bake.mockReset().mockReturnValue(glb);
  mocks.save.mockReset().mockResolvedValue(metadata);
});

describe("browser modeling connection", () => {
  it("evaluates, bakes with the requested color, and saves browser provenance", async () => {
    const controller = new AbortController();
    await expect(
      buildBrowserModel(recipe, {
        color: "#d18e5a",
        signal: controller.signal,
      }),
    ).resolves.toBe(metadata);
    expect(mocks.evaluate).toHaveBeenCalledWith(recipe, controller.signal);
    expect(mocks.bake).toHaveBeenCalledWith(evaluation, { color: "#d18e5a" });
    expect(mocks.save).toHaveBeenCalledWith(glb, {
      source: "browser-manifold",
      kernelVersion: "3.3.2",
      bounds: evaluation.bounds,
    });
  });

  it("rejects before queueing when already aborted and does not persist", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      buildBrowserModel(recipe, {
        color: "#ffffff",
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(mocks.evaluate).not.toHaveBeenCalled();
    expect(mocks.bake).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("checks cancellation after worker evaluation before baking or saving", async () => {
    let finish!: (value: typeof evaluation) => void;
    mocks.evaluate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const building = buildBrowserModel(recipe, {
      color: "#ffffff",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mocks.evaluate).toHaveBeenCalledOnce());
    controller.abort();
    finish(evaluation);
    await expect(building).rejects.toThrow();
    expect(mocks.bake).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
