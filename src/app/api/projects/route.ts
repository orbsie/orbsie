import { requireCloudGeneratedModels } from "@/lib/server/generated-registry";
import { z } from "zod";
import { projectSchema, committed } from "@/lib/protocol";
import { archiveProjectSnapshot } from "@/lib/server/storage";
import { projectSnapshotToken } from "@/lib/server/project-snapshot-token";
import { assertBrowserProceduralIntegrity } from "../../../lib/server/browser-procedural-integrity";
import {
  requireUser,
  database,
  checkOrigin,
  apiError,
  boundedJSON,
  HttpError,
} from "@/lib/server/auth";

function withSnapshotToken<T extends { snapshot: unknown }>(row: T) {
  return { ...row, snapshotToken: projectSnapshotToken(row.snapshot) };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const result = await database().query(
        "SELECT id, title, revision, snapshot, updated_at, public_url, publication_revision FROM orbs WHERE id=$1 AND owner_id=$2",
        [id, user.id],
      );
      if (!result.rows[0]) throw new HttpError(404, "World not found.");
      return Response.json({ project: withSnapshotToken(result.rows[0]) });
    }
    const result = await database().query(
      "SELECT id, title, revision, snapshot, updated_at, public_url, publication_revision FROM orbs WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 50",
      [user.id],
    );
    return Response.json({ projects: result.rows.map(withSnapshotToken) });
  } catch (e) {
    return apiError(e);
  }
}
export async function PUT(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser(request);
    const parsed = z
      .object({
        project: projectSchema,
        baseRevision: z.number().int().nullable(),
        baseSnapshotToken: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable()
          .optional(),
      })
      .safeParse(await boundedJSON(request));
    if (!parsed.success) throw new HttpError(400, "Invalid world data.");
    const { project, baseRevision, baseSnapshotToken } = parsed.data;
    assertBrowserProceduralIntegrity(project);
    await requireCloudGeneratedModels(user.id, project);
    const committedSnapshot = committed(project);
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT owner_id,revision,snapshot FROM orbs WHERE id=$1 FOR UPDATE",
        [project.id],
      );
      if (existing.rows.length) {
        if (existing.rows[0].owner_id !== user.id)
          throw new HttpError(404, "World not found.");
        const storedSnapshotToken = projectSnapshotToken(
          existing.rows[0].snapshot,
        );
        if (
          existing.rows[0].revision !== baseRevision ||
          !baseSnapshotToken ||
          storedSnapshotToken !== baseSnapshotToken
        ) {
          const latest = await client.query(
            "SELECT id,title,revision,snapshot,updated_at,public_url,publication_revision FROM orbs WHERE id=$1 AND owner_id=$2",
            [project.id, user.id],
          );
          await client.query("ROLLBACK");
          return Response.json(
            {
              error:
                "A newer cloud save exists. Your local draft is still saved on this device.",
              conflict: withSnapshotToken(latest.rows[0]),
            },
            { status: 409 },
          );
        }
        await client.query(
          "UPDATE orbs SET snapshot=$1,title=$2,revision=$3,updated_at=now() WHERE id=$4",
          [
            JSON.stringify(committedSnapshot),
            project.title,
            project.revision,
            project.id,
          ],
        );
      } else {
        if (baseRevision !== null || baseSnapshotToken)
          throw new HttpError(409, "Cloud version not found.");
        await client.query(
          "INSERT INTO orbs(id,owner_id,title,revision,snapshot) VALUES($1,$2,$3,$4,$5)",
          [
            project.id,
            user.id,
            project.title,
            project.revision,
            JSON.stringify(committedSnapshot),
          ],
        );
      }
      await client.query(
        "INSERT INTO orb_revisions(orb_id,revision,snapshot) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [project.id, project.revision, JSON.stringify(committedSnapshot)],
      );
      await client.query("COMMIT");
      let archivePending = false;
      try {
        await archiveProjectSnapshot(user.id, committedSnapshot);
      } catch {
        archivePending = true;
      }
      return Response.json({
        revision: project.revision,
        snapshotToken: projectSnapshotToken(committedSnapshot),
        archivePending,
      });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    return apiError(e);
  }
}
