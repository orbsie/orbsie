import { describe, expect, it } from "vitest";
import Module from "manifold-3d";
import {
  browserModelRecipeSchema,
  parseBrowserModelRecipe,
} from "../src/lib/browser-modeling";
import {
  evaluateBrowserModelRecipe,
  type BrowserModelKernel,
} from "../src/lib/browser-modeling-kernel";
import {
  overlappingTrunkCanopyUnionCommand,
  overlappingTrunkCanopyUnionRecipe,
} from "../src/lib/browser-modeling-recipe-examples";
import {
  applyModelOperation,
  blankProject,
  parseModelCommandForProcessing,
} from "../src/lib/protocol";
import {
  browserModelingInstructions,
  modelingInstructions,
} from "../src/lib/modeling-policy";

function manifoldKernel(wasm: Awaited<ReturnType<typeof Module>>) {
  return {
    cube: (size: readonly [number, number, number], center: boolean) =>
      wasm.Manifold.cube(size, center),
    sphere: (radius: number, segments: number) =>
      wasm.Manifold.sphere(radius, segments),
    cylinder: (
      depth: number,
      radiusLow: number,
      radiusHigh: number,
      segments: number,
      center: boolean,
    ) => wasm.Manifold.cylinder(depth, radiusLow, radiusHigh, segments, center),
    extrude: (profile: [number, number][], depth: number) =>
      wasm.Manifold.extrude(profile, depth),
    revolve: (profile: [number, number][], segments: number, degrees: number) =>
      wasm.Manifold.revolve(profile, segments, degrees),
    compose: (manifolds: ReturnType<typeof wasm.Manifold.cube>[]) =>
      wasm.Manifold.compose(manifolds),
    mesh: (vertices: Float32Array, triangles: Uint32Array) =>
      wasm.Manifold.ofMesh(
        new wasm.Mesh({
          numProp: 3,
          vertProperties: vertices,
          triVerts: triangles,
        }),
      ),
  } satisfies BrowserModelKernel;
}

describe("browser modeling policy", () => {
  it("describes bounded full revolutions in the browser backend vocabulary", () => {
    expect(browserModelingInstructions).toContain("revolve(profile, segments)");
    expect(browserModelingInstructions).toContain(
      "full 360-degree sweep around Y",
    );
    expect(browserModelingInstructions).toContain(
      "preserving the explicit heights without automatic centering",
    );
    expect(browserModelingInstructions).toContain(
      "segments default to 32 (maximum 64)",
    );
    expect(browserModelingInstructions).toContain(
      "centered from -depth/2 to +depth/2",
    );
    expect(browserModelingInstructions).toContain("partial sweep");
    expect(browserModelingInstructions).toContain(
      "bounded closed triangle mesh",
    );
    expect(browserModelingInstructions).toContain(
      "self-intersecting triangles",
    );
    expect(browserModelingInstructions).toContain("capped open tube");
    expect(browserModelingInstructions).toContain("closed loops");
    expect(browserModelingInstructions).not.toContain("lathe");
    expect(modelingInstructions(false, true)).toBe(browserModelingInstructions);
  });

  it("documents and evaluates a boolean union for overlapping generated parts", async () => {
    const wasm = await Module();
    wasm.setup();
    const parsed = parseBrowserModelRecipe(overlappingTrunkCanopyUnionRecipe);
    expect(browserModelRecipeSchema.safeParse(parsed).success).toBe(true);
    expect(browserModelingInstructions).toContain(
      JSON.stringify(overlappingTrunkCanopyUnionRecipe),
    );
    expect(browserModelingInstructions).toContain(
      JSON.stringify(overlappingTrunkCanopyUnionCommand),
    );

    const result = evaluateBrowserModelRecipe(parsed, manifoldKernel(wasm));
    expect(result.statistics.triangles).toBeGreaterThan(0);
    expect(result.bounds.min[1]).toBeLessThan(0);
    expect(result.bounds.max[1]).toBeGreaterThan(1);
  });

  it("parses and applies the complete command after reserving its entity", () => {
    const project = blankProject();
    const cursor = { runId: "run", sequence: 0, seen: new Set<string>() };
    const reserved = applyModelOperation(
      project,
      {
        version: 1,
        projectId: project.id,
        runId: "run",
        operationId: "reserve",
        sequence: 1,
        baseRevision: 0,
        command: {
          type: "reserve_entity",
          entity: {
            id: overlappingTrunkCanopyUnionCommand.id,
            label: "Compound object",
            position: [0, 0, 0],
            scale: [1, 1, 1],
            color: "#6ead60",
            stage: "seed",
          },
        },
      },
      cursor,
    );
    const serializedCommand = JSON.parse(
      JSON.stringify(overlappingTrunkCanopyUnionCommand),
    );
    const parsed = parseModelCommandForProcessing(
      serializedCommand,
      false,
      true,
    );
    expect(parsed).toEqual(overlappingTrunkCanopyUnionCommand);
    if (parsed.type !== "set_geometry")
      throw new Error("Expected set_geometry");
    expect(parsed.assetPolicy).toBe("new-only");
    expect(parsed.geometry).not.toHaveProperty("assetPolicy");

    const applied = applyModelOperation(
      reserved.project,
      {
        version: 1,
        projectId: project.id,
        runId: "run",
        operationId: "geometry",
        sequence: 2,
        baseRevision: reserved.project.revision,
        command: parsed,
      },
      reserved.cursor,
    );
    expect(applied.project.entities[0]).toMatchObject({
      id: overlappingTrunkCanopyUnionCommand.id,
      stage: "ready",
      assetPolicy: "new-only",
      geometry: overlappingTrunkCanopyUnionCommand.geometry,
    });
  });

  it("rejects the same touching or overlapping parts when modeled as compose", async () => {
    const wasm = await Module();
    wasm.setup();
    const invalidRecipe = {
      ...overlappingTrunkCanopyUnionRecipe,
      nodes: overlappingTrunkCanopyUnionRecipe.nodes.map((node) =>
        node.id === "trunk-canopy"
          ? {
              id: "trunk-canopy",
              kind: "compose" as const,
              inputs: ["trunk", "placed-canopy"],
            }
          : node,
      ),
    };
    expect(browserModelRecipeSchema.safeParse(invalidRecipe).success).toBe(
      true,
    );
    expect(() =>
      evaluateBrowserModelRecipe(
        parseBrowserModelRecipe(invalidRecipe),
        manifoldKernel(wasm),
      ),
    ).toThrow(/touching or overlapping/);
  });
});
