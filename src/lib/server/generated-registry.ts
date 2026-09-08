import {
  sameGeneratedProvenance,
  generatedModelMetadataSchema,
  type GeneratedModelMetadata,
} from "../generated-models";
import type { Project } from "../protocol";
import { database, HttpError } from "./auth";

export { sameGeneratedProvenance } from "../generated-models";
/** Only ready, owner-scoped assets may enter a cloud revision. */
export async function requireCloudGeneratedModels(
  ownerId: string,
  project: Project,
) {
  const wanted = new Map<string, GeneratedModelMetadata>();
  for (const entity of project.entities) {
    if (entity.geometry?.kind !== "generated") continue;
    if (!entity.geometry.model)
      throw new HttpError(
        409,
        "Finish building every model before saving to your account.",
      );
    const metadata = generatedModelMetadataSchema.parse(entity.geometry.model);
    const previous = wanted.get(metadata.sha256);
    if (previous && !sameGeneratedProvenance(previous, metadata))
      throw new HttpError(
        400,
        "Model references disagree about their saved data.",
      );
    wanted.set(metadata.sha256, metadata);
  }
  if (!wanted.size) return wanted;
  const rows = await database().query(
    "SELECT sha256,metadata FROM generated_models WHERE owner_id=$1 AND ready=true AND sha256=ANY($2::text[])",
    [ownerId, [...wanted.keys()]],
  );
  const found = new Map(
    rows.rows.map((row) => [
      row.sha256,
      generatedModelMetadataSchema.parse(row.metadata),
    ]),
  );
  for (const [hash, expected] of wanted) {
    const saved = found.get(hash);
    if (!saved || !sameGeneratedProvenance(expected, saved))
      throw new HttpError(
        409,
        "Upload the complete generated models before saving this world to your account.",
      );
  }
  return found;
}
