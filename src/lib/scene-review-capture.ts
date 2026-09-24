"use client";

import {
  MAX_REVIEW_IMAGE_BYTES,
  validateReviewImageDataUrl,
  type SceneReviewRenderer,
} from "./review-image";
import type { WorldNavigationBounds } from "./world-navigation";

export type { SceneReviewRenderer } from "./review-image";

export type SceneReviewSourceState = {
  renderer: SceneReviewRenderer;
  projectId: string;
  revision: number;
  /** Revision whose current geometry has actually reached the renderer. */
  renderedRevision: number;
  transitionSettled: boolean;
  mounted: boolean;
  readyAssetIds: readonly string[];
  pendingAssetIds: readonly string[];
  failedAssetIds: readonly string[];
  errors: readonly string[];
};

export type SceneReviewCameraView = {
  /** World-space position in the Y-up scene. */
  position: readonly [x: number, y: number, z: number];
  /** Unit world-space direction the renderer camera faces. */
  forward: readonly [x: number, y: number, z: number];
};

export type SceneReviewCaptureSource = {
  renderer: SceneReviewRenderer;
  getState: () => SceneReviewSourceState;
  /** Returns a PNG data URL containing the game canvas only. */
  capture: () => string;
  /** Snapshot the camera used for the synchronous capture, when available. */
  getCameraView?: () => SceneReviewCameraView | undefined;
};

export type SceneReviewCaptureRequest = {
  projectId: string;
  revision: number;
  renderer?: SceneReviewRenderer;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type SceneReviewCaptureFraming = {
  /** Bounds are already transformed into world space. */
  boundsByEntity: Iterable<WorldNavigationBounds | undefined>;
  /** Matrices from the same rendered camera used to capture the source. */
  viewMatrix: ArrayLike<number>;
  projectionMatrix: ArrayLike<number>;
  /** Absolute-world offset removed from WebGL scene coordinates. */
  renderOrigin?: readonly [number, number, number];
};

export type SceneReviewCaptureResult = {
  image: string;
  width: number;
  height: number;
  byteLength: number;
  renderer: SceneReviewRenderer;
  projectId: string;
  revision: number;
  cameraView?: SceneReviewCameraView;
  readiness: {
    renderedRevision: number;
    transitionSettled: boolean;
    readyAssetIds: string[];
    pendingAssetIds: string[];
    failedAssetIds: string[];
  };
  errors: string[];
};

/** Read a Three.js camera world matrix without updating or mutating the camera. */
export function sceneReviewCameraViewFromMatrixWorld(
  elements: ArrayLike<number>,
  renderOrigin: readonly [number, number, number] = [0, 0, 0],
): SceneReviewCameraView | undefined {
  if (
    elements.length < 16 ||
    Array.from({ length: 16 }, (_, index) => elements[index]).some(
      (component) => !Number.isFinite(component),
    ) ||
    renderOrigin.some((component) => !Number.isFinite(component))
  )
    return undefined;
  const position: [number, number, number] = [
    elements[12] + renderOrigin[0],
    elements[13] + renderOrigin[1],
    elements[14] + renderOrigin[2],
  ];
  const rawForward: [number, number, number] = [
    -elements[8],
    -elements[9],
    -elements[10],
  ];
  const length = Math.hypot(...rawForward);
  if (
    !position.every(Number.isFinite) ||
    !Number.isFinite(length) ||
    length <= Number.EPSILON
  )
    return undefined;
  const forward = rawForward.map((component) => component / length) as [
    number,
    number,
    number,
  ];
  for (let axis = 0; axis < forward.length; axis++)
    if (Object.is(forward[axis], -0)) forward[axis] = 0;
  return { position, forward };
}

export type SceneReviewCaptureErrorCode =
  | "aborted"
  | "timeout"
  | "unavailable"
  | "project-mismatch"
  | "superseded-revision"
  | "asset-failed"
  | "invalid-image";

export class SceneReviewCaptureError extends Error {
  readonly code: SceneReviewCaptureErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: SceneReviewCaptureErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SceneReviewCaptureError";
    this.code = code;
    this.details = details;
  }
}

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 10000;
// Leave room for this data URL in the existing bounded review request. The
// cap is on the encoded payload callers actually transport, with a matching
// decoded cap for the PNG parser.
const CAPTURE_EDGES = [768, 512, 384, 256, 192, 128] as const;

type CaptureCrop = { x: number; y: number; width: number; height: number };

function validMatrix(matrix: ArrayLike<number>): boolean {
  return (
    matrix.length >= 16 &&
    Array.from({ length: 16 }, (_, index) => matrix[index]).every((component) =>
      Number.isFinite(component),
    )
  );
}

function transformPoint(
  matrix: ArrayLike<number>,
  point: readonly [number, number, number, number],
): [number, number, number, number] {
  return [
    matrix[0] * point[0] +
      matrix[4] * point[1] +
      matrix[8] * point[2] +
      matrix[12] * point[3],
    matrix[1] * point[0] +
      matrix[5] * point[1] +
      matrix[9] * point[2] +
      matrix[13] * point[3],
    matrix[2] * point[0] +
      matrix[6] * point[1] +
      matrix[10] * point[2] +
      matrix[14] * point[3],
    matrix[3] * point[0] +
      matrix[7] * point[1] +
      matrix[11] * point[2] +
      matrix[15] * point[3],
  ];
}

function isValidBounds(bounds: WorldNavigationBounds): boolean {
  return (
    bounds.min.length === 3 &&
    bounds.max.length === 3 &&
    bounds.min.every(Number.isFinite) &&
    bounds.max.every(Number.isFinite) &&
    bounds.min.every((component, axis) => component <= bounds.max[axis])
  );
}

/**
 * Project committed world bounds into the source canvas. Unknown or unstable
 * projections return undefined so capture keeps the complete renderer frame.
 */
export function sceneReviewCaptureCrop(
  canvasWidth: number,
  canvasHeight: number,
  framing: SceneReviewCaptureFraming,
): CaptureCrop | undefined {
  const { boundsByEntity, viewMatrix, projectionMatrix } = framing;
  const renderOrigin = framing.renderOrigin ?? [0, 0, 0];
  if (
    !Number.isFinite(canvasWidth) ||
    !Number.isFinite(canvasHeight) ||
    canvasWidth <= 0 ||
    canvasHeight <= 0 ||
    !validMatrix(viewMatrix) ||
    !validMatrix(projectionMatrix) ||
    renderOrigin.length !== 3 ||
    !renderOrigin.every(Number.isFinite)
  )
    return undefined;

  let unionMinX = canvasWidth;
  let unionMinY = canvasHeight;
  let unionMaxX = 0;
  let unionMaxY = 0;
  let sawVisibleBounds = false;

  for (const bounds of boundsByEntity) {
    // An unknown entity could be visible anywhere, so retain the full frame.
    if (!bounds || !isValidBounds(bounds)) return undefined;

    const projected: Array<[number, number, number, number]> = [];
    for (const x of [bounds.min[0], bounds.max[0]])
      for (const y of [bounds.min[1], bounds.max[1]])
        for (const z of [bounds.min[2], bounds.max[2]]) {
          const view = transformPoint(viewMatrix, [
            x - renderOrigin[0],
            y - renderOrigin[1],
            z - renderOrigin[2],
            1,
          ]);
          const clip = transformPoint(projectionMatrix, view);
          if (!clip.every(Number.isFinite)) return undefined;
          projected.push(clip);
        }

    const behindCount = projected.filter(([, , , w]) => w <= 1e-8).length;
    if (behindCount === projected.length) continue;
    // A box crossing the eye plane has unbounded projected corners. Its
    // visible part cannot be safely isolated with a rectangular crop.
    if (behindCount > 0) return undefined;

    const outsidePlanes = [
      (point: number[]) => point[0] < -point[3],
      (point: number[]) => point[0] > point[3],
      (point: number[]) => point[1] < -point[3],
      (point: number[]) => point[1] > point[3],
      (point: number[]) => point[2] < -point[3],
      (point: number[]) => point[2] > point[3],
    ];
    if (outsidePlanes.some((outside) => projected.every(outside))) continue;

    let entityMinX = canvasWidth;
    let entityMinY = canvasHeight;
    let entityMaxX = 0;
    let entityMaxY = 0;
    for (const [clipX, clipY, , clipW] of projected) {
      const pixelX = ((clipX / clipW + 1) * canvasWidth) / 2;
      const pixelY = ((1 - clipY / clipW) * canvasHeight) / 2;
      if (!Number.isFinite(pixelX) || !Number.isFinite(pixelY))
        return undefined;
      entityMinX = Math.min(entityMinX, pixelX);
      entityMinY = Math.min(entityMinY, pixelY);
      entityMaxX = Math.max(entityMaxX, pixelX);
      entityMaxY = Math.max(entityMaxY, pixelY);
    }
    entityMinX = Math.max(0, entityMinX);
    entityMinY = Math.max(0, entityMinY);
    entityMaxX = Math.min(canvasWidth, entityMaxX);
    entityMaxY = Math.min(canvasHeight, entityMaxY);
    if (entityMaxX <= entityMinX || entityMaxY <= entityMinY) continue;

    sawVisibleBounds = true;
    unionMinX = Math.min(unionMinX, entityMinX);
    unionMinY = Math.min(unionMinY, entityMinY);
    unionMaxX = Math.max(unionMaxX, entityMaxX);
    unionMaxY = Math.max(unionMaxY, entityMaxY);
  }

  if (!sawVisibleBounds) return undefined;
  const unionWidth = unionMaxX - unionMinX;
  const unionHeight = unionMaxY - unionMinY;
  const padX = Math.max(16, unionWidth * 0.12);
  const padY = Math.max(16, unionHeight * 0.12);
  const x = Math.max(0, Math.floor(unionMinX - padX));
  const y = Math.max(0, Math.floor(unionMinY - padY));
  const right = Math.min(canvasWidth, Math.ceil(unionMaxX + padX));
  const bottom = Math.min(canvasHeight, Math.ceil(unionMaxY + padY));
  const width = right - x;
  const height = bottom - y;
  const zoom = Math.max(canvasWidth, canvasHeight) / Math.max(width, height);
  // Avoid changing the composition for marginal gains. This threshold also
  // makes the crop useful after the output is reduced to the existing cap.
  if (zoom < 1.25 || width * height > canvasWidth * canvasHeight * 0.78)
    return undefined;
  return { x, y, width, height };
}

function captureError(
  code: SceneReviewCaptureErrorCode,
  message: string,
  details?: Record<string, unknown>,
): SceneReviewCaptureError {
  return new SceneReviewCaptureError(code, message, details);
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw captureError("aborted", "Scene review capture was cancelled.");
}

function inspectPng(image: string): {
  width: number;
  height: number;
  byteLength: number;
} {
  try {
    return validateReviewImageDataUrl(image);
  } catch (error) {
    throw captureError(
      "invalid-image",
      error instanceof Error
        ? error.message
        : "Scene review capture is not valid PNG data.",
      error instanceof Error && "code" in error
        ? { reason: (error as { code?: unknown }).code }
        : undefined,
    );
  }
}

/** Copy one renderer canvas into a bounded, aspect-preserving review image. */
export function captureSceneCanvas(
  canvas: HTMLCanvasElement,
  framing?: SceneReviewCaptureFraming,
): string {
  if (!canvas.width || !canvas.height)
    throw new Error("Scene canvas is not ready.");
  const crop = framing
    ? sceneReviewCaptureCrop(canvas.width, canvas.height, framing)
    : undefined;
  const source = crop ?? {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
  };
  let lastImage = "";
  for (const maxEdge of CAPTURE_EDGES) {
    const scale =
      crop === undefined
        ? Math.min(1, maxEdge / Math.max(source.width, source.height))
        : maxEdge / Math.max(source.width, source.height);
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const context = output.getContext("2d");
    if (!context) throw new Error("Could not capture the game canvas.");
    context.fillStyle = "#07100f";
    context.fillRect(0, 0, width, height);
    context.drawImage(
      canvas,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      width,
      height,
    );
    lastImage = output.toDataURL("image/png");
    if (
      new TextEncoder().encode(lastImage).byteLength <= MAX_REVIEW_IMAGE_BYTES
    )
      return lastImage;
  }
  throw new Error("Scene review capture exceeds the image limit.");
}

function waitForChange(
  listeners: Set<() => void>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      listeners.delete(onChange);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const onChange = () => finish();
    const onAbort = () => {
      cleanup();
      reject(captureError("aborted", "Scene review capture was cancelled."));
    };
    listeners.add(onChange);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(finish, Math.max(1, timeoutMs));
  });
}

function copyState(state: SceneReviewSourceState): SceneReviewSourceState {
  return {
    ...state,
    readyAssetIds: [...state.readyAssetIds],
    pendingAssetIds: [...state.pendingAssetIds],
    failedAssetIds: [...state.failedAssetIds],
    errors: [...state.errors],
  };
}

/**
 * A small process-local registry keeps renderer readiness out of React state.
 * Renderers register refs and notify only when a resource/transition changes;
 * captures can then wait without exposing scene objects or mutators.
 */
export class SceneReviewCaptureBridge {
  private readonly sources = new Map<symbol, SceneReviewCaptureSource>();
  private readonly listeners = new Set<() => void>();

  register(source: SceneReviewCaptureSource): () => void {
    const token = Symbol("scene-review-source");
    this.sources.set(token, source);
    this.notify();
    return () => {
      if (this.sources.delete(token)) this.notify();
    };
  }

  notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  async capture(
    request: SceneReviewCaptureRequest,
  ): Promise<SceneReviewCaptureResult> {
    const timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(1, request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    );
    const deadline = Date.now() + timeoutMs;
    let sawSource = false;
    let lastState: SceneReviewSourceState | undefined;
    while (Date.now() < deadline) {
      assertNotAborted(request.signal);
      const candidates = [...this.sources.values()].filter(
        (source) => !request.renderer || source.renderer === request.renderer,
      );
      let matching:
        | { source: SceneReviewCaptureSource; state: SceneReviewSourceState }
        | undefined;
      for (const source of candidates) {
        const state = copyState(source.getState());
        sawSource = true;
        lastState = state;
        if (!state.mounted) continue;
        if (state.projectId !== request.projectId) continue;
        if (
          state.revision > request.revision ||
          state.renderedRevision > request.revision
        )
          throw captureError(
            "superseded-revision",
            "The requested scene revision has been replaced.",
            {
              expectedRevision: request.revision,
              actualRevision: state.revision,
            },
          );
        matching = { source, state };
        break;
      }
      if (!matching) {
        if (
          candidates.length > 0 &&
          candidates.every((source) => !source.getState().mounted)
        )
          throw captureError(
            "unavailable",
            "The scene renderer was unmounted before capture completed.",
          );
        const otherProject = candidates.find((source) => {
          const state = source.getState();
          return state.mounted && state.projectId !== request.projectId;
        });
        if (otherProject)
          throw captureError(
            "project-mismatch",
            "The requested scene project is no longer mounted.",
            { expectedProjectId: request.projectId },
          );
        await waitForChange(
          this.listeners,
          Math.min(50, deadline - Date.now()),
          request.signal,
        );
        continue;
      }
      const { source, state } = matching;
      if (state.failedAssetIds.length) {
        throw captureError(
          "asset-failed",
          "A scene asset failed before review capture.",
          { failedAssetIds: state.failedAssetIds },
        );
      }
      if (
        state.revision !== request.revision ||
        state.renderedRevision !== request.revision ||
        state.pendingAssetIds.length ||
        !state.transitionSettled
      ) {
        await waitForChange(
          this.listeners,
          Math.min(50, deadline - Date.now()),
          request.signal,
        );
        continue;
      }
      assertNotAborted(request.signal);
      let image: string;
      let cameraView: SceneReviewCameraView | undefined;
      try {
        image = source.capture();
        const observedCamera = source.getCameraView?.();
        cameraView = observedCamera
          ? {
              position: [...observedCamera.position],
              forward: [...observedCamera.forward],
            }
          : undefined;
      } catch (error) {
        throw captureError(
          "invalid-image",
          "Scene renderer could not produce a capture.",
          {
            reason: error instanceof Error ? error.message : String(error),
          },
        );
      }
      const dimensions = inspectPng(image);
      assertNotAborted(request.signal);
      const after = copyState(source.getState());
      if (
        !after.mounted ||
        after.projectId !== request.projectId ||
        after.revision !== request.revision ||
        after.renderedRevision !== request.revision ||
        after.pendingAssetIds.length ||
        after.failedAssetIds.length ||
        !after.transitionSettled
      ) {
        lastState = after;
        await waitForChange(
          this.listeners,
          Math.min(50, deadline - Date.now()),
          request.signal,
        );
        continue;
      }
      return {
        image,
        ...dimensions,
        renderer: after.renderer,
        projectId: after.projectId,
        revision: after.revision,
        ...(cameraView ? { cameraView } : {}),
        readiness: {
          renderedRevision: after.renderedRevision,
          transitionSettled: after.transitionSettled,
          readyAssetIds: [...after.readyAssetIds],
          pendingAssetIds: [...after.pendingAssetIds],
          failedAssetIds: [...after.failedAssetIds],
        },
        errors: [...after.errors],
      };
    }
    assertNotAborted(request.signal);
    throw captureError(
      sawSource ? "timeout" : "unavailable",
      sawSource
        ? "Scene review capture did not reach a stable ready revision in time."
        : "No scene renderer is mounted for review capture.",
      lastState
        ? {
            projectId: lastState.projectId,
            revision: lastState.revision,
            renderedRevision: lastState.renderedRevision,
            pendingAssetIds: lastState.pendingAssetIds,
          }
        : undefined,
    );
  }
}

export const sceneReviewCaptureBridge = new SceneReviewCaptureBridge();

export function registerSceneReviewCaptureSource(
  source: SceneReviewCaptureSource,
): () => void {
  return sceneReviewCaptureBridge.register(source);
}

export function notifySceneReviewCaptureChanged(): void {
  sceneReviewCaptureBridge.notify();
}

export function captureSceneReview(
  request: SceneReviewCaptureRequest,
): Promise<SceneReviewCaptureResult> {
  return sceneReviewCaptureBridge.capture(request);
}
