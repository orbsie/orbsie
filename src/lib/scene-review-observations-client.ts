import type { SceneReviewCaptureResult } from "./scene-review-capture";
import type { SceneReviewStructuralObservations } from "./server/scene-review-observations";

/** Send only bounded renderer facts; the PNG travels in its separate field. */
export function sceneReviewObservationsFromCapture(
  capture: SceneReviewCaptureResult,
): SceneReviewStructuralObservations {
  return {
    projectId: capture.projectId,
    revision: capture.revision,
    renderer: capture.renderer,
    renderedRevision: capture.readiness.renderedRevision,
    transitionSettled: capture.readiness.transitionSettled,
    readyAssetIds: [...capture.readiness.readyAssetIds],
    pendingAssetIds: [...capture.readiness.pendingAssetIds],
    failedAssetIds: [...capture.readiness.failedAssetIds],
  };
}
