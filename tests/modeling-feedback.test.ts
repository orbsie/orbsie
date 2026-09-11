import { expect, it } from "vitest";
import {
  modelingFeedbackLimits,
  modelingFeedbackSchema,
} from "../src/lib/modeling-feedback";

function recipeWithBytesNearLimit(idLength: number, extraByte = false) {
  const id = "m".repeat(idLength);
  const vertices = Array.from(
    { length: 1498 },
    (_, index) =>
      [
        extraByte && index === 0 ? 10 : index % 100,
        Math.floor(index / 100),
        0,
      ] as [number, number, number],
  );
  return {
    version: 1 as const,
    revision: 0,
    output: id,
    nodes: [
      {
        id,
        kind: "mesh" as const,
        vertices,
        triangles: Array.from(
          { length: vertices.length - 2 },
          (_, index) => [0, index + 1, index + 2] as [number, number, number],
        ),
      },
    ],
  };
}

function feedback(recipe: ReturnType<typeof recipeWithBytesNearLimit>) {
  return {
    version: 1 as const,
    projectId: "project-a",
    entityId: "tree-0",
    backend: "browser-manifold" as const,
    nodeId: "mesh",
    error: "[browser-modeling-kernel] node mesh failed.",
    recipe,
  };
}

it("accepts a rejected recipe exactly at the byte cap", () => {
  const recipe = recipeWithBytesNearLimit(53);
  expect(new TextEncoder().encode(JSON.stringify(recipe)).byteLength).toBe(
    modelingFeedbackLimits.maxRecipeBytes,
  );
  expect(modelingFeedbackSchema.parse(feedback(recipe))).toEqual(
    feedback(recipe),
  );
});

it("rejects an incoming rejected recipe one byte over the byte cap", () => {
  const recipe = recipeWithBytesNearLimit(53, true);
  expect(new TextEncoder().encode(JSON.stringify(recipe)).byteLength).toBe(
    modelingFeedbackLimits.maxRecipeBytes + 1,
  );
  expect(() => modelingFeedbackSchema.parse(feedback(recipe))).toThrow(
    "feedback size limit",
  );
});
