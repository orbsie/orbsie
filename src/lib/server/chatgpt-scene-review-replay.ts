import {
  applyModelOperation,
  type Cursor,
  type ModelCommand,
  type Project,
} from "../protocol";
import { assertModelingCommand } from "../modeling-policy";
import { deriveAssetPolicy, enforceAssetPolicy } from "../asset-policy";
import {
  createSceneBinding,
  initialSceneProvenance,
  updateSceneProvenance,
  type SceneBinding,
  type SceneProvenanceMap,
} from "../scene-binding";
import type { PrivateSceneReviewResult } from "./chatgpt-scene-review";
import type { SceneReviewPhase, SceneReviewScope } from "../scene-review";

function ensureActive(signal: AbortSignal) {
  signal.throwIfAborted();
}

/**
 * Reapply a private host review on the web server. The host binding and its
 * correction batch are claims; policy, provenance, operation sequencing, and
 * the final binding are rebuilt here before ledger completion.
 */
export async function replayChatGPTSceneReview(input: {
  result: Pick<PrivateSceneReviewResult, "review">;
  project: Project;
  prompt: string;
  selected?: string;
  browserModeling: boolean;
  phase: SceneReviewPhase;
  scope: SceneReviewScope;
  signal: AbortSignal;
}): Promise<{
  project: Project;
  provenance: SceneProvenanceMap;
  binding: SceneBinding;
  corrections: readonly ModelCommand[];
}> {
  ensureActive(input.signal);
  let provenance: SceneProvenanceMap;
  try {
    provenance = initialSceneProvenance(input.project);
    await createSceneBinding(input.project, provenance);
  } catch {
    throw Error("The reviewed scene provenance is invalid.");
  }

  const review = input.result.review;
  const entityIds = new Set(input.project.entities.map((entity) => entity.id));
  if (
    review.projectId !== input.project.id ||
    review.reviewedRevision !== input.project.revision ||
    review.scope !== input.scope ||
    review.issues.some((issue) =>
      issue.entityIds.some((entityId) => !entityIds.has(entityId)),
    ) ||
    (review.verdict === "accept" &&
      (review.issues.length > 0 || review.corrections.length > 0)) ||
    (review.verdict === "revise" && review.issues.length === 0) ||
    (input.phase === "review" &&
      review.verdict === "revise" &&
      review.corrections.length === 0) ||
    (input.phase === "final-review" && review.corrections.length > 0)
  )
    throw Error("The scene review response is invalid.");
  if (review.verdict === "accept") {
    ensureActive(input.signal);
    return {
      project: input.project,
      provenance,
      binding: await createSceneBinding(input.project, provenance),
      corrections: [],
    };
  }
  if (input.phase === "final-review") {
    ensureActive(input.signal);
    return {
      project: input.project,
      provenance,
      binding: await createSceneBinding(input.project, provenance),
      corrections: [],
    };
  }

  const policy = deriveAssetPolicy(input.prompt, input.selected, input.project);
  let project = input.project;
  let cursor: Cursor = {
    runId: crypto.randomUUID(),
    sequence: 0,
    seen: new Set(),
  };
  const corrections: ModelCommand[] = [];
  try {
    for (const candidate of review.corrections) {
      ensureActive(input.signal);
      const command = enforceAssetPolicy(
        project,
        candidate as unknown as ModelCommand,
        policy,
      );
      assertModelingCommand(command, false, input.browserModeling);
      const applied = applyModelOperation(
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
      project = applied.project;
      cursor = applied.cursor;
      updateSceneProvenance(provenance, command);
      corrections.push(command);
    }
    const commit: ModelCommand = {
      type: "commit_revision",
      message: "Review correction applied.",
    };
    const applied = applyModelOperation(
      project,
      {
        version: 1,
        projectId: project.id,
        runId: cursor.runId,
        operationId: crypto.randomUUID(),
        sequence: cursor.sequence + 1,
        baseRevision: project.revision,
        command: commit,
      },
      cursor,
    );
    project = applied.project;
    corrections.push(commit);
  } catch {
    throw Error("The scene review corrections could not be applied safely.");
  }

  ensureActive(input.signal);
  return {
    project,
    provenance,
    binding: await createSceneBinding(project, provenance),
    corrections,
  };
}
