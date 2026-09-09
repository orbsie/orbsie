import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalChatGPT } from "./local-chatgpt.mjs";
import { systemPrompt } from "../src/lib/server/generation";
import {
  applyOperation,
  blankProject,
  commandSchema,
  type Command,
  type Cursor,
  type Project,
} from "../src/lib/protocol";

const directory = await mkdtemp(join(tmpdir(), "orbsie-flagship-"));
const client = new LocalChatGPT(directory);
const resume = process.env.ORBSIE_RESUME_EVIDENCE;
const evidence: any = resume
  ? JSON.parse(await readFile(resume, "utf8"))
  : {
      startedAt: new Date().toISOString(),
      effort: "low",
      turns: [],
      limitations:
        "Protocol and scene structure only; no claim of visual quality, reachability, or browser playability.",
    };
let project: Project = resume
  ? evidence.turns.find(
      (turn: any) => turn.kind === "flagship-creation" && turn.passed,
    )?.project
  : blankProject();
assert.ok(project, "Resume requires a passed creation snapshot");
if (resume) {
  assert.ok(evidence.turns.length < 3, "At most one retry is allowed");
  evidence.priorError = evidence.error;
  delete evidence.error;
  evidence.retryReason =
    "Clarified system prompt: existing IDs use setters and must not be reserved again.";
}
try {
  evidence.model = await client.connect("gpt-5.6-luna");
  for (const edit of resume ? [true] : [false, true]) {
    const before = structuredClone(project);
    const selected = project.entities.find(
      (entity) => entity.geometry?.kind === "tree",
    )?.id;
    if (edit) assert.ok(selected, "Creation must include a selectable tree");
    const instruction = edit
      ? `Make selected tree ${selected} a giant pink mushroom. Use pink #ff44aa and increase its scale. Preserve its ID and position and every unrelated entity and environment. Commit the edit.`
      : "Make a sunny little island game where I collect five glowing crystals, bounce across three moving platforms, and reach a portal. Add friendly trees and a pond.";
    const started = performance.now();
    const turn: any = {
      kind: edit ? "scoped-mushroom-edit" : "flagship-creation",
      instruction,
      before,
      systemPrompt,
      commands: [],
      operationTimingsMs: [],
    };
    evidence.turns.push(turn);
    let cursor: Cursor = {
      runId: crypto.randomUUID(),
      sequence: 0,
      seen: new Set(),
    };
    let buffer = "";
    function emit(line: string) {
      if (!line.trim()) return;
      assert.ok(turn.commands.length < 250, "Operation limit exceeded");
      const command: Command = commandSchema.parse(JSON.parse(line));
      turn.lastReceivedCommand = command;
      const result = applyOperation(
        project,
        {
          version: 1,
          projectId: project.id,
          runId: cursor.runId,
          operationId: crypto.randomUUID(),
          sequence: cursor.sequence + 1,
          baseRevision: project.revision,
          command,
        },
        cursor,
      );
      project = result.project;
      cursor = result.cursor;
      turn.commands.push(command);
      turn.operationTimingsMs.push(performance.now() - started);
      if (
        command.type === "reserve_entity" &&
        turn.firstReservationMs === undefined
      )
        turn.firstReservationMs = performance.now() - started;
    }
    await client.generate(
      systemPrompt,
      {
        instruction,
        selectedEntityId: edit ? selected : undefined,
        project: { ...project, messages: [] },
      },
      (delta: string) => {
        buffer += delta;
        assert.ok(buffer.length < 100000, "Command buffer exceeded");
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        lines.forEach(emit);
      },
      AbortSignal.timeout(185000),
    );
    emit(buffer);
    turn.durationMs = performance.now() - started;
    turn.project = structuredClone(project);
    assert.equal(turn.commands.at(-1)?.type, "commit_revision");
    assert.ok(project.revision > before.revision);
    assert.ok(project.entities.every((entity) => entity.stage === "ready"));
    turn.counts = {
      entities: project.entities.length,
      crystals: project.entities.filter(
        (e) => e.geometry?.kind === "crystal" && e.behavior?.type === "collect",
      ).length,
      movingPlatforms: project.entities.filter(
        (e) =>
          e.geometry?.kind === "platform" &&
          e.behavior?.type === "move" &&
          (e.behavior.speed ?? 0) > 0 &&
          (e.behavior.amplitude ?? 0) > 0,
      ).length,
      portals: project.entities.filter((e) => e.behavior?.type === "portal")
        .length,
      trees: project.entities.filter((e) => e.geometry?.kind === "tree").length,
      ponds: project.entities.filter((e) => e.geometry?.kind === "pond").length,
    };
    if (!edit) {
      assert.equal(turn.counts.crystals, 5);
      assert.equal(turn.counts.movingPlatforms, 3);
      assert.ok(
        turn.counts.portals >= 1 &&
          turn.counts.trees >= 1 &&
          turn.counts.ponds >= 1,
      );
      for (const entity of project.entities) {
        assert.ok(
          turn.commands.some(
            (c: Command) =>
              c.type === "set_geometry" &&
              c.id === entity.id &&
              c.geometry.detail === "coarse",
          ),
          `${entity.id} lacks coarse refinement`,
        );
      }
    } else {
      assert.deepEqual(project.environment, before.environment);
      assert.equal(project.entities.length, before.entities.length);
      for (const entity of before.entities.filter((e) => e.id !== selected))
        assert.deepEqual(
          project.entities.find((e) => e.id === entity.id),
          entity,
        );
      const previous = before.entities.find((e) => e.id === selected)!;
      const mushroom = project.entities.find((e) => e.id === selected)!;
      assert.equal(mushroom.geometry?.kind, "mushroom");
      assert.equal(mushroom.color.toLowerCase(), "#ff44aa");
      assert.deepEqual(mushroom.position, previous.position);
      assert.ok(
        mushroom.scale.some((value, index) => value > previous.scale[index]),
      );
    }
    turn.passed = true;
    console.log(
      JSON.stringify({
        kind: turn.kind,
        model: evidence.model,
        durationMs: turn.durationMs,
        operations: turn.commands.length,
        counts: turn.counts,
      }),
    );
  }
  evidence.passed = true;
} catch (error) {
  evidence.error = String(error);
  evidence.partialProject = project;
  throw error;
} finally {
  evidence.finishedAt = new Date().toISOString();
  await writeFile(
    process.env.ORBSIE_EVIDENCE_PATH ?? "/tmp/orbsie-flagship-live.json",
    JSON.stringify(evidence, null, 2),
  );
  client.close();
  await rm(directory, { recursive: true, force: true });
}
