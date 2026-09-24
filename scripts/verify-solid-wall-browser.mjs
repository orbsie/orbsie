#!/usr/bin/env node
/**
 * Deterministic browser acceptance for ready, bounded solid walls.
 *
 * The real editor, renderers, gameplay loop, input paths, ZIP export and
 * standalone player run locally. Only /api/config, /api/trial and
 * /api/generate are fulfilled; generation returns this fixed command stream.
 * No provider or model call is made.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { createTraversalTouchInput } from "./lib/traversal-touch-input.mjs";

const appUrl = process.env.TEST_URL ?? "http://127.0.0.1:3024";
const appOrigin = new URL(appUrl).origin;
const evidenceDir = resolve(
  process.env.ORBSIE_SOLID_WALL_EVIDENCE_DIRECTORY ??
    "docs/evidence/solid-wall-browser",
);
const requestedRenderer = process.env.ORBSIE_SOLID_WALL_RENDERER ?? "all";
assert(
  ["all", "webgl", "software"].includes(requestedRenderer),
  "ORBSIE_SOLID_WALL_RENDERER must be all, webgl, or software.",
);

const WALL = {
  id: "fixture-solid-wall",
  label: "Bounded test wall",
  // Input "s" travels along +[sin(0.5), 0, cos(0.5)] in the player.
  // This wide, axis-aligned box crosses that path and leaves room to slide.
  position: [2.5 * Math.sin(0.5), 1.5, 5 + 2.5 * Math.cos(0.5)],
  scale: [1, 1, 1],
  color: "#d19150",
  geometry: {
    kind: "custom",
    detail: "refined",
    parts: [
      {
        shape: "box",
        position: [0, 0, 0],
        scale: [8, 3, 0.5],
        color: "#d19150",
      },
    ],
  },
};
const BEHIND = {
  id: "fixture-behind-wall",
  label: "Collectible behind wall",
  position: [2, 0.5, 8.6],
  scale: [0.6, 0.6, 0.6],
  color: "#7ad9bd",
  geometry: { kind: "crystal", detail: "refined" },
};
const GAME = {
  spawn: [0, 0.5, 5],
  variables: [{ name: "wallHit", initial: 0 }],
  rules: [
    {
      id: "wallContact",
      trigger: { type: "collision", entityId: WALL.id },
      conditions: [
        {
          operand: { type: "variable", name: "wallHit" },
          comparison: "eq",
          value: 0,
        },
      ],
      actions: [
        { type: "set_variable", name: "wallHit", value: 1 },
        { type: "add_score", amount: 11 },
      ],
    },
    {
      id: "crossedWall",
      trigger: { type: "collect", entityId: BEHIND.id },
      conditions: [],
      actions: [{ type: "add_score", amount: 100 }],
    },
  ],
};

const report = {
  mode: "deterministic-solid-wall-browser-acceptance",
  generatedAt: new Date().toISOString(),
  testUrlOrigin: appOrigin,
  realProviderCalls: 0,
  requestedRenderer,
  passed: false,
  mockedApiRequests: [],
  unexpectedApiRequests: [],
  externalRequests: [],
  pageErrors: [],
  expectedRendererFallbackErrors: [],
  renderers: {},
  standalone: null,
};
await mkdir(evidenceDir, { recursive: true });

function reserve(entity, behavior) {
  return {
    type: "reserve_entity",
    entity: {
      id: entity.id,
      label: entity.label,
      position: entity.position,
      scale: entity.scale,
      color: entity.color,
      stage: "seed",
      behavior: { type: behavior },
    },
  };
}

function fixtureCommands(wallBehavior) {
  return [
    reserve(WALL, wallBehavior),
    { type: "set_geometry", id: WALL.id, geometry: WALL.geometry },
    reserve(BEHIND, "collect"),
    { type: "set_geometry", id: BEHIND.id, geometry: BEHIND.geometry },
    { type: "set_game", game: GAME },
    { type: "commit_revision", message: "Program ready." },
  ];
}

function cleanError(error) {
  return String(error)
    .replace(/https?:\/\/[^\s)]+/g, "[url]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .slice(0, 1200);
}

async function makeInput(page, mode) {
  if (mode === "touch") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
    });
    const touch = createTraversalTouchInput({
      cdp,
      touchPoint: async (key, id) => {
        const label = key === " " ? "Jump" : `Move ${key}`;
        const box = await page
          .getByRole("button", { name: label, exact: true })
          .boundingBox();
        if (!box) throw new Error(`Missing visible touch control ${label}.`);
        return { x: box.x + box.width / 2, y: box.y + box.height / 2, id };
      },
    });
    return {
      mode,
      setKeys: (keys) => touch.setKeys(keys),
      releaseAll: () => touch.releaseAll(),
      close: async () => {
        await touch.releaseAll().catch(() => {});
        await cdp.detach().catch(() => {});
      },
    };
  }

  const held = new Set();
  return {
    mode,
    setKeys: async (keys) => {
      const next = new Set(keys);
      for (const key of held) {
        if (!next.has(key)) {
          await page.keyboard.up(key);
          held.delete(key);
        }
      }
      for (const key of next) {
        if (!held.has(key)) {
          await page.keyboard.down(key);
          held.add(key);
        }
      }
    },
    releaseAll: async () => {
      for (const key of held) await page.keyboard.up(key);
      held.clear();
    },
    close: async () => {
      for (const key of held) await page.keyboard.up(key).catch(() => {});
      held.clear();
    },
  };
}

async function readObservation(page) {
  return page.evaluate(() => {
    const read = window.__ORBSIE_GAMEPLAY_READ__;
    return typeof read === "function" ? read() : null;
  });
}

async function waitForObservation(page, predicate, options) {
  const { afterAtMs = -Infinity, timeoutMs = 15000, label } = options;
  const startedAt = Date.now();
  let cursor = afterAtMs;
  let latest = null;
  while (Date.now() - startedAt < timeoutMs) {
    const observation = await readObservation(page);
    if (observation && observation.atMs > cursor) {
      latest = observation;
      cursor = observation.atMs;
      if (predicate(observation)) return observation;
    }
    await page.waitForTimeout(50);
  }
  throw new Error(
    `${label} did not match a fresh observation: ${JSON.stringify({ latest, afterAtMs, waitedMs: Date.now() - startedAt })}`,
  );
}

async function waitForStableWallContact(page, afterAtMs) {
  const startedAt = Date.now();
  let cursor = afterAtMs;
  let stableSince = null;
  let latest = null;
  while (Date.now() - startedAt < 12000) {
    const observation = await readObservation(page);
    if (observation && observation.atMs > cursor) {
      cursor = observation.atMs;
      latest = observation;
      if (
        observation.playing &&
        observation.contacts.includes(WALL.id) &&
        observation.gameScore === 11
      ) {
        stableSince ??= Date.now();
        if (Date.now() - stableSince >= 450) return observation;
      } else stableSince = null;
    }
    await page.waitForTimeout(50);
  }
  throw new Error(
    `Wall contact did not stay active under held input: ${JSON.stringify({ latest, waitedMs: Date.now() - startedAt })}`,
  );
}

async function installEditorRoutes(context, wallBehavior) {
  const commands = fixtureCommands(wallBehavior);
  let generationRequests = 0;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:" || url.protocol === "blob:") {
      await route.continue();
      return;
    }
    if (url.origin !== appOrigin) {
      report.externalRequests.push({
        stage: "editor",
        origin: url.origin,
        path: url.pathname,
      });
      await route.abort("blockedbyclient");
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }

    report.mockedApiRequests.push({
      path: url.pathname,
      method: route.request().method(),
    });
    if (url.pathname === "/api/config") {
      await route.fulfill({ json: { accounts: false } });
    } else if (url.pathname === "/api/trial") {
      await route.fulfill({ json: { enabled: true, remaining: 3 } });
    } else if (url.pathname === "/api/generate") {
      generationRequests += 1;
      await route.fulfill({
        contentType: "application/x-ndjson",
        body:
          commands.map((command) => JSON.stringify(command)).join("\n") + "\n",
      });
    } else {
      report.unexpectedApiRequests.push({
        path: url.pathname,
        method: route.request().method(),
      });
      await route.abort("blockedbyclient");
    }
  });
  return () => generationRequests;
}

async function exportWorld(page, zipPath) {
  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download your world/ }).click();
  await (await downloadPromise).saveAs(zipPath);
  const zipBytes = await readFile(zipPath);
  const files = unzipSync(zipBytes);
  const projectBytes = files["project.json"];
  assert(projectBytes, "The downloaded ZIP must include project.json.");
  const project = JSON.parse(strFromU8(projectBytes));
  const wall = project.entities?.find((entity) => entity.id === WALL.id);
  assert.equal(wall?.stage, "ready", "The exported wall must be ready.");
  assert.equal(wall?.behavior?.type, "solid");
  assert.equal(wall?.geometry?.kind, "custom");
  assert(
    wall.geometry.parts?.some((part) => part.shape === "box"),
    "The exported wall must retain its bounded box geometry.",
  );
  assert(
    project.game?.rules?.some(
      (rule) =>
        rule.trigger?.type === "collision" && rule.trigger.entityId === WALL.id,
    ),
    "The exported program must retain the wall collision rule.",
  );
  assert(files["src/lib/gameplay.ts"], "The ZIP must include gameplay source.");
  return {
    path: "world.zip",
    bytes: zipBytes.byteLength,
    sha256: createHash("sha256").update(zipBytes).digest("hex"),
    files: Object.keys(files).length,
    project,
  };
}

async function runEditorScenario(
  browser,
  renderer,
  wallBehavior,
  options = {},
) {
  const isTouch = options.inputMode === "touch";
  const context = await browser.newContext({
    viewport: isTouch
      ? { width: 390, height: 844 }
      : { width: 1280, height: 800 },
    reducedMotion: "reduce",
    hasTouch: isTouch,
    isMobile: isTouch,
  });
  await context.addInitScript(() => {
    window.__ORBSIE_GAMEPLAY_READ_REQUESTED__ = true;
  });
  if (renderer === "software") {
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
  }
  const generationCount = await installEditorRoutes(context, wallBehavior);
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    const message = cleanError(error);
    if (
      renderer === "software" &&
      message.includes("THREE.WebGLRenderer: Error creating WebGL context.")
    )
      report.expectedRendererFallbackErrors.push({
        renderer,
        wallBehavior,
        message,
      });
    else report.pageErrors.push(message);
  });
  const result = {
    renderer,
    wallBehavior,
    inputMode: options.inputMode,
    generationRequests: 0,
    screenshots: [],
  };
  let input;
  try {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/Orbsie/i, { timeout: 10000 });
    await page
      .locator("#prompt")
      .fill(
        "Create a bounded box wall with a collectible behind it for a small platform game.",
      );
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Program ready.", { exact: true })).toBeVisible(
      {
        timeout: 30000,
      },
    );
    result.generationRequests = generationCount();
    assert.equal(
      result.generationRequests,
      1,
      "Exactly one mocked generation is expected.",
    );
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.locator(".game-hud")).toBeVisible({ timeout: 30000 });

    const expectedObservationRenderer =
      renderer === "webgl" ? "webgl" : "software";
    const baseline = await waitForObservation(
      page,
      (observation) =>
        observation.playing &&
        observation.renderer === expectedObservationRenderer &&
        observation.entities.some(
          (entity) =>
            entity.id === WALL.id &&
            entity.behavior === wallBehavior &&
            entity.stage === "ready",
        ),
      { label: `${renderer} ${wallBehavior} ready gameplay baseline` },
    );
    result.baseline = {
      atMs: baseline.atMs,
      player: [...baseline.player.position],
      renderer: baseline.renderer,
      revision: baseline.revision,
      wall: baseline.entities.find((entity) => entity.id === WALL.id),
    };
    result.screenshots.push(`${renderer}-${wallBehavior}-before.png`);
    await page.screenshot({
      path: resolve(evidenceDir, result.screenshots.at(-1)),
      fullPage: true,
    });

    input = await makeInput(page, options.inputMode);
    if (input.mode === "keyboard") {
      await page
        .getByRole("region", { name: "Gameplay area", exact: true })
        .focus();
      await expect(
        page.getByRole("region", { name: "Gameplay area", exact: true }),
      ).toBeFocused();
    } else {
      await expect(
        page.getByRole("button", { name: "Move s", exact: true }),
      ).toBeVisible();
      assert.equal(
        await page.evaluate(
          () => window.matchMedia("(pointer: coarse)").matches,
        ),
        true,
        "Touch fixture must expose a coarse pointer.",
      );
    }

    await input.setKeys(["s"]);
    if (wallBehavior === "solid") {
      const contact = await waitForStableWallContact(page, baseline.atMs);
      await page.waitForTimeout(500);
      const blocked = await waitForObservation(
        page,
        (observation) =>
          observation.contacts.includes(WALL.id) &&
          observation.gameScore === 11 &&
          observation.atMs > contact.atMs,
        {
          afterAtMs: contact.atMs,
          label: `${renderer} held input at solid wall`,
        },
      );
      const normal = [Math.sin(0.5), Math.cos(0.5)];
      const travel =
        (blocked.player.position[0] - baseline.player.position[0]) * normal[0] +
        (blocked.player.position[2] - baseline.player.position[2]) * normal[1];
      const nearFace = WALL.position[2] - 0.25;
      assert(
        travel > 1,
        `The player must reach the wall; traveled ${travel.toFixed(3)}.`,
      );
      assert(
        blocked.player.position[2] < nearFace - 0.22 + 0.12,
        `The player crossed the solid wall depth: ${blocked.player.position[2].toFixed(3)}.`,
      );
      assert.equal(
        blocked.gameScore,
        11,
        "Wall contact must fire its collision rule once.",
      );
      assert(
        !blocked.collected.includes(BEHIND.id),
        "The hidden collectible must remain unreachable.",
      );
      result.blocking = {
        observationAtMs: blocked.atMs,
        player: [...blocked.player.position],
        travelAlongApproach: Number(travel.toFixed(3)),
        wallContact: blocked.contacts.includes(WALL.id),
        collisionRuleScore: blocked.gameScore,
        behindWallCollected: blocked.collected.includes(BEHIND.id),
      };
      result.screenshots.push(`${renderer}-solid-blocked.png`);
      await page.screenshot({
        path: resolve(evidenceDir, result.screenshots.at(-1)),
        fullPage: true,
      });

      await input.setKeys(["a"]);
      const slide = await waitForObservation(
        page,
        (observation) =>
          observation.contacts.includes(WALL.id) &&
          observation.gameScore === 11 &&
          observation.player.position[0] < blocked.player.position[0] - 0.65 &&
          Math.abs(
            observation.player.position[2] - blocked.player.position[2],
          ) < 0.08,
        {
          afterAtMs: blocked.atMs,
          timeoutMs: 6000,
          label: `${renderer} movement parallel to wall`,
        },
      );
      assert(!slide.collected.includes(BEHIND.id));
      result.parallelSlide = {
        observationAtMs: slide.atMs,
        from: [...blocked.player.position],
        to: [...slide.player.position],
        tangentDistance: Number(
          Math.abs(
            slide.player.position[0] - blocked.player.position[0],
          ).toFixed(3),
        ),
        wallContact: slide.contacts.includes(WALL.id),
        score: slide.gameScore,
      };
      result.screenshots.push(`${renderer}-solid-parallel-slide.png`);
      await page.screenshot({
        path: resolve(evidenceDir, result.screenshots.at(-1)),
        fullPage: true,
      });
      await input.releaseAll();
    } else {
      const crossed = await waitForObservation(
        page,
        (observation) =>
          observation.collected.includes(BEHIND.id) &&
          observation.gameScore === 111 &&
          observation.player.position[2] > WALL.position[2] + 0.7,
        {
          afterAtMs: baseline.atMs,
          timeoutMs: 10000,
          label: `${renderer} traversable visual-only wall`,
        },
      );
      assert.equal(
        crossed.entities.find((entity) => entity.id === WALL.id)?.behavior,
        "static",
      );
      result.visualOnlyTraversal = {
        observationAtMs: crossed.atMs,
        player: [...crossed.player.position],
        wallContactRuleFired: crossed.gameScore >= 11,
        behindWallCollected: crossed.collected.includes(BEHIND.id),
        score: crossed.gameScore,
      };
      result.screenshots.push(`${renderer}-static-traversed.png`);
      await page.screenshot({
        path: resolve(evidenceDir, result.screenshots.at(-1)),
        fullPage: true,
      });
      await input.releaseAll();
    }

    if (options.exportZip) {
      const zip = await exportWorld(page, resolve(evidenceDir, "world.zip"));
      result.export = {
        path: zip.path,
        bytes: zip.bytes,
        sha256: zip.sha256,
        fileCount: zip.files,
        readySolidWall: true,
        boxGeometry: true,
        collisionRule: true,
      };
      report._zipProject = zip.project;
    }
    return result;
  } catch (error) {
    result.error = cleanError(error);
    throw error;
  } finally {
    await input?.close().catch(() => {});
    await context.close();
  }
}

async function runStandalone(browser) {
  const zipBytes = await readFile(resolve(evidenceDir, "world.zip"));
  const files = unzipSync(zipBytes);
  let server;
  let context;
  try {
    server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const path = pathname.slice(1) || "index.html";
      const bytes = files[path];
      if (!bytes) {
        response.writeHead(404);
        response.end();
        return;
      }
      const extension = path.split(".").at(-1);
      response.setHeader(
        "Content-Type",
        {
          html: "text/html",
          css: "text/css",
          js: "text/javascript",
          json: "application/json",
          svg: "image/svg+xml",
          png: "image/png",
          wasm: "application/wasm",
        }[extension] ?? "application/octet-stream",
      );
      response.end(bytes);
    });
    await new Promise((resolveListen) =>
      server.listen(0, "127.0.0.1", resolveListen),
    );
    const origin = `http://127.0.0.1:${server.address().port}`;
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: "reduce",
    });
    await context.addInitScript(() => {
      window.__ORBSIE_GAMEPLAY_READ_REQUESTED__ = true;
    });
    const page = await context.newPage();
    const externalRequests = [];
    const errors = [];
    page.on("pageerror", (error) => errors.push(cleanError(error)));
    page.on("request", (request) => {
      const url = request.url();
      if (
        !url.startsWith(origin) &&
        !url.startsWith("data:") &&
        !url.startsWith("blob:")
      )
        externalRequests.push({
          origin: new URL(url).origin,
          path: new URL(url).pathname,
        });
    });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (
        url.origin !== origin &&
        url.protocol !== "data:" &&
        url.protocol !== "blob:"
      ) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await expect(page.locator("main[data-ready=true]")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator(".score")).toHaveText("Score: 0", {
      timeout: 15000,
    });
    const baseline = await waitForObservation(
      page,
      (observation) =>
        observation.playing &&
        observation.entities.some(
          (entity) =>
            entity.id === WALL.id &&
            entity.behavior === "solid" &&
            entity.stage === "ready",
        ),
      {
        timeoutMs: 15000,
        label: "standalone ready solid-wall baseline",
      },
    );
    await page.keyboard.down("s");
    const contact = await waitForObservation(
      page,
      (observation) =>
        observation.playing &&
        observation.contacts.includes(WALL.id) &&
        observation.gameScore === 11,
      {
        afterAtMs: baseline.atMs,
        timeoutMs: 10000,
        label: "standalone fresh wall contact under held input",
      },
    );
    await page.waitForTimeout(300);
    const blocked = await waitForObservation(
      page,
      (observation) =>
        observation.playing &&
        observation.contacts.includes(WALL.id) &&
        observation.gameScore === 11,
      {
        afterAtMs: contact.atMs,
        timeoutMs: 5000,
        label: "standalone fresh position remains blocked",
      },
    );
    await page.keyboard.up("s");
    await expect(page.locator(".score")).toHaveText("Score: 11", {
      timeout: 10000,
    });
    const score = await page.locator(".score").innerText();
    const wallNearFaceZ = WALL.position[2] - 0.25;
    const maximumFrontPlayerZ = wallNearFaceZ - 0.22 + 0.12;
    const roundedPosition = blocked.player.position.map((value) =>
      Number(value.toFixed(3)),
    );
    assert.equal(
      score,
      "Score: 11",
      "Standalone must fire wall contact without collecting behind it.",
    );
    assert(
      blocked.player.position[2] <= maximumFrontPlayerZ,
      `Standalone player crossed the wall face: z=${blocked.player.position[2].toFixed(3)} > ${maximumFrontPlayerZ.toFixed(3)}.`,
    );
    assert(
      !blocked.collected.includes(BEHIND.id),
      "Standalone must keep the collectible behind the wall unreachable.",
    );
    assert.deepEqual(
      externalRequests,
      [],
      "Standalone attempted an external request.",
    );
    assert.deepEqual(errors, [], "Standalone reported a browser error.");
    const screenshot = "standalone-solid-blocked-offline.png";
    await page.screenshot({
      path: resolve(evidenceDir, screenshot),
      fullPage: true,
    });
    return {
      passed: true,
      offline: true,
      renderer: "exported-standalone",
      inputMode: "keyboard",
      score,
      wallCollisionRuleFired: true,
      gameplayObservation: {
        renderer: blocked.renderer,
        baselineAtMs: Number(baseline.atMs.toFixed(1)),
        baselinePlayerPosition: baseline.player.position.map((value) =>
          Number(value.toFixed(3)),
        ),
        blockedAtMs: Number(blocked.atMs.toFixed(1)),
        blockedPlayerPosition: roundedPosition,
        wallContact: blocked.contacts.includes(WALL.id),
        wallNearFaceZ: Number(wallNearFaceZ.toFixed(3)),
        maximumFrontPlayerZ: Number(maximumFrontPlayerZ.toFixed(3)),
      },
      behindWallCollectibleReached: false,
      externalRequests,
      pageErrors: errors,
      screenshot,
    };
  } finally {
    await context?.close();
    if (server) await new Promise((resolveClose) => server.close(resolveClose));
  }
}

const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const renderers =
    requestedRenderer === "all" ? ["webgl", "software"] : [requestedRenderer];
  for (const renderer of renderers) {
    const inputMode = renderer === "software" ? "touch" : "keyboard";
    const solid = await runEditorScenario(browser, renderer, "solid", {
      inputMode,
      exportZip: !report._zipProject,
    });
    const visualOnly = await runEditorScenario(browser, renderer, "static", {
      inputMode,
    });
    report.renderers[renderer] = { solid, visualOnly };
  }
  assert(report._zipProject, "A ready solid-wall world ZIP must be exported.");
  report.standalone = await runStandalone(browser);
  assert.deepEqual(
    report.unexpectedApiRequests,
    [],
    "Only config, trial and generation may be mocked.",
  );
  assert.equal(
    report.expectedRendererFallbackErrors.length,
    renderers.includes("software") ? 2 : 0,
    "Forced software mode should report only its expected WebGL initialization fallback.",
  );
  assert.deepEqual(
    report.externalRequests,
    [],
    "The editor must make no external requests.",
  );
  assert.deepEqual(
    report.pageErrors,
    [],
    "The editor must report no browser errors.",
  );
  delete report._zipProject;
  report.passed = true;
  await writeFile(
    resolve(evidenceDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report));
} catch (error) {
  delete report._zipProject;
  report.failure = cleanError(error);
  await writeFile(
    resolve(evidenceDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  throw error;
} finally {
  await browser.close();
}
