import { describe, expect, it } from "vitest";
import { blankProject } from "../src/lib/protocol";
import {
  sceneReviewFeedback,
  validateSceneReviewStructuralObservations,
} from "../src/lib/server/scene-review-observations";

describe("review structural observations", () => {
  it("binds renderer feedback to the reviewed world and revision", () => {
    const project = blankProject();
    const observations = {
      projectId: project.id,
      revision: project.revision,
      renderer: "software" as const,
      renderedRevision: project.revision,
    };
    expect(() =>
      validateSceneReviewStructuralObservations(project, observations),
    ).not.toThrow();
    expect(sceneReviewFeedback("Check the horizon", observations)).toContain(
      `"projectId":"${project.id}"`,
    );
    expect(() =>
      validateSceneReviewStructuralObservations(project, {
        ...observations,
        revision: project.revision + 1,
      }),
    ).toThrow("another scene revision");
    expect(() =>
      validateSceneReviewStructuralObservations(project, {
        ...observations,
        bounds: [{ entityId: "missing", min: [0, 0, 0], max: [1, 1, 1] }],
      }),
    ).toThrow("unknown object");
  });

  it("rejects combined feedback that exceeds the private transport limit", () => {
    expect(() =>
      sceneReviewFeedback("x".repeat(64 * 1024 + 1), undefined),
    ).toThrow("too large");
  });
});
