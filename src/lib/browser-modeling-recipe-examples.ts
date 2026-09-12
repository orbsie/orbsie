import type { BrowserModelRecipe } from "./browser-modeling";

/**
 * A compact example of merging intentionally overlapping parts into one solid.
 * Keep this as a recipe so policy text and kernel coverage use the same shape.
 */
export const overlappingTrunkCanopyUnionRecipe = {
  version: 1,
  revision: 0,
  output: "trunk-canopy",
  nodes: [
    {
      id: "trunk",
      kind: "cylinder",
      radius: 0.45,
      depth: 2.2,
      axis: "y",
      segments: 24,
    },
    { id: "canopy", kind: "sphere", radius: 1, segments: 24 },
    {
      id: "placed-canopy",
      kind: "transform",
      input: "canopy",
      position: [0, 0.85, 0],
      rotation: [0, 0, 0],
      scale: [1, 0.8, 1],
    },
    {
      id: "trunk-canopy",
      kind: "boolean",
      operation: "union",
      operands: ["trunk", "placed-canopy"],
    },
  ],
} as const satisfies BrowserModelRecipe;
