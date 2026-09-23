import { expect, it } from "vitest";
import { assertAppliedAuthoringReviewBinding } from "../src/lib/authoring-review-binding";
import { blankProject } from "../src/lib/protocol";
import { createSceneBinding } from "../src/lib/scene-binding";

it("compares the applied scene with the reviewed world and revision", async () => {
  const project = blankProject();
  const accepted = await createSceneBinding(project);
  await expect(
    assertAppliedAuthoringReviewBinding(project, accepted),
  ).resolves.toBeUndefined();

  const changed = structuredClone(project);
  changed.environment.sky = "#123456";
  await expect(
    assertAppliedAuthoringReviewBinding(changed, accepted),
  ).rejects.toThrow("applied scene differs");
  await expect(
    assertAppliedAuthoringReviewBinding(project, {
      ...accepted,
      revision: accepted.revision + 1,
    }),
  ).rejects.toThrow("applied scene differs");
  await expect(
    assertAppliedAuthoringReviewBinding(project, {
      ...accepted,
      projectId: "another-world",
    }),
  ).rejects.toThrow("applied scene differs");
});
