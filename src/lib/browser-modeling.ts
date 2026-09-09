import { z } from "zod";

const MAX_NODES = 64;
const MAX_DEPTH = 16;
const MAX_SEGMENTS = 64;
const MAX_COORDINATE_METERS = 100;
const MAX_DIMENSION_METERS = 100;
const MAX_ROTATION_RADIANS = 100;
const MAX_SCALE = 20;

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const coordinate = z
  .number()
  .finite()
  .min(-MAX_COORDINATE_METERS)
  .max(MAX_COORDINATE_METERS);
const rotation = z
  .number()
  .finite()
  .min(-MAX_ROTATION_RADIANS)
  .max(MAX_ROTATION_RADIANS);
const dimension = z.number().finite().gt(0).max(MAX_DIMENSION_METERS);
const positiveScale = z.number().finite().gt(0).max(MAX_SCALE);
const vector3 = z.tuple([coordinate, coordinate, coordinate]);
const size3 = z.tuple([dimension, dimension, dimension]);
const scale3 = z.tuple([positiveScale, positiveScale, positiveScale]);
const segments = z.number().int().min(3).max(MAX_SEGMENTS);

const boxNodeSchema = z
  .object({
    id: identifier,
    kind: z.literal("box"),
    size: size3,
  })
  .strict();

const sphereNodeSchema = z
  .object({
    id: identifier,
    kind: z.literal("sphere"),
    radius: dimension,
    segments: segments.default(32),
  })
  .strict();

const cylinderNodeSchema = z
  .object({
    id: identifier,
    kind: z.literal("cylinder"),
    radius: dimension,
    depth: dimension,
    axis: z.enum(["x", "y", "z"]),
    segments: segments.default(32),
  })
  .strict();

const transformNodeSchema = z
  .object({
    id: identifier,
    kind: z.literal("transform"),
    input: identifier,
    position: vector3,
    rotation: z.tuple([rotation, rotation, rotation]),
    scale: scale3,
  })
  .strict();

const booleanNodeSchema = z
  .object({
    id: identifier,
    kind: z.literal("boolean"),
    operation: z.enum(["union", "subtract", "intersect"]),
    operands: z.array(identifier).min(2).max(MAX_NODES),
  })
  .strict();

/** A centered primitive or a data-only graph operation in the browser recipe. */
export const browserModelNodeSchema = z.discriminatedUnion("kind", [
  boxNodeSchema,
  sphereNodeSchema,
  cylinderNodeSchema,
  transformNodeSchema,
  booleanNodeSchema,
]);

const browserModelRecipeBaseSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().min(0).max(2_147_483_647),
    output: identifier,
    nodes: z.array(browserModelNodeSchema).min(1).max(MAX_NODES),
  })
  .strict();

export type BrowserModelNode = z.infer<typeof browserModelNodeSchema>;
export type BrowserModelRecipe = z.infer<typeof browserModelRecipeBaseSchema>;

function graphIssue(message: string, path: (string | number)[] = []) {
  return { code: "custom" as const, message, path };
}

/**
 * A browser recipe is a directed acyclic graph. Primitive dimensions are
 * meters, positions are Y-up meters, and rotations are radians.
 */
export const browserModelRecipeSchema =
  browserModelRecipeBaseSchema.superRefine((recipe, context) => {
    const byId = new Map<string, BrowserModelNode>();
    recipe.nodes.forEach((node, index) => {
      if (byId.has(node.id)) {
        context.addIssue(
          graphIssue(`Duplicate browser recipe node ID: ${node.id}.`, [
            "nodes",
            index,
            "id",
          ]),
        );
      } else byId.set(node.id, node);
    });

    if (!byId.has(recipe.output))
      context.addIssue(
        graphIssue(
          `Browser recipe output node does not exist: ${recipe.output}.`,
          ["output"],
        ),
      );

    const references = (node: BrowserModelNode): string[] => {
      if (node.kind === "transform") return [node.input];
      if (node.kind === "boolean") return node.operands;
      return [];
    };

    recipe.nodes.forEach((node, index) => {
      const refs = references(node);
      const seenRefs = new Set<string>();
      refs.forEach((reference, refIndex) => {
        if (seenRefs.has(reference))
          context.addIssue(
            graphIssue(`Browser recipe node repeats operand: ${reference}.`, [
              "nodes",
              index,
              node.kind === "transform" ? "input" : "operands",
              ...(node.kind === "boolean" ? [refIndex] : []),
            ]),
          );
        seenRefs.add(reference);
        if (!byId.has(reference))
          context.addIssue(
            graphIssue(
              `Browser recipe reference does not exist: ${reference}.`,
              [
                "nodes",
                index,
                node.kind === "transform" ? "input" : "operands",
                ...(node.kind === "boolean" ? [refIndex] : []),
              ],
            ),
          );
      });
    });

    const state = new Map<string, "visiting" | "visited">();
    const reachable = new Set<string>();
    let hasCycle = false;
    const visit = (id: string, path: string[]) => {
      const currentState = state.get(id);
      if (currentState === "visiting") {
        hasCycle = true;
        context.addIssue(
          graphIssue(
            `Browser recipe graph contains a cycle: ${[...path, id].join(" -> ")}.`,
            ["output"],
          ),
        );
        return;
      }
      if (currentState === "visited") return;
      const node = byId.get(id);
      if (!node) return;
      state.set(id, "visiting");
      reachable.add(id);
      const refs = references(node);
      refs.forEach((reference) => visit(reference, [...path, id]));
      state.set(id, "visited");
    };

    if (byId.has(recipe.output)) visit(recipe.output, []);

    if (!hasCycle && byId.has(recipe.output)) {
      const heights = new Map<string, number>();
      const heightOf = (id: string): number => {
        const cached = heights.get(id);
        if (cached !== undefined) return cached;
        const node = byId.get(id);
        if (!node) return 0;
        const refs = references(node);
        const height =
          refs.length === 0
            ? 1
            : 1 + Math.max(...refs.map((reference) => heightOf(reference)));
        heights.set(id, height);
        return height;
      };
      const depth = heightOf(recipe.output);
      if (depth > MAX_DEPTH)
        context.addIssue(
          graphIssue(
            `Browser recipe graph depth exceeds ${MAX_DEPTH} nodes (found ${depth}).`,
            ["output"],
          ),
        );
    }

    recipe.nodes.forEach((node, index) => {
      if (!reachable.has(node.id))
        context.addIssue(
          graphIssue(
            `Browser recipe node is unreachable from output: ${node.id}.`,
            ["nodes", index, "id"],
          ),
        );
    });
  });

export function parseBrowserModelRecipe(input: unknown): BrowserModelRecipe {
  return browserModelRecipeSchema.parse(input);
}

/**
 * Replace exactly one already-identified node without mutating the recipe.
 * The replacement must keep the node ID and produce a valid whole graph before
 * the revision is incremented.
 */
export function replaceBrowserModelRecipeNode(
  recipe: BrowserModelRecipe,
  nodeId: string,
  replacement: unknown,
  expectedRevision: number,
): BrowserModelRecipe {
  const current = browserModelRecipeSchema.parse(recipe);
  if (current.revision !== expectedRevision)
    throw new Error(
      `Browser recipe revision is stale: expected ${expectedRevision}, current ${current.revision}.`,
    );
  if (!current.nodes.some((node) => node.id === nodeId))
    throw new Error(`Browser recipe node does not exist: ${nodeId}.`);

  const nextNode = browserModelNodeSchema.parse(replacement);
  if (nextNode.id !== nodeId)
    throw new Error(
      `Browser recipe replacement must preserve node ID ${nodeId}; received ${nextNode.id}.`,
    );

  return browserModelRecipeSchema.parse({
    ...current,
    revision: current.revision + 1,
    nodes: current.nodes.map((node) => (node.id === nodeId ? nextNode : node)),
  });
}

export const browserModelRecipeLimits = Object.freeze({
  maxNodes: MAX_NODES,
  maxDepth: MAX_DEPTH,
  maxSegments: MAX_SEGMENTS,
  maxCoordinateMeters: MAX_COORDINATE_METERS,
  maxDimensionMeters: MAX_DIMENSION_METERS,
  maxRotationRadians: MAX_ROTATION_RADIANS,
  maxScale: MAX_SCALE,
});
