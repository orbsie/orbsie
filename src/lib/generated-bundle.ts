import {
  generatedModelMetadataSchema,
  generatedModelPath,
  MAX_GENERATED_MODEL_BYTES,
  readGeneratedModel,
  type GeneratedModel,
} from "./generated-models";
import { validateGeneratedGLB } from "./generated-glb";
import type { Project } from "./protocol";

const TOTAL_BUDGET = 6 * 1024 * 1024;
export const GENERATED_MODEL_MANIFEST = "models/generated/manifest.json";
/** Package exact immutable bytes, not device-local IndexedDB references. */
export async function bundleGeneratedAssets(
  project: Pick<Project, "entities">,
  read: (hash: string) => Promise<GeneratedModel> = readGeneratedModel,
): Promise<Record<string, Uint8Array>> {
  const references = project.entities.flatMap((entity) => {
    if (entity.geometry?.kind !== "generated") return [];
    if (!entity.geometry.model)
      throw Error(
        "This world has an unfinished generated model. Finish modeling before export or publication.",
      );
    return [generatedModelMetadataSchema.parse(entity.geometry.model)];
  });
  if (!references.length) return {};
  const files: Record<string, Uint8Array> = {};
  const models = new Map<string, GeneratedModel["metadata"]>();
  let total = 0;
  for (const expected of references) {
    let metadata = models.get(expected.sha256);
    if (!metadata) {
      const record = await read(expected.sha256);
      metadata = generatedModelMetadataSchema.parse(record.metadata);
      const glb = new Uint8Array(record.glb);
      total += glb.byteLength;
      if (glb.byteLength > MAX_GENERATED_MODEL_BYTES || total > TOTAL_BUDGET)
        throw Error(
          "Generated models exceed the export size budget (2 MiB per model, 6 MiB total).",
        );
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", glb));
      const hash = [...digest]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      if (
        hash !== expected.sha256 ||
        metadata.sha256 !== hash ||
        metadata.bytes !== glb.byteLength
      )
        throw Error(
          "A generated model failed its integrity check. Export stopped.",
        );
      validateGeneratedGLB(glb, metadata.bounds);
      models.set(hash, metadata);
      files[generatedModelPath(hash)] = glb;
    }
    if (
      metadata.bytes !== expected.bytes ||
      metadata.source !== expected.source ||
      metadata.version !== expected.version ||
      metadata.blenderVersion !== expected.blenderVersion ||
      metadata.kernelVersion !== expected.kernelVersion ||
      JSON.stringify(metadata.bounds) !== JSON.stringify(expected.bounds)
    )
      throw Error(
        "A generated model's provenance differs from this world. Export stopped.",
      );
  }
  const manifest = new TextEncoder().encode(
    JSON.stringify(
      {
        version: 1,
        models: [...models.values()].sort((a, b) =>
          a.sha256.localeCompare(b.sha256),
        ),
      },
      null,
      2,
    ),
  );
  if (total + manifest.byteLength > TOTAL_BUDGET)
    throw Error(
      "Generated models and their manifest exceed the 6 MiB export budget.",
    );
  files[GENERATED_MODEL_MANIFEST] = manifest;
  return files;
}
