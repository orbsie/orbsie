import type { Project } from "./protocol";
import { createSceneBinding } from "./scene-binding";

/** Verify the locally applied scene, not merely the server's claimed digest. */
export async function assertAppliedAuthoringReviewBinding(
  project: Project,
  expected: { projectId: string; revision: number; digest: string },
): Promise<void> {
  const actual = await createSceneBinding(project);
  if (
    actual.projectId !== expected.projectId ||
    actual.revision !== expected.revision ||
    actual.digest !== expected.digest
  )
    throw Error("The applied scene differs from the reviewed result.");
}
