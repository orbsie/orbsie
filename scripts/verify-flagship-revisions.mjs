#!/usr/bin/env node

/**
 * Deterministic browser acceptance for flagship revision edits (prompt.md §12, 6–8).
 *
 * The browser uses the real editor UI and the test-only fixture transport. It
 * never calls a live model provider. Persisted assertions read the app's own
 * IndexedDB snapshot so this harness checks saved project state, not React
 * state or fixture output in isolation.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { installFixtureGeneration } from "./fixture-generation.mjs";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";

const TEST_URL = process.env.TEST_URL ?? "http://localhost:3028";
const EVIDENCE_DIR =
  process.env.ORBSIE_FLAGSHIP_EVIDENCE_DIR ??
  "docs/evidence/flagship-revisions";
const APP_SOURCE_COMMIT = process.env.ORBSIE_APP_SOURCE_COMMIT ?? "unverified";
const INITIAL_PROMPT =
  "Make a sunny little island game where I collect five glowing crystals, bounce across three moving platforms, and reach a portal. Add friendly trees and a pond.";
const MUSHROOM_PROMPT = "Make this a giant pink mushroom";
const PLATFORM_PROMPT =
  "Make the middle platform slower and add two more crystals";
const WAIT_TIMEOUT = 45000;

function sourceCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unavailable";
  }
}

function byId(project) {
  return new Map(project.entities.map((entity) => [entity.id, entity]));
}

function collectables(project) {
  return project.entities.filter(
    (entity) => entity.stage === "ready" && entity.behavior?.type === "collect",
  );
}

function assertInitialScene(project) {
  const crystals = collectables(project);
  const platforms = project.entities.filter(
    (entity) =>
      entity.geometry?.kind === "platform" && entity.behavior?.type === "move",
  );
  const trees = project.entities.filter(
    (entity) => entity.geometry?.kind === "tree",
  );
  const ponds = project.entities.filter(
    (entity) => entity.geometry?.kind === "pond",
  );
  const portals = project.entities.filter(
    (entity) => entity.behavior?.type === "portal",
  );
  assert.equal(crystals.length, 5, "initial scene has five collectibles");
  assert.equal(platforms.length, 3, "initial scene has three moving platforms");
  assert.equal(trees.length, 3, "initial scene has three trees");
  assert.equal(ponds.length, 1, "initial scene has one pond");
  assert.equal(portals.length, 1, "initial scene has one portal");
  for (const platform of platforms) {
    assert.ok(
      typeof platform.behavior?.speed === "number" &&
        platform.behavior.speed > 0,
      `platform ${platform.id} has a positive speed`,
    );
  }
}

function assertUnchangedEntities(before, after, excludedIds = new Set()) {
  const previous = byId(before);
  const current = byId(after);
  for (const [id, entity] of previous) {
    if (excludedIds.has(id)) continue;
    assert.deepEqual(
      current.get(id),
      entity,
      `entity ${id} remained unchanged`,
    );
  }
}

async function savedProject(page, predicate, label) {
  let current = null;
  await expect
    .poll(
      async () => {
        current = (await storageSnapshot(page, "__no-provider-key__")).project;
        return Boolean(current && predicate(current));
      },
      {
        timeout: WAIT_TIMEOUT,
        message: `Timed out waiting for saved ${label}.`,
      },
    )
    .toBe(true);
  return current;
}

const report = {
  status: "running",
  mode: "deterministic-fixture-browser",
  appSourceCommit: APP_SOURCE_COMMIT,
  repositoryCommit: sourceCommit(),
  url: TEST_URL,
  fixtureTransport: true,
  generationRequests: 0,
  blockedExternalHttpRequests: [],
  fixtureFontStylesheets: [],
  pageErrors: [],
  consoleErrors: [],
  requestFailures: [],
  checks: {},
};

const testOrigin = new URL(TEST_URL).origin;
await mkdir(EVIDENCE_DIR, { recursive: true });
await unlink(`${EVIDENCE_DIR}/failure.png`).catch(() => undefined);

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
let page;

try {
  // Keep all non-app HTTP(S) traffic out of this deterministic run. The
  // fixture route is registered below and therefore handles /api/generate
  // before this guard sees the rewritten fixture URL.
  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      (requestUrl.protocol === "http:" || requestUrl.protocol === "https:") &&
      requestUrl.origin !== testOrigin
    ) {
      report.blockedExternalHttpRequests.push({
        method: route.request().method(),
        url: route.request().url(),
      });
      await route.abort();
      return;
    }
    await route.fallback();
  });
  await   installFixtureGeneration(context);
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  // Three's existing devtools observation hook exposes scene references for
  // read-only telemetry. No store import, score injection or transform writes.
  await page.addInitScript(() => {
    const observed = [];
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      if (event.detail?.isScene) observed.push(event.detail);
    });
    window.__orbReadPlayer = () => {
      let player;
      for (const scene of observed)
        scene.traverse((object) => {
          if (object.geometry?.type === "CapsuleGeometry")
            player = object.parent;
        });
      return player
        ? {
            x: player.position.x,
            y: player.position.y,
            z: player.position.z,
            visible: player.visible,
          }
        : null;
    };
  });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    report.requestFailures.push({
      method: request.method(),
      url: request.url(),
      failure: request.failure()?.errorText ?? "unknown",
    });
  });
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname === "/api/generate") report.generationRequests += 1;
  });

  await page.goto(TEST_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByPlaceholder("What experience to build?").fill(INITIAL_PROMPT);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByText("Your island is alive!", { exact: false }),
  ).toBeVisible({ timeout: WAIT_TIMEOUT });

  const initial = await savedProject(
    page,
    (project) =>
      project.revision > 0 &&
      project.messages.at(-1)?.role === "assistant" &&
      project.messages.at(-1)?.text.includes("Your island is alive!"),
    "initial island commit",
  );
  assert.equal(initial.messages[0]?.text, INITIAL_PROMPT);
  assertInitialScene(initial);
  report.checks.initialScene = {
    revision: initial.revision,
    entities: initial.entities.length,
    collectibles: collectables(initial).length,
  };

  await page.getByRole("button", { name: "Show objects", exact: true }).click();
  await page.getByRole("button", { name: "Friendly tree" }).click();
  await expect(page.locator(".selection-chip")).toContainText("Friendly tree");
  const selectedTreeId = byId(initial).get("tree-0")?.id;
  assert.equal(
    selectedTreeId,
    "tree-0",
    "Friendly tree is the expected stable entity",
  );
  await page.locator("#prompt").fill(MUSHROOM_PROMPT);
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  await expect(
    page.getByText("Done. I kept the rest", { exact: false }),
  ).toBeVisible({
    timeout: WAIT_TIMEOUT,
  });

  const mushroom = await savedProject(
    page,
    (project) =>
      project.messages.at(-1)?.role === "assistant" &&
      project.messages.at(-1)?.text.includes("Done. I kept the rest") &&
      project.entities.some(
        (entity) =>
          entity.id === selectedTreeId && entity.geometry?.kind === "mushroom",
      ),
    "mushroom revision commit",
  );
  const initialEntities = byId(initial);
  const mushroomEntities = byId(mushroom);
  const initialTree = initialEntities.get(selectedTreeId);
  const mushroomTree = mushroomEntities.get(selectedTreeId);
  assert.ok(initialTree, "selected tree exists in the initial saved project");
  assert.ok(mushroomTree, "selected tree remains present after the edit");
  assert.equal(mushroom.entities.length, initial.entities.length);
  assert.equal(mushroomTree.geometry?.kind, "mushroom");
  assert.equal(mushroomTree.color, "#ed99b5");
  assert.ok(
    mushroomTree.scale.every(
      (value, index) => value > initialTree.scale[index],
    ),
    "giant mushroom scale is larger than the original tree",
  );
  assertUnchangedEntities(initial, mushroom, new Set([selectedTreeId]));
  assert.deepEqual(mushroom.environment, initial.environment);
  report.checks.mushroomRevision = {
    revision: mushroom.revision,
    targetId: selectedTreeId,
    targetKind: mushroomTree.geometry?.kind,
    targetColor: mushroomTree.color,
    unchangedEntityCount: initial.entities.length - 1,
  };

  await page
    .getByRole("button", { name: "Clear selected object", exact: true })
    .click();
  await expect(page.locator(".selection-chip")).toHaveCount(0);
  await page.locator("#prompt").fill(PLATFORM_PROMPT);
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  await expect(
    page.getByText("Done. I kept the rest", { exact: false }),
  ).toBeVisible({
    timeout: WAIT_TIMEOUT,
  });

  const revised = await savedProject(
    page,
    (project) =>
      project.messages.at(-1)?.role === "assistant" &&
      project.messages.at(-1)?.text.includes("Done. I kept the rest") &&
      collectables(project).length === 7 &&
      project.entities.find((entity) => entity.id === "platform-1")?.behavior
        ?.speed === 0.3,
    "platform and collectible revision commit",
  );
  const revisedEntities = byId(revised);
  const revisedPlatform = revisedEntities.get("platform-1");
  const mushroomAfterSecondEdit = revisedEntities.get(selectedTreeId);
  const previousPlatformSpeed =
    mushroomEntities.get("platform-1")?.behavior?.speed;
  assert.ok(revisedPlatform, "middle platform remains present");
  const revisedPlatformSpeed = revisedPlatform.behavior?.speed;
  assert.equal(revisedPlatform.behavior?.type, "move");
  assert.equal(revised.entities.length, mushroom.entities.length + 2);
  assert.ok(
    typeof previousPlatformSpeed === "number" &&
      typeof revisedPlatformSpeed === "number" &&
      revisedPlatformSpeed < previousPlatformSpeed,
    "middle platform speed decreased",
  );
  assert.equal(revisedPlatformSpeed, 0.3);
  assert.equal(
    collectables(revised).length,
    7,
    "second revision has a seven-crystal collection goal",
  );
  assert.equal(
    new Set(collectables(revised).map((entity) => entity.id)).size,
    7,
    "all seven collectibles have unique IDs",
  );
  assertUnchangedEntities(mushroom, revised, new Set(["platform-1"]));
  assert.deepEqual(mushroomAfterSecondEdit, mushroomTree);
  assert.deepEqual(revised.environment, mushroom.environment);
  report.checks.platformRevision = {
    revision: revised.revision,
    platformId: "platform-1",
    previousSpeed: previousPlatformSpeed,
    revisedSpeed: revisedPlatform.behavior?.speed,
    collectibles: collectables(revised).length,
    uniqueCollectibles: new Set(
      collectables(revised).map((entity) => entity.id),
    ).size,
    preservedMushroom: true,
  };

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".game-hud")).toBeVisible();
  await expect(page.locator(".game-hud strong span")).toHaveText(/\/\s*7/);
  await page.screenshot({ path: `${EVIDENCE_DIR}/revised-goal-7.png` });
  report.checks.playGoal7 = true;

  const readPlayer = () => page.evaluate(() => window.__orbReadPlayer());
  const score = async () =>
    Number(
      (await page.locator(".game-hud strong").innerText()).match(/(\d+)/)?.[1],
    );
  const held = new Set();
  const setKeys = async (keys) => {
    for (const key of held)
      if (!keys.includes(key)) {
        await page.keyboard.up(key);
        held.delete(key);
      }
    for (const key of keys)
      if (!held.has(key)) {
        await page.keyboard.down(key);
        held.add(key);
      }
  };
  const approach = async (target, tolerance = 0.42) => {
    for (let step = 0; step < 180; step += 1) {
      const position = await readPlayer();
      const dx = target.position[0] - position.x;
      const dz = target.position[2] - position.z;
      if (Math.hypot(dx, dz) < tolerance) {
        await setKeys([]);
        return true;
      }
      const inputX = Math.cos(0.5) * dx - Math.sin(0.5) * dz;
      const inputZ = Math.sin(0.5) * dx + Math.cos(0.5) * dz;
      const choices = [
        { x: 1, z: 0, keys: ["d"] },
        { x: -1, z: 0, keys: ["a"] },
        { x: 0, z: 1, keys: ["s"] },
        { x: 0, z: -1, keys: ["w"] },
        { x: Math.SQRT1_2, z: Math.SQRT1_2, keys: ["d", "s"] },
        { x: Math.SQRT1_2, z: -Math.SQRT1_2, keys: ["d", "w"] },
        { x: -Math.SQRT1_2, z: Math.SQRT1_2, keys: ["a", "s"] },
        { x: -Math.SQRT1_2, z: -Math.SQRT1_2, keys: ["a", "w"] },
      ];
      const best = choices.reduce((a, b) =>
        a.x * inputX + a.z * inputZ > b.x * inputX + b.z * inputZ ? a : b,
      );
      await setKeys(best.keys);
      await page.waitForTimeout(110);
    }
    await setKeys([]);
    return false;
  };
  await page.mouse.click(1100, 850);
  await page.waitForFunction(() => window.__orbReadPlayer()?.visible, {
    timeout: WAIT_TIMEOUT,
  });
  await page.waitForTimeout(6000);

  const portal = revised.entities.find(
    (entity) => entity.behavior?.type === "portal",
  );
  const gatedPortal = await approach(portal);
  assert.ok(gatedPortal, "player reached the portal before collecting");
  await page.waitForTimeout(1200);
  assert.equal(
    await page.locator(".win-card").count(),
    0,
    "the portal must not complete the goal before every crystal is collected",
  );
  const gatedScore = await score();
  assert.ok(gatedScore < 7, "the early portal visit must not win");
  report.checks.portalGating = { collected: gatedScore, won: false };

  const revisedCollectables = collectables(revised);
  for (
    let pass = 0;
    (await score()) < 7 && pass < 3;
    pass += 1
  ) {
    for (const target of revisedCollectables) {
      if ((await score()) >= 7) break;
      await approach(target);
      const before = await score();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if ((await score()) !== before) break;
        await approach(target);
        await setKeys([" "]);
        await page.waitForTimeout(450);
        await setKeys([]);
        await page.waitForTimeout(400);
      }
    }
  }
  await expect.poll(score).toBe(7, { timeout: WAIT_TIMEOUT });
  assert.equal(
    revisedCollectables.length,
    7,
    "every revised crystal was collected",
  );
  const winArrived = await approach(portal);
  assert.ok(winArrived, "player returned to the portal with every crystal");
  await expect(page.locator(".win-card")).toBeVisible({ timeout: WAIT_TIMEOUT });
  await expect(
    page.getByText("You found every crystal and made it home.", {
      exact: true,
    }),
  ).toBeVisible();
  assert.equal(await score(), 7);
  await page.screenshot({ path: `${EVIDENCE_DIR}/won-goal-7.png` });
  report.checks.winGoal7 = { collected: 7, won: true };
  await page.getByRole("button", { name: "One more adventure" }).click();
  await expect(page.locator(".win-card")).toHaveCount(0);
  await expect.poll(score).toBe(0);
  report.checks.playReset = true;

  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(
    page.getByText("Previous change restored.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".game-hud strong span")).toHaveText(/\/\s*5/);
  const undone = await savedProject(
    page,
    (project) =>
      project.entities.length === mushroom.entities.length &&
      project.messages.length === mushroom.messages.length &&
      project.entities.some(
        (entity) =>
          entity.id === selectedTreeId && entity.geometry?.kind === "mushroom",
      ) &&
      collectables(project).length === 5,
    "undo revision",
  );
  assert.deepEqual(
    undone.entities,
    mushroom.entities,
    "undo restored the exact preceding entity state",
  );
  assert.deepEqual(undone.messages, mushroom.messages);
  assert.deepEqual(undone.environment, mushroom.environment);
  report.checks.undo = {
    revision: undone.revision,
    restoredEntityState: true,
    collectibles: collectables(undone).length,
    hudGoal: 5,
  };

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Continue your saved world" }),
  ).toBeVisible({
    timeout: WAIT_TIMEOUT,
  });
  await page.getByRole("button", { name: "Continue your saved world" }).click();
  await expect(page.locator(".workspace-heading h2")).toBeVisible();
  const reopened = await savedProject(
    page,
    (project) =>
      project.entities.length === mushroom.entities.length &&
      project.messages.length === mushroom.messages.length &&
      collectables(project).length === 5,
    "reopened saved revision",
  );
  assert.deepEqual(
    reopened.entities,
    mushroom.entities,
    "reload preserved the undone entity state",
  );
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".game-hud strong span")).toHaveText(/\/\s*5/);
  await page.screenshot({ path: `${EVIDENCE_DIR}/reopened-goal-5.png` });
  report.checks.reloadRecovery = {
    revision: reopened.revision,
    restoredEntityState: true,
    collectibles: collectables(reopened).length,
    hudGoal: 5,
  };

  assert.equal(
    report.generationRequests,
    3,
    "exactly three fixture generation requests were intercepted",
  );
  assert.deepEqual(report.blockedExternalHttpRequests, []);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (report.status !== "passed") {
    await page
      ?.screenshot({ path: `${EVIDENCE_DIR}/failure.png` })
      .catch(() => undefined);
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(
    `${EVIDENCE_DIR}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  console.log(JSON.stringify(report));
}
