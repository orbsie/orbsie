import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { database } from "../src/lib/server/auth";
import { startGenerationRun } from "../src/lib/server/generation-runs";
import { blankProject } from "../src/lib/protocol";

it.runIf(process.env.RUN_GENERATION_RETENTION_DATABASE_TEST === "1")(
  "prunes superseded history atomically under concurrent admission and preserves protected recovery",
  async () => {
    const owner = randomUUID();
    const other = randomUUID();
    const project = blankProject();
    const db = database();
    const ids = Array.from({ length: 64 }, () => randomUUID());
    try {
      for (const id of [owner, other])
        await db.query(
          'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,false)',
          [id, "Retention test", `${id}@example.invalid`],
        );
      await db.query(
        "INSERT INTO orbs(id,owner_id,title,revision,snapshot) VALUES($1,$2,$3,$4,$5)",
        [
          project.id,
          owner,
          project.title,
          project.revision,
          JSON.stringify(project),
        ],
      );
      await db.query(
        `INSERT INTO generation_runs(id,orb_id,owner_id,base_revision,state,checkpoint,starting_snapshot,prompt,created_at)
         SELECT id,$2,$3,$4,'complete',$5,$5,'Build',now()-ordinality*interval '1 second'
         FROM unnest($1::text[]) WITH ORDINALITY AS seeded(id,ordinality)`,
        [ids, project.id, owner, project.revision, JSON.stringify(project)],
      );
      await db.query(
        "INSERT INTO generation_operations(run_id,sequence,operation_id,envelope) VALUES($1,1,$2,'{}')",
        [ids[63], randomUUID()],
      );
      const foreignId = randomUUID();
      await db.query(
        "INSERT INTO generation_runs(id,orb_id,owner_id,base_revision,state,checkpoint,prompt) VALUES($1,$2,$3,0,'complete',$4,'Foreign')",
        [foreignId, project.id, other, JSON.stringify(project)],
      );
      const runs = await Promise.all(
        [randomUUID(), randomUUID()].map((runId) =>
          startGenerationRun(owner, { runId, project, prompt: "Build" }),
        ),
      );
      expect(runs.every((run) => run.state === "running")).toBe(true);
      const retained = await db.query(
        "SELECT id FROM generation_runs WHERE owner_id=$1",
        [owner],
      );
      expect(retained.rows).toHaveLength(64);
      expect(retained.rows.map((row) => row.id)).toContain(ids[0]);
      expect(retained.rows.map((row) => row.id)).not.toContain(ids[63]);
      expect(retained.rows.map((row) => row.id)).not.toContain(ids[62]);
      expect(
        (
          await db.query(
            "SELECT * FROM generation_operations WHERE run_id=$1",
            [ids[63]],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await db.query("SELECT id FROM generation_runs WHERE id=$1", [
            foreignId,
          ])
        ).rowCount,
      ).toBe(1);
      await db.query(
        "UPDATE generation_runs SET state='running',created_at=now(),lease_until=now()+interval '180 seconds' WHERE owner_id=$1",
        [owner],
      );
      await expect(
        startGenerationRun(owner, {
          runId: randomUUID(),
          project,
          prompt: "Build",
        }),
      ).rejects.toMatchObject({ status: 413 });
      expect(
        (
          await db.query(
            "SELECT count(*)::integer AS count FROM generation_runs WHERE owner_id=$1",
            [owner],
          )
        ).rows[0].count,
      ).toBe(64);
    } finally {
      await db.query(
        "DELETE FROM generation_runs WHERE owner_id=ANY($1::text[])",
        [[owner, other]],
      );
      await db.query("DELETE FROM orbs WHERE id=$1 AND owner_id=$2", [
        project.id,
        owner,
      ]);
      await db.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [
        [owner, other],
      ]);
      await db.end();
    }
  },
  30000,
);
