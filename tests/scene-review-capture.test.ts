import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureSceneCanvas,
  SceneReviewCaptureBridge,
  SceneReviewCaptureError,
  type SceneReviewCaptureSource,
  type SceneReviewSourceState,
} from "../src/lib/scene-review-capture";
import { MAX_REVIEW_IMAGE_BYTES } from "../src/lib/review-image";

const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

afterEach(() => vi.unstubAllGlobals());

function stubCanvasCapture(encode: (width: number, height: number) => string) {
  const sizes: Array<{ width: number; height: number }> = [];
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      expect(tag).toBe("canvas");
      const output = {
        width: 0,
        height: 0,
        getContext: () => ({
          fillStyle: "",
          fillRect: () => undefined,
          drawImage: () => undefined,
        }),
        toDataURL: () => {
          sizes.push({ width: output.width, height: output.height });
          return encode(output.width, output.height);
        },
      };
      return output;
    },
  });
  return sizes;
}

describe("scene review canvas capture", () => {
  it("uses the higher-detail size when its PNG fits the existing cap", () => {
    const sizes = stubCanvasCapture(() => image);
    const canvas = { width: 1600, height: 900 } as HTMLCanvasElement;

    expect(captureSceneCanvas(canvas)).toBe(image);
    expect(sizes).toEqual([{ width: 768, height: 432 }]);
  });

  it("falls back to the prior size when the higher-detail PNG exceeds the cap", () => {
    const oversized = `data:image/png;base64,${"A".repeat(MAX_REVIEW_IMAGE_BYTES)}`;
    const sizes = stubCanvasCapture((width) =>
      width === 768 ? oversized : image,
    );
    const canvas = { width: 1600, height: 900 } as HTMLCanvasElement;

    expect(captureSceneCanvas(canvas)).toBe(image);
    expect(sizes).toEqual([
      { width: 768, height: 432 },
      { width: 512, height: 288 },
    ]);
    expect(new TextEncoder().encode(oversized).byteLength).toBeGreaterThan(
      MAX_REVIEW_IMAGE_BYTES,
    );
  });
});

function source(
  renderer: "webgl" | "software",
  state: Partial<SceneReviewSourceState> = {},
  capture = () => image,
): SceneReviewCaptureSource {
  return {
    renderer,
    getState: () => ({
      renderer,
      projectId: "project",
      revision: 2,
      renderedRevision: 2,
      transitionSettled: true,
      mounted: true,
      readyAssetIds: ["body"],
      pendingAssetIds: [],
      failedAssetIds: [],
      errors: [],
      ...state,
    }),
    capture,
  };
}

async function expectCaptureError(
  promise: Promise<unknown>,
  code: SceneReviewCaptureError["code"],
) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("scene review capture bridge", () => {
  it("captures the requested revision after a replacement commits", async () => {
    const bridge = new SceneReviewCaptureBridge();
    let replacementReady = false;
    const unregister = bridge.register(
      source("webgl", {
        get renderedRevision() {
          return replacementReady ? 2 : 1;
        },
        get pendingAssetIds() {
          return replacementReady ? [] : ["body"];
        },
      }),
    );
    const capture = bridge.capture({
      projectId: "project",
      revision: 2,
      renderer: "webgl",
      timeoutMs: 500,
    });
    setTimeout(() => {
      replacementReady = true;
      bridge.notify();
    }, 15);
    const result = await capture;
    expect(result).toMatchObject({
      renderer: "webgl",
      projectId: "project",
      revision: 2,
      width: 1,
      height: 1,
    });
    expect(result.byteLength).toBe(image.length);
    unregister();
  });

  it("rejects a superseded revision instead of returning a newer scene", async () => {
    const bridge = new SceneReviewCaptureBridge();
    const unregister = bridge.register(
      source("software", { revision: 3, renderedRevision: 3 }),
    );
    await expectCaptureError(
      bridge.capture({
        projectId: "project",
        revision: 2,
        renderer: "software",
        timeoutMs: 100,
      }),
      "superseded-revision",
    );
    unregister();
  });

  it("rejects a new project and failed asset without exposing image data", async () => {
    const bridge = new SceneReviewCaptureBridge();
    let unregister = bridge.register(
      source("webgl", { projectId: "new-project" }),
    );
    await expectCaptureError(
      bridge.capture({ projectId: "project", revision: 2, timeoutMs: 100 }),
      "project-mismatch",
    );
    unregister();
    unregister = bridge.register(
      source("webgl", { failedAssetIds: ["body"], renderedRevision: 1 }),
    );
    await expectCaptureError(
      bridge.capture({ projectId: "project", revision: 2, timeoutMs: 100 }),
      "asset-failed",
    );
    unregister();
  });

  it("stops waiting on abort and on renderer unmount", async () => {
    const bridge = new SceneReviewCaptureBridge();
    const controller = new AbortController();
    const unregister = bridge.register(
      source("software", { renderedRevision: 1, pendingAssetIds: ["body"] }),
    );
    const pending = bridge.capture({
      projectId: "project",
      revision: 2,
      timeoutMs: 500,
      signal: controller.signal,
    });
    controller.abort();
    await expectCaptureError(pending, "aborted");
    unregister();

    const second = bridge.register(
      source("software", { mounted: false, renderedRevision: 1 }),
    );
    await expectCaptureError(
      bridge.capture({ projectId: "project", revision: 2, timeoutMs: 50 }),
      "unavailable",
    );
    second();
  });

  it("rejects non-PNG or over-cap captures", async () => {
    const bridge = new SceneReviewCaptureBridge();
    let unregister = bridge.register(
      source("webgl", {}, () => "https://remote/image.png"),
    );
    await expectCaptureError(
      bridge.capture({ projectId: "project", revision: 2, timeoutMs: 100 }),
      "invalid-image",
    );
    unregister();
    const oversized = `data:image/png;base64,${"A".repeat(128 * 1024)}`;
    unregister = bridge.register(source("webgl", {}, () => oversized));
    await expectCaptureError(
      bridge.capture({ projectId: "project", revision: 2, timeoutMs: 100 }),
      "invalid-image",
    );
    unregister();
  });

  it("captures both renderer adapters through the same primitive contract", async () => {
    for (const renderer of ["webgl", "software"] as const) {
      const bridge = new SceneReviewCaptureBridge();
      const unregister = bridge.register(source(renderer));
      const result = await bridge.capture({
        projectId: "project",
        revision: 2,
        renderer,
        timeoutMs: 100,
      });
      expect(result.renderer).toBe(renderer);
      expect(result.image.startsWith("data:image/png;base64,")).toBe(true);
      unregister();
    }
  });

  it("does not hide a capture callback failure as a readiness success", async () => {
    const bridge = new SceneReviewCaptureBridge();
    const unregister = bridge.register(
      source("webgl", {}, () => {
        throw new Error("canvas unavailable");
      }),
    );
    await expectCaptureError(
      bridge.capture({ projectId: "project", revision: 2, timeoutMs: 100 }),
      "invalid-image",
    );
    unregister();
  });
});
