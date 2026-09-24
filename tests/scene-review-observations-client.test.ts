import { expect, it } from "vitest";
import { sceneReviewObservationsFromCapture } from "../src/lib/scene-review-observations-client";
import type { SceneReviewCaptureResult } from "../src/lib/scene-review-capture";

it("keeps a rendered revision and readiness without copying image or raw errors", () => {
  const capture: SceneReviewCaptureResult = {
    image: "data:image/png;base64,secret-image",
    width: 256,
    height: 192,
    byteLength: 40,
    renderer: "software",
    projectId: "world",
    revision: 7,
    cameraView: {
      position: [2, 3, 8],
      forward: [0, -0.2, -0.98],
    },
    readiness: {
      renderedRevision: 7,
      transitionSettled: true,
      readyAssetIds: ["tree"],
      pendingAssetIds: [],
      failedAssetIds: [],
    },
    errors: ["raw renderer detail"],
  };
  const observations = sceneReviewObservationsFromCapture(capture);
  expect(observations).toEqual({
    projectId: "world",
    revision: 7,
    renderer: "software",
    cameraView: {
      position: [2, 3, 8],
      forward: [0, -0.2, -0.98],
    },
    renderedRevision: 7,
    transitionSettled: true,
    readyAssetIds: ["tree"],
    pendingAssetIds: [],
    failedAssetIds: [],
  });
  expect(JSON.stringify(observations)).not.toContain("secret-image");
  expect(JSON.stringify(observations)).not.toContain("raw renderer detail");
});

it("preserves legacy captures that do not include a camera view", () => {
  const capture: SceneReviewCaptureResult = {
    image: "data:image/png;base64,secret-image",
    width: 256,
    height: 192,
    byteLength: 40,
    renderer: "webgl",
    projectId: "world",
    revision: 7,
    readiness: {
      renderedRevision: 7,
      transitionSettled: true,
      readyAssetIds: [],
      pendingAssetIds: [],
      failedAssetIds: [],
    },
    errors: [],
  };
  const observations = sceneReviewObservationsFromCapture(capture);
  expect(observations).not.toHaveProperty("cameraView");
  expect(JSON.stringify(observations)).not.toContain("secret-image");
});
