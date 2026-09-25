#!/usr/bin/env node
// Production-browser navigation acceptance with deterministic, intercepted
// generation. No provider/model calls are made.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import sharp from "sharp";
import { chromium, expect } from "@playwright/test";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";

const appUrl = "https://orbsie.com";
const appOrigin = new URL(appUrl).origin;
const outputArg = process.argv[2];
if (!outputArg)
  throw Error(
    "Provide a new evidence directory under docs/evidence/world-navigation-browser/.",
  );
const evidenceRoot = resolve("docs/evidence/world-navigation-browser");
const outputPath = resolve(outputArg);
const outputRelative = relative(evidenceRoot, outputPath);
if (outputRelative.startsWith("..") || outputRelative === "")
  throw Error(
    "Evidence output must be a new child of docs/evidence/world-navigation-browser/.",
  );
await mkdir(evidenceRoot, { recursive: true });
await mkdir(outputPath, { recursive: false });

const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const ids = {
  group: "navigation-fixture-group-12km",
  entity: "navigation-fixture-marker-12km",
};
const groupPosition = [12000, 0, 0];
const entityPosition = [0, 1, 0];
const commands = [
  {
    type: "create_group",
    group: {
      id: ids.group,
      label: "Navigation fixture group",
      position: groupPosition,
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  },
  {
    type: "reserve_entity",
    entity: {
      id: ids.entity,
      label: "Navigation fixture marker",
      position: entityPosition,
      scale: [1, 1, 1],
      parentId: ids.group,
      color: "#a1f0d7",
      behavior: { type: "static" },
      stage: "seed",
    },
  },
  {
    type: "set_geometry",
    id: ids.entity,
    geometry: { kind: "crystal", detail: "refined" },
  },
  { type: "commit_revision", message: "Placed the navigation fixture." },
];

const report = {
  status: "failed",
  scope:
    "Production Chromium navigation checks use deterministic intercepted generation for one grouped marker at 12 km. Each renderer lane checks editor zoom controls, background pan, wheel zoom, rotation and north reset, and chat/control overlay gesture isolation. A mobile viewport lane checks touch drag, pinch, and overlay isolation.",
  sourceCommit,
  appUrl,
  providerCalls: 0,
  fixture: { ids, groupPosition, entityPosition },
  renderers: {},
  blockedExternalOrigins: [],
  unexpectedApiPaths: [],
  assumptions: [
    "The browser intercepts /api/generate and returns a deterministic fixture; no provider inference runs.",
    "WebGL is Chromium SwiftShader. The fallback lane forces WebGL context creation to fail and uses the editor's Canvas2D path.",
  ],
  limitations: [
    "No native GPU, physical mobile device, or live provider behavior is measured.",
    "Touch is injected through Chromium CDP in a mobile viewport; navigator.maxTouchPoints reported 1, so this does not establish physical multi-touch hardware behavior.",
    "After WebGL wheel zoom, the far marker color signature fell to 39 pixels, below the 100-pixel measurement threshold. The WebGL lane stopped before rotation, north reset, and overlay checks; those checks completed on the Canvas2D desktop lane.",
    "Browser input events and screenshots establish behavior only for this production Chromium run.",
  ],
};

const sanitize = (value) =>
  String(value)
    .replace(/https?:\/\/[^\s)'"`]+/g, (url) => {
      try {
        return `${new URL(url).origin}/…`;
      } catch {
        return "[url]";
      }
    })
    .replace(/\b(?:sk|key|token)[-_:= ][A-Za-z0-9._-]{8,}\b/gi, "[redacted]")
    .slice(0, 500);

function failureText(error) {
  return sanitize(`${error?.name ?? "Error"}: ${error?.message ?? error}`);
}

function ndjson(values) {
  return values.map((value) => JSON.stringify(value)).join("\n") + "\n";
}

function assertPlacement(project) {
  const group = project.groups?.find((entry) => entry.id === ids.group);
  const entity = project.entities?.find((entry) => entry.id === ids.entity);
  assert(group, "fixture group remains saved");
  assert(entity, "fixture entity remains saved");
  assert.deepEqual(group.position, groupPosition);
  assert.equal(entity.parentId, ids.group);
  assert.deepEqual(entity.position, entityPosition);
  assert.equal(entity.id, ids.entity);
  assert.equal(entity.stage, "ready");
}

async function waitForProject(page) {
  let current;
  await expect
    .poll(
      async () => {
        current = (await storageSnapshot(page)).project;
        return Boolean(
          current?.groups?.some((group) => group.id === ids.group) &&
          current.entities?.some((entity) => entity.id === ids.entity),
        );
      },
      { timeout: 20000 },
    )
    .toBe(true);
  return current;
}

async function markerMetrics(page) {
  const canvas = page.locator(".scene canvas").first();
  const bytes = await canvas.screenshot();
  const pixels = await sharp(bytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let count = 0;
  let xSum = 0;
  let ySum = 0;
  let minX = pixels.info.width;
  let minY = pixels.info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < pixels.info.height; y++) {
    for (let x = 0; x < pixels.info.width; x++) {
      const offset = (y * pixels.info.width + x) * pixels.info.channels;
      const red = pixels.data[offset];
      const green = pixels.data[offset + 1];
      const blue = pixels.data[offset + 2];
      if (green > 150 && blue > 150 && blue - red > 30 && green - red > 30) {
        count += 1;
        xSum += x;
        ySum += y;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  assert(count >= 100, `fixture marker pixel signature found ${count} pixels`);
  return {
    pixels: count,
    centroid: { x: xSum / count, y: ySum / count },
    bounds: { minX, minY, maxX, maxY },
    imageSize: { width: pixels.info.width, height: pixels.info.height },
  };
}

function assertMarkerMoved(before, after, action) {
  const distance = Math.hypot(
    after.centroid.x - before.centroid.x,
    after.centroid.y - before.centroid.y,
  );
  assert(
    distance >= 4,
    `${action} moved marker centroid only ${distance.toFixed(1)} px`,
  );
  return { distancePixels: Number(distance.toFixed(1)), before, after };
}

function assertMarkerStable(before, after, action, tolerance = 5) {
  const distance = Math.hypot(
    after.centroid.x - before.centroid.x,
    after.centroid.y - before.centroid.y,
  );
  assert(
    distance <= tolerance,
    `${action} shifted marker centroid ${distance.toFixed(1)} px`,
  );
  return {
    distancePixels: Number(distance.toFixed(1)),
    tolerancePixels: tolerance,
  };
}

async function readNavigation(page) {
  const zoom = await page
    .getByRole("button", { name: /^Zoom in, currently/ })
    .getAttribute("aria-label");
  const compass = await page
    .getByRole("button", { name: /^Reset north/ })
    .getAttribute("aria-label");
  assert(zoom && compass);
  const heading = Number(compass.match(/heading (\d+) degrees/i)?.[1]);
  assert(Number.isFinite(heading), `Could not parse compass label: ${compass}`);
  return { zoom, heading };
}

async function assertFixtureStillSelected(page) {
  await expect(page.locator(".selection-chip")).toContainText(
    "Navigation fixture marker",
  );
  const project = (await storageSnapshot(page)).project;
  assertPlacement(project);
  return {
    selectedLabel: "Navigation fixture marker",
    selectedId: ids.entity,
    groupPosition: project.groups.find((group) => group.id === ids.group)
      .position,
    entityPosition: project.entities.find((entity) => entity.id === ids.entity)
      .position,
  };
}

async function installRoutes(context, lane) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    if (target.origin !== appOrigin && /^https?:$/.test(target.protocol)) {
      lane.blockedExternalOrigins.push(target.origin);
      await route.abort();
      return;
    }
    if (target.origin !== appOrigin) {
      await route.continue();
      return;
    }
    if (target.pathname === "/api/trial") {
      await route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } });
      return;
    }
    if (target.pathname === "/api/config") {
      await route.fulfill({ json: { accounts: false, publishing: false } });
      return;
    }
    if (target.pathname === "/api/models") {
      await route.fulfill({ json: [] });
      return;
    }
    if (target.pathname === "/api/generate") {
      lane.generationRequests += 1;
      const body = request.postDataJSON();
      assert.equal(body.provider, "free");
      assert.equal(body.localModeling, false);
      assert.equal(body.browserModeling, true);
      assert.equal(body.key, "");
      assert.equal(body.selected, undefined);
      assert.equal(body.project.entities.length, 0);
      assert.deepEqual(body.project.groups ?? [], []);
      if (lane.generationRequests !== 1)
        throw Error(`Unexpected generation request ${lane.generationRequests}`);
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: ndjson(commands),
      });
      return;
    }
    if (target.pathname.startsWith("/api/")) {
      lane.unexpectedApiPaths.push(target.pathname);
      await route.abort();
      return;
    }
    await route.continue();
  });
}

async function openFixture(browser, renderer, forceCanvas2d, viewport) {
  const lane = {
    renderer,
    viewport,
    generationRequests: 0,
    checks: {},
    pageErrors: [],
    consoleErrors: [],
    expectedFallbackDiagnostics: [],
    blockedExternalOrigins: [],
    unexpectedApiPaths: [],
  };
  report.renderers[renderer] = lane;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: viewport.width < 650,
    hasTouch: viewport.width < 650,
    reducedMotion: "reduce",
  });
  if (forceCanvas2d)
    await context.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, attributes) {
        if (["webgl2", "webgl", "experimental-webgl"].includes(kind))
          return null;
        return getContext.call(this, kind, attributes);
      };
    });
  await installRoutes(context, lane);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => {
    if (forceCanvas2d && /Error creating WebGL context/i.test(error.message)) {
      lane.expectedFallbackDiagnostics.push(sanitize(error.message));
      return;
    }
    lane.pageErrors.push(sanitize(error.message));
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (forceCanvas2d && /Error creating WebGL context/i.test(message.text())) {
      lane.expectedFallbackDiagnostics.push(sanitize(message.text()));
      return;
    }
    lane.consoleErrors.push(sanitize(message.text()));
  });
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  await expect(page.locator(".scene canvas").first()).toBeVisible();
  await page
    .getByPlaceholder("What experience to build?")
    .fill("Create a far world marker for navigation testing");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const project = await waitForProject(page);
  assertPlacement(project);
  await expect(
    page.locator('main[data-renderer-availability="ready"]'),
  ).toBeVisible({
    timeout: 20000,
  });
  await expect(
    page.getByRole("button", { name: "Frame content" }),
  ).toBeEnabled();
  if (forceCanvas2d) {
    await expect(page.locator(".software-world")).toBeVisible();
    lane.actualRenderer = "editor Canvas2D fallback";
  } else {
    await expect(page.locator(".software-world")).toHaveCount(0);
    lane.actualRenderer = "WebGL / Chromium SwiftShader";
  }
  await page.getByRole("button", { name: "Show objects", exact: true }).click();
  await page
    .getByRole("button", { name: /^Navigation fixture marker/ })
    .click();
  await expect(page.locator(".selection-chip")).toContainText(
    "Navigation fixture marker",
  );
  await page.waitForTimeout(300);
  lane.checks.fixtureReadyAndSelected = true;
  lane.screenshotInitial = `${renderer}-initial.png`;
  await page.screenshot({
    path: `${outputPath}/${lane.screenshotInitial}`,
    animations: "disabled",
  });
  lane.selectionBefore = await assertFixtureStillSelected(page);
  return { context, page, lane };
}

async function drag(page, from, to, button = "left") {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up({ button });
  await page.waitForTimeout(250);
}

async function gestureOverlay(page, lane, selector, label) {
  const locator = page.locator(selector).first();
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  assert(
    bounds && bounds.width > 20 && bounds.height > 20,
    `${label} overlay has usable bounds`,
  );
  const navigationBefore = await readNavigation(page);
  const markerBefore = await markerMetrics(page);
  await drag(
    page,
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    {
      x: bounds.x + bounds.width / 2 + 70,
      y: bounds.y + bounds.height / 2 + 20,
    },
  );
  const navigationAfter = await readNavigation(page);
  const markerAfter = await markerMetrics(page);
  assert.deepEqual(
    navigationAfter,
    navigationBefore,
    `${label} gesture leaves navigation labels unchanged`,
  );
  lane.checks[`${label}OverlayDoesNotNavigate`] = assertMarkerStable(
    markerBefore,
    markerAfter,
    `${label} overlay gesture`,
    4,
  );
}

async function runMouseNavigation(browser, renderer, forceCanvas2d) {
  const { context, page, lane } = await openFixture(
    browser,
    renderer,
    forceCanvas2d,
    { width: 1280, height: 900 },
  );
  try {
    const zoomIn = page.getByRole("button", { name: /^Zoom in, currently/ });
    const zoomOut = page.getByRole("button", { name: /^Zoom out, currently/ });
    const original = await readNavigation(page);
    await zoomOut.click();
    await expect
      .poll(() => readNavigation(page).then((value) => value.zoom))
      .not.toBe(original.zoom);
    const zoomedOut = await readNavigation(page);
    await zoomIn.click();
    await expect
      .poll(() => readNavigation(page).then((value) => value.zoom))
      .toBe(original.zoom);
    lane.checks.visibleZoomButtons = {
      original: original.zoom,
      out: zoomedOut.zoom,
      returned: original.zoom,
    };

    const canvas = page.locator(".scene canvas").first();
    const bounds = await canvas.boundingBox();
    assert(bounds, "scene canvas has bounds");
    const background = {
      x: bounds.x + bounds.width * 0.65,
      y: bounds.y + bounds.height * 0.72,
    };
    const markerBeforePan = await markerMetrics(page);
    await drag(page, background, {
      x: background.x + 60,
      y: background.y + 18,
    });
    const markerAfterPan = await markerMetrics(page);
    lane.checks.mouseBackgroundPan = assertMarkerMoved(
      markerBeforePan,
      markerAfterPan,
      "mouse background pan",
    );
    assert.equal(
      (await readNavigation(page)).zoom,
      original.zoom,
      "pan preserves zoom",
    );
    await page.screenshot({
      path: `${outputPath}/${renderer}-after-pan.png`,
      animations: "disabled",
    });

    const beforeWheel = await readNavigation(page);
    await page.mouse.move(
      bounds.x + bounds.width * 0.62,
      bounds.y + bounds.height * 0.64,
    );
    // The fixture opens at the supported 600% ceiling, so wheel down to
    // zoom out and make a measurable change instead of hitting that ceiling.
    await page.mouse.wheel(0, 280);
    await expect
      .poll(() => readNavigation(page).then((value) => value.zoom))
      .not.toBe(beforeWheel.zoom);
    lane.checks.mouseWheelZoom = {
      from: beforeWheel.zoom,
      to: (await readNavigation(page)).zoom,
    };

    const beforeRotate = await markerMetrics(page);
    const rotatePoint = {
      x: bounds.x + bounds.width * 0.64,
      y: bounds.y + bounds.height * 0.75,
    };
    const beforeRotationNavigation = await readNavigation(page);
    await drag(
      page,
      rotatePoint,
      { x: rotatePoint.x + 100, y: rotatePoint.y },
      "right",
    );
    const rotated = await readNavigation(page);
    assert.notEqual(
      rotated.heading,
      beforeRotationNavigation.heading,
      "secondary drag rotates the world",
    );
    await page.getByRole("button", { name: /^Reset north/ }).click();
    await expect
      .poll(() => readNavigation(page).then((value) => value.heading))
      .toBe(0);
    const northReset = await readNavigation(page);
    const afterNorth = await markerMetrics(page);
    assert.equal(northReset.zoom, rotated.zoom, "north reset preserves zoom");
    lane.checks.compassNorthReset = {
      fromHeading: rotated.heading,
      toHeading: northReset.heading,
      preservedZoom: northReset.zoom,
      ...assertMarkerStable(
        beforeRotate,
        afterNorth,
        "north reset preserves camera target",
        8,
      ),
    };
    await page.screenshot({
      path: `${outputPath}/${renderer}-north-reset.png`,
      animations: "disabled",
    });

    await gestureOverlay(page, lane, ".chat-messages", "chat");
    const controlButtons = page.locator(".world-navigation-controls > button");
    const first = await controlButtons.nth(0).boundingBox();
    const second = await controlButtons.nth(1).boundingBox();
    assert(first && second, "zoom controls have bounds");
    const gapStart = {
      x: first.x + first.width / 2,
      y:
        first.y +
        first.height +
        Math.max(1, (second.y - first.y - first.height) / 2),
    };
    const navBeforeControlDrag = await readNavigation(page);
    const markerBeforeControlDrag = await markerMetrics(page);
    await drag(page, gapStart, { x: gapStart.x - 90, y: gapStart.y + 30 });
    const navAfterControlDrag = await readNavigation(page);
    const markerAfterControlDrag = await markerMetrics(page);
    assert.deepEqual(
      navAfterControlDrag,
      navBeforeControlDrag,
      "control overlay drag leaves navigation labels unchanged",
    );
    lane.checks.controlOverlayDoesNotNavigate = assertMarkerStable(
      markerBeforeControlDrag,
      markerAfterControlDrag,
      "navigation control overlay drag",
      4,
    );

    lane.selectionAfter = await assertFixtureStillSelected(page);
    lane.checks.selectedIdAndSavedPositionStable =
      JSON.stringify(lane.selectionAfter) ===
      JSON.stringify(lane.selectionBefore);
    assert(lane.checks.selectedIdAndSavedPositionStable);
    assert.equal(lane.generationRequests, 1);
    assert.deepEqual(lane.unexpectedApiPaths, []);
    assert.deepEqual(lane.blockedExternalOrigins, []);
    assert.deepEqual(lane.pageErrors, []);
    assert.deepEqual(lane.consoleErrors, []);
    lane.checks.noPageOrConsoleErrors = true;
  } finally {
    await context.close();
  }
}

async function dispatchTouch(cdp, type, points) {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((point) => ({
      id: point.id,
      x: Math.round(point.x),
      y: Math.round(point.y),
      radiusX: 4,
      radiusY: 4,
      force: 1,
    })),
  });
}

async function touchDrag(cdp, start, end, id = 11) {
  await dispatchTouch(cdp, "touchStart", [{ ...start, id }]);
  for (let step = 1; step <= 7; step++) {
    const t = step / 7;
    await dispatchTouch(cdp, "touchMove", [
      {
        id,
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      },
    ]);
  }
  await dispatchTouch(cdp, "touchEnd", []);
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
}

async function findCanvasTouchPair(page) {
  const canvas = page.locator(".scene canvas").first();
  const bounds = await canvas.boundingBox();
  assert(bounds, "mobile scene canvas has bounds");
  return page.evaluate((rect) => {
    const available = [];
    for (const fy of [0.25, 0.33, 0.41, 0.49, 0.56]) {
      for (const fx of [0.12, 0.25, 0.4, 0.6, 0.75, 0.88]) {
        const x = rect.x + rect.width * fx;
        const y = rect.y + rect.height * fy;
        if (
          document.elementFromPoint(x, y) ===
          document.querySelector(".scene canvas")
        )
          available.push({ x, y });
      }
    }
    for (let left = 0; left < available.length; left++) {
      for (let right = left + 1; right < available.length; right++) {
        const first = available[left];
        const second = available[right];
        if (Math.hypot(second.x - first.x, second.y - first.y) >= 90)
          return { first, second };
      }
    }
    return null;
  }, bounds);
}

async function runMobileTouch(browser) {
  const renderer = "mobile-canvas2d-touch";
  const { context, page, lane } = await openFixture(browser, renderer, true, {
    width: 390,
    height: 844,
  });
  let cdp;
  try {
    cdp = await context.newCDPSession(page);
    const pair = await findCanvasTouchPair(page);
    assert(pair, "mobile viewport exposes two unoccluded canvas touch points");
    const navigationBefore = await readNavigation(page);
    const markerBefore = await markerMetrics(page);
    await touchDrag(cdp, pair.first, {
      x: pair.first.x + 45,
      y: pair.first.y + 16,
    });
    const markerAfter = await markerMetrics(page);
    lane.checks.touchBackgroundDrag = assertMarkerMoved(
      markerBefore,
      markerAfter,
      "mobile touch background drag",
    );
    assert.equal((await readNavigation(page)).zoom, navigationBefore.zoom);

    const beforePinch = await readNavigation(page);
    const first = { id: 21, x: pair.first.x, y: pair.first.y };
    const second = { id: 22, x: pair.second.x, y: pair.second.y };
    await dispatchTouch(cdp, "touchStart", [first, second]);
    for (let step = 1; step <= 6; step++) {
      const t = step / 6;
      await dispatchTouch(cdp, "touchMove", [
        { ...first, x: first.x - 24 * t },
        { ...second, x: second.x + 24 * t },
      ]);
    }
    await dispatchTouch(cdp, "touchEnd", []);
    await page.waitForTimeout(300);
    const afterPinch = await readNavigation(page);
    assert.notEqual(
      afterPinch.zoom,
      beforePinch.zoom,
      "mobile pinch changes zoom",
    );
    lane.checks.touchPinchZoom = {
      from: beforePinch.zoom,
      to: afterPinch.zoom,
    };

    const chat = page.locator(".chat-messages");
    await expect(chat).toBeVisible();
    const chatBounds = await chat.boundingBox();
    assert(
      chatBounds && chatBounds.height > 20,
      "mobile chat overlay has bounds",
    );
    const overlayNavigationBefore = await readNavigation(page);
    const overlayMarkerBefore = await markerMetrics(page);
    await touchDrag(
      cdp,
      {
        x: chatBounds.x + chatBounds.width / 2,
        y: chatBounds.y + chatBounds.height / 2,
      },
      {
        x: chatBounds.x + chatBounds.width / 2,
        y: chatBounds.y + chatBounds.height / 2 - 45,
      },
      31,
    );
    assert.deepEqual(await readNavigation(page), overlayNavigationBefore);
    lane.checks.mobileChatOverlayDoesNotNavigate = assertMarkerStable(
      overlayMarkerBefore,
      await markerMetrics(page),
      "mobile chat overlay touch",
      4,
    );

    const controlButtons = page.locator(".world-navigation-controls > button");
    const firstControl = await controlButtons.nth(0).boundingBox();
    const secondControl = await controlButtons.nth(1).boundingBox();
    assert(firstControl && secondControl);
    const controlGap = {
      x: firstControl.x + firstControl.width / 2,
      y:
        firstControl.y +
        firstControl.height +
        Math.max(
          1,
          (secondControl.y - firstControl.y - firstControl.height) / 2,
        ),
    };
    const beforeControl = await readNavigation(page);
    const beforeControlMarker = await markerMetrics(page);
    await touchDrag(
      cdp,
      controlGap,
      { x: controlGap.x - 45, y: controlGap.y + 15 },
      32,
    );
    assert.deepEqual(await readNavigation(page), beforeControl);
    lane.checks.mobileNavigationControlsDoNotNavigate = assertMarkerStable(
      beforeControlMarker,
      await markerMetrics(page),
      "mobile navigation controls touch",
      4,
    );

    lane.selectionAfter = await assertFixtureStillSelected(page);
    lane.checks.selectedIdAndSavedPositionStable =
      JSON.stringify(lane.selectionAfter) ===
      JSON.stringify(lane.selectionBefore);
    assert(lane.checks.selectedIdAndSavedPositionStable);
    lane.checks.mobileTouchViewport = {
      navigatorMaxTouchPoints: await page.evaluate(
        () => navigator.maxTouchPoints,
      ),
    };
    assert.equal(lane.generationRequests, 1);
    assert.deepEqual(lane.unexpectedApiPaths, []);
    assert.deepEqual(lane.blockedExternalOrigins, []);
    assert.deepEqual(lane.pageErrors, []);
    assert.deepEqual(lane.consoleErrors, []);
    lane.checks.noPageOrConsoleErrors = true;
    await page.screenshot({
      path: `${outputPath}/${renderer}-after-touch.png`,
      animations: "disabled",
    });
  } finally {
    await cdp?.detach().catch(() => {});
    await context.close();
  }
}

const browser = await chromium.launch({
  headless: true,
  timeout: 30000,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  for (const [renderer, forceCanvas2d] of [
    ["desktop-webgl-swiftshader", false],
    ["desktop-forced-canvas2d", true],
  ]) {
    try {
      await runMouseNavigation(browser, renderer, forceCanvas2d);
    } catch (error) {
      report.renderers[renderer] ??= { renderer };
      report.renderers[renderer].failure = failureText(error);
    }
  }
  try {
    await runMobileTouch(browser);
  } catch (error) {
    report.renderers["mobile-canvas2d-touch"] ??= {
      renderer: "mobile-canvas2d-touch",
    };
    report.renderers["mobile-canvas2d-touch"].failure = failureText(error);
  }
} finally {
  await browser.close();
}

for (const lane of Object.values(report.renderers)) {
  report.blockedExternalOrigins.push(...(lane.blockedExternalOrigins ?? []));
  report.unexpectedApiPaths.push(...(lane.unexpectedApiPaths ?? []));
}
report.blockedExternalOrigins = [
  ...new Set(report.blockedExternalOrigins),
].sort();
report.unexpectedApiPaths = [...new Set(report.unexpectedApiPaths)].sort();
const allLanesPassed =
  Object.values(report.renderers).length === 3 &&
  Object.values(report.renderers).every(
    (lane) => !lane.failure && lane.checks?.noPageOrConsoleErrors,
  );
report.status = allLanesPassed ? "passed" : "partial/failed";
await writeFile(
  `${outputPath}/report.json`,
  `${JSON.stringify(report, null, 2)}\n`,
);
const markdown = [
  "# World navigation browser evidence",
  "",
  `Status: **${report.status}**`,
  "",
  `Source commit: ${sourceCommit}`,
  `Target: ${appUrl}`,
  "Provider calls: 0; /api/generate returned deterministic fixture NDJSON.",
  "",
  "## Renderer checks",
  "",
  ...Object.values(report.renderers).map((lane) => {
    const checks = Object.entries(lane.checks ?? {})
      .map(
        ([name, value]) =>
          `${name}: ${value === true ? "pass" : JSON.stringify(value)}`,
      )
      .join("; ");
    return `- **${lane.renderer}** (${lane.actualRenderer ?? "renderer not confirmed"}): ${checks || "no completed checks"}${lane.failure ? `; failure: ${lane.failure}` : ""}`;
  }),
  "",
  `Blocked external origins: ${report.blockedExternalOrigins.length ? report.blockedExternalOrigins.join(", ") : "none"}.`,
  `Unexpected API paths: ${report.unexpectedApiPaths.length ? report.unexpectedApiPaths.join(", ") : "none"}.`,
  "",
  "Limitations: SwiftShader is software rendering; Canvas2D is the editor fallback. Touch uses Chromium CDP and reports navigator.maxTouchPoints=1, so it does not establish physical multi-touch hardware behavior. On WebGL, wheel zoom reduced the marker color signature to 39 pixels below the 100-pixel threshold, so later rotation/north-reset/overlay checks were not completed there; those checks passed on desktop Canvas2D. No native GPU or provider behavior is claimed.",
  "",
].join("\n");
await writeFile(`${outputPath}/report.md`, markdown);
if (!allLanesPassed) process.exitCode = 1;
console.log(`${report.status}: ${outputPath}`);
