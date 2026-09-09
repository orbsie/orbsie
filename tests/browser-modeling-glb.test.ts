import { describe, it, expect } from "vitest";
import Module from "manifold-3d";
import { evaluateBrowserModelRecipe } from "../src/lib/browser-modeling-kernel";
import { parseBrowserModelRecipe } from "../src/lib/browser-modeling";
import { bakeBrowserModelGLB } from "../src/lib/browser-modeling-glb";
import { generatedGLBBounds } from "../src/lib/generated-glb";

describe("browser mesh baked asset bridge", () => {
  it("bakes real boolean geometry into a self-contained validated GLB", async () => {
    const wasm = await Module();
    wasm.setup();
    const recipe = parseBrowserModelRecipe({
      version: 1,
      revision: 0,
      output: "arch",
      nodes: [
        { id: "box", kind: "box", size: [6, 4, 1.5] },
        { id: "cutter", kind: "cylinder", radius: 1.8, depth: 2, axis: "z" },
        {
          id: "placed",
          kind: "transform",
          input: "cutter",
          position: [0, -1, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        {
          id: "arch",
          kind: "boolean",
          operation: "subtract",
          operands: ["box", "placed"],
        },
      ],
    });
    const mesh = evaluateBrowserModelRecipe(recipe, wasm.Manifold);
    const before = new Float32Array(mesh.vertices);
    const bytes = bakeBrowserModelGLB(mesh, {
      color: "#E4C79B",
      roughness: 0.9,
    });
    expect(generatedGLBBounds(bytes)).toEqual(mesh.bounds);
    expect(mesh.vertices).toEqual(before);
    const jsonSize = new DataView(bytes.buffer).getUint32(12, true);
    const doc = JSON.parse(
      new TextDecoder().decode(bytes.slice(20, 20 + jsonSize)),
    );
    expect(doc.buffers[0].uri).toBeUndefined();
    expect(doc.meshes[0].primitives[0].attributes.NORMAL).toBe(1);
    expect(doc.materials[0].pbrMetallicRoughness.roughnessFactor).toBe(0.9);
    expect(() =>
      bakeBrowserModelGLB(
        { ...mesh, indices: new Uint32Array([0, 1, 999999]) },
        { color: "#ffffff" },
      ),
    ).toThrow(/Invalid browser mesh/);
    expect(() =>
      bakeBrowserModelGLB(mesh, { color: "javascript:bad" }),
    ).toThrow();
    expect(() =>
      bakeBrowserModelGLB(
        { ...mesh, bounds: { min: [0, 0, 0], max: [1, 1, 1] } },
        { color: "#ffffff" },
      ),
    ).toThrow();
  });
});
