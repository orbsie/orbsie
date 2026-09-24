import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const output = resolve(
  "docs/evidence/initial-project-framing-failure-20260924",
);
const reviewFailure =
  "Scene saved, but review could not finish. Your world is safe.";
const fixture = `
import { createRoot } from "react-dom/client";
import World from "./src/components/world";
import { useOrb } from "./src/lib/store";
import { blankProject } from "./src/lib/protocol";
import { parcelTransitionController } from "./src/lib/parcel-transition";
import { _roots } from "@react-three/fiber";

const savedProject = {
  ...blankProject(),
  id: "saved-small-project",
  title: "Saved small subject",
  revision: 1,
  entities: [{
    id: "tiny-subject",
    label: "Tiny subject",
    position: [0, 0, 0],
    scale: [0.1, 0.1, 0.1],
    color: "#f0ac52",
    stage: "ready",
    geometry: { kind: "rock", detail: "coarse" },
  }],
};
useOrb.setState({
  project: savedProject,
  phase: "editing",
  playing: false,
  building: false,
  error: "",
  generationRecovery: undefined,
});
createRoot(document.getElementById("root")!).render(<World />);

(window as any).initialProjectFrameFixture = {
  ready: () => {
    const canvas = document.querySelector("canvas");
    return Boolean(canvas && _roots.get(canvas)?.store.getState().camera);
  },
  state() {
    const state = useOrb.getState();
    return {
      projectId: state.project.id,
      revision: state.project.revision,
      entityCount: state.project.entities.length,
      entityStages: state.project.entities.map((entity) => entity.stage),
      phase: state.phase,
      building: state.building,
      playing: state.playing,
      error: state.error,
      generationRecoveryProjectId: state.generationRecovery?.projectId ?? null,
    };
  },
  async openSaved() {
    useOrb.setState({
      project: blankProject(),
      phase: "landing",
      playing: false,
      building: false,
      error: "",
      generationRecovery: undefined,
    });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    return useOrb.getState().load(savedProject);
  },
  enterLanding() {
    const project = blankProject();
    useOrb.getState().set({
      project,
      phase: "landing",
      playing: false,
      building: false,
      error: "",
      generationErrorCode: undefined,
      generationRecovery: undefined,
    });
    return this.state();
  },
  startEmptyBuild() {
    const previous = useOrb.getState().project;
    const project = {
      ...blankProject(),
      title: "A tiny orange rock",
      messages: [{ role: "user" as const, text: "Create a tiny orange rock." }],
    };
    useOrb.setState({
      project,
      phase: "descending",
      playing: false,
      building: true,
      error: "",
      generationErrorCode: undefined,
      generationRecovery: undefined,
    });
    return { previousProjectId: previous.id, ...this.state() };
  },
  commitSmallObjectForReview() {
    const current = useOrb.getState().project;
    const project = {
      ...current,
      revision: 1,
      entities: [{
        id: "tiny-subject",
        label: "Tiny subject",
        position: [0, 0, 0] as [number, number, number],
        scale: [0.1, 0.1, 0.1] as [number, number, number],
        color: "#f0ac52",
        stage: "ready" as const,
        geometry: { kind: "rock" as const, detail: "coarse" as const },
      }],
    };
    useOrb.setState({ project });
    return this.state();
  },
  settleReviewFailure() {
    useOrb.getState().set({
      phase: "editing",
      building: false,
      error: ${JSON.stringify(reviewFailure)},
      generationErrorCode: undefined,
      generationRecovery: undefined,
    });
    return this.state();
  },
  camera() {
    const label = document.querySelector('[aria-label^="Zoom in, currently"]');
    const canvas = document.querySelector("canvas");
    const state = canvas ? _roots.get(canvas)?.store.getState() : undefined;
    return {
      zoomLabel: label?.getAttribute("aria-label") ?? null,
      position: state?.camera.position.toArray() ?? null,
    };
  },
  transition() {
    const { progress, settled, target } = parcelTransitionController.snapshot;
    return { progress, settled, target };
  },
};
`;

const { outputFiles } = await build({
  stdin: {
    contents: fixture,
    resolveDir: process.cwd(),
    sourcefile: "initial-project-frame-fixture.tsx",
    loader: "tsx",
  },
  bundle: true,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  write: false,
});
const bundle = outputFiles[0].contents;
const server = createServer((request, response) => {
  if (request.url === "/fixture.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(bundle);
  } else if (request.url === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><title>Saved project framing fixture</title><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#07100f}canvas{display:block;width:100%;height:100%}</style><div id="root"></div><script type="module" src="/fixture.js"></script>',
    );
  } else {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const origin = `http://127.0.0.1:${server.address().port}`;
const errors = [];
const externalRequests = [];
const networkFailures = [];
const httpErrors = [];
const apiRequests = [];
let browser;
try {
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: "block",
  });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname.startsWith("/api/"))
      apiRequests.push(`${request.method()} ${url.pathname}`);
  });
  page.on("requestfailed", (request) => {
    networkFailures.push({
      url: request.url(),
      error: request.failure()?.errorText ?? "unknown",
    });
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      httpErrors.push({ url: response.url(), status: response.status() });
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 500));
  });
  await page.goto(origin);
  await expect
    .poll(() => page.evaluate(() => window.initialProjectFrameFixture?.ready()))
    .toBe(true);
  await expect
    .poll(() =>
      page
        .locator('[aria-label^="Zoom in, currently"]')
        .getAttribute("aria-label"),
    )
    .toBe("Zoom in, currently 100%");
  const savedBefore = await page.evaluate(() =>
    window.initialProjectFrameFixture.camera(),
  );
  await page.screenshot({
    path: resolve(output, "saved-project-before-open.png"),
  });

  assert.equal(
    await page.evaluate(() => window.initialProjectFrameFixture.openSaved()),
    true,
  );
  await expect
    .poll(() =>
      page
        .locator('[aria-label^="Zoom in, currently"]')
        .getAttribute("aria-label"),
    )
    .not.toBe("Zoom in, currently 100%");
  await page.waitForTimeout(700);
  const savedAfter = await page.evaluate(() =>
    window.initialProjectFrameFixture.camera(),
  );
  const savedState = await page.evaluate(() =>
    window.initialProjectFrameFixture.state(),
  );
  await page.screenshot({
    path: resolve(output, "saved-project-after-open.png"),
  });

  assert.notEqual(savedAfter.zoomLabel, savedBefore.zoomLabel);
  assert.ok(savedBefore.position && savedAfter.position);
  assert.equal(savedState.phase, "editing");
  assert.equal(savedState.entityCount, 1);

  const landing = await page.evaluate(() =>
    window.initialProjectFrameFixture.enterLanding(),
  );
  assert.equal(landing.phase, "landing");
  assert.equal(landing.building, false);
  assert.equal(landing.entityCount, 0);
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(output, "lifecycle-landing.png") });

  const build = await page.evaluate(() =>
    window.initialProjectFrameFixture.startEmptyBuild(),
  );
  assert.notEqual(build.projectId, landing.projectId);
  assert.equal(build.phase, "descending");
  assert.equal(build.building, true);
  assert.equal(build.entityCount, 0);
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(output, "lifecycle-building.png") });

  const committed = await page.evaluate(() =>
    window.initialProjectFrameFixture.commitSmallObjectForReview(),
  );
  assert.equal(committed.projectId, build.projectId);
  assert.equal(committed.revision, 1);
  assert.deepEqual(committed.entityStages, ["ready"]);
  assert.equal(committed.phase, "descending");
  assert.equal(committed.building, true);
  await page.waitForTimeout(250);
  await page.screenshot({
    path: resolve(output, "lifecycle-committed-under-review.png"),
  });

  const reviewFailureState = await page.evaluate(() =>
    window.initialProjectFrameFixture.settleReviewFailure(),
  );
  assert.equal(reviewFailureState.projectId, build.projectId);
  assert.equal(reviewFailureState.phase, "editing");
  assert.equal(reviewFailureState.building, false);
  assert.equal(reviewFailureState.playing, false);
  assert.equal(reviewFailureState.error, reviewFailure);
  assert.equal(reviewFailureState.generationRecoveryProjectId, null);
  assert.deepEqual(reviewFailureState.entityStages, ["ready"]);
  await expect
    .poll(() =>
      page
        .locator('[aria-label^="Zoom in, currently"]')
        .getAttribute("aria-label"),
    )
    .not.toBe("Zoom in, currently 100%");
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.initialProjectFrameFixture.transition().settled,
        ),
      { timeout: 10000 },
    )
    .toBe(true);
  const reviewFailureCamera = await page.evaluate(() =>
    window.initialProjectFrameFixture.camera(),
  );
  const reviewFailureTransition = await page.evaluate(() =>
    window.initialProjectFrameFixture.transition(),
  );
  await page.screenshot({
    path: resolve(output, "lifecycle-review-error.png"),
  });

  const cameraDistance = (from, to) =>
    Math.hypot(...from.map((value, index) => value - to[index]));
  assert.ok(savedBefore.position && reviewFailureCamera.position);
  assert.notEqual(reviewFailureCamera.zoomLabel, savedBefore.zoomLabel);
  assert.ok(
    cameraDistance(savedBefore.position, reviewFailureCamera.position) > 0.5,
    "settled failed review should move the default camera to the committed object",
  );
  assert.ok(
    Number.parseInt(
      reviewFailureCamera.zoomLabel?.match(/(\d+)%/)?.[1] ?? "0",
      10,
    ) > 100,
    "the committed small object should be legible at a zoom greater than the default",
  );

  assert.deepEqual(errors, []);
  assert.deepEqual(networkFailures, []);
  assert.deepEqual(httpErrors, []);
  assert.deepEqual(apiRequests, []);
  assert.deepEqual(externalRequests, []);
  await writeFile(
    resolve(output, "report.json"),
    `${JSON.stringify(
      {
        status: "passed",
        sourceCommit: "0fa9b2c",
        scope:
          "World renderer saved-project baseline and deterministic initial-build lifecycle through a committed small object and settled review failure",
        fixture: {
          kind: "deterministic lifecycle state fixture",
          liveProviderResponse: false,
          simulatedHttp502: false,
          reviewFailureUiState: reviewFailure,
        },
        providerCalls: 0,
        apiRequests,
        externalRequests,
        networkFailures,
        httpErrors,
        errors,
        scenarios: {
          savedProjectOpen: {
            phase: savedState.phase,
            entityCount: savedState.entityCount,
            zoomChanged: savedAfter.zoomLabel !== savedBefore.zoomLabel,
            before: savedBefore,
            after: savedAfter,
          },
          initialBuildReviewFailure: {
            landing: {
              phase: landing.phase,
              building: landing.building,
              entityCount: landing.entityCount,
            },
            build: {
              newProjectId: build.projectId !== landing.projectId,
              phase: build.phase,
              building: build.building,
              entityCount: build.entityCount,
            },
            committedUnderReview: {
              sameProjectId: committed.projectId === build.projectId,
              revision: committed.revision,
              entityStages: committed.entityStages,
              phase: committed.phase,
              building: committed.building,
            },
            settledReviewFailure: {
              sameProjectId: reviewFailureState.projectId === build.projectId,
              phase: reviewFailureState.phase,
              building: reviewFailureState.building,
              playing: reviewFailureState.playing,
              error: reviewFailureState.error,
              generationRecoveryPresent:
                reviewFailureState.generationRecoveryProjectId !== null,
              entityStages: reviewFailureState.entityStages,
              transition: reviewFailureTransition,
              camera: reviewFailureCamera,
              movedFromDefaultCamera:
                cameraDistance(
                  savedBefore.position,
                  reviewFailureCamera.position,
                ) > 0.5,
              zoomedPastDefault:
                Number.parseInt(
                  reviewFailureCamera.zoomLabel?.match(/(\d+)%/)?.[1] ?? "0",
                  10,
                ) > 100,
            },
          },
        },
        screenshots: [
          "saved-project-before-open.png",
          "saved-project-after-open.png",
          "lifecycle-landing.png",
          "lifecycle-building.png",
          "lifecycle-committed-under-review.png",
          "lifecycle-review-error.png",
        ],
      },
      null,
      2,
    )}\n`,
  );
  console.log("Saved small-project camera framing fixture passed.");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
