import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assetManifest,
  findCatalogAsset,
  type CatalogAsset,
} from "../asset-catalog";

export const PUBLICATION_MANIFEST_FILE = "publication-manifest.json";
export const PUBLICATION_ARTIFACT_PATHS = [
  "index.html",
  "project.json",
  "runtime.js",
  "runtime.css",
] as const;
export const PUBLICATION_USED_ASSETS_FILE = "assets/catalog/used-assets.json";

const MANIFEST_VERSION = 2;
const LEGACY_MANIFEST_VERSION = 1;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_FILES = 64;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_PARALLEL_FETCHES = 2;

type PublicationPath = string;
export type PublicationFile = {
  file: PublicationPath;
  data: string | Uint8Array;
};
export type PublicationManifest = {
  version: typeof MANIFEST_VERSION | typeof LEGACY_MANIFEST_VERSION;
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

export function isKnownPublicationPath(value: string): boolean {
  if (!isSafePublicationPath(value)) return false;
  return (
    (PUBLICATION_ARTIFACT_PATHS as readonly string[]).includes(value) ||
    value === PUBLICATION_USED_ASSETS_FILE ||
    catalogAssetPaths.has(value) ||
    catalogLicensePaths.has(value)
  );
}

function publicationByteLength(data: string | Uint8Array) {
  return typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
}

const manifestSchema = z
  .object({
    version: z.union([
      z.literal(LEGACY_MANIFEST_VERSION),
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
  let project: unknown;
  try {
    project = JSON.parse(new TextDecoder().decode(projectBytes));
  } catch {
    throw new PublicationVerificationError(
      "The public deployment project snapshot is not valid JSON.",
    );
  }
  if (
    !project ||
    typeof project !== "object" ||
    (project as { id?: unknown }).id !== options.projectId ||
    (project as { revision?: unknown }).revision !== options.revision
  )
    throw new PublicationVerificationError(
      "The public deployment contains a different world or revision.",
    );
  verifyCatalogReferences(project, manifest, assets);
}
