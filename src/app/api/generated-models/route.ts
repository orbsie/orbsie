import { createHash } from "node:crypto";
import { z } from "zod";
import {
  requireUser,
  database,
  checkOrigin,
  boundedJSON,
  apiError,
  HttpError,
} from "../../../lib/server/auth";
import {
  generatedModelMetadataSchema,
  MAX_GENERATED_MODEL_BYTES,
} from "../../../lib/generated-models";
import { validateGeneratedGLB } from "../../../lib/generated-glb";
import { sameGeneratedProvenance } from "../../../lib/server/generated-registry";
import {
  writeCloudGeneratedModel,
  readCloudGeneratedModel,
  cloudGeneratedModelsEnabled,
  CloudGeneratedModelError,
} from "../../../lib/server/generated-storage";
export const maxDuration = 60;
const inputSchema = z
  .object({
    metadata: generatedModelMetadataSchema,
    glb: z
      .string()
      .max(4 * Math.ceil(MAX_GENERATED_MODEL_BYTES / 3))
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
  })
  .strict();
function failure(error: unknown) {
  return apiError(
    error instanceof CloudGeneratedModelError
      ? new HttpError(error.status, error.message)
      : error,
  );
}
export async function PUT(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser(request);
    if (!cloudGeneratedModelsEnabled())
      throw new HttpError(
        503,
        "Cloud model storage is unavailable. Your local models are safe.",
      );
    const parsed = inputSchema.safeParse(
      await boundedJSON(request, 3 * 1024 * 1024),
    );
    if (!parsed.success)
      throw new HttpError(400, "Invalid generated model upload.");
    const { metadata } = parsed.data;
    const glb = new Uint8Array(Buffer.from(parsed.data.glb, "base64"));
    if (
      glb.byteLength !== metadata.bytes ||
      createHash("sha256").update(glb).digest("hex") !== metadata.sha256
    )
      throw new HttpError(
        400,
        "The generated model failed its integrity check.",
      );
    try {
      validateGeneratedGLB(glb, metadata.bounds);
    } catch {
      throw new HttpError(400, "The generated model is not a supported GLB.");
    }
    const client = await database().connect();
    let savedMetadata = metadata;
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`generated-models:${user.id}`],
      );
      const existing = await client.query(
        "SELECT metadata FROM generated_models WHERE owner_id=$1 AND sha256=$2",
        [user.id, metadata.sha256],
      );
      if (existing.rows[0]) {
        savedMetadata = generatedModelMetadataSchema.parse(
          existing.rows[0].metadata,
        );
        if (!sameGeneratedProvenance(savedMetadata, metadata))
          throw new HttpError(
            409,
            "This model conflicts with its saved cloud provenance.",
          );
      } else {
        const quota = await client.query(
          "SELECT count(*)::integer AS count,COALESCE(sum(bytes),0)::bigint AS bytes FROM generated_models WHERE owner_id=$1",
          [user.id],
        );
        if (
          Number(quota.rows[0].count) >= 256 ||
          Number(quota.rows[0].bytes) + glb.byteLength > 64 * 1024 * 1024
        )
          throw new HttpError(
            413,
            "Your account has reached its generated-model storage limit (64 MiB or 256 models).",
          );
        await client.query(
          "INSERT INTO generated_models(owner_id,sha256,bytes,metadata) VALUES($1,$2,$3,$4)",
          [user.id, metadata.sha256, metadata.bytes, JSON.stringify(metadata)],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    // A failed upload leaves a bounded pending reservation; retry uses the same identity.
    await writeCloudGeneratedModel(user.id, { metadata: savedMetadata, glb });
    await database().query(
      "UPDATE generated_models SET ready=true,updated_at=now() WHERE owner_id=$1 AND sha256=$2",
      [user.id, metadata.sha256],
    );
    return Response.json(
      { metadata: savedMetadata },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const hash = new URL(request.url).searchParams.get("hash") ?? "";
    if (!/^[a-f0-9]{64}$/.test(hash))
      throw new HttpError(400, "Invalid model identity.");
    const result = await database().query(
      "SELECT metadata FROM generated_models WHERE owner_id=$1 AND sha256=$2 AND ready=true",
      [user.id, hash],
    );
    if (!result.rows[0])
      throw new HttpError(404, "This model is not in your cloud library.");
    const model = await readCloudGeneratedModel(
      user.id,
      generatedModelMetadataSchema.parse(result.rows[0].metadata),
    );
    return Response.json(
      {
        metadata: model.metadata,
        glb: Buffer.from(model.glb).toString("base64"),
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    return failure(error);
  }
}
