import { z } from "zod";

const coordinate = z.number().finite().min(-100).max(100);
const point = z.tuple([coordinate, coordinate, coordinate]);
const profilePoint = z.tuple([coordinate, coordinate]);
const positiveScale = z.number().finite().min(0.001).max(20);

/** Data-only modeling language. No Python, paths, imports, URLs or expressions. */
export const modelingPartSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    shape: z.enum([
      "box",
      "sphere",
      "cylinder",
      "cone",
      "torus",
      "mesh",
      "extrude",
      "lathe",
    ]),
    position: point.default([0, 0, 0]),
    rotation: point.default([0, 0, 0]),
    scale: z
      .tuple([positiveScale, positiveScale, positiveScale])
      .default([1, 1, 1]),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    vertices: z.array(point).min(3).max(4096).optional(),
    faces: z
      .array(z.array(z.number().int().min(0).max(4095)).min(3).max(16))
      .min(1)
      .max(8192)
      .optional(),
    profile: z.array(profilePoint).min(3).max(128).optional(),
    depth: z.number().finite().min(0.001).max(20).optional(),
    segments: z.number().int().min(3).max(64).default(16),
    bevel: z.number().finite().min(0).max(0.5).default(0),
    subdivision: z.number().int().min(0).max(2).default(0),
  })
  .strict()
  .superRefine((part, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: "custom", message });
    if (part.shape === "mesh") {
      if (!part.vertices || !part.faces)
        issue("Mesh parts require vertices and faces.");
      if (
        part.faces?.some(
          (face) =>
            face.some((index) => index >= (part.vertices?.length ?? 0)) ||
            new Set(face).size !== face.length,
        )
      )
        issue("Mesh faces must reference distinct existing vertices.");
    } else if (part.vertices || part.faces)
      issue("Only mesh parts may supply vertices and faces.");
    if (part.shape === "extrude" || part.shape === "lathe") {
      if (!part.profile) issue("Profile shapes require profile points.");
      if (part.shape === "extrude" && part.depth === undefined)
        issue("Extrusions require depth.");
      if (part.shape === "lathe" && part.depth !== undefined)
        issue("Lathe profiles define height; depth is only for extrusions.");
      if (
        part.shape === "lathe" &&
        part.profile?.some(([radius]) => radius < 0)
      )
        issue("Lathe radii must be nonnegative.");
    } else if (part.profile || part.depth !== undefined)
      issue("Only profile shapes may supply a profile or depth.");
  });

export const modelingJobSchema = z
  .object({
    version: z.literal(1),
    parts: z.array(modelingPartSchema).min(1).max(32),
  })
  .strict()
  .superRefine((job, context) => {
    if (new Set(job.parts.map((part) => part.id)).size !== job.parts.length)
      context.addIssue({
        code: "custom",
        message: "Modeling part IDs must be unique.",
      });
    const vertices = job.parts.reduce(
      (sum, part) => sum + (part.vertices?.length ?? 0),
      0,
    );
    const faces = job.parts.reduce(
      (sum, part) => sum + (part.faces?.length ?? 0),
      0,
    );
    if (vertices > 8192 || faces > 16384)
      context.addIssue({
        code: "custom",
        message: "The modeling job exceeds its mesh input budget.",
      });
    const estimatedTriangles = job.parts.reduce((sum, part) => {
      const segments = part.segments;
      const base =
        part.shape === "mesh"
          ? (part.faces ?? []).reduce(
              (total, face) => total + face.length - 2,
              0,
            )
          : part.shape === "lathe"
            ? 2 * Math.max(0, (part.profile?.length ?? 0) - 1) * segments
            : part.shape === "extrude"
              ? 4 * (part.profile?.length ?? 0)
              : part.shape === "sphere" || part.shape === "torus"
                ? 2 * segments * segments
                : part.shape === "box"
                  ? 12
                  : 4 * segments;
      return sum + base * 4 ** part.subdivision * (part.bevel ? 6 : 1);
    }, 0);
    if (estimatedTriangles > 100000)
      context.addIssue({
        code: "custom",
        message: "The modeling job exceeds its estimated construction budget.",
      });
  });
export type ModelingPart = z.infer<typeof modelingPartSchema>;
export type ModelingJob = z.infer<typeof modelingJobSchema>;
