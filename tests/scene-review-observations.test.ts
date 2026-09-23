import { describe, expect, it } from "vitest";
import {
  MAX_SCENE_POSITION,
  blankProject,
  entitySchema,
} from "../src/lib/protocol";
import {
  sceneReviewStructuralObservationsSchema,
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

  it("accepts finite distant world bounds without widening the evidence budget", () => {
    const entity = entitySchema.parse({
      id: "far-tree",
      label: "Far tree",
      position: [MAX_SCENE_POSITION, 0, -MAX_SCENE_POSITION],
      stage: "ready",
    });
    const project = { ...blankProject(), entities: [entity] };
    const observations = sceneReviewStructuralObservationsSchema.parse({
      projectId: project.id,
      revision: project.revision,
      bounds: [
        {
          entityId: entity.id,
          min: [MAX_SCENE_POSITION - 5, -2, -MAX_SCENE_POSITION - 5],
          max: [MAX_SCENE_POSITION + 5, 8, -MAX_SCENE_POSITION + 5],
        },
      ],
    });
    expect(() =>
      validateSceneReviewStructuralObservations(project, observations),
    ).not.toThrow();
    expect(() =>
      sceneReviewStructuralObservationsSchema.parse({
        ...observations,
        bounds: [
          {
            entityId: entity.id,
            min: [Number.MAX_VALUE, 0, 0],
            max: [Number.MAX_VALUE, 1, 1],
          },
        ],
      }),
    ).toThrow();
  });
});
