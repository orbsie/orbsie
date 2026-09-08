import type { PoolClient } from "pg";
import { z } from "zod";
import {
  applyOperation,
  committed,
  projectSchema,
  type Project,
} from "../protocol";
import {
  generationRunSchema,
  journalEnvelopeSchema,
} from "../generation-journal";
import {
  generatedModelMetadataSchema,
  sameGeneratedProvenance,
} from "../generated-models";
import { database, HttpError } from "./auth";
export const startRunSchema = z
  .object({
    project: projectSchema,
    prompt: z.string().min(1).max(4000),
    selected: z.string().max(80).optional(),
    runId: z.string().uuid(),
  })
  .strict();
export const appendRunSchema = z
  .object({ runId: z.string().uuid(), envelope: journalEnvelopeSchema })
  .strict();
export const runIdSchema = z.object({ runId: z.string().uuid() }).strict();
type Row = {
  id: string;
  orb_id: string;
  sequence: number;
  state: string;
  checkpoint: Project;
  starting_snapshot: Project;
  recovery_checkpoint?: Project | null;
  prompt: string;
  selected: string | null;
  base_revision: number;
  expired?: boolean;
  cloudBaselineCurrent?: boolean;
};
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ak = Object.keys(a),
    bk = Object.keys(b);
  return (
    ak.length === bk.length &&
    ak.every(
      (k) =>
        Object.hasOwn(b, k) &&
        equal(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    )
  );
}
function bounded(project: Project) {
  if (Buffer.byteLength(JSON.stringify(project)) > 500 * 1024)
    throw new HttpError(413, "Generation checkpoint exceeds its size budget.");
}
function view(row: Row) {
  return generationRunSchema.parse({
    id: row.id,
    projectId: row.orb_id,
    sequence: row.sequence,
    state: row.state,
    checkpoint: row.checkpoint,
    recoveryCheckpoint: row.recovery_checkpoint ?? undefined,
    prompt: row.prompt,
    ...(row.selected ? { selected: row.selected } : {}),
    baseRevision: row.base_revision,
    cloudBaselineCurrent: row.cloudBaselineCurrent ?? true,
  });
}
async function transaction<T>(fn: (c: PoolClient) => Promise<T>) {
  const c = await database().connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function assets(c: PoolClient, owner: string, project: Project) {
  const wanted = new Map();
  for (const entity of project.entities) {
    if (entity.geometry?.kind !== "generated") continue;
    if (!entity.geometry.model)
      throw new HttpError(
        409,
        "Finish and upload the generated model before checkpointing.",
      );
    const model = generatedModelMetadataSchema.parse(entity.geometry.model);
    const old = wanted.get(model.sha256);
    if (old && !sameGeneratedProvenance(old, model))
      throw new HttpError(409, "Generated model references disagree.");
    wanted.set(model.sha256, model);
  }
  if (!wanted.size) return;
  const found = await c.query(
    "SELECT sha256,metadata FROM generated_models WHERE owner_id=$1 AND ready=true AND sha256=ANY($2::text[])",
    [owner, [...wanted.keys()]],
  );
  for (const [hash, model] of wanted) {
    const row = found.rows.find((r) => r.sha256 === hash);
    if (
      !row ||
      !sameGeneratedProvenance(
        model,
        generatedModelMetadataSchema.parse(row.metadata),
      )
    )
      throw new HttpError(
        409,
        "Upload complete generated models before checkpointing.",
      );
  }
}
/** Rebuild old runs from their durable journal, preserving every finished revision. */
async function ensureRecoveryCheckpoint(c: PoolClient, row: Row) {
  if (row.recovery_checkpoint) return;
  let raw = projectSchema.parse(row.starting_snapshot);
  let recovery = committed(raw);
  const result = await c.query(
    "SELECT envelope FROM generation_operations WHERE run_id=$1 ORDER BY sequence LIMIT 257",
    [row.id],
  );
  if (result.rows.length !== row.sequence || result.rows.length > 256)
    throw new HttpError(409, "Generation recovery journal is incomplete.");
  const seen = new Set<string>();
  for (let index = 0; index < result.rows.length; index++) {
    const envelope = journalEnvelopeSchema.parse(result.rows[index].envelope);
    if (envelope.projectId !== row.orb_id || envelope.sequence !== index + 1)
      throw new HttpError(
        409,
        "Generation recovery journal is out of sequence.",
      );
    raw = applyOperation(raw, envelope, {
      runId: row.id,
      sequence: index,
      seen,
    }).project;
    seen.add(envelope.operationId);
    recovery = committed(raw, recovery);
    bounded(recovery);
  }
  if (!equal(JSON.parse(JSON.stringify(raw)), row.checkpoint))
    throw new HttpError(
      409,
      "Generation recovery journal does not match its checkpoint.",
    );
  bounded(recovery);
  await c.query(
    "UPDATE generation_runs SET recovery_checkpoint=$2 WHERE id=$1",
    [row.id, JSON.stringify(recovery)],
  );
  row.recovery_checkpoint = recovery;
}

async function locked(c: PoolClient, owner: string, id: string): Promise<Row> {
  const result = await c.query(
    "SELECT *, (lease_until<=now() OR created_at+interval '15 minutes'<=now()) AS expired FROM generation_runs WHERE id=$1 AND owner_id=$2 FOR UPDATE",
    [id, owner],
  );
  if (!result.rows[0]) throw new HttpError(404, "Generation run not found.");
  const row = result.rows[0] as Row;
  if (row.state === "running" && row.expired) {
    await c.query(
      "UPDATE generation_runs SET state='interrupted',updated_at=now() WHERE id=$1",
      [id],
    );
    row.state = "interrupted";
  }
  const orb = await c.query(
    "SELECT revision,snapshot FROM orbs WHERE id=$1 AND owner_id=$2 FOR SHARE",
    [row.orb_id, owner],
  );
  row.cloudBaselineCurrent =
    !!orb.rows[0] &&
    orb.rows[0].revision === row.base_revision &&
    equal(orb.rows[0].snapshot, row.starting_snapshot);
  await ensureRecoveryCheckpoint(c, row);
  return row;
}
type RetentionRun = {
  id: string;
  orb_id: string;
  state: string;
  expired: boolean;
};
/** Rows must be newest-first (created_at DESC,id DESC), from one owner only. */
export function supersededGenerationRuns(
  rows: readonly RetentionRun[],
  limit: number,
): string[] {
  const newest = new Set<string>();
  const candidates: string[] = [];
  for (const row of rows) {
    const superseded = newest.has(row.orb_id);
    newest.add(row.orb_id);
    const terminal =
      ["complete", "cancelled", "interrupted"].includes(row.state) ||
      (row.state === "running" && row.expired);
    if (superseded && terminal) candidates.push(row.id);
  }
  return candidates.reverse().slice(0, Math.max(0, Math.min(64, limit)));
}
export async function startGenerationRun(owner: string, input: unknown) {
  const value = startRunSchema.parse(input);
  bounded(value.project);
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `generation-runs:${owner}`,
    ]);
    const previous = await c.query(
      "SELECT * FROM generation_runs WHERE id=$1 AND owner_id=$2",
      [value.runId, owner],
    );
    if (previous.rows[0]) {
      const row = previous.rows[0] as Row;
      if (
        !equal(row.starting_snapshot, value.project) ||
        row.prompt !== value.prompt ||
        (row.selected ?? undefined) !== value.selected
      )
        throw new HttpError(
          409,
          "Run identity conflicts with its original request.",
        );
      return view(await locked(c, owner, value.runId));
    }
    const orb = await c.query(
      "SELECT revision,snapshot FROM orbs WHERE id=$1 AND owner_id=$2 FOR SHARE",
      [value.project.id, owner],
    );
    if (!orb.rows[0])
      throw new HttpError(
        404,
        "Save this world to your account before starting a durable run.",
      );
    if (
      orb.rows[0].revision !== value.project.revision ||
      !equal(orb.rows[0].snapshot, value.project)
    )
      throw new HttpError(
        409,
        "Save the exact current world before starting a durable run.",
      );
    const quota = await c.query(
      "SELECT count(*)::integer AS count FROM generation_runs WHERE owner_id=$1",
      [owner],
    );
    if (quota.rows[0].count >= 64) {
      // The owner admission lock serializes pruning/start. Row locks serialize
      // pruning with append/cancel; active leases and newest-per-orb survive.
      const retained = await c.query(
        "SELECT id,orb_id,state,(lease_until<=now() OR created_at+interval '15 minutes'<=now()) AS expired FROM generation_runs WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 256 FOR UPDATE",
        [owner],
      );
      const remove = supersededGenerationRuns(
        retained.rows,
        Number(quota.rows[0].count) - 63,
      );
      if (Number(quota.rows[0].count) - remove.length >= 64)
        throw new HttpError(
          413,
          "Your recovery slots are full. The newest checkpoint for every world and active runs are protected.",
        );
      // Expired running candidates are terminal in effect; deleting their
      // superseded checkpoints also cascades their operation journals.
      await c.query(
        "DELETE FROM generation_runs WHERE owner_id=$1 AND id=ANY($2::text[])",
        [owner, remove],
      );
    }
    await assets(c, owner, value.project);
    const result = await c.query(
      "INSERT INTO generation_runs(id,orb_id,owner_id,base_revision,sequence,state,checkpoint,starting_snapshot,prompt,selected,lease_until,recovery_checkpoint) VALUES($1,$2,$3,$4,0,'running',$5,$5,$6,$7,now()+interval '180 seconds',$8) RETURNING *",
      [
        value.runId,
        value.project.id,
        owner,
        value.project.revision,
        JSON.stringify(value.project),
        value.prompt,
        value.selected ?? null,
        JSON.stringify(committed(value.project)),
      ],
    );
    return view(result.rows[0]);
  });
}
export async function appendGenerationRun(owner: string, input: unknown) {
  const { runId, envelope } = appendRunSchema.parse(input);
  return transaction(async (c) => {
    const row = await locked(c, owner, runId);
    const prior = await c.query(
      "SELECT envelope FROM generation_operations WHERE run_id=$1 AND (sequence=$2 OR operation_id=$3)",
      [runId, envelope.sequence, envelope.operationId],
    );
    if (prior.rows.length) {
      if (prior.rows.length !== 1 || !equal(prior.rows[0].envelope, envelope))
        throw new HttpError(
          409,
          "Operation identity conflicts with a saved operation.",
        );
      return view(row);
    }
    if (row.state !== "running")
      return {
        error: new HttpError(
          409,
          "This generation run has ended. Continue from its saved checkpoint.",
        ),
        run: view(row),
      };
    if (!row.cloudBaselineCurrent)
      throw new HttpError(
        409,
        "The cloud world changed. Recover this checkpoint as a separate draft.",
      );
    if (row.sequence >= 256)
      throw new HttpError(413, "Generation operation limit reached.");
    let project: Project;
    try {
      project = applyOperation(row.checkpoint, envelope, {
        runId: row.id,
        sequence: row.sequence,
        seen: new Set(),
      }).project;
    } catch {
      throw new HttpError(
        409,
        "Generation operation does not match the saved checkpoint.",
      );
    }
    bounded(project);
    const recovery = committed(
      project,
      row.recovery_checkpoint ?? row.starting_snapshot,
    );
    bounded(recovery);
    await assets(c, owner, project);
    await c.query(
      "INSERT INTO generation_operations(run_id,sequence,operation_id,envelope) VALUES($1,$2,$3,$4)",
      [
        runId,
        envelope.sequence,
        envelope.operationId,
        JSON.stringify(envelope),
      ],
    );
    const result = await c.query(
      "UPDATE generation_runs SET sequence=$2,checkpoint=$3,state=$4,recovery_checkpoint=$5,lease_until=LEAST(now()+interval '180 seconds',created_at+interval '15 minutes'),updated_at=now() WHERE id=$1 RETURNING *",
      [
        runId,
        envelope.sequence,
        JSON.stringify(project),
        envelope.command.type === "commit_revision" ? "complete" : "running",
        JSON.stringify(recovery),
      ],
    );
    return { run: view(result.rows[0]) };
  }).then((result) => {
    if ("error" in result) throw result.error;
    return "run" in result ? result.run : result;
  });
}
export async function readGenerationRun(owner: string, id: string) {
  runIdSchema.parse({ runId: id });
  return transaction(async (c) => view(await locked(c, owner, id)));
}
export async function cancelGenerationRun(owner: string, id: string) {
  runIdSchema.parse({ runId: id });
  return transaction(async (c) => {
    const row = await locked(c, owner, id);
    if (row.state === "running") {
      await c.query(
        "UPDATE generation_runs SET state='cancelled',updated_at=now() WHERE id=$1",
        [id],
      );
      row.state = "cancelled";
    }
    return view(row);
  });
}

export async function latestGenerationRun(owner: string, projectId: string) {
  z.string().min(1).max(80).parse(projectId);
  return transaction(async (c) => {
    const result = await c.query(
      "SELECT id FROM generation_runs WHERE owner_id=$1 AND orb_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
      [owner, projectId],
    );
    if (!result.rows[0])
      throw new HttpError(
        404,
        "No saved generation run exists for this world.",
      );
    return view(await locked(c, owner, result.rows[0].id));
  });
}

/** Bounded operation replay; the checkpoint is authoritative at run.sequence. */
export async function replayGenerationRun(
  owner: string,
  id: string,
  afterSequence: number,
) {
  runIdSchema.parse({ runId: id });
  z.number().int().min(0).max(256).parse(afterSequence);
  return transaction(async (c) => {
    const row = await locked(c, owner, id);
    const result = await c.query(
      "SELECT envelope FROM generation_operations WHERE run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 50",
      [id, afterSequence],
    );
    const operations = result.rows.map((r) =>
      journalEnvelopeSchema.parse(r.envelope),
    );
    return {
      run: view(row),
      operations,
      nextSequence: operations.at(-1)?.sequence ?? afterSequence,
    };
  });
}
