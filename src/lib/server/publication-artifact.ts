import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assetManifest,
  findCatalogAsset,
  type CatalogAsset,
} from "../asset-catalog";
import { validateGeneratedGLB } from "../generated-glb";
import {
  generatedModelMetadataSchema,
  type GeneratedModelMetadata,
} from "../generated-models";
import { projectSchema } from "../protocol";

export const PUBLICATION_MANIFEST_FILE = "publication-manifest.json";
export const PUBLICATION_ARTIFACT_PATHS = [
  "index.html",
  "project.json",
  "runtime.js",
  "runtime.css",
] as const;
export const PUBLICATION_USED_ASSETS_FILE = "assets/catalog/used-assets.json";
export const PUBLICATION_GENERATED_MODEL_MANIFEST =
  "models/generated/manifest.json";

export const PUBLICATION_GEOMETRY_WORKER = "generated-geometry-worker.js";
const MANIFEST_VERSION = 3;
const ASSET_MANIFEST_VERSION = 2;
const LEGACY_MANIFEST_VERSION = 1;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_FILES = 64;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_PARALLEL_FETCHES = 2;
const GENERATED_MODEL_PATH = /^models\/generated\/([a-f0-9]{64})\.glb$/;

type PublicationPath = string;
export type PublicationFile = {
  file: PublicationPath;
  data: string | Uint8Array;
};
export type PublicationManifest = {
  version:
    | typeof MANIFEST_VERSION
    | typeof ASSET_MANIFEST_VERSION
    | typeof LEGACY_MANIFEST_VERSION;
  projectId: string;
  revision: number;
  files: Array<{
    file: string;
    bytes: number;
    sha256: string;
  }>;
};

export type VercelDeploymentFile = {
  file: string;
  data: string;
  encoding?: "base64";
};

type PublicationBytes = {
  file: string;
  bytes: Uint8Array;
};

const catalogAssetPaths = new Map<string, CatalogAsset>(
  assetManifest.assets.map((asset) => [asset.path.slice(1), asset]),
);
const catalogLicensePaths = new Set(
  assetManifest.sources.map((source) => source.license.textFile),
);

function isSafePublicationPath(value: string) {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("..") &&
    !value.includes("\0") &&
    !/[?#]/.test(value) &&
    !/^[a-z][a-z\d+.-]*:/i.test(value)
  );
}

function generatedModelPath(hash: string) {
  return `models/generated/${hash}.glb`;
}

function generatedModelHash(path: string) {
  return GENERATED_MODEL_PATH.exec(path)?.[1];
}

export function isKnownPublicationPath(value: string): boolean {
  if (!isSafePublicationPath(value)) return false;
  return (
    (PUBLICATION_ARTIFACT_PATHS as readonly string[]).includes(value) ||
    value === PUBLICATION_GEOMETRY_WORKER ||
    value === PUBLICATION_USED_ASSETS_FILE ||
    value === PUBLICATION_GENERATED_MODEL_MANIFEST ||
    GENERATED_MODEL_PATH.test(value) ||
    catalogAssetPaths.has(value) ||
    catalogLicensePaths.has(value)
  );
}

function publicationByteLength(data: string | Uint8Array) {
  return typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
}

function publicationBytes(data: string | Uint8Array) {
  return typeof data === "string"
    ? new TextEncoder().encode(data)
    : new Uint8Array(data);
}

const manifestSchema = z
  .object({
    version: z.union([
      z.literal(LEGACY_MANIFEST_VERSION),
      z.literal(ASSET_MANIFEST_VERSION),
      z.literal(MANIFEST_VERSION),
    ]),
    projectId: z.string().min(1).max(80),
    revision: z.number().int().min(0),
    files: z
      .array(
        z.object({
          file: z.string().min(1).max(255),
          bytes: z.number().int().nonnegative().max(MAX_ARTIFACT_BYTES),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .max(MAX_MANIFEST_FILES),
  })
  .strict();

export type PublicationVerificationFailureKind =
  "protected" | "invalid" | "unavailable";

export class PublicationVerificationError extends Error {
  constructor(
    message: string,
    public readonly kind: PublicationVerificationFailureKind = "invalid",
  ) {
    super(message);
    this.name = "PublicationVerificationError";
  }
}

export function sha256(data: Uint8Array | string) {
  return createHash("sha256").update(data).digest("hex");
}

export function isPublicationDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

const generatedManifestSchema = z
  .object({
    version: z.literal(1),
    models: z.array(generatedModelMetadataSchema).max(MAX_MANIFEST_FILES),
  })
  .strict();

function parsePublicationJSON(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new PublicationVerificationError(`${label} is not valid JSON.`);
  }
}

function containsGeneratedGeometry(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const entities = (value as { entities?: unknown }).entities;
  return (
    Array.isArray(entities) &&
    entities.some(
      (entity) =>
        entity &&
        typeof entity === "object" &&
        (entity as { geometry?: unknown }).geometry &&
        typeof (entity as { geometry?: unknown }).geometry === "object" &&
        (entity as { geometry: { kind?: unknown } }).geometry.kind ===
          "generated",
    )
  );
}

function sameGeneratedProvenance(
  left: GeneratedModelMetadata,
  right: GeneratedModelMetadata,
) {
  return (
    left.version === right.version &&
    left.sha256 === right.sha256 &&
    left.bytes === right.bytes &&
    left.source === right.source &&
    left.blenderVersion === right.blenderVersion &&
    JSON.stringify(left.bounds) === JSON.stringify(right.bounds)
  );
}

function generatedProjectReferences(project: unknown) {
  if (!containsGeneratedGeometry(project))
    return new Map<string, GeneratedModelMetadata>();
  const parsed = projectSchema.safeParse(project);
  if (!parsed.success)
    throw new PublicationVerificationError(
      "The generated project snapshot is incomplete or invalid.",
    );
  const references = new Map<string, GeneratedModelMetadata>();
  for (const entity of parsed.data.entities) {
    if (entity.geometry?.kind !== "generated") continue;
    if (!entity.geometry.model)
      throw new PublicationVerificationError(
        "The generated project contains an unfinished generated model.",
      );
    const metadata = generatedModelMetadataSchema.parse(entity.geometry.model);
    const previous = references.get(metadata.sha256);
    if (previous && !sameGeneratedProvenance(previous, metadata))
      throw new PublicationVerificationError(
        `Generated model ${metadata.sha256} has conflicting project provenance.`,
      );
    references.set(metadata.sha256, metadata);
  }
  return references;
}

function parseGeneratedManifest(bytes: Uint8Array) {
  const parsed = generatedManifestSchema.safeParse(
    parsePublicationJSON(bytes, "The generated model manifest"),
  );
  if (!parsed.success)
    throw new PublicationVerificationError(
      "The generated model manifest is invalid.",
    );
  if (
    new Set(parsed.data.models.map((model) => model.sha256)).size !==
    parsed.data.models.length
  )
    throw new PublicationVerificationError(
      "The generated model manifest contains duplicate models.",
    );
  return parsed.data;
}

function validateGeneratedPublication(
  project: unknown,
  entries: readonly PublicationBytes[],
) {
  const references = generatedProjectReferences(project);
  const modelEntries = entries.filter(({ file }) => generatedModelHash(file));
  const manifestEntry = entries.find(
    ({ file }) => file === PUBLICATION_GENERATED_MODEL_MANIFEST,
  );
  if (!references.size) {
    if (modelEntries.length || manifestEntry)
      throw new PublicationVerificationError(
        "The publication contains generated assets that are not referenced by the project.",
      );
    return;
  }
  if (!manifestEntry)
    throw new PublicationVerificationError(
      "The publication is missing models/generated/manifest.json.",
    );
  const generatedManifest = parseGeneratedManifest(manifestEntry.bytes);
  const manifestModels = new Map(
    generatedManifest.models.map((model) => [model.sha256, model]),
  );
  const modelFiles = new Map(
    modelEntries.map((entry) => [generatedModelHash(entry.file)!, entry]),
  );
  if (
    modelEntries.length !== references.size ||
    modelFiles.size !== modelEntries.length ||
    manifestModels.size !== references.size
  )
    throw new PublicationVerificationError(
      "The publication generated model set does not match the project references.",
    );
  for (const [hash, expected] of references) {
    const entry = modelFiles.get(hash);
    if (!entry)
      throw new PublicationVerificationError(
        `The publication is missing generated model ${hash}.`,
      );
    const actualBytes = entry.bytes.byteLength;
    const actualHash = sha256(entry.bytes);
    if (
      actualBytes !== expected.bytes ||
      actualHash !== hash ||
      actualHash !== expected.sha256
    )
      throw new PublicationVerificationError(
        `Generated model ${hash} failed its SHA-256 or byte-length check.`,
      );
    try {
      validateGeneratedGLB(entry.bytes, expected.bounds);
    } catch {
      throw new PublicationVerificationError(
        `Generated model ${hash} failed GLB validation.`,
      );
    }
    const manifestModel = manifestModels.get(hash);
    if (!manifestModel)
      throw new PublicationVerificationError(
        `The generated model manifest is missing model ${hash}.`,
      );
    if (!sameGeneratedProvenance(manifestModel, expected))
      throw new PublicationVerificationError(
        `The generated model manifest provenance for ${hash} does not match the project.`,
      );
  }
  for (const hash of manifestModels.keys()) {
    if (!references.has(hash))
      throw new PublicationVerificationError(
        `The generated model manifest contains unreferenced model ${hash}.`,
      );
  }
}

function canonicalManifest(manifest: PublicationManifest) {
  return JSON.stringify(manifest);
}

export function makePublicationManifest(
  projectId: string,
  revision: number,
  files: readonly PublicationFile[],
): { manifest: PublicationManifest; data: string; digest: string } {
  if (
    files.length < PUBLICATION_ARTIFACT_PATHS.length ||
    files.some(
      (file, index) =>
        index < PUBLICATION_ARTIFACT_PATHS.length &&
        file.file !== PUBLICATION_ARTIFACT_PATHS[index],
    ) ||
    files.length > MAX_MANIFEST_FILES ||
    files.some((file) => !isKnownPublicationPath(file.file))
  ) {
    throw new Error(
      "Publication files must contain the immutable runtime set and only known local catalog paths.",
    );
  }
  if (!files.some((file) => file.file === PUBLICATION_GEOMETRY_WORKER))
    throw new Error("Publication is missing its generated geometry worker.");
  const projectFile = files.find((file) => file.file === "project.json");
  if (!projectFile)
    throw new Error("Publication files must contain project.json.");
  validateGeneratedPublication(
    parsePublicationJSON(
      publicationBytes(projectFile.data),
      "The project snapshot",
    ),
    files.map((file) => ({
      file: file.file,
      bytes: publicationBytes(file.data),
    })),
  );
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    if (paths.has(file.file))
      throw new Error(`Publication file ${file.file} is duplicated.`);
    paths.add(file.file);
    const bytes = publicationByteLength(file.data);
    if (bytes > MAX_ARTIFACT_BYTES)
      throw new Error(
        `Publication asset ${file.file} is larger than the publication verification limit.`,
      );
    totalBytes += bytes;
  }
  if (totalBytes > MAX_TOTAL_ARTIFACT_BYTES)
    throw new Error(
      "The publication exceeds the aggregate asset verification limit.",
    );
  const manifest: PublicationManifest = {
    version: MANIFEST_VERSION,
    projectId,
    revision,
    files: files.map(({ file, data }) => ({
      file,
      bytes: publicationByteLength(data),
      sha256: sha256(data),
    })),
  };
  const data = canonicalManifest(manifest);
  return { manifest, data, digest: sha256(data) };
}

export function toVercelDeploymentFile(
  file: PublicationFile,
): VercelDeploymentFile {
  if (!isKnownPublicationPath(file.file))
    throw new Error("Vercel deployment files must use known local paths.");
  if (typeof file.data === "string")
    return { file: file.file, data: file.data };
  return {
    file: file.file,
    data: Buffer.from(file.data).toString("base64"),
    encoding: "base64",
  };
}

function deploymentOrigin(rawUrl: string) {
  if (!rawUrl || rawUrl.length > 255 || /[\r\n]/.test(rawUrl))
    throw new PublicationVerificationError(
      "Vercel returned an invalid deployment URL. Publication is still verifying.",
    );
  const url = new URL(rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !url.hostname ||
    url.port ||
    !url.hostname.toLowerCase().endsWith(".vercel.app")
  ) {
    throw new PublicationVerificationError(
      "Vercel returned a deployment URL outside the trusted Vercel host. Publication is still verifying.",
    );
  }
  return url;
}

function artifactUrl(origin: URL, file: string) {
  const url = new URL(file, origin);
  if (url.origin !== origin.origin || url.pathname !== `/${file}`)
    throw new PublicationVerificationError(
      "Publication verification encountered an unsafe asset URL.",
    );
  return url;
}

async function readBounded(
  response: Response,
  limit: number,
  label: string,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > limit) {
    await cancelBody(response);
    throw new PublicationVerificationError(
      `${label} is larger than the publication verification limit.`,
    );
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit)
      throw new PublicationVerificationError(
        `${label} is larger than the publication verification limit.`,
      );
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new PublicationVerificationError(
          `${label} is larger than the publication verification limit.`,
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function cancelBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The response is already being rejected; cancellation is best effort.
  }
}

async function fetchAnonymous(
  origin: URL,
  file: string,
  limit: number,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(artifactUrl(origin, file), {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new PublicationVerificationError(
      `Could not fetch ${file} from the public deployment.`,
      "unavailable",
    );
  }
  if (response.status === 401 || response.status === 403) {
    await cancelBody(response);
    throw new PublicationVerificationError(
      "The deployment is protected from anonymous visitors. Review Vercel deployment protection.",
      "protected",
    );
  }
  if (response.status >= 300 && response.status < 400) {
    await cancelBody(response);
    throw new PublicationVerificationError(
      `The public deployment redirected while verifying ${file}; redirects are not accepted.`,
    );
  }
  if (!response.ok) {
    await cancelBody(response);
    throw new PublicationVerificationError(
      `The public deployment did not serve ${file} (HTTP ${response.status}).`,
    );
  }
  return readBounded(response, limit, file);
}

function parseManifest(bytes: Uint8Array): PublicationManifest {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new PublicationVerificationError(
      "The public deployment manifest is not valid JSON.",
    );
  }
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success)
    throw new PublicationVerificationError(
      "The public deployment manifest is invalid.",
    );
  const files = parsed.data.files;
  if (
    parsed.data.version === MANIFEST_VERSION &&
    !files.some((file) => file.file === PUBLICATION_GEOMETRY_WORKER)
  )
    throw new PublicationVerificationError(
      "The public deployment is missing its generated geometry worker.",
    );
  if (
    files.length < PUBLICATION_ARTIFACT_PATHS.length ||
    files.some(
      (file, index) =>
        index < PUBLICATION_ARTIFACT_PATHS.length &&
        file.file !== PUBLICATION_ARTIFACT_PATHS[index],
    ) ||
    files.some((file) => !isKnownPublicationPath(file.file))
  )
    throw new PublicationVerificationError(
      "The public deployment manifest does not describe the expected assets.",
    );
  if (
    parsed.data.version === LEGACY_MANIFEST_VERSION &&
    files.length !== PUBLICATION_ARTIFACT_PATHS.length
  )
    throw new PublicationVerificationError(
      "The legacy publication manifest contains unsupported asset files.",
    );
  if (new Set(files.map((file) => file.file)).size !== files.length)
    throw new PublicationVerificationError(
      "The public deployment manifest contains duplicate files.",
    );
  return parsed.data as PublicationManifest;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return results;
}

function referencedCatalogAssets(project: unknown): CatalogAsset[] {
  if (!project || typeof project !== "object") return [];
  const entities = (project as { entities?: unknown }).entities;
  if (!Array.isArray(entities)) return [];
  const assets = new Map<string, CatalogAsset>();
  for (const entity of entities) {
    if (!entity || typeof entity !== "object") continue;
    const geometry = (entity as { geometry?: unknown }).geometry;
    if (!geometry || typeof geometry !== "object") continue;
    if ((geometry as { kind?: unknown }).kind !== "asset") continue;
    const assetId = (geometry as { assetId?: unknown }).assetId;
    const asset = findCatalogAsset(assetId);
    if (!asset)
      throw new PublicationVerificationError(
        "The public deployment references an unknown catalog asset.",
      );
    assets.set(asset.id, asset);
  }
  return [...assets.values()];
}

function parseUsedAssets(bytes: Uint8Array) {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new PublicationVerificationError(
      "The public deployment catalog provenance is not valid JSON.",
    );
  }
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as { assets?: unknown }).assets) ||
    !Array.isArray((value as { sources?: unknown }).sources)
  )
    throw new PublicationVerificationError(
      "The public deployment catalog provenance is incomplete.",
    );
  return value as {
    assets: Array<{
      id?: unknown;
      path?: unknown;
      sizeBytes?: unknown;
      sha256?: unknown;
      sourceId?: unknown;
    }>;
    sources: Array<{
      sourceId?: unknown;
      license?: {
        textFile?: unknown;
        textSha256?: unknown;
      };
    }>;
  };
}

function verifyCatalogReferences(
  project: unknown,
  manifest: PublicationManifest,
  assets: Array<{
    entry: PublicationManifest["files"][number];
    bytes: Uint8Array;
  }>,
) {
  const referenced = referencedCatalogAssets(project);
  if (!referenced.length) return;
  const entries = new Map(manifest.files.map((entry) => [entry.file, entry]));
  const downloaded = new Map(
    assets.map(({ entry, bytes }) => [entry.file, { entry, bytes }]),
  );
  const provenanceEntry = entries.get(PUBLICATION_USED_ASSETS_FILE);
  const provenanceBytes = downloaded.get(PUBLICATION_USED_ASSETS_FILE)?.bytes;
  if (!provenanceEntry || !provenanceBytes)
    throw new PublicationVerificationError(
      "The public deployment is missing catalog provenance for referenced assets.",
    );
  const provenance = parseUsedAssets(provenanceBytes);
  for (const asset of referenced) {
    const modelPath = asset.path.slice(1);
    const modelEntry = entries.get(modelPath);
    if (!modelEntry)
      throw new PublicationVerificationError(
        `The public deployment is missing catalog asset ${asset.id}.`,
      );
    if (
      modelEntry.bytes !== asset.sizeBytes ||
      modelEntry.sha256 !== asset.sha256
    )
      throw new PublicationVerificationError(
        `The public deployment catalog asset ${asset.id} failed its catalog integrity check.`,
      );
    const source = assetManifest.sources.find(
      (candidate) => candidate.sourceId === asset.sourceId,
    );
    const licensePath = source?.license.textFile;
    if (!source || !licensePath)
      throw new PublicationVerificationError(
        `The catalog source for ${asset.id} is incomplete.`,
      );
    const licenseEntry = entries.get(licensePath);
    if (!licenseEntry)
      throw new PublicationVerificationError(
        `The public deployment is missing the license for catalog asset ${asset.id}.`,
      );
    if (licenseEntry.sha256 !== source.license.textSha256)
      throw new PublicationVerificationError(
        `The public deployment license for catalog asset ${asset.id} failed its integrity check.`,
      );
    const metadataAsset = provenance.assets.find(
      (candidate) => candidate.id === asset.id,
    );
    if (
      !metadataAsset ||
      JSON.stringify(metadataAsset) !== JSON.stringify(asset)
    )
      throw new PublicationVerificationError(
        `The public deployment catalog provenance does not describe ${asset.id}.`,
      );
    const metadataSource = provenance.sources.find(
      (candidate) => candidate.sourceId === source.sourceId,
    );
    if (
      !metadataSource ||
      JSON.stringify(metadataSource) !== JSON.stringify(source)
    )
      throw new PublicationVerificationError(
        `The public deployment license provenance for ${asset.id} is incomplete.`,
      );
  }
}

export async function verifyPublicationArtifacts(options: {
  deploymentUrl: string;
  projectId: string;
  revision: number;
  expectedDigest: string;
}) {
  const origin = deploymentOrigin(options.deploymentUrl);
  if (!isPublicationDigest(options.expectedDigest))
    throw new PublicationVerificationError(
      "The deployment is missing valid integrity metadata. Publish it again to create a verifiable release.",
    );
  const manifestBytes = await fetchAnonymous(
    origin,
    PUBLICATION_MANIFEST_FILE,
    MAX_MANIFEST_BYTES,
  );
  if (sha256(manifestBytes) !== options.expectedDigest)
    throw new PublicationVerificationError(
      "The public deployment manifest does not match the immutable release metadata.",
    );
  const manifest = parseManifest(manifestBytes);
  if (
    manifest.projectId !== options.projectId ||
    manifest.revision !== options.revision
  )
    throw new PublicationVerificationError(
      "The public deployment contains a different world or revision.",
    );
  const totalBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
  if (
    manifest.files.length > MAX_MANIFEST_FILES ||
    totalBytes > MAX_TOTAL_ARTIFACT_BYTES
  )
    throw new PublicationVerificationError(
      "The public deployment exceeds the publication verification limit.",
    );
  const assets = await mapWithConcurrency(
    manifest.files,
    MAX_PARALLEL_FETCHES,
    async (entry) => ({
      entry,
      bytes: await fetchAnonymous(origin, entry.file, MAX_ARTIFACT_BYTES),
    }),
  );
  for (const { entry, bytes } of assets) {
    if (bytes.byteLength !== entry.bytes || sha256(bytes) !== entry.sha256)
      throw new PublicationVerificationError(
        `The public deployment asset ${entry.file} is missing or corrupt.`,
      );
  }
  const projectBytes = assets.find(
    ({ entry }) => entry.file === "project.json",
  )?.bytes;
  if (!projectBytes)
    throw new PublicationVerificationError(
      "The public deployment is missing project.json.",
    );
  const project = parsePublicationJSON(
    projectBytes,
    "The public deployment project snapshot",
  );
  if (
    !project ||
    typeof project !== "object" ||
    (project as { id?: unknown }).id !== options.projectId ||
    (project as { revision?: unknown }).revision !== options.revision
  )
    throw new PublicationVerificationError(
      "The public deployment contains a different world or revision.",
    );
  validateGeneratedPublication(
    project,
    assets.map(({ entry, bytes }) => ({ file: entry.file, bytes })),
  );
  verifyCatalogReferences(project, manifest, assets);
}
