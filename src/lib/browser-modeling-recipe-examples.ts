import type { BrowserModelRecipe } from "./browser-modeling";
import type { ModelCommand } from "./protocol";

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

/**
 * A complete model command for a previously reserved generic entity. Keeping
 * the wrapper beside the recipe prevents the policy example from drifting
 * away from the command schema or moving assetPolicy inside geometry.
 */
export const overlappingTrunkCanopyUnionCommand = {
  type: "set_geometry",
  id: "compound-object",
  geometry: {
    kind: "generated",
    collision: "none",
    detail: "refined",
    job: {
      backend: "browser-manifold",
      recipe: overlappingTrunkCanopyUnionRecipe,
    },
  },
  assetPolicy: "new-only",
} as const satisfies Extract<ModelCommand, { type: "set_geometry" }>;
