import { createHash } from "node:crypto";
import { getVercelOidcToken } from "@vercel/oidc";
import { committed, projectSchema, type Project } from "../protocol";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Private, content-addressed archives; callers must establish project ownership. */
export async function archiveProjectSnapshot(
  ownerId: string,
  project: Project,
) {
  const bucket = process.env.GCS_BUCKET;
  const audience = process.env.GCP_WORKLOAD_IDENTITY_PROVIDER;
  if (!bucket || !audience) return null;
  if (!ownerId) throw Error("Archive ownership is required.");
  const snapshot = committed(projectSchema.parse(project));
  const body = JSON.stringify(snapshot);
  if (Buffer.byteLength(body) > 500_000) throw Error("Archive is too large.");
  const object = `snapshots/${hash(ownerId)}/${hash(snapshot.id)}/${snapshot.revision}-${hash(body)}.json`;
  const tokenResponse = await fetch("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience,
      scope: "https://www.googleapis.com/auth/devstorage.read_write",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
      subjectToken: await getVercelOidcToken(),
    }),
    signal: AbortSignal.timeout(6000),
    cache: "no-store",
  });
  if (!tokenResponse.ok) throw Error("Archive authentication failed.");
  const token = (await tokenResponse.json()).access_token;
  if (typeof token !== "string" || !token)
    throw Error("Archive authentication failed.");
  const query = new URLSearchParams({
    uploadType: "media",
    name: object,
    ifGenerationMatch: "0",
  });
  const response = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?${query}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    },
  );
  // A content-addressed object already exists: a retry must never overwrite it.
  if (response.status === 412) return { object, generation: "existing" };
  if (!response.ok) throw Error("Cloud archive could not be saved.");
  const metadata = await response.json();
  return { object, generation: String(metadata.generation) };
}
