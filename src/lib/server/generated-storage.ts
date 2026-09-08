import { createHash } from "node:crypto";
import { getVercelOidcToken } from "@vercel/oidc";
import {
  MAX_GENERATED_MODEL_BYTES,
  generatedModelMetadataSchema,
  type GeneratedModel,
  type GeneratedModelMetadata,
} from "../generated-models";
import { validateGeneratedGLB } from "../generated-glb";

const STS_URL = "https://sts.googleapis.com/v1/token";
const STORAGE_API = "https://storage.googleapis.com";
const STS_TIMEOUT_MS = 6_000;
const STORAGE_TIMEOUT_MS = 8_000;

export function cloudGeneratedModelsEnabled(): boolean {
  return Boolean(
    process.env.GCS_BUCKET?.trim() &&
    process.env.GCP_WORKLOAD_IDENTITY_PROVIDER?.trim(),
  );
}

export class CloudGeneratedModelError extends Error {
  readonly status: number;

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CloudGeneratedModelError";
    this.status = status;
  }
}

type CloudConfig = {
  bucket: string;
  audience: string;
};

function cloudConfig(): CloudConfig {
  const bucket = process.env.GCS_BUCKET?.trim();
  const audience = process.env.GCP_WORKLOAD_IDENTITY_PROVIDER?.trim();
  if (!bucket || !audience)
    throw new CloudGeneratedModelError(
      503,
      "Private generated model storage is not configured.",
    );
  return { bucket, audience };
}

function ownerHash(ownerId: string): string {
  if (typeof ownerId !== "string" || !ownerId.trim() || ownerId.length > 512)
    throw new CloudGeneratedModelError(
      400,
      "Generated model ownership is required.",
    );
  return createHash("sha256").update(ownerId).digest("hex");
}

function storageUrl(bucket: string, object: string): string {
  return `${STORAGE_API}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`;
}

function uploadUrl(bucket: string, object: string): string {
  const query = new URLSearchParams({
    uploadType: "media",
    name: object,
    ifGenerationMatch: "0",
  });
  return `${STORAGE_API}/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?${query}`;
}

async function accessToken(config: CloudConfig): Promise<string> {
  let response: Response;
  try {
    response = await fetch(STS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
        audience: config.audience,
        scope: "https://www.googleapis.com/auth/devstorage.read_write",
        requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
        subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
        subjectToken: await getVercelOidcToken(),
      }),
      signal: AbortSignal.timeout(STS_TIMEOUT_MS),
      redirect: "error",
      cache: "no-store",
    });
  } catch (error) {
    throw new CloudGeneratedModelError(
      502,
      "Cloud generated model authentication failed.",
      { cause: error },
    );
  }
  if (!response.ok)
    throw new CloudGeneratedModelError(
      502,
      "Cloud generated model authentication failed.",
    );
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new CloudGeneratedModelError(
      502,
      "Cloud generated model authentication failed.",
      { cause: error },
    );
  }
  const token =
    payload && typeof payload === "object" && "access_token" in payload
      ? payload.access_token
      : undefined;
  if (typeof token !== "string" || !token)
    throw new CloudGeneratedModelError(
      502,
      "Cloud generated model authentication failed.",
    );
  return token;
}

function validatedMetadata(value: unknown): GeneratedModelMetadata {
  try {
    return generatedModelMetadataSchema.parse(value);
  } catch (error) {
    throw new CloudGeneratedModelError(
      400,
      "Generated model metadata is invalid.",
      { cause: error },
    );
  }
}

function copiedBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array))
    throw new CloudGeneratedModelError(
      400,
      "Generated model bytes are invalid.",
    );
  const bytes = new Uint8Array(value);
  if (bytes.byteLength > MAX_GENERATED_MODEL_BYTES)
    throw new CloudGeneratedModelError(
      400,
      "Generated model exceeds the byte limit.",
    );
  return bytes;
}

function validateModelForWrite(model: GeneratedModel): {
  metadata: GeneratedModelMetadata;
  glb: Uint8Array;
} {
  if (!model || typeof model !== "object")
    throw new CloudGeneratedModelError(400, "Generated model is invalid.");
  const metadata = validatedMetadata(model.metadata);
  const glb = copiedBytes(model.glb);
  if (metadata.bytes !== glb.byteLength)
    throw new CloudGeneratedModelError(
      400,
      "Generated model metadata does not match its bytes.",
    );
  const digest = createHash("sha256").update(glb).digest("hex");
  if (digest !== metadata.sha256)
    throw new CloudGeneratedModelError(
      400,
      "Generated model content does not match its digest.",
    );
  try {
    validateGeneratedGLB(glb, metadata.bounds);
  } catch (error) {
    throw new CloudGeneratedModelError(
      400,
      "Generated model GLB validation failed.",
      { cause: error },
    );
  }
  return { metadata, glb };
}

async function boundedResponseBytes(response: Response): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0)
      throw new CloudGeneratedModelError(
        502,
        "Cloud generated model returned an invalid size.",
      );
    if (size > MAX_GENERATED_MODEL_BYTES)
      throw new CloudGeneratedModelError(
        502,
        "Cloud generated model exceeds the byte limit.",
      );
  }
  if (!response.body)
    throw new CloudGeneratedModelError(
      502,
      "Cloud generated model returned no body.",
    );
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_GENERATED_MODEL_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new CloudGeneratedModelError(
          502,
          "Cloud generated model exceeds the byte limit.",
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readProviderBytes(
  config: CloudConfig,
  token: string,
  object: string,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(storageUrl(config.bucket, object), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
      redirect: "error",
      cache: "no-store",
    });
  } catch (error) {
    throw new CloudGeneratedModelError(
      502,
      "Cloud generated model could not be read.",
      { cause: error },
    );
  }
  if (response.status === 404)
    throw new CloudGeneratedModelError(
      404,
      "Generated model was not found in private storage.",
    );
  if (!response.ok)
    throw new CloudGeneratedModelError(
      502,
      "Cloud generated model could not be read.",
    );
  try {
    return await boundedResponseBytes(response);
  } catch (error) {
    if (error instanceof CloudGeneratedModelError) throw error;
    throw new CloudGeneratedModelError(
      502,
      "Cloud generated model could not be read.",
      { cause: error },
    );
  }
}

function validateStoredBytes(
  bytes: Uint8Array,
  metadata: GeneratedModelMetadata,
): void {
  if (bytes.byteLength !== metadata.bytes)
    throw new CloudGeneratedModelError(
      502,
      "Cloud generated model metadata does not match its bytes.",
    );
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== metadata.sha256)
    throw new CloudGeneratedModelError(
      502,
      "Cloud generated model content failed integrity verification.",
    );
  try {
    validateGeneratedGLB(bytes, metadata.bounds);
  } catch (error) {
    throw new CloudGeneratedModelError(
      502,
      "Cloud generated model GLB validation failed.",
      { cause: error },
    );
  }
}

async function validateExistingObject(
  config: CloudConfig,
  token: string,
  object: string,
  expected: { metadata: GeneratedModelMetadata; glb: Uint8Array },
): Promise<void> {
  const existing = await readProviderBytes(config, token, object);
  validateStoredBytes(existing, expected.metadata);
  if (
    existing.byteLength !== expected.glb.byteLength ||
    existing.some((value, index) => value !== expected.glb[index])
  )
    throw new CloudGeneratedModelError(
      502,
      "Cloud generated model storage contains conflicting bytes.",
    );
}

export async function writeCloudGeneratedModel(
  ownerId: string,
  model: GeneratedModel,
): Promise<void> {
  const config = cloudConfig();
  const owner = ownerHash(ownerId);
  const expected = validateModelForWrite(model);
  const token = await accessToken(config);
  const object = `generated/${owner}/${expected.metadata.sha256}.glb`;
  let response: Response;
  try {
    response = await fetch(uploadUrl(config.bucket, object), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "model/gltf-binary",
      },
      body: Buffer.from(expected.glb),
      signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
      redirect: "error",
      cache: "no-store",
    });
  } catch (error) {
    throw new CloudGeneratedModelError(
      502,
      "Cloud generated model could not be saved.",
      { cause: error },
    );
  }
  if (response.status === 412) {
    await validateExistingObject(config, token, object, expected);
    return;
  }
  if (!response.ok)
    throw new CloudGeneratedModelError(
      502,
      "Cloud generated model could not be saved.",
    );
}

export async function readCloudGeneratedModel(
  ownerId: string,
  value: GeneratedModelMetadata,
): Promise<GeneratedModel> {
  const config = cloudConfig();
  const owner = ownerHash(ownerId);
  const metadata = validatedMetadata(value);
  const token = await accessToken(config);
  const object = `generated/${owner}/${metadata.sha256}.glb`;
  const glb = await readProviderBytes(config, token, object);
  validateStoredBytes(glb, metadata);
  return { metadata, glb };
}
