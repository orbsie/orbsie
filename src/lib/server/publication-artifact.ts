import { createHash } from "node:crypto";
import { z } from "zod";

export const PUBLICATION_MANIFEST_FILE = "publication-manifest.json";
export const PUBLICATION_ARTIFACT_PATHS = [
  "index.html",
  "project.json",
  "runtime.js",
  "runtime.css",
] as const;

const MANIFEST_VERSION = 1;
const MAX_MANIFEST_BYTES = 64 * 1024;
// Four immutable assets are fetched, so this also bounds their aggregate body
// size at MAX_TOTAL_ARTIFACT_BYTES even when a manifest understates a length.
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_ARTIFACT_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_PARALLEL_FETCHES = 2;

type PublicationPath = (typeof PUBLICATION_ARTIFACT_PATHS)[number];
export type PublicationFile = {
  file: PublicationPath;
  data: string;
};
export type PublicationManifest = {
  version: typeof MANIFEST_VERSION;
  projectId: string;
  revision: number;
  files: Array<{
    file: PublicationPath;
    bytes: number;
    sha256: string;
  }>;
};

const manifestSchema = z
  .object({
    version: z.literal(MANIFEST_VERSION),
    projectId: z.string().min(1).max(80),
    revision: z.number().int().min(0),
    files: z.array(
      z.object({
        file: z.enum(PUBLICATION_ARTIFACT_PATHS),
        bytes: z.number().int().nonnegative().max(MAX_ARTIFACT_BYTES),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    ),
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
    files.length !== PUBLICATION_ARTIFACT_PATHS.length ||
    files.some((file, index) => file.file !== PUBLICATION_ARTIFACT_PATHS[index])
  ) {
    throw new Error(
      "Publication files must contain the immutable runtime set.",
    );
  }
  for (const file of files) {
    if (Buffer.byteLength(file.data) > MAX_ARTIFACT_BYTES)
      throw new Error(
        `Publication asset ${file.file} is larger than the publication verification limit.`,
      );
  }
  const manifest: PublicationManifest = {
    version: MANIFEST_VERSION,
    projectId,
    revision,
    files: files.map(({ file, data }) => ({
      file,
      bytes: Buffer.byteLength(data),
      sha256: sha256(data),
    })),
  };
  const data = canonicalManifest(manifest);
  return { manifest, data, digest: sha256(data) };
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
    files.length !== PUBLICATION_ARTIFACT_PATHS.length ||
    files.some((file, index) => file.file !== PUBLICATION_ARTIFACT_PATHS[index])
  )
    throw new PublicationVerificationError(
      "The public deployment manifest does not describe the expected assets.",
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
  if (totalBytes > MAX_TOTAL_ARTIFACT_BYTES)
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
}
