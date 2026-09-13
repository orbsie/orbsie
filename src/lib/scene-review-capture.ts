"use client";

export type SceneReviewRenderer = "webgl" | "software";

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

export type SceneReviewCaptureSource = {
  renderer: SceneReviewRenderer;
  getState: () => SceneReviewSourceState;
  /** Returns a PNG data URL containing the game canvas only. */
  capture: () => string;
};

export type SceneReviewCaptureRequest = {
  projectId: string;
  revision: number;
  renderer?: SceneReviewRenderer;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type SceneReviewCaptureResult = {
  image: string;
  width: number;
  height: number;
  byteLength: number;
  renderer: SceneReviewRenderer;
  projectId: string;
  revision: number;
  readiness: {
    renderedRevision: number;
    transitionSettled: boolean;
    readyAssetIds: string[];
    pendingAssetIds: string[];
    failedAssetIds: string[];
  };
  errors: string[];
};

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
const MAX_IMAGE_BYTES = 128 * 1024;
const MAX_DECODED_IMAGE_BYTES = Math.floor((MAX_IMAGE_BYTES * 3) / 4);
const MAX_IMAGE_PIXELS = 2_000_000;
const CAPTURE_EDGES = [512, 384, 256, 192, 128] as const;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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

function decodeBase64(value: string): Uint8Array {
  try {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++)
      bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw captureError(
      "invalid-image",
      "Scene review capture is not valid PNG data.",
    );
  }
}

function inspectPng(image: string): {
  width: number;
  height: number;
  byteLength: number;
} {
  if (!image.startsWith("data:image/png;base64,"))
    throw captureError(
      "invalid-image",
      "Scene review capture must be a local PNG data URL.",
    );
  if (image.length > MAX_IMAGE_BYTES)
    throw captureError(
      "invalid-image",
      "Scene review capture exceeds the image limit.",
      {
        byteLength: image.length,
        maxBytes: MAX_IMAGE_BYTES,
      },
    );
  const bytes = decodeBase64(image.slice("data:image/png;base64,".length));
  if (bytes.byteLength > MAX_DECODED_IMAGE_BYTES || bytes.byteLength < 24)
    throw captureError(
      "invalid-image",
      "Scene review capture exceeds the image limit.",
      {
        byteLength: image.length,
        decodedByteLength: bytes.byteLength,
        maxBytes: MAX_IMAGE_BYTES,
      },
    );
  for (let index = 0; index < PNG_SIGNATURE.length; index++)
    if (bytes[index] !== PNG_SIGNATURE[index])
      throw captureError(
        "invalid-image",
        "Scene review capture is not a PNG image.",
      );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1 || width * height > MAX_IMAGE_PIXELS)
    throw captureError(
      "invalid-image",
      "Scene review capture exceeds the pixel limit.",
      {
        width,
        height,
        maxPixels: MAX_IMAGE_PIXELS,
      },
    );
  return { width, height, byteLength: image.length };
}

/** Copy one renderer canvas into a bounded, aspect-preserving review image. */
export function captureSceneCanvas(canvas: HTMLCanvasElement): string {
  if (!canvas.width || !canvas.height)
    throw new Error("Scene canvas is not ready.");
  let lastImage = "";
  for (const maxEdge of CAPTURE_EDGES) {
    const scale = Math.min(1, maxEdge / Math.max(canvas.width, canvas.height));
    const width = Math.max(1, Math.round(canvas.width * scale));
    const height = Math.max(1, Math.round(canvas.height * scale));
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const context = output.getContext("2d");
    if (!context) throw new Error("Could not capture the game canvas.");
    context.fillStyle = "#07100f";
    context.fillRect(0, 0, width, height);
    context.drawImage(canvas, 0, 0, width, height);
    lastImage = output.toDataURL("image/png");
    if (lastImage.length <= MAX_IMAGE_BYTES) return lastImage;
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
      try {
        image = source.capture();
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
