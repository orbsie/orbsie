import { get, update } from "idb-keyval";
import { z } from "zod";
import { validateGeneratedGLB } from "./generated-glb";
export { validateGeneratedGLB } from "./generated-glb";

export const MAX_GENERATED_MODEL_BYTES = 2 * 1024 * 1024;
const point = z.tuple([
  z.number().finite().min(-1e6).max(1e6),
  z.number().finite().min(-1e6).max(1e6),
  z.number().finite().min(-1e6).max(1e6),
]);
export const generatedModelMetadataSchema = z
  .object({
    version: z.literal(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive().max(MAX_GENERATED_MODEL_BYTES),
    source: z.literal("local-blender"),
    blenderVersion: z.string().min(1).max(64),
    bounds: z.object({ min: point, max: point }).strict(),
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.bounds.min.some((min, index) => min > value.bounds.max[index]))
      context.addIssue({
        code: "custom",
        message: "Model bounds are inverted.",
      });
  });
export type GeneratedModelMetadata = z.infer<
  typeof generatedModelMetadataSchema
>;
export type GeneratedModel = {
  metadata: GeneratedModelMetadata;
  glb: Uint8Array;
};

async function digest(bytes: Uint8Array) {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
  );
  return [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
const storageKey = (hash: string) => {
  if (!/^[a-f0-9]{64}$/.test(hash))
    throw Error("Invalid generated model identity.");
  return `orbsie-model:${hash}`;
};

export async function saveGeneratedModel(
  glb: Uint8Array,
  provenance: Pick<GeneratedModelMetadata, "blenderVersion" | "bounds">,
): Promise<GeneratedModelMetadata> {
  glb = new Uint8Array(glb);
  provenance = structuredClone(provenance);
  validateGeneratedGLB(glb, provenance.bounds);
  const sha256 = await digest(glb);
  const metadata = generatedModelMetadataSchema.parse({
    ...provenance,
    version: 1,
    sha256,
    bytes: glb.byteLength,
    source: "local-blender",
    createdAt: new Date().toISOString(),
  });
  let saved = metadata;
  await update<GeneratedModel>(storageKey(sha256), (existing) => {
    if (!existing) return { metadata, glb };
    const previous = generatedModelMetadataSchema.parse(existing.metadata);
    if (
      previous.sha256 !== sha256 ||
      previous.bytes !== glb.byteLength ||
      !(existing.glb instanceof Uint8Array) ||
      existing.glb.length !== glb.length ||
      existing.glb.some((byte, index) => byte !== glb[index])
    )
      throw Error("The saved generated model failed its integrity check.");
    if (
      previous.blenderVersion !== metadata.blenderVersion ||
      JSON.stringify(previous.bounds) !== JSON.stringify(metadata.bounds)
    )
      throw Error(
        "Generated model provenance conflicts with its saved record.",
      );
    saved = previous;
    return existing;
  });
  return saved;
}
export async function readGeneratedModel(
  hash: string,
): Promise<GeneratedModel> {
  const record = await get<GeneratedModel>(storageKey(hash));
  if (!record)
    throw Error("This generated model is not available on this device.");
  const metadata = generatedModelMetadataSchema.parse(record.metadata);
  const glb = new Uint8Array(record.glb);
  if (
    metadata.sha256 !== hash ||
    metadata.bytes !== glb.byteLength ||
    (await digest(glb)) !== hash
  )
    throw Error("The saved generated model failed its integrity check.");
  validateGeneratedGLB(glb, metadata.bounds);
  return { metadata, glb };
}
export function generatedModelPath(hash: string) {
  storageKey(hash);
  return `models/generated/${hash}.glb`;
}

/** Timestamps may differ between devices; byte identity and construction provenance may not. */
export function sameGeneratedProvenance(
  a: GeneratedModelMetadata,
  b: GeneratedModelMetadata,
) {
  return (
    a.sha256 === b.sha256 &&
    a.bytes === b.bytes &&
    a.blenderVersion === b.blenderVersion &&
    JSON.stringify(a.bounds) === JSON.stringify(b.bounds)
  );
}
