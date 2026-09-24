#!/usr/bin/env node
// Deterministic browser acceptance for a far-away group through editor save,
// ZIP export, and independent standalone playback. No model/provider calls.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { createServer } from "node:http";
import { unzipSync, strFromU8 } from "fflate";
import sharp from "sharp";
import { chromium, expect } from "@playwright/test";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";

const appUrl = process.env.TEST_URL ?? "http://localhost:3001";
const output = process.argv[2];
if (!output)
  throw Error(
    "Provide a new evidence directory under docs/evidence/far-world-browser/.",
  );
const evidenceRoot = resolve("docs/evidence/far-world-browser");
const outputPath = resolve(output);
const outputRelative = relative(evidenceRoot, outputPath);
if (outputRelative.startsWith("..") || outputRelative === "")
  throw Error(
    "Evidence output must be a new child of docs/evidence/far-world-browser/.",
  );
await mkdir(evidenceRoot, { recursive: true });
await mkdir(outputPath, { recursive: false });

const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const appOrigin = new URL(appUrl).origin;
const ids = {
  group: "far-world-group-12km",
  entity: "far-world-marker-12km",
};
const groupPosition = [12000, 0, 0];
const entityLocalPosition = [0, 1, 0];
const initialGeometry = { kind: "crystal", detail: "refined" };
const editedGeometry = { kind: "platform", detail: "refined" };

const report = {
  status: "failed",
  scope:
    "A deterministic local browser journey creates a grouped entity at 12 km, verifies initial automatic framing and the manual Frame control, edits its geometry, reloads saved state, exports a ZIP, and verifies distant content is visible in the isolated standalone player.",
  sourceCommit,
  appUrl,
  stableIds: ids,
  worldPositionMeters: groupPosition,
  providerCalls: 0,
  externalRequests: [],
  unexpectedLocalApiRequests: [],
  pageErrors: [],
  consoleErrors: [],
  assumptions: [
    "The browser harness supplies deterministic NDJSON responses to the editor's /api/generate endpoint; no provider inference is performed.",
    "The software path forces HTML canvas WebGL context creation to return null so the product selects its Canvas2D fallback.",
  ],
  limitations: [
    "WebGL runs under Chromium SwiftShader; this is not native GPU evidence.",
    "The standalone runtime loads near the 12 km content and responds to its restart control. This does not demonstrate sustained gameplay traversal over a long distance.",
    "No physical mobile, growing-world performance, memory, or live provider acceptance is claimed.",
  ],
  renderers: {},
};

function ndjson(commands) {
  return commands.map((command) => JSON.stringify(command)).join("\n") + "\n";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function initialCommands() {
  return [
    {
      type: "create_group",
      group: {
        id: ids.group,
        label: "Twelve kilometer group",
        position: groupPosition,
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    },
    {
      type: "reserve_entity",
      entity: {
        id: ids.entity,
        label: "Far world marker",
        position: entityLocalPosition,
        scale: [1, 1, 1],
        parentId: ids.group,
        color: "#a1f0d7",
        behavior: { type: "static" },
        stage: "seed",
      },
    },
    { type: "set_geometry", id: ids.entity, geometry: initialGeometry },
    {
      type: "commit_revision",
      message: "Placed a marker in the far world.",
    },
  ];
}

function editedCommands() {
  return [
    { type: "set_geometry", id: ids.entity, geometry: editedGeometry },
    {
      type: "commit_revision",
      message: "Changed the far marker while keeping its placement.",
    },
  ];
}

function assertFarPlacement(project, expectedGeometry) {
  const group = project.groups?.find((entry) => entry.id === ids.group);
  const entity = project.entities.find((entry) => entry.id === ids.entity);
  assert(group, "12 km group is present");
  assert(entity, "far-world entity is present");
  assert.deepEqual(group.position, groupPosition);
  assert.equal(entity.parentId, ids.group);
  assert.deepEqual(entity.position, entityLocalPosition);
  assert.deepEqual(entity.geometry, expectedGeometry);
  assert.equal(entity.stage, "ready");
}

async function waitForProject(page, predicate, timeout = 45000) {
  let current;
  await expect
    .poll(
      async () => {
        current = (await storageSnapshot(page)).project;
        return Boolean(current && predicate(current));
      },
      { timeout },
    )
    .toBe(true);
  return current;
}

async function inspectCanvasCenter(image, bounds, minimumMarkerPixels = 500) {
  assert(bounds, "Rendered canvas has a browser bounding box");
  const crop = {
    left: Math.max(0, Math.floor(bounds.x + bounds.width * 0.35)),
    top: Math.max(0, Math.floor(bounds.y + bounds.height * 0.2)),
    width: Math.floor(bounds.width * 0.3),
    height: Math.floor(bounds.height * 0.6),
  };
  assert(crop.width > 0 && crop.height > 0);
  const pixels = await sharp(image)
    .extract(crop)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let markerPixels = 0;
  let minX = crop.width;
  let minY = crop.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < crop.height; y++) {
    for (let x = 0; x < crop.width; x++) {
      const offset = (y * crop.width + x) * 3;
      const red = pixels.data[offset];
      const green = pixels.data[offset + 1];
      const blue = pixels.data[offset + 2];
      // The fixture marker is #a1f0d7. This tolerant teal signature covers
      // its lit WebGL facets and the Canvas2D fill without matching the green
      // terrain/background in the centered viewport region.
      if (green > 150 && blue > 150 && blue - red > 30 && green - red > 30) {
        markerPixels += 1;
        minX = Math.min(minX, x + crop.left);
        minY = Math.min(minY, y + crop.top);
        maxX = Math.max(maxX, x + crop.left);
        maxY = Math.max(maxY, y + crop.top);
      }
    }
  }
  assert(
    markerPixels >= minimumMarkerPixels,
    `Expected the teal far marker to be visible in the centered canvas; observed ${markerPixels} matching pixels.`,
  );
  return {
    region: "center 30% x 60% of the rendered canvas",
    pixelSignature: "G>150, B>150, B-R>30, G-R>30 for fixture tint #a1f0d7",
    markerPixels,
    minimumMarkerPixels,
    markerBounds: { minX, minY, maxX, maxY },
  };
}

function assertCanvasChanged(before, after, bounds) {
  assert(bounds, "Rendered canvas has a browser bounding box");
  const crop = {
    left: Math.max(0, Math.floor(bounds.x + bounds.width * 0.35)),
    top: Math.max(0, Math.floor(bounds.y + bounds.height * 0.2)),
    width: Math.floor(bounds.width * 0.3),
    height: Math.floor(bounds.height * 0.6),
  };
  return Promise.all([
    sharp(before)
      .extract(crop)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    sharp(after)
      .extract(crop)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]).then(([beforePixels, afterPixels]) => {
    assert.deepEqual(afterPixels.info, beforePixels.info);
    let changedPixels = 0;
    for (let offset = 0; offset < beforePixels.data.length; offset += 3) {
      const delta =
        Math.abs(beforePixels.data[offset] - afterPixels.data[offset]) +
        Math.abs(beforePixels.data[offset + 1] - afterPixels.data[offset + 1]) +
        Math.abs(beforePixels.data[offset + 2] - afterPixels.data[offset + 2]);
      if (delta > 60) changedPixels += 1;
    }
    assert(
      changedPixels >= 5000,
      `Expected Frame to change the centered canvas; observed ${changedPixels} changed pixels.`,
    );
    return {
      pixelDeltaThreshold: 60,
      changedPixels,
      minimumChangedPixels: 5000,
    };
  });
}

async function inspectStandaloneFarPlatform(image, bounds) {
  assert(bounds, "Standalone canvas has a browser bounding box");
  const crop = {
    left: Math.floor(bounds.x + bounds.width * 0.4),
    top: Math.floor(bounds.y + bounds.height * 0.2),
    width: Math.floor(bounds.width * 0.2),
    height: Math.floor(bounds.height * 0.25),
  };
  const { data } = await sharp(image)
    .extract(crop)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let platformPixels = 0;
  for (let offset = 0; offset < data.length; offset += 3) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    if (
      (red > 230 && green > 230 && blue > 220) ||
      (green > 210 && blue > 210 && blue > red + 5)
    )
      platformPixels += 1;
  }
  assert(
    platformPixels >= 100,
    `Expected the pale platform ahead of the player; observed ${platformPixels} matching pixels.`,
  );
  return { region: crop, platformPixels, minimumPlatformPixels: 100 };
}

function contentTypeFor(path) {
  const extension = path.split(".").pop();
  return (
    {
      css: "text/css",
      glb: "model/gltf-binary",
      html: "text/html",
      js: "text/javascript",
      json: "application/json",
      mjs: "text/javascript",
      wasm: "application/wasm",
    }[extension] ?? "application/octet-stream"
  );
}

async function runEditorJourney(browser, rendererName, forceSoftware) {
  const lane = {
    renderer: rendererName,
    forceSoftware,
    generationRequests: 0,
    generationSelections: [],
    apiPaths: [],
    unexpectedLocalApiRequests: [],
    blockedExternalRequests: [],
    pageErrors: [],
    consoleErrors: [],
    checks: {},
  };
  report.renderers[rendererName] = lane;
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  if (forceSoftware)
    await context.addInitScript(() => {
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
  await context.route("**/*", async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    if (target.origin !== appOrigin && /^https?:$/.test(target.protocol)) {
      lane.blockedExternalRequests.push(target.href);
      await route.abort();
      return;
    }
    if (target.origin !== appOrigin) {
      await route.continue();
      return;
    }
    if (target.pathname === "/api/trial") {
      lane.apiPaths.push(target.pathname);
      await route.fulfill({
        json: { enabled: true, remaining: 3, limit: 3 },
      });
      return;
    }
    if (target.pathname === "/api/config") {
      lane.apiPaths.push(target.pathname);
      await route.fulfill({ json: { accounts: false, publishing: false } });
      return;
    }
    if (target.pathname === "/api/models") {
      lane.apiPaths.push(target.pathname);
      await route.fulfill({ json: [] });
      return;
    }
    if (target.pathname === "/api/generate") {
      lane.apiPaths.push(target.pathname);
      lane.generationRequests += 1;
      const body = request.postDataJSON();
      lane.generationSelections.push(body.selected ?? null);
      assert.equal(body.provider, "free");
      assert.equal(body.localModeling, false);
      assert.equal(body.browserModeling, true);
      assert.equal(body.key, "");
      if (lane.generationRequests === 1) {
        assert.equal(body.selected, undefined);
        assert.equal(body.project.entities.length, 0);
        assert.deepEqual(body.project.groups ?? [], []);
        await route.fulfill({
          contentType: "application/x-ndjson",
          body: ndjson(initialCommands()),
        });
        return;
      }
      if (lane.generationRequests === 2) {
        assert.equal(body.selected, ids.entity);
        assertFarPlacement(body.project, initialGeometry);
        await route.fulfill({
          contentType: "application/x-ndjson",
          body: ndjson(editedCommands()),
        });
        return;
      }
      throw Error(`Unexpected generation request ${lane.generationRequests}`);
    }
    if (target.pathname.startsWith("/api/")) {
      lane.apiPaths.push(target.pathname);
      lane.unexpectedLocalApiRequests.push(target.pathname);
      await route.abort();
      return;
    }
    await route.continue();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => {
    const message = error.message;
    if (forceSoftware && /Error creating WebGL context/i.test(message)) return;
    lane.pageErrors.push(message);
    report.pageErrors.push(`${rendererName}: ${message}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const value = message.text();
    if (forceSoftware && /Error creating WebGL context/i.test(value)) return;
    lane.consoleErrors.push(value.slice(0, 500));
    report.consoleErrors.push(`${rendererName}: ${value.slice(0, 500)}`);
  });

  try {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await expect(page.locator("canvas")).toBeVisible();
    await page
      .getByPlaceholder("What experience to build?")
      .fill("Create a marker group in the far world at twelve kilometers");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const created = await waitForProject(
      page,
      (project) =>
        project.groups?.some((group) => group.id === ids.group) &&
        project.entities.some(
          (entity) =>
            entity.id === ids.entity &&
            entity.geometry?.kind === initialGeometry.kind,
        ),
    );
    assertFarPlacement(created, initialGeometry);
    await expect(
      page.locator('main[data-renderer-availability="ready"]'),
    ).toBeVisible({ timeout: 30000 });
    if (forceSoftware) {
      await expect(page.locator(".software-world")).toBeVisible({
        timeout: 30000,
      });
      lane.actualRenderer = "software canvas fallback";
    } else {
      await expect(page.locator(".software-world")).toHaveCount(0);
      lane.actualRenderer = "WebGL / Chromium SwiftShader";
    }
    lane.checks = { ...lane.checks, deterministicFarWorldCreated: true };
    const canvas = page.locator(".scene canvas").first();
    await expect(canvas).toBeVisible();
    const canvasBounds = await canvas.boundingBox();
    const frame = page.getByRole("button", { name: "Frame content" });
    await expect(frame).toBeEnabled({ timeout: 30000 });
    await expect
      .poll(async () =>
        page.getByRole("button", { name: /^Zoom in, currently/ }).getAttribute("aria-label"),
      )
      .toMatch(/^Zoom in, currently (?!100%)/);
    const autoFramedImage = await page.screenshot({
      path: `${outputPath}/${rendererName}-created.png`,
      animations: "disabled",
    });
    const autoFramedMarker = await inspectCanvasCenter(
      autoFramedImage,
      canvasBounds,
    );
    lane.checks.newWorldAutoFramedFarContent = true;

    // A deliberate zoom away from the generated object gives the manual
    // Frame control a distinct job after initial automatic framing.
    for (let index = 0; index < 7; index += 1)
      await page.getByRole("button", { name: /^Zoom out, currently/ }).click();
    await page.waitForTimeout(300);
    const beforeFrame = await page.screenshot({ animations: "disabled" });

    await frame.click();
    await page.waitForTimeout(500);
    const afterFrameImage = await page.screenshot({ animations: "disabled" });
    const beforeMarker = await inspectCanvasCenter(
      beforeFrame,
      canvasBounds,
      0,
    );
    const afterMarker = await inspectCanvasCenter(
      afterFrameImage,
      canvasBounds,
    );
    assert(
      afterMarker.markerPixels >= beforeMarker.markerPixels + 500,
      `Expected the far marker's teal pixels to appear after Frame; before ${beforeMarker.markerPixels}, after ${afterMarker.markerPixels}.`,
    );
    lane.navigationVisibility = {
      canvasBounds,
      autoFramedMarkerPixels: autoFramedMarker.markerPixels,
      ...(await assertCanvasChanged(
        beforeFrame,
        afterFrameImage,
        canvasBounds,
      )),
      beforeMarkerPixels: beforeMarker.markerPixels,
      ...afterMarker,
    };
    const afterFrame = (await storageSnapshot(page)).project;
    assertFarPlacement(afterFrame, initialGeometry);
    lane.checks.navigationFramedFarContent = true;
    await page.screenshot({
      path: `${outputPath}/${rendererName}-framed-12km.png`,
      animations: "disabled",
    });

    await page
      .getByRole("button", { name: "Show objects", exact: true })
      .click();
    await page.getByRole("button", { name: /^Far world marker/ }).click();
    await page
      .locator("#prompt")
      .fill("Change the selected far world marker into a low platform");
    await page
      .getByRole("button", { name: "Change this", exact: true })
      .click();
    const edited = await waitForProject(
      page,
      (project) =>
        project.entities.find((entity) => entity.id === ids.entity)?.geometry
          ?.kind === editedGeometry.kind,
    );
    assertFarPlacement(edited, editedGeometry);
    assert.equal(lane.generationRequests, 2);
    assert.deepEqual(lane.generationSelections, [null, ids.entity]);
    lane.checks.editedAtFarWorldWithStableIdAndCoordinates = true;
    await page.screenshot({
      path: `${outputPath}/${rendererName}-edited-12km.png`,
      animations: "disabled",
    });

    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForTimeout(300);
    const playImage = await page.screenshot({
      path: `${outputPath}/${rendererName}-play-12km.png`,
      animations: "disabled",
    });
    lane.editorPlayVisibility = await inspectStandaloneFarPlatform(
      playImage,
      await page.locator(".scene canvas").first().boundingBox(),
    );
    lane.checks.editorPlayDistantContentVisible = true;
    await page.getByRole("button", { name: "Edit", exact: true }).click();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Continue your saved world" }),
    ).toBeVisible({ timeout: 30000 });
    await page
      .getByRole("button", { name: "Continue your saved world" })
      .click();
    const reopened = await waitForProject(
      page,
      (project) =>
        project.entities.find((entity) => entity.id === ids.entity)?.geometry
          ?.kind === editedGeometry.kind,
    );
    assertFarPlacement(reopened, editedGeometry);
    lane.checks.localReloadRetainsStableIdAndCoordinates = true;
    await expect(
      page.locator('main[data-renderer-availability="ready"]'),
    ).toBeVisible({ timeout: 30000 });
    await page.getByRole("button", { name: "Frame content" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `${outputPath}/${rendererName}-reloaded-framed-12km.png`,
      animations: "disabled",
    });

    await page.getByRole("button", { name: "Share Orb", exact: true }).click();
    const downloadStarted = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Download your world/ }).click();
    const download = await downloadStarted;
    const zipPath = `${outputPath}/${rendererName}-world.zip`;
    await download.saveAs(zipPath);
    const files = unzipSync(new Uint8Array(await readFile(zipPath)));
    const exported = JSON.parse(strFromU8(files["project.json"]));
    assertFarPlacement(exported, editedGeometry);
    assert(files["runtime.js"] && files["runtime.css"] && files["index.html"]);
    lane.checks.zipProjectRetainsStableIdAndCoordinates = true;
    lane.zip = {
      bytes: (await readFile(zipPath)).byteLength,
      projectId: exported.id,
      revision: exported.revision,
      projectSHA256: await page.evaluate(async (serialized) => {
        const bytes = new TextEncoder().encode(serialized);
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(hash)]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("");
      }, strFromU8(files["project.json"])),
    };

    const standaloneServer = createServer((request, response) => {
      const path =
        new URL(request.url ?? "/", "http://standalone.local").pathname.slice(
          1,
        ) || "index.html";
      if (path.startsWith("../") || path === "..") {
        response.writeHead(400).end();
        return;
      }
      const bytes = files[path];
      if (!bytes) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": contentTypeFor(path),
        "Cache-Control": "no-store",
      });
      if (request.method === "HEAD") response.end();
      else response.end(bytes);
    });
    await new Promise((resolveListen, rejectListen) => {
      standaloneServer.once("error", rejectListen);
      standaloneServer.listen(0, "127.0.0.1", resolveListen);
    });
    standaloneServer.unref();
    const standaloneOrigin = `http://127.0.0.1:${standaloneServer.address().port}`;
    const playerContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
    });
    if (forceSoftware)
      await playerContext.addInitScript(() => {
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
    const served = new Set();
    const standaloneExternal = [];
    const standaloneApiRequests = [];
    await playerContext.route("**/*", async (route) => {
      const target = new URL(route.request().url());
      if (target.origin !== standaloneOrigin) {
        standaloneExternal.push(target.href);
        await route.abort();
        return;
      }
      if (target.pathname.startsWith("/api/"))
        standaloneApiRequests.push(target.pathname);
      served.add(target.pathname.slice(1) || "index.html");
      await route.continue();
    });
    const player = await playerContext.newPage();
    const standaloneErrors = [];
    player.on("pageerror", (error) => {
      if (forceSoftware && /Error creating WebGL context/i.test(error.message))
        return;
      standaloneErrors.push(error.message);
    });
    await player.goto(standaloneOrigin, { waitUntil: "domcontentloaded" });
    await expect(player.locator('main[data-ready="true"]')).toBeVisible({
      timeout: 30000,
    });
    await expect.poll(() => served.has("project.json")).toBe(true);
    await expect(player.getByRole("button", { name: "Restart" })).toBeVisible();
    await expect(player.locator(".score")).toBeVisible();
    await player.getByRole("button", { name: "Restart" }).click();
    await expect(player.locator('main[data-ready="true"]')).toBeVisible();
    await player.waitForTimeout(300);
    const standaloneImage = await player.screenshot({
      path: `${outputPath}/${rendererName}-standalone.png`,
      animations: "disabled",
    });
    const standaloneCanvas = player.locator("canvas").first();
    await expect(standaloneCanvas).toBeVisible();
    const standaloneVisibility = await inspectStandaloneFarPlatform(
      standaloneImage,
      await standaloneCanvas.boundingBox(),
    );
    assert.deepEqual(standaloneErrors, []);
    assert.deepEqual(standaloneExternal, []);
    assert.deepEqual(standaloneApiRequests, []);
    assert(served.has("runtime.js") && served.has("project.json"));
    lane.checks.independentStandaloneReadyAndInteractive = true;
    lane.checks.standaloneDistantContentVisible = true;
    lane.checks.standaloneHasNoEditorApiOrExternalRequests = true;
    lane.standalone = {
      renderer: forceSoftware
        ? "software canvas fallback"
        : "WebGL / Chromium SwiftShader",
      visibility: standaloneVisibility,
      projectServed: served.has("project.json"),
      runtimeServed: served.has("runtime.js"),
      editorApiRequests: standaloneApiRequests,
      externalRequests: standaloneExternal,
    };
    await playerContext.close();
    await new Promise((resolveClose, rejectClose) =>
      standaloneServer.close((error) =>
        error ? rejectClose(error) : resolveClose(),
      ),
    );

    assert.deepEqual(lane.unexpectedLocalApiRequests, []);
    assert.deepEqual(lane.blockedExternalRequests, []);
    assert.deepEqual(lane.pageErrors, []);
    assert.deepEqual(lane.consoleErrors, []);
    lane.localApiPaths = lane.apiPaths;
    lane.checks.noProviderOrExternalRequests = true;
    return lane;
  } finally {
    await context.close();
  }
}

let browser;
let failure;
try {
  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  await runEditorJourney(browser, "webgl-swiftshader", false);
  await runEditorJourney(browser, "software-fallback", true);
  report.providerCalls = 0;
  report.status = "passed";
} catch (error) {
  failure = error;
  report.error =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await browser?.close();
  report.externalRequests = Object.values(report.renderers).flatMap((lane) => [
    ...lane.blockedExternalRequests,
    ...(lane.standalone?.externalRequests ?? []),
  ]);
  await writeFile(
    `${outputPath}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  const markdown =
    `# Far-world browser acceptance\n\n` +
    `Status: **${report.status}**\n\n` +
    `${report.scope}\n\n` +
    `Source commit: \`${sourceCommit}\`. Provider calls: ${report.providerCalls}. External requests: ${report.externalRequests.length}.\n\n` +
    `The browser creates and edits a grouped object at [12,000, 0, 0] meters, verifies the new world is auto-framed, zooms away and uses the manual Frame control, then checks Play, reload, ZIP export and a fresh standalone player. Both Chromium SwiftShader WebGL and forced Canvas2D fallback lanes are included.\n\n` +
    `The harness requires at least 500 centered teal marker pixels immediately after generation. After manual Frame, it requires another 500-pixel increase over the zoomed-out view and at least 5,000 changed central pixels.\n\n` +
    `Limitations: ${report.limitations.join(" ")}\n\n` +
    `See [report.json](./report.json) for assertions and request audits. Screenshots show the created, framed, edited, editor Play, reloaded, and standalone states for each lane.\n`;
  await writeFile(`${outputPath}/README.md`, markdown);
  if (failure) throw failure;
  console.log(
    JSON.stringify(
      {
        status: report.status,
        sourceCommit,
        evidence: outputPath,
        renderers: Object.fromEntries(
          Object.entries(report.renderers).map(([name, lane]) => [
            name,
            {
              renderer: lane.actualRenderer,
              checks: lane.checks,
              generationRequests: lane.generationRequests,
            },
          ]),
        ),
        providerCalls: report.providerCalls,
        externalRequests: report.externalRequests.length,
      },
      null,
      2,
    ),
  );
}
