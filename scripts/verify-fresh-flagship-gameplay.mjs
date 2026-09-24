#!/usr/bin/env node
/**
 * Local browser fixture for the fresh-world gameplay driver.
 *
 * This uses the real Orbsie editor, renderer components, physics loop, input
 * handlers, and observation bridge. Only the generation transport is a local
 * deterministic NDJSON fixture; no provider, model, credential, or external
 * network request is used. The report is intentionally separate from provider
 * E2E.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import {
  observeFlagshipMovementDuringGeneration,
  runFreshFlagshipGameplay,
} from "./provider-browser-e2e.mjs";
import { waitForFreshGameplayObservation } from "./lib/fresh-flagship-gameplay.mjs";

const appUrl = process.env.TEST_URL ?? "http://localhost:3040";
const appOrigin = new URL(appUrl).origin;
const evidenceDir = resolve(
  process.env.ORBSIE_FRESH_GAMEPLAY_FIXTURE_EVIDENCE ??
    "docs/evidence/fresh-flagship-gameplay-fixture",
);
const requestedRenderer = process.env.ORBSIE_FRESH_GAMEPLAY_RENDERER ?? "all";
const layoutOnly = process.env.ORBSIE_FRESH_GAMEPLAY_LAYOUT_ONLY === "1";
const coarsePointerFixture =
  process.env.ORBSIE_FRESH_GAMEPLAY_COARSE_POINTER === "1";
const focusOnly = process.env.ORBSIE_FRESH_GAMEPLAY_FOCUS_ONLY === "1";
assert(
  requestedRenderer === "all" ||
    requestedRenderer === "webgl" ||
    requestedRenderer === "software",
  "ORBSIE_FRESH_GAMEPLAY_RENDERER must be all, webgl, or software.",
);
if (layoutOnly)
  assert.equal(
    requestedRenderer,
    "software",
    "Layout-only fixture validation requires the forced software renderer.",
  );
if (focusOnly)
  assert(
    requestedRenderer === "webgl" || requestedRenderer === "software",
    "Focus-only fixture validation requires webgl or software renderer.",
  );
assert(
  !(layoutOnly && focusOnly),
  "Layout-only and focus-only fixture modes cannot be combined.",
);

const entities = [
  {
    id: "fixture-platform-a",
    label: "First moving platform",
    position: [0, 0.2, 3],
    color: "#eedda5",
    scale: [1.6, 0.6, 1.6],
    geometry: { kind: "platform", detail: "refined" },
    behavior: { type: "move", speed: 0.8, amplitude: 0.22, axis: "y" },
    stage: "ready",
  },
  {
    id: "fixture-platform-b",
    label: "Second moving platform",
    position: [0, 0.8, 0.3],
    color: "#efc79c",
    scale: [1.6, 0.7, 1.6],
    geometry: { kind: "platform", detail: "refined" },
    behavior: { type: "move", speed: 0.7, amplitude: 0.35, axis: "x" },
    stage: "ready",
  },
  {
    id: "fixture-platform-c",
    label: "Bouncy moving platform",
    position: [0, 1.4, -1.8],
    color: "#ddc4e9",
    scale: [1.7, 0.7, 1.7],
    geometry: { kind: "platform", detail: "refined" },
    behavior: { type: "bounce" },
    stage: "ready",
  },
  ...[
    [-1.5, 0.8, 4],
    [1.4, 0.8, 2.6],
    [-1.2, 0.8, 1.2],
    [1.4, 0.8, -0.5],
    [-1.2, 0.8, -2.8],
  ].map((position, index) => ({
    id: `fixture-crystal-${index + 1}`,
    label: `Crystal ${index + 1}`,
    position,
    color: "#a1f0d7",
    scale: [0.6, 0.6, 0.6],
    geometry: { kind: "crystal", detail: "refined" },
    behavior: { type: "collect" },
    stage: "ready",
  })),
  {
    id: "fixture-portal",
    label: "Sunlight portal",
    position: [0, 0, -5.2],
    color: "#eddbb7",
    scale: [1.4, 1.4, 1.1],
    geometry: { kind: "arch", detail: "refined" },
    behavior: { type: "portal" },
    stage: "ready",
  },
  {
    id: "fixture-mushroom",
    label: "Friendly mushroom",
    position: [-4, 0.7, 0],
    color: "#a1f0d7",
    scale: [0.9, 1.2, 0.9],
    geometry: { kind: "tree", detail: "refined" },
    stage: "ready",
  },
];

const platforms = entities.slice(0, 3);
const collectibles = entities.slice(3, 8);
const portal = entities[8];
const collectibleRules = collectibles.map((entity, index) => ({
  id: `collect-${index + 1}`,
  trigger: { type: "collect", entityId: entity.id },
  conditions: [],
  actions: [{ type: "add_score", amount: 1 }],
}));
const game = {
  variables: [],
  rules: [
    {
      id: "move-bounce-platform",
      trigger: { type: "start" },
      conditions: [],
      actions: [
        {
          type: "move_path",
          entityId: platforms[2].id,
          points: [
            [...platforms[2].position],
            [0.8, platforms[2].position[1], platforms[2].position[2]],
          ],
          duration: 2,
          loop: true,
        },
      ],
    },
    ...collectibleRules,
    {
      id: "portal-win",
      trigger: { type: "collision", entityId: portal.id },
      conditions: [{ operand: { type: "score" }, comparison: "gte", value: 5 }],
      actions: [{ type: "win" }],
    },
  ],
};

const addedCollectibles = [
  {
    id: "fixture-crystal-6",
    label: "Crystal 6",
    position: [0.8, 0.8, -3.4],
    color: "#a1f0d7",
    scale: [0.6, 0.6, 0.6],
    geometry: { kind: "crystal", detail: "refined" },
    behavior: { type: "collect" },
    stage: "ready",
  },
  {
    id: "fixture-crystal-7",
    label: "Crystal 7",
    position: [-0.2, 0.8, -4.3],
    color: "#a1f0d7",
    scale: [0.6, 0.6, 0.6],
    geometry: { kind: "crystal", detail: "refined" },
    behavior: { type: "collect" },
    stage: "ready",
  },
];

const goal7Game = {
  ...game,
  rules: [
    ...game.rules.slice(0, -1),
    ...addedCollectibles.map((entity, index) => ({
      id: `collect-${index + 6}`,
      trigger: { type: "collect", entityId: entity.id },
      conditions: [],
      actions: [{ type: "add_score", amount: 1 }],
    })),
    {
      ...game.rules.at(-1),
      conditions: [{ operand: { type: "score" }, comparison: "gte", value: 7 }],
    },
  ],
};

function reserveEntity(entity) {
  const { geometry: _geometry, stage: _stage, ...rest } = entity;
  return { type: "reserve_entity", entity: { ...rest, stage: "seed" } };
}

const fixtureCommands = [
  ...entities.flatMap((entity) => [
    reserveEntity(entity),
    { type: "set_geometry", id: entity.id, geometry: entity.geometry },
  ]),
  { type: "set_game", game },
  {
    type: "commit_revision",
    message:
      "Local fresh gameplay fixture ready: collect five crystals, use three moving platforms, reach the portal, then restart.",
  },
];
const mushroomEditCommands = [
  {
    type: "set_geometry",
    id: "fixture-mushroom",
    geometry: { kind: "mushroom", detail: "refined" },
  },
  { type: "set_material", id: "fixture-mushroom", color: "#ff44aa" },
  { type: "commit_revision", message: "Fixture mushroom revision committed." },
];
const goal7Commands = [
  ...addedCollectibles.flatMap((entity) => [
    reserveEntity(entity),
    { type: "set_geometry", id: entity.id, geometry: entity.geometry },
  ]),
  { type: "set_game", game: goal7Game },
  {
    type: "commit_revision",
    message: "Fixture seven-crystal revision committed.",
  },
];
const fixtureProject = {
  version: 1,
  title: "Local fresh gameplay fixture",
  seed: 42,
  entities,
  environment: { sky: "#dceee9", ground: "#91b977", water: "#59bdbb" },
  game,
  messages: [],
  revision: fixtureCommands.length,
};
const story = { platforms, collectibles, portal };

function installSoftwareFallback(context) {
  return context.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, attributes) {
      if (
        kind === "webgl2" ||
        kind === "webgl" ||
        kind === "experimental-webgl"
      )
        return null;
      return getContext.call(this, kind, attributes);
    };
  });
}

function summarizeGameplayRun(run) {
  if (!run || typeof run !== "object") return null;
  const inputTrace = Array.isArray(run.inputTrace) ? run.inputTrace : [];
  const keysUsed = [
    ...new Set(inputTrace.flatMap((entry) => entry.keys ?? [])),
  ].sort();
  return {
    projectId: run.projectId ?? null,
    revision: run.revision ?? null,
    renderer: run.renderer ?? null,
    expectedCollectibleIds: run.expectedCollectibleIds ?? [],
    collectedIds: run.collectedIds ?? [],
    score: run.score ?? null,
    elapsedMs: run.elapsedMs ?? null,
    movementDistance: run.movement?.distance ?? null,
    actualInput: {
      mode: run.inputMode ?? null,
      traceEntries: inputTrace.length,
      keysUsed,
    },
    platformEvidence: (run.platformEvidence ?? []).map((platform) => ({
      id: platform.id,
      behavior: platform.behavior,
      groundedFrames: platform.groundedFrames,
      bounceFrames: platform.bounceFrames,
      maximumDisplacement: platform.maximumDisplacement,
    })),
    win: run.win
      ? {
          projectId: run.win.projectId,
          revision: run.win.revision,
          score: run.win.score,
          status: run.win.status,
          portalId: run.win.portalId,
        }
      : null,
    reset: run.reset
      ? {
          projectId: run.reset.projectId,
          revision: run.reset.revision,
          scoreIdsCount: run.reset.scoreIds?.length ?? null,
          score: run.reset.score,
          status: run.reset.status,
          lifecycleAdvanced: run.reset.lifecycleAdvanced,
          playerPosition: run.reset.player?.position ?? null,
        }
      : null,
  };
}

function summarizePartialTraversal(partial, failure) {
  if (!partial) return null;
  const observation = partial.lastObservation ?? null;
  const inputTrace = Array.isArray(partial.inputTrace)
    ? partial.inputTrace
    : [];
  return {
    failure,
    observationCount: partial.observationCount ?? null,
    lastObservation: observation
      ? {
          projectId: observation.projectId,
          revision: observation.revision,
          renderer: observation.renderer,
          atMs: observation.atMs,
          playerPosition: observation.player?.position ?? null,
          playerVelocityY: observation.player?.velocityY ?? null,
        }
      : null,
    inputTraceTailEntries: inputTrace.length,
    platformEvidence: (partial.platformEvidence ?? []).map((platform) => ({
      id: platform.id,
      behavior: platform.behavior,
      groundedFrames: platform.groundedFrames,
      bounceFrames: platform.bounceFrames,
      maximumDisplacement: platform.maximumDisplacement,
    })),
  };
}

function summarizeRendererEvidence(evidence) {
  const phases = evidence.gameplayPhases ?? {};
  const movement = evidence.generationMovement;
  const failure = evidence.failure ?? null;
  const partial = evidence.partialTraversal ?? evidence.traversal;
  return {
    status: evidence.status ?? (failure ? "failed" : "passed"),
    renderer: evidence.renderer ?? null,
    generationRequests: evidence.generationRequests ?? null,
    projectId: evidence.projectId ?? null,
    revision: evidence.revision ?? null,
    generationMovement: movement
      ? {
          status: movement.status,
          projectId: movement.projectId,
          revisionBefore: movement.revisionBefore,
          revisionAfter: movement.revisionAfter,
          distance: movement.movementDistance ?? null,
          streamOpenBefore: movement.generationStreamOpenAtMovement,
          streamOpenAfter: movement.generationStreamOpenAfterMovement,
          inputMode: movement.inputMode,
        }
      : null,
    gameplayPhases: Object.fromEntries(
      Object.entries(phases).map(([name, phase]) => [
        name,
        summarizeGameplayRun(phase),
      ]),
    ),
    partialTraversal: summarizePartialTraversal(partial, failure),
    componentBoundary: evidence.componentBoundary ?? null,
    failure,
  };
}

async function readSoftwareWorldDiagnostics(page) {
  try {
    const snapshot = await page.evaluate(() => {
      const read = window.__ORBSIE_SOFTWARE_WORLD_DIAGNOSTICS_READ__;
      return {
        diagnostics: typeof read === "function" ? read() : null,
        longTasks: Array.isArray(window.__ORBSIE_SOFTWARE_WORLD_LONG_TASKS__)
          ? window.__ORBSIE_SOFTWARE_WORLD_LONG_TASKS__.slice(-16)
          : [],
      };
    });
    const { diagnostics } = snapshot;
    if (!diagnostics) return { classification: "diagnostics-unavailable" };
    const classification =
      !diagnostics.mounted || !diagnostics.canvasConnected
        ? "component-unmounted"
        : diagnostics.runtimeError
          ? "raf-stopped-after-exception"
          : diagnostics.documentVisibility !== "visible"
            ? "page-hidden-or-paused"
            : diagnostics.frameScheduled &&
                diagnostics.lastFrameAgeMs !== null &&
                diagnostics.lastFrameAgeMs > 1000
              ? "raf-frame-delayed"
              : diagnostics.loopStopped
                ? "raf-stopped-without-error"
                : diagnostics.frameScheduled
                  ? "raf-running"
                  : "raf-state-incomplete";
    return { classification, ...diagnostics, longTasks: snapshot.longTasks };
  } catch (error) {
    return {
      classification: "diagnostic-read-failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function assertViewportBox(
  box,
  viewport,
  label,
  { allowPartial = false } = {},
) {
  assert(box, `${label} did not produce a layout box.`);
  assert(box.width > 0 && box.height > 0, `${label} is empty.`);
  if (allowPartial) {
    assert(
      box.right > -1 &&
        box.bottom > -1 &&
        box.left < viewport.width + 1 &&
        box.top < viewport.height + 1,
      `${label} is not visible in the viewport: ${JSON.stringify({ box, viewport })}.`,
    );
    return;
  }
  assert(
    box.left >= -1 && box.top >= -1,
    `${label} starts outside the viewport.`,
  );
  assert(
    box.right <= viewport.width + 1 && box.bottom <= viewport.height + 1,
    `${label} overflows the viewport: ${JSON.stringify({ box, viewport })}.`,
  );
}

async function activateFixtureControl(locator) {
  if (coarsePointerFixture) {
    await locator.tap();
    return;
  }
  await locator.click();
}

async function waitForStableBoundingBox(
  page,
  selector,
  { maxWaitMs = 1200, stableFrames = 2, requireInViewport = false } = {},
) {
  const startedAt = Date.now();
  const viewport = page.viewportSize();
  let previous;
  let stable = 0;
  while (Date.now() - startedAt <= maxWaitMs) {
    const box = await page.locator(selector).boundingBox();
    const inViewport =
      box &&
      viewport &&
      box.y >= -1 &&
      box.y + box.height <= viewport.height + 1;
    const isStable =
      box &&
      previous &&
      ["x", "y", "width", "height"].every(
        (key) => Math.abs(box[key] - previous[key]) < 0.5,
      );
    stable = isStable ? stable + 1 : 0;
    if (stable >= stableFrames && (!requireInViewport || inViewport))
      return { box, waitedMs: Date.now() - startedAt };
    previous = box;
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
  }
  throw new Error(
    `${selector} did not settle within ${maxWaitMs}ms while measuring the fixture layout.`,
  );
}

async function measureSoftwareViewport(
  page,
  label,
  { allowClosedComposer = false } = {},
) {
  const viewport = page.viewportSize();
  assert(viewport, "Fixture page did not expose a viewport.");
  const metrics = await page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      return rect
        ? {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          }
        : null;
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scene: box(".scene"),
      canvas: box(".software-world canvas"),
      composer: box(".chat-panel, .landing-composer"),
      sheetHandle: box(".sheet-handle"),
      hud: box(".game-hud"),
      advisory: box(".graphics-error.is-advisory"),
      toolbar: box(".play-toolbar"),
      heading: box(".workspace-heading h2"),
      interaction: {
        pointerCoarse: matchMedia("(pointer: coarse)").matches,
        anyPointerCoarse: matchMedia("(any-pointer: coarse)").matches,
        maxTouchPoints: navigator.maxTouchPoints,
      },
      horizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth + 1 ||
        document.body.scrollWidth > window.innerWidth + 1,
      verticalOverflow:
        document.documentElement.scrollHeight > window.innerHeight + 1 ||
        document.body.scrollHeight > window.innerHeight + 1,
    };
  });
  assert.equal(
    metrics.viewport.width,
    viewport.width,
    `${label} viewport width changed unexpectedly.`,
  );
  assert.equal(
    metrics.viewport.height,
    viewport.height,
    `${label} viewport height changed unexpectedly.`,
  );
  // The scene is a full-bleed visual layer. During the mobile sheet transition
  // its camera framing can intentionally leave part of that layer outside the
  // viewport; the canvas itself and the interactive overlays remain bounded.
  assertViewportBox(metrics.scene, viewport, `${label} scene`, {
    allowPartial: true,
  });
  // The software canvas follows the full-bleed scene framing and can be
  // intentionally clipped by the mobile sheet. Require a visible intersection
  // here; the sheet, HUD, and controls below remain fully bounded.
  assertViewportBox(metrics.canvas, viewport, `${label} canvas`, {
    allowPartial: true,
  });
  assertViewportBox(
    metrics.advisory,
    viewport,
    `${label} compatibility advice`,
  );
  if (coarsePointerFixture) {
    assert.equal(
      metrics.interaction.pointerCoarse,
      true,
      `${label} did not expose a coarse pointer in the touch fixture.`,
    );
    assert(
      metrics.interaction.maxTouchPoints > 0,
      `${label} did not expose touch points in the touch fixture.`,
    );
  }
  if (metrics.advisory && metrics.toolbar) {
    const overlaps =
      metrics.advisory.left < metrics.toolbar.right &&
      metrics.advisory.right > metrics.toolbar.left &&
      metrics.advisory.top < metrics.toolbar.bottom &&
      metrics.advisory.bottom > metrics.toolbar.top;
    assert.equal(
      overlaps,
      false,
      `${label} compatibility advice overlaps the play toolbar: ${JSON.stringify({ advisory: metrics.advisory, toolbar: metrics.toolbar })}.`,
    );
  }
  if (metrics.heading && metrics.toolbar) {
    const overlaps =
      metrics.heading.left < metrics.toolbar.right &&
      metrics.heading.right > metrics.toolbar.left &&
      metrics.heading.top < metrics.toolbar.bottom &&
      metrics.heading.bottom > metrics.toolbar.top;
    assert.equal(
      overlaps,
      false,
      `${label} project title overlaps the play toolbar: ${JSON.stringify({ heading: metrics.heading, toolbar: metrics.toolbar })}.`,
    );
  }
  if (metrics.composer && !allowClosedComposer)
    assertViewportBox(metrics.composer, viewport, `${label} composer`);
  if (allowClosedComposer)
    assertViewportBox(metrics.sheetHandle, viewport, `${label} sheet handle`);
  assert.equal(
    metrics.horizontalOverflow,
    false,
    `${label} has horizontal overflow.`,
  );
  assert.equal(
    metrics.verticalOverflow,
    false,
    `${label} has vertical overflow.`,
  );
  return metrics;
}

async function captureSoftwareLayoutState(page, label) {
  return page.evaluate((stateLabel) => {
    const describe = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        className:
          typeof element.className === "string" ? element.className : null,
        rect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        },
        position: style.position,
        transform: style.transform,
        overflow: style.overflow,
      };
    };
    const describeChain = (selector) => {
      const chain = [];
      let element = document.querySelector(selector);
      for (let depth = 0; element && depth < 6; depth += 1) {
        chain.push(describe(element));
        element = element.parentElement;
      }
      return chain;
    };
    const active = document.activeElement;
    return {
      label: stateLabel,
      window: {
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      },
      visualViewport: window.visualViewport
        ? {
            offsetLeft: window.visualViewport.offsetLeft,
            offsetTop: window.visualViewport.offsetTop,
            pageLeft: window.visualViewport.pageLeft,
            pageTop: window.visualViewport.pageTop,
            width: window.visualViewport.width,
            height: window.visualViewport.height,
          }
        : null,
      document: {
        documentElementScrollTop: document.documentElement.scrollTop,
        bodyScrollTop: document.body.scrollTop,
        scrollHeight: document.documentElement.scrollHeight,
        bodyScrollHeight: document.body.scrollHeight,
      },
      activeElement: active
        ? {
            tag: active.tagName.toLowerCase(),
            id: active.id || null,
            className:
              typeof active.className === "string" ? active.className : null,
          }
        : null,
      targets: {
        advisory: describeChain(".graphics-error.is-advisory"),
        composer: describeChain(".chat-panel"),
        scene: describeChain(".scene"),
      },
    };
  }, label);
}

async function waitForTwoAnimationFrames(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

async function verifySoftwareWorkspaceLayout(page, evidenceDir) {
  const layout = {};
  try {
    return await verifySoftwareWorkspaceLayoutSteps(page, evidenceDir, layout);
  } catch (error) {
    if (error && typeof error === "object")
      error.softwareLayoutEvidence = layout;
    throw error;
  }
}

async function verifySoftwareWorkspaceLayoutSteps(page, evidenceDir, layout) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);
  await expect(page.locator("main")).toHaveClass(/is-workspace/);
  await expect(page.locator(".software-world canvas")).toBeVisible();
  await expect(page.locator(".graphics-error.is-advisory")).toBeVisible();
  await expect(page.locator(".game-hud")).toBeVisible();
  await expect(page.locator(".chat-panel textarea")).toBeVisible();
  layout.desktopPlaying = await measureSoftwareViewport(
    page,
    "desktop-playing",
  );
  await page.screenshot({
    path: resolve(evidenceDir, "software-desktop-playing.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  await expect(page.locator(".software-world canvas")).toBeVisible();
  const handle = page.locator(".sheet-handle");
  await expect(handle).toHaveAttribute("aria-expanded", "false");
  await activateFixtureControl(handle);
  await expect(handle).toHaveAttribute("aria-expanded", "true");
  const composer = page.locator(".chat-panel textarea");
  await expect(composer).toBeVisible();
  layout.phoneSheetOpenSettle = await waitForStableBoundingBox(
    page,
    ".chat-panel",
    { requireInViewport: true },
  );
  layout.phoneSheetOpenDiagnostics = [
    await captureSoftwareLayoutState(page, "before-textarea-fill"),
  ];
  await composer.fill("Software transition layout check");
  await expect(composer).toHaveValue("Software transition layout check");
  layout.phoneSheetOpenDiagnostics.push(
    await captureSoftwareLayoutState(page, "immediately-after-textarea-fill"),
  );
  await waitForTwoAnimationFrames(page);
  layout.phoneSheetOpenDiagnostics.push(
    await captureSoftwareLayoutState(page, "after-two-animation-frames"),
  );
  await page.waitForTimeout(300);
  layout.phoneSheetOpenDiagnostics.push(
    await captureSoftwareLayoutState(page, "after-300ms"),
  );
  layout.phoneSheetOpen = await measureSoftwareViewport(
    page,
    "phone-sheet-open",
  );
  await page.screenshot({
    path: resolve(evidenceDir, "software-phone-sheet-open.png"),
    fullPage: true,
  });
  await activateFixtureControl(handle);
  await expect(handle).toHaveAttribute("aria-expanded", "false");
  layout.phoneSheetClosedSettle = await waitForStableBoundingBox(
    page,
    ".chat-panel",
  );
  layout.phoneSheetClosed = await measureSoftwareViewport(
    page,
    "phone-sheet-closed",
    { allowClosedComposer: true },
  );
  await page.screenshot({
    path: resolve(evidenceDir, "software-phone-sheet-closed.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(150);
  layout.phoneLandscape = await measureSoftwareViewport(
    page,
    "phone-landscape",
    { allowClosedComposer: true },
  );
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();
  await activateFixtureControl(
    page.getByRole("button", { name: "Edit", exact: true }),
  );
  layout.phoneLandscape.editHitTest = true;
  await page.screenshot({
    path: resolve(evidenceDir, "software-phone-landscape.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);

  await activateFixtureControl(
    page.getByRole("button", { name: "Back to planet", exact: true }),
  );
  await expect(page.locator("main")).toHaveClass(/is-landing/);
  await expect(page.locator(".landing-composer")).toBeVisible();
  await page.waitForTimeout(1100);
  layout.landing = await measureSoftwareViewport(page, "phone-landing");
  await page.screenshot({
    path: resolve(evidenceDir, "software-phone-landing.png"),
    fullPage: true,
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("main")).toHaveAttribute(
    "data-renderer-availability",
    "ready",
    { timeout: 30000 },
  );
  await expect(
    page.getByRole("button", {
      name: "Continue your saved world",
      exact: true,
    }),
  ).toBeVisible({ timeout: 10000 });
  await page
    .getByRole("button", { name: "Continue your saved world", exact: true })
    .click();
  await expect(page.locator("main")).toHaveClass(/is-workspace/);
  await expect(page.locator(".software-world canvas")).toBeVisible();
  await expect(page.locator(".chat-panel")).toBeVisible();
  await page.waitForTimeout(1100);
  layout.reopened = await measureSoftwareViewport(page, "phone-reopened");
  await page.screenshot({
    path: resolve(evidenceDir, "software-phone-reopened.png"),
    fullPage: true,
  });
  return layout;
}

async function readGameplayObservation(page) {
  return page.evaluate(() => {
    const read = window.__ORBSIE_GAMEPLAY_READ__;
    return typeof read === "function" ? read() : null;
  });
}

async function waitForFreshMatchingObservation(
  page,
  predicate,
  label,
  lastAtMs = -Infinity,
  maxWaitMs = 30000,
) {
  const startedAt = Date.now();
  let cursor = lastAtMs;
  let latest = null;
  while (Date.now() - startedAt < maxWaitMs) {
    const sample = await waitForFreshGameplayObservation(
      () => readGameplayObservation(page),
      (delayMs) => page.waitForTimeout(delayMs),
      {
        lastAtMs: cursor,
        maxWaitMs: Math.min(1000, maxWaitMs - (Date.now() - startedAt)),
      },
    );
    if (!sample.observation) break;
    latest = sample.observation;
    cursor = latest.atMs;
    if (predicate(latest))
      return { observation: latest, waitedMs: Date.now() - startedAt };
  }
  throw new Error(
    `${label} did not produce a matching fresh observation: ${JSON.stringify({ latest, waitedMs: Date.now() - startedAt })}`,
  );
}

async function waitForGroundedBaseline(
  page,
  projectId,
  reset,
  lastAtMs,
  label,
) {
  const samples = [];
  let cursor = lastAtMs;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const sample = await waitForFreshGameplayObservation(
      () => readGameplayObservation(page),
      (delayMs) => page.waitForTimeout(delayMs),
      {
        lastAtMs: cursor,
        maxWaitMs: Math.min(1000, 30000 - (Date.now() - startedAt)),
      },
    );
    if (!sample.observation) break;
    const observation = sample.observation;
    cursor = observation.atMs;
    if (
      observation.projectId === projectId &&
      observation.reset === reset &&
      observation.playing === true &&
      Number.isFinite(observation.player.position[1]) &&
      Math.abs(observation.player.position[1] - 0.42) < 0.08 &&
      Number.isFinite(observation.player.velocityY) &&
      Math.abs(observation.player.velocityY) < 0.02
    ) {
      samples.push(observation);
      if (samples.length >= 3)
        return {
          observation,
          waitedMs: Date.now() - startedAt,
          stableFrames: samples.length,
        };
    } else samples.length = 0;
  }
  throw new Error(
    `${label} did not reach a stable grounded baseline: ${JSON.stringify({ latest: cursor, waitedMs: Date.now() - startedAt })}`,
  );
}

async function waitForJumpRise(page, baseline, projectId, reset, label) {
  const startedAt = Date.now();
  let cursor = baseline.atMs;
  let latest = null;
  const maxWaitMs = 1200;
  while (Date.now() - startedAt < maxWaitMs) {
    const sample = await waitForFreshGameplayObservation(
      () => readGameplayObservation(page),
      (delayMs) => page.waitForTimeout(delayMs),
      {
        lastAtMs: cursor,
        maxWaitMs: Math.min(250, maxWaitMs - (Date.now() - startedAt)),
      },
    );
    if (!sample.observation) break;
    latest = sample.observation;
    cursor = latest.atMs;
    const position = latest.player.position;
    if (
      latest.projectId === projectId &&
      latest.reset === reset &&
      latest.playing === true &&
      Number.isFinite(latest.player.velocityY) &&
      latest.player.velocityY > 0 &&
      Number.isFinite(position[1]) &&
      position[1] > baseline.player.position[1] + 0.02
    )
      return { observation: latest, waitedMs: Date.now() - startedAt };
  }
  throw new Error(
    `${label} did not show a fresh upward jump above the grounded baseline: ${JSON.stringify({ baseline, latest, waitedMs: Date.now() - startedAt })}`,
  );
}

async function verifyGameplayKeyboardFocus(page, project) {
  const evidence = { renderer: null, projectId: project.id, jumps: [] };
  let spaceHeld = false;
  try {
    const region = page.getByRole("region", {
      name: "Gameplay area",
      exact: true,
    });
    const play = page.getByRole("button", { name: "Play", exact: true });
    const edit = page.getByRole("button", { name: "Edit", exact: true });
    const restart = page.getByRole("button", {
      name: "Restart game",
      exact: true,
    });
    const composer = page.locator("#prompt");
    await expect(region).toBeVisible();
    await expect(region).toBeFocused();
    evidence.initialFocus = true;

    const initial = await waitForFreshMatchingObservation(
      page,
      (observation) =>
        observation.projectId === project.id && observation.playing === true,
      "click-Play focus",
    );
    evidence.renderer = initial.observation.renderer;
    await restart.click();
    await expect(region).toBeFocused();
    evidence.restartFocus = true;
    const restartReset = await waitForFreshMatchingObservation(
      page,
      (observation) =>
        observation.projectId === project.id &&
        observation.reset > initial.observation.reset,
      "restart before restart-Space focus",
      initial.observation.atMs,
    );
    const restartBaseline = (
      await waitForGroundedBaseline(
        page,
        project.id,
        restartReset.observation.reset,
        restartReset.observation.atMs,
        "restart-Space baseline",
      )
    ).observation;
    await page.keyboard.down(" ");
    spaceHeld = true;
    const restartAfter = (
      await waitForJumpRise(
        page,
        restartBaseline,
        project.id,
        restartReset.observation.reset,
        "restart-Space",
      )
    ).observation;
    await page.keyboard.up(" ");
    spaceHeld = false;
    evidence.jumps.push({
      activation: "restart",
      before: restartBaseline,
      after: restartAfter,
    });

    await restart.click();
    const firstReset = await waitForFreshMatchingObservation(
      page,
      (observation) =>
        observation.projectId === project.id &&
        observation.reset > restartReset.observation.reset,
      "restart before click-Play focus",
      restartAfter.atMs,
    );
    await edit.click();
    await expect(edit).toBeFocused();
    await play.click();
    await expect(region).toBeFocused();
    const firstBaseline = (
      await waitForGroundedBaseline(
        page,
        project.id,
        firstReset.observation.reset,
        firstReset.observation.atMs,
        "click-Play baseline",
      )
    ).observation;
    await page.keyboard.down(" ");
    spaceHeld = true;
    const firstAfter = (
      await waitForJumpRise(
        page,
        firstBaseline,
        project.id,
        firstReset.observation.reset,
        "click-Play Space",
      )
    ).observation;
    await page.keyboard.up(" ");
    spaceHeld = false;
    evidence.jumps.push({
      activation: "click",
      before: firstBaseline,
      after: firstAfter,
    });

    await restart.click();
    const secondReset = await waitForFreshMatchingObservation(
      page,
      (observation) =>
        observation.projectId === project.id &&
        observation.reset > firstReset.observation.reset,
      "restart before keyboard Play",
      firstAfter.atMs,
    );
    await edit.click();
    await expect(edit).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(play).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(region).toBeFocused();
    evidence.keyboardActivationFocus = true;
    evidence.focusVisible = await region.evaluate((element) =>
      element.matches(":focus-visible"),
    );
    assert.equal(
      evidence.focusVisible,
      true,
      "Keyboard-activated Play did not leave a visible gameplay focus target.",
    );
    const secondBaseline = (
      await waitForGroundedBaseline(
        page,
        project.id,
        secondReset.observation.reset,
        secondReset.observation.atMs,
        "keyboard-activated Play baseline",
      )
    ).observation;
    await page.keyboard.down(" ");
    spaceHeld = true;
    const secondAfter = (
      await waitForJumpRise(
        page,
        secondBaseline,
        project.id,
        secondReset.observation.reset,
        "keyboard-activated Play Space",
      )
    ).observation;
    await page.keyboard.up(" ");
    spaceHeld = false;
    evidence.jumps.push({
      activation: "keyboard-enter",
      before: secondBaseline,
      after: secondAfter,
    });

    await restart.click();
    const typingReset = await waitForFreshMatchingObservation(
      page,
      (observation) =>
        observation.projectId === project.id &&
        observation.reset > secondReset.observation.reset,
      "restart before composer isolation",
      secondAfter.atMs,
    );
    const typingBaseline = (
      await waitForGroundedBaseline(
        page,
        project.id,
        typingReset.observation.reset,
        typingReset.observation.atMs,
        "composer isolation baseline",
      )
    ).observation;
    await composer.focus();
    await expect(composer).toBeFocused();
    await page.keyboard.type("wasd ");
    const typingAfter = (
      await waitForFreshMatchingObservation(
        page,
        (observation) =>
          observation.projectId === project.id &&
          observation.reset === typingReset.observation.reset &&
          observation.playing === true,
        "composer isolation observation",
        typingBaseline.atMs,
        1000,
      )
    ).observation;
    assert(
      Math.hypot(
        typingAfter.player.position[0] - typingBaseline.player.position[0],
        typingAfter.player.position[1] - typingBaseline.player.position[1],
        typingAfter.player.position[2] - typingBaseline.player.position[2],
      ) < 0.02 &&
        Math.abs(
          typingAfter.player.position[1] - typingBaseline.player.position[1],
        ) < 0.02 &&
        Math.abs(typingAfter.player.velocityY) < 0.02,
      `Composer typing moved gameplay: ${JSON.stringify({ typingBaseline, typingAfter })}`,
    );
    evidence.composerTyping = {
      focused: true,
      value: await composer.inputValue(),
      before: typingBaseline,
      after: typingAfter,
    };

    await region.focus({ preventScroll: true });
    let tabReachedEditor = false;
    for (let index = 0; index < 16; index += 1) {
      await page.keyboard.press("Tab");
      if (
        await edit.evaluate((element) => document.activeElement === element)
      ) {
        tabReachedEditor = true;
        break;
      }
    }
    assert.equal(
      tabReachedEditor,
      true,
      "Tab navigation did not return to Edit.",
    );
    evidence.tabReachedEditor = true;
    evidence.finalFocus = await page.evaluate(() => ({
      tag: document.activeElement?.tagName.toLowerCase() ?? null,
      text: document.activeElement?.textContent?.trim() ?? null,
    }));
    return evidence;
  } catch (error) {
    if (error && typeof error === "object")
      error.gameplayFocusEvidence = evidence;
    throw error;
  } finally {
    if (spaceHeld) await page.keyboard.up(" ").catch(() => {});
  }
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return { promise, resolve: resolvePromise };
}

async function startGenerationStream() {
  const started = deferred();
  const release = deferred();
  const finished = deferred();
  const requestBodies = [];
  let requests = 0;
  let responseFinished = false;
  const server = createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": appOrigin,
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      });
      response.end();
      return;
    }
    if (request.url !== "/api/generate-stream" || request.method !== "POST") {
      response.writeHead(404);
      response.end();
      return;
    }
    const body = [];
    for await (const chunk of request) body.push(chunk);
    const requestBody = JSON.parse(Buffer.concat(body).toString("utf8"));
    requestBodies.push(requestBody);
    const requestIndex = requests;
    requests += 1;
    const commands =
      requestIndex === 0
        ? fixtureCommands
        : requestIndex === 1
          ? mushroomEditCommands
          : requestIndex === 2
            ? goal7Commands
            : null;
    if (!commands) {
      response.writeHead(409, {
        "Access-Control-Allow-Origin": appOrigin,
        "Content-Type": "application/json",
      });
      response.end(
        JSON.stringify({ error: "Unexpected fixture generation request." }),
      );
      return;
    }
    response.writeHead(200, {
      "Access-Control-Allow-Origin": appOrigin,
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    });
    const encode = (items) =>
      items.map((command) => JSON.stringify(command)).join("\n") + "\n";
    if (requestIndex === 0) {
      response.write(encode(commands.slice(0, 2)));
      started.resolve();
      const markFinished = () => {
        responseFinished = true;
        finished.resolve();
      };
      response.once("finish", markFinished);
      response.once("close", markFinished);
      await release.promise;
      response.end(encode(commands.slice(2)));
      markFinished();
      return;
    }
    response.end(encode(commands));
  });
  await new Promise((resolveServer) =>
    server.listen(0, "127.0.0.1", resolveServer),
  );
  const address = server.address();
  assert(
    address && typeof address === "object",
    "Fixture stream did not bind.",
  );
  return {
    origin: `http://127.0.0.1:${address.port}`,
    started: started.promise,
    release: () => release.resolve(),
    finished: finished.promise,
    get requestProject() {
      return requestBodies[0]?.project;
    },
    get requestBodies() {
      return requestBodies;
    },
    get requests() {
      return requests;
    },
    close: async () => {
      release.resolve();
      if (requests > 0 && !responseFinished) {
        await Promise.race([
          finished.promise,
          new Promise((resolveFinished) => setTimeout(resolveFinished, 1000)),
        ]);
      }
      server.closeAllConnections();
      await new Promise((resolveServer) => server.close(resolveServer));
    },
  };
}

async function runRenderer(browser, renderer) {
  const stream = await startGenerationStream();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "no-preference",
    ...(coarsePointerFixture ? { hasTouch: true, isMobile: true } : {}),
  });
  await context.addInitScript(() => {
    window.__ORBSIE_GAMEPLAY_READ_REQUESTED__ = true;
  });
  await context.addInitScript((fixtureRenderer) => {
    if (fixtureRenderer === "software") {
      window.__ORBSIE_SOFTWARE_WORLD_DIAGNOSTICS_REQUESTED__ = true;
      window.__ORBSIE_SOFTWARE_WORLD_LONG_TASKS__ = [];
      if (typeof PerformanceObserver === "function") {
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries())
              window.__ORBSIE_SOFTWARE_WORLD_LONG_TASKS__.push({
                startTime: entry.startTime,
                duration: entry.duration,
              });
            window.__ORBSIE_SOFTWARE_WORLD_LONG_TASKS__ =
              window.__ORBSIE_SOFTWARE_WORLD_LONG_TASKS__.slice(-32);
          }).observe({ type: "longtask", buffered: true });
        } catch {}
      }
    }
  }, renderer);
  await context.addInitScript(
    ({ streamUrl }) => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const requestUrl = new URL(
          typeof input === "string" ? input : input.url,
          window.location.href,
        );
        if (requestUrl.pathname !== "/api/generate")
          return originalFetch(input, init);
        return originalFetch(streamUrl, { ...init, credentials: "omit" });
      };
    },
    { streamUrl: `${stream.origin}/api/generate-stream` },
  );
  if (renderer === "software") await installSoftwareFallback(context);
  const blockedExternalRequests = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin !== appOrigin &&
      url.origin !== stream.origin &&
      url.protocol !== "data:"
    ) {
      blockedExternalRequests.push(url.href);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    if (url.origin === stream.origin) {
      await route.continue();
      return;
    }
    if (url.pathname === "/api/config") {
      await route.fulfill({
        json: { accounts: false, publishing: false, cloudRecovery: false },
      });
      return;
    }
    if (url.pathname === "/api/trial") {
      await route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } });
      return;
    }
    await route.fulfill({ json: {} });
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const requestFailures = [];
  const requestsSeen = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      consoleErrors.push(`${message.type()}: ${message.text()}`);
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") || url.origin !== appOrigin)
      requestsSeen.push(`${request.method()} ${request.url()}`);
  });
  page.on("requestfailed", (request) =>
    requestFailures.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown"}`,
    ),
  );
  let generationMovement;
  let result;
  let goal7Gameplay;
  let undoGameplay;
  let stage = "open-page";
  let layout;
  let focusEvidence;
  let componentBoundary;
  try {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toHaveAttribute(
      "data-renderer-availability",
      "ready",
      { timeout: 30000 },
    );
    const prompt = page.locator("#prompt");
    await prompt.fill("Create the local fresh gameplay fixture.");
    await expect(prompt).toHaveValue(
      "Create the local fresh gameplay fixture.",
    );
    const create = page.getByRole("button", { name: "Create", exact: true });
    await expect(create).toBeEnabled({ timeout: 30000 });
    await create.click();
    await Promise.race([
      stream.started,
      page.waitForTimeout(30000).then(async () => {
        const mainState = await page
          .locator("main")
          .getAttribute("data-renderer-availability")
          .catch(() => null);
        throw new Error(
          `Fixture generation stream did not start (renderer=${mainState}, requests=${JSON.stringify(requestsSeen)}, failures=${JSON.stringify(requestFailures)}, pageErrors=${JSON.stringify(pageErrors)}, console=${JSON.stringify(consoleErrors.slice(-8))}).`,
        );
      }),
    ]);
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    assert(
      stream.requestProject?.id,
      "The fixture stream did not receive the source project ID.",
    );
    generationMovement = await observeFlagshipMovementDuringGeneration(
      page,
      {
        generationBodies: [{ projectId: stream.requestProject.id }],
        generationRequests: stream.requests,
        generationStatuses: [],
        generationRequestTimes: [{ atMs: Date.now() }],
      },
      { projectId: stream.requestProject.id, inputMode: "keyboard" },
    );
    stream.release();
    await stream.finished;
    await expect(
      page.getByText(fixtureCommands.at(-1).message, { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    assert(
      stream.requestProject?.id,
      "The fixture did not receive the source project ID.",
    );
    const project = {
      ...fixtureProject,
      id: stream.requestProject.id,
      messages: [
        {
          role: "user",
          text: "Create the local fresh gameplay fixture.",
        },
        { role: "assistant", text: fixtureCommands.at(-1).message },
      ],
    };
    if (focusOnly) {
      focusEvidence = await verifyGameplayKeyboardFocus(page, project);
      assert.equal(stream.requests, 1);
      assert.deepEqual(blockedExternalRequests, []);
      const expectedPageErrors =
        renderer === "software"
          ? pageErrors.filter(
              (message) =>
                message ===
                "THREE.WebGLRenderer: Error creating WebGL context.",
            )
          : [];
      const unexpectedPageErrors = pageErrors.filter(
        (message) => !expectedPageErrors.includes(message),
      );
      assert.deepEqual(unexpectedPageErrors, []);
      return {
        status: "passed",
        renderer,
        focusOnly: true,
        generationRequests: stream.requests,
        projectId: project.id,
        revision: project.revision,
        generationMovement,
        focus: focusEvidence,
        pageErrors,
        expectedPageErrors,
        blockedExternalRequests,
      };
    }
    if (layoutOnly) {
      await expect(page.locator("main")).toHaveClass(/is-workspace/);
      await activateFixtureControl(
        page.getByRole("button", { name: "Play", exact: true }),
      );
      await expect(page.locator(".game-hud")).toBeVisible({ timeout: 30000 });
      layout = await verifySoftwareWorkspaceLayout(page, evidenceDir);
      assert.equal(stream.requests, 1);
      assert.deepEqual(blockedExternalRequests, []);
      const expectedPageErrors = pageErrors.filter(
        (message) =>
          message === "THREE.WebGLRenderer: Error creating WebGL context.",
      );
      const unexpectedPageErrors = pageErrors.filter(
        (message) => !expectedPageErrors.includes(message),
      );
      assert.deepEqual(unexpectedPageErrors, []);
      return {
        status: "passed",
        renderer,
        layoutOnly: true,
        generationRequests: stream.requests,
        projectId: project.id,
        revision: project.revision,
        layout,
        pageErrors,
        expectedPageErrors,
        blockedExternalRequests,
      };
    }
    stage = "creation-five";
    result = await runFreshFlagshipGameplay(page, project, story, {
      inputMode: "keyboard",
    });
    assert.equal(result.renderer, renderer);
    assert.equal(result.collectedIds.length, 5);
    assert.equal(result.platformEvidence.length, 3);
    assert(
      result.platformEvidence.every(
        (entry) => entry.maximumDisplacement >= 0.05,
      ),
    );
    assert(
      result.platformEvidence.every(
        (entry) => entry.groundedFrames || entry.bounceFrames,
      ),
    );
    assert(result.platformEvidence.some((entry) => entry.bounceFrames > 0));
    assert.equal(result.win.status, "won");
    assert.equal(result.reset.scoreIds.length, 0);
    assert.equal(result.reset.projectId, project.id);
    stage = "mushroom-edit";

    const mushroomRevision = {
      ...project,
      revision: project.revision + mushroomEditCommands.length,
      entities: project.entities.map((entity) =>
        entity.id === "fixture-mushroom"
          ? {
              ...entity,
              geometry: { kind: "mushroom", detail: "refined" },
              color: "#ff44aa",
            }
          : entity,
      ),
      messages: [
        ...project.messages,
        { role: "user", text: "Make this a giant pink mushroom." },
        { role: "assistant", text: mushroomEditCommands.at(-1).message },
      ],
    };
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    if (!(await page.locator(".object-list").isVisible()))
      await page
        .getByRole("button", { name: "Show objects", exact: true })
        .click();
    const mushroomRow = page
      .locator(".object-list button")
      .filter({ hasText: "Friendly mushroom" })
      .first();
    await expect(mushroomRow).toHaveCount(1);
    await mushroomRow.click();
    await expect(page.locator(".selection-chip")).toContainText(
      "Friendly mushroom",
    );
    await page.locator("#prompt").fill("Make this a giant pink mushroom.");
    await page
      .getByRole("button", { name: "Change this", exact: true })
      .click();
    await expect(
      page.getByText("Fixture mushroom revision committed.", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    assert.equal(stream.requests, 2);
    assert.equal(stream.requestBodies[1]?.selected, "fixture-mushroom");

    const goal7Project = {
      ...mushroomRevision,
      revision: mushroomRevision.revision + goal7Commands.length,
      entities: [...mushroomRevision.entities, ...addedCollectibles],
      game: goal7Game,
      messages: [
        ...mushroomRevision.messages,
        {
          role: "user",
          text: "Make the middle platform slower and add two more crystals.",
        },
        { role: "assistant", text: goal7Commands.at(-1).message },
      ],
    };
    await expect(
      page.getByRole("button", { name: "Clear selected object", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Clear selected object", exact: true })
      .click();
    await page
      .locator("#prompt")
      .fill("Make the middle platform slower and add two more crystals.");
    await page
      .getByRole("button", { name: "Change this", exact: true })
      .click();
    await expect(
      page.getByText("Fixture seven-crystal revision committed.", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
    assert.equal(stream.requests, 3);
    assert.equal(
      stream.requestBodies[2]?.project?.entities?.find(
        (entity) => entity.id === "fixture-mushroom",
      )?.geometry?.kind,
      "mushroom",
      "The seven-crystal edit did not begin from the selected mushroom revision.",
    );
    assert.equal(stream.requestBodies[2]?.selected ?? null, null);
    const goal7Story = {
      platforms: goal7Project.entities.filter((entity) =>
        entity.id.startsWith("fixture-platform-"),
      ),
      collectibles: goal7Project.entities.filter(
        (entity) => entity.behavior?.type === "collect",
      ),
      portal: goal7Project.entities.find(
        (entity) => entity.behavior?.type === "portal",
      ),
    };
    stage = "goal-seven";
    goal7Gameplay = await runFreshFlagshipGameplay(
      page,
      goal7Project,
      goal7Story,
      { inputMode: "keyboard", expectedCollectibleCount: 7 },
    );
    assert.equal(goal7Gameplay.renderer, renderer);
    assert.equal(goal7Gameplay.revision, goal7Project.revision);
    assert.equal(goal7Gameplay.collectedIds.length, 7);
    assert.equal(goal7Gameplay.win.status, "won");
    assert.equal(goal7Gameplay.reset.scoreIds.length, 0);

    stage = "ui-undo";
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByRole("button", { name: "Undo last change", exact: true })
      .click();
    await expect(
      page.getByText("Previous change restored.", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    const undoneProject = {
      ...mushroomRevision,
      revision: goal7Project.revision + 1,
    };
    const undoneStory = {
      platforms: undoneProject.entities.filter((entity) =>
        entity.id.startsWith("fixture-platform-"),
      ),
      collectibles: undoneProject.entities.filter(
        (entity) => entity.behavior?.type === "collect",
      ),
      portal: undoneProject.entities.find(
        (entity) => entity.behavior?.type === "portal",
      ),
    };
    assert.equal(undoneStory.collectibles.length, 5);
    assert.equal(
      undoneProject.entities.find((entity) => entity.id === "fixture-mushroom")
        ?.geometry?.kind,
      "mushroom",
    );
    stage = "undo-five";
    undoGameplay = await runFreshFlagshipGameplay(
      page,
      undoneProject,
      undoneStory,
      { inputMode: "keyboard", expectedCollectibleCount: 5 },
    );
    assert.equal(undoGameplay.renderer, renderer);
    assert.equal(undoGameplay.revision, undoneProject.revision);
    assert.equal(undoGameplay.collectedIds.length, 5);
    assert.equal(undoGameplay.win.status, "won");
    assert.equal(undoGameplay.reset.scoreIds.length, 0);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    assert.equal(stream.requests, 3);
    stage = "complete";
    assert.deepEqual(blockedExternalRequests, []);
    if (renderer === "software")
      layout = await verifySoftwareWorkspaceLayout(page, evidenceDir);
    // The software fixture deliberately blocks WebGL so the app exercises its
    // Canvas2D fallback. Three.js reports that expected initialization failure
    // as a page error; retain it in the report while failing on every other
    // renderer error.
    const expectedPageErrors =
      renderer === "software"
        ? pageErrors.filter(
            (message) =>
              message === "THREE.WebGLRenderer: Error creating WebGL context.",
          )
        : [];
    const unexpectedPageErrors = pageErrors.filter(
      (message) => !expectedPageErrors.includes(message),
    );
    assert.deepEqual(unexpectedPageErrors, []);
    await page.screenshot({
      path: resolve(evidenceDir, `${renderer}-reset.png`),
      fullPage: true,
    });
    return {
      status: "passed",
      renderer,
      generationRequests: stream.requests,
      projectId: project.id,
      revision: project.revision,
      generationMovement,
      focus: focusEvidence,
      gameplayPhases: {
        creationFive: result,
        goalSeven: goal7Gameplay,
        uiUndoFive: undoGameplay,
      },
      gameplay: result,
      layout,
      pageErrors,
      expectedPageErrors,
      blockedExternalRequests,
    };
  } catch (error) {
    if (renderer === "software")
      componentBoundary = await readSoftwareWorldDiagnostics(page);
    const partialEvidence = {
      renderer,
      stage,
      generationRequests: stream.requests,
      projectId: stream.requestProject?.id ?? null,
      generationMovement:
        generationMovement ??
        (error && typeof error === "object"
          ? (error.generationMovementEvidence ?? null)
          : null),
      traversal:
        result ??
        (error && typeof error === "object"
          ? (error.freshGameplayEvidence ?? null)
          : null),
      gameplayPhases: {
        creationFive: result,
        goalSeven: goal7Gameplay ?? null,
        uiUndoFive: undoGameplay ?? null,
      },
      focus:
        focusEvidence ??
        (error && typeof error === "object"
          ? (error.gameplayFocusEvidence ?? null)
          : null),
      layout:
        layout ??
        (error && typeof error === "object"
          ? (error.softwareLayoutEvidence ?? null)
          : null),
      componentBoundary: componentBoundary ?? null,
    };
    const message = error instanceof Error ? error.message : String(error);
    const code = /No observation/.test(message)
      ? "no-fresh-observation"
      : /could not recover|did not contact|could not reach/.test(message)
        ? "unreachable-target"
        : /toHaveCount|toBeVisible|Expected values/.test(message)
          ? "fixture-ui-assertion"
          : "gameplay-acceptance-failed";
    const target =
      message.match(
        /(?:approaching|contact platform|reach) ([A-Za-z0-9_-]+)/,
      )?.[1] ?? null;
    partialEvidence.failure = { stage, code, target };
    const wrappedError = new Error(
      `${stage}: ${code}${target ? ` (${target})` : ""}`,
    );
    wrappedError.fixtureEvidence = partialEvidence;
    throw wrappedError;
  } finally {
    await stream.close().catch(() => {});
    await page
      .screenshot({
        path: resolve(evidenceDir, `${renderer}-final.png`),
        fullPage: true,
      })
      .catch(() => {});
    await page.close().catch(() => {});
    await context.close();
  }
}

const report = {
  passed: false,
  scope:
    "Local deterministic browser fixture using the real Orbsie renderers, physics, input handlers, and opt-in observation bridge; no external provider/model/auth/network calls (local fixture HTTP only).",
  appUrl,
  renderers: {},
};
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  await mkdir(evidenceDir, { recursive: true });
  const renderers =
    requestedRenderer === "all" ? ["webgl", "software"] : [requestedRenderer];
  for (const renderer of renderers) {
    try {
      report.renderers[renderer] = await runRenderer(browser, renderer);
    } catch (error) {
      if (error && typeof error === "object" && error.fixtureEvidence)
        report.renderers[renderer] = error.fixtureEvidence;
      throw error;
    }
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await mkdir(evidenceDir, { recursive: true });
  const summaryReport = {
    ...report,
    renderers: Object.fromEntries(
      Object.entries(report.renderers).map(([renderer, evidence]) => [
        renderer,
        summarizeRendererEvidence(evidence),
      ]),
    ),
  };
  await writeFile(
    resolve(evidenceDir, "report.json"),
    `${JSON.stringify(summaryReport, null, 2)}\n`,
  );
  console.log(JSON.stringify(summaryReport, null, 2));
}
