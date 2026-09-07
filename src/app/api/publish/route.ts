import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  requireUser,
  database,
  checkOrigin,
  apiError,
  boundedJSON,
  HttpError,
} from "@/lib/server/auth";
import { projectSchema } from "@/lib/protocol";
export const maxDuration = 60;
const publicPath = (id: string) => `/o/${encodeURIComponent(id)}`;
async function vercel(path: string, method = "GET", body?: unknown) {
  const token = process.env.VERCEL_DEPLOY_TOKEN,
    team = process.env.VERCEL_TEAM_ID;
  if (!token || !team)
    throw new HttpError(
      503,
      "Dedicated publishing is not configured. Download or share a play link instead.",
    );
  const response = await fetch(
    `https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(team)}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(18000),
    },
  );
  if (!response.ok)
    throw new HttpError(
      response.status === 404 ? 404 : 502,
      response.status === 429
        ? "Vercel is rate limiting publication. Retry later."
        : `Vercel could not complete publication (${response.status}). Your previous release is safe.`,
    );
  return response.json();
}
export async function POST(request: Request) {
  let client;
  try {
    checkOrigin(request);
    const user = await requireUser(request);
    const { projectId, revision } = z
      .object({
        projectId: z.string().max(80),
        revision: z.number().int().min(0),
      })
      .parse(await boundedJSON(request, 1000));
    client = await database().connect();
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT * FROM orbs WHERE id=$1 AND owner_id=$2 FOR UPDATE",
      [projectId, user.id],
    );
    const orb = result.rows[0];
    if (!orb)
      throw new HttpError(
        404,
        "Save your world to your account before publishing.",
      );
    if (orb.revision !== revision)
      throw new HttpError(
        409,
        "Save this revision to the cloud before publishing.",
      );
    if (orb.deployment_id && orb.publication_revision === revision) {
      const deployment = await vercel(`/v13/deployments/${orb.deployment_id}`);
      if (!["ERROR", "CANCELED"].includes(deployment.readyState)) {
        await client.query("COMMIT");
        return Response.json({
          state:
            deployment.readyState === "READY"
              ? "VERIFYING"
              : deployment.readyState,
          servedRevision: orb.published_revision ?? null,
          url: publicPath(projectId),
          deploymentUrl: `https://${deployment.url}`,
          deploymentId: deployment.id,
        });
      }
    }
    const quota = await client.query(
      "SELECT count(*) FROM orbs WHERE owner_id=$1 AND vercel_project_id IS NOT NULL",
      [user.id],
    );
    if (
      !orb.vercel_project_id &&
      Number(quota.rows[0].count) >= Number(process.env.MAX_PUBLISHED_ORBS ?? 5)
    )
      throw new HttpError(
        429,
        "Your account has reached its published-world limit.",
      );
    const name = `orb-${createHash("sha256").update(projectId).digest("hex").slice(0, 20)}`;
    let target = orb.vercel_project_id;
    if (!target) {
      try {
        const existing = await vercel(`/v9/projects/${name}`);
        target = existing.id;
      } catch (e) {
        if (!(e instanceof HttpError) || e.status !== 404) throw e;
        const created = await vercel("/v11/projects", "POST", {
          name,
          framework: null,
          buildCommand: "",
          installCommand: "",
          ssoProtection: null,
        });
        target = created.id;
      }
    }
    const snapshot = projectSchema.parse(orb.snapshot);
    const html =
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orbsie world</title><link rel="stylesheet" href="runtime.css"></head><body><div id="root"></div><script type="module" src="runtime.js"></script></body></html>';
    const files = [
      { file: "index.html", data: html },
      {
        file: "project.json",
        data: JSON.stringify({ ...snapshot, messages: [] }),
      },
      {
        file: "runtime.js",
        data: await readFile(
          process.cwd() + "/public/player/runtime.js",
          "utf8",
        ),
      },
      {
        file: "runtime.css",
        data: await readFile(
          process.cwd() + "/public/player/runtime.css",
          "utf8",
        ),
      },
    ];
    // Recover an accepted deployment after a request timeout by its immutable revision metadata.
    const prior = await vercel(`/v6/deployments?projectId=${target}&limit=10`);
    const recovered = prior.deployments?.find(
      (d: { meta?: { orbRevision?: string }; state: string }) =>
        d.meta?.orbRevision === String(revision) &&
        !["ERROR", "CANCELED"].includes(d.state),
    );
    const deployment =
      recovered ??
      (await vercel("/v13/deployments", "POST", {
        name,
        project: target,
        target: "production",
        files,
        projectSettings: {
          framework: null,
          buildCommand: "",
          installCommand: "",
          outputDirectory: null,
        },
        meta: { orbRevision: String(revision), orbId: projectId },
      }));
    await client.query(
      "UPDATE orbs SET vercel_project_id=$1,deployment_id=$2,publication_revision=$3 WHERE id=$4",
      [target, deployment.id ?? deployment.uid, revision, projectId],
    );
    await client.query("COMMIT");
    return Response.json({
      state:
        (deployment.readyState ?? deployment.state) === "READY"
          ? "VERIFYING"
          : (deployment.readyState ?? deployment.state),
      servedRevision: orb.published_revision ?? null,
      url: publicPath(projectId),
      deploymentUrl: `https://${deployment.url}`,
      deploymentId: deployment.id ?? deployment.uid,
    });
  } catch (e) {
    if (client) await client.query("ROLLBACK");
    return apiError(e);
  } finally {
    client?.release();
  }
}
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const id = new URL(request.url).searchParams.get("projectId");
    const result = await database().query(
      "SELECT deployment_id,public_url,publication_revision,published_revision FROM orbs WHERE id=$1 AND owner_id=$2",
      [id, user.id],
    );
    const orb = result.rows[0];
    if (!orb?.deployment_id)
      throw new HttpError(404, "This world has not been published.");
    const d = await vercel(`/v13/deployments/${orb.deployment_id}`);
    if (d.readyState === "READY") {
      const url = `https://${d.url}`;
      const accessible = await fetch(url, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      });
      if (!accessible.ok)
        return Response.json({
          state: "PROTECTED",
          servedRevision: orb.published_revision ?? null,
          deploymentUrl: orb.public_url,
          error:
            "The game is deployed but not publicly accessible. Review Vercel deployment protection.",
        });
      const promoted = await database().query(
        "UPDATE orbs SET public_url=$1,published_revision=publication_revision WHERE id=$2 AND owner_id=$3 AND deployment_id=$4 AND publication_revision=$5 RETURNING published_revision",
        [url, id, user.id, orb.deployment_id, orb.publication_revision],
      );
      // A new POST may have replaced the attempt while Vercel/HEAD was in flight.
      if (!promoted.rows.length) return Response.json({ state: "VERIFYING" });
      orb.published_revision = promoted.rows[0].published_revision;
    }
    return Response.json({
      state: d.readyState,
      servedRevision: orb.published_revision ?? null,
      url: d.readyState === "READY" ? publicPath(id!) : undefined,
      deploymentUrl:
        d.readyState === "READY" ? `https://${d.url}` : orb.public_url,
    });
  } catch (e) {
    return apiError(e);
  }
}
