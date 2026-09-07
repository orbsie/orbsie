import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalChatGPT, assertPinkOnlyEdit } from "./local-chatgpt.mjs";
import { systemPrompt } from "../src/lib/server/generation";
import {
  applyOperation,
  blankProject,
  commandSchema,
  type Cursor,
} from "../src/lib/protocol";

const cwd = await mkdtemp(join(tmpdir(), "orbsie-model-"));
const client = new LocalChatGPT(cwd);
const signal = AbortSignal.timeout(360000);
let project = blankProject();
const evidence: unknown[] = [];
try {
  const model = await client.connect();
  console.log(`Discovered ${model}; all turns use low reasoning.`);
  for (const edit of [false, true]) {
    const before = structuredClone(project);
    const selected = project.entities[0]?.id;
    let buffer = "",
      count = 0;
    let cursor: Cursor = {
      runId: crypto.randomUUID(),
      sequence: 0,
      seen: new Set(),
    };
    const commands: Array<{ type: string }> = [];
    function emit(line: string) {
      if (!line.trim()) return;
      if (++count > 250) throw Error("Operation limit exceeded.");
      const command = commandSchema.parse(JSON.parse(line));
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
      commands.push(command);
    }
    await client.generate(
      systemPrompt,
      {
        instruction: edit
          ? `Change only selected entity ${selected} to bright pink #ff44aa. Preserve its geometry and every unrelated entity. Commit the edit.`
          : "Create a tiny moon garden with exactly three distinct entities: one tree, one collectible crystal, and a portal. Reserve and refine each, then commit.",
        selectedEntityId: edit ? selected : undefined,
        project: { ...project, messages: [] },
      },
      (delta: string) => {
        buffer += delta;
        if (buffer.length > 100000) throw Error("Command buffer exceeded.");
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        lines.forEach(emit);
      },
      signal,
    );
    emit(buffer);
    if (
      !count ||
      commands.at(-1)?.type !== "commit_revision" ||
      project.revision <= before.revision
    )
      throw Error("Generation did not commit a valid revision.");
    if (edit) {
      assertPinkOnlyEdit(before, project, selected!, "#ff44aa");
    } else if (Object.keys(project.entities).length !== 3)
      throw Error("Expected three generated entities.");
    evidence.push({
      model,
      effort: "low",
      kind: edit ? "scoped-edit" : "creation",
      commands,
      project,
    });
    console.log(
      `${edit ? "Scoped edit" : "Creation"}: ${count} valid operations, revision ${project.revision}.`,
    );
  }
  const output = process.env.ORBSIE_EVIDENCE_PATH;
  if (output) await writeFile(output, JSON.stringify(evidence, null, 2));
} finally {
  client.close();
  await rm(cwd, { recursive: true, force: true });
}
