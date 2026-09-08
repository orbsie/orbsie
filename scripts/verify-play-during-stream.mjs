#!/usr/bin/env node

/**
 * Verify that a playable world keeps running while its generation response is
 * still open and accepts a compatible entity update without restarting play.
 *
 * The stream is built from the saved live-authored project replay. It never
 * calls a model provider and does not inject store state or synthetic input.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";

const TEST_URL = process.env.TEST_URL ?? "http://localhost:3030";
const EVIDENCE_DIR =
  process.env.ORBSIE_PLAY_STREAM_EVIDENCE_DIR ??
  "docs/evidence/play-during-stream";
const REPLAY_ZIP =
  process.env.ORBSIE_GAME_STREAM_WORLD_ZIP ??
  "docs/evidence/game-program-chatgpt/world.zip";
const APP_SOURCE_COMMIT = process.env.ORBSIE_APP_SOURCE_COMMIT ?? "unverified";
const WAIT_TIMEOUT = 45000;
const VIEWPORT = { width: 1440, height: 1000 };
const REDUCED_MOTION = "no-preference";
const MATERIAL_COLOR = "#5d8cff";
const COMMIT_MESSAGE = "Crystal game stream complete.";
const PROMPT = "Build a tiny crystal game with arrow-key rules.";

function sourceCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unavailable";
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function replaySource() {
  const archiveBytes = await readFile(REPLAY_ZIP);
  const files = unzipSync(archiveBytes);
  const projectBytes = files["project.json"];
  if (!projectBytes)
    throw Error(`Replay archive lacks project.json: ${REPLAY_ZIP}`);
  const project = JSON.parse(strFromU8(projectBytes));
  const entity = project.entities?.find(
    (candidate) => candidate.id === "crystal",
  );
  if (!entity) throw Error("Saved replay lacks the crystal entity.");
  assert.equal(project.entities.length, 1, "saved replay has one entity");
  assert.equal(entity.stage, "ready");
  assert.deepEqual(entity.behavior, { type: "collect" });
  assert.equal(entity.geometry?.kind, "crystal");
  assert.equal(entity.geometry?.detail, "refined");
  assert.equal(
    project.game?.rules?.length,
    3,
    "saved replay has three game rules",
  );
  assert.deepEqual(
    project.game.rules.map((rule) => [rule.id, rule.trigger, rule.actions]),
    [
      [
        "right_score",
        { type: "input", action: "right" },
        [{ type: "add_score", amount: 7 }],
      ],
      ["up_win", { type: "input", action: "up" }, [{ type: "win" }]],
      ["left_lose", { type: "input", action: "left" }, [{ type: "lose" }]],
    ],
  );

  const reserveEntity = Object.fromEntries(
    Object.entries(entity).filter(([name]) => name !== "geometry"),
  );
  reserveEntity.stage = "seed";
  const initialCommands = [
    { type: "reserve_entity", entity: reserveEntity },
    { type: "set_geometry", id: entity.id, geometry: entity.geometry },
    { type: "set_game", game: project.game },
  ];
  assert.deepEqual(initialCommands[1].geometry, entity.geometry);
  assert.deepEqual(initialCommands[2].game, project.game);
  return {
    archiveSHA256: sha256(archiveBytes),
    projectSHA256: sha256(projectBytes),
    project,
    entity,
    initialCommands,
    materialCommand: {
      type: "set_material",
      id: entity.id,
      color: MATERIAL_COLOR,
    },
    commitCommand: { type: "commit_revision", message: COMMIT_MESSAGE },
  };
}

const report = {
  status: "running",
  mode: "deterministic-held-ndjson-browser",
  scope:
    "One normal-motion editor run derives a one-crystal game stream from the saved live-authored replay, enters Play before commit, scores 7 with real ArrowRight input while building remains visible, applies a compatible crystal material update while the stream remains open, then commits/EOFs and wins with real ArrowUp input. It covers this narrow input-rule gameplay path during an open response; it does not cover physical traversal, partial provider/model stream semantics, live inference, or synthetic store/input state.",
  url: TEST_URL,
  appSourceCommit: APP_SOURCE_COMMIT,
  repositoryCommit: sourceCommit(),
  replayArchive: REPLAY_ZIP,
  viewport: VIEWPORT,
  reducedMotion: REDUCED_MOTION,
  fixtureTransport: true,
  generationRequestCount: 0,
  fixtureServerRequestCount: 0,
  fixtureURL: null,
  streamTimeline: [],
  blockedExternalHttpRequests: [],
  fixtureFontStylesheets: [],
  pageErrors: [],
  consoleErrors: [],
  requestFailures: [],
  generationLifecycle: [],
  checks: {},
};

await mkdir(EVIDENCE_DIR, { recursive: true });
await readFile(`${EVIDENCE_DIR}/failure.png`).catch(() => undefined);

let browser;
let context;
let page;
let server;
let fixtureURL;
let releaseMaterial;
let releaseCommit;
const materialGate = new Promise((resolve) => {
  releaseMaterial = resolve;
});
const commitGate = new Promise((resolve) => {
  releaseCommit = resolve;
});
const stream = {
  received: false,
  initialFlushed: false,
  materialFlushed: false,
  commitFlushed: false,
  eofWritten: false,
  ended: false,
  closedBeforeEOF: false,
  requestBodyBytes: 0,
};
let timelineStart = Date.now();
function recordEvent(name, details = {}) {
  report.streamTimeline.push({
    name,
    elapsedMs: Date.now() - timelineStart,
    ...details,
  });
}

try {
  const replay = await replaySource();
  report.replaySource = {
    archiveSHA256: replay.archiveSHA256,
    projectSHA256: replay.projectSHA256,
    projectId: replay.project.id,
    entityId: replay.entity.id,
    entityGeometry: replay.entity.geometry,
    gameRuleIds: replay.project.game.rules.map((rule) => rule.id),
  };

  server = createServer(async (request, response) => {
    if (request.url !== "/api/generate" || request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }
    report.fixtureServerRequestCount += 1;
    stream.received = true;
    recordEvent("request-received");
    for await (const chunk of request) stream.requestBodyBytes += chunk.length;
    response.on("close", () => {
      if (!stream.ended && !response.writableFinished) {
        stream.closedBeforeEOF = true;
        recordEvent("response-closed-before-eof");
      }
    });
    response.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    });
    for (const command of replay.initialCommands)
      response.write(`${JSON.stringify(command)}\n`);
    stream.initialFlushed = true;
    recordEvent("initial-commands-flushed", {
      commands: replay.initialCommands.map((command) => command.type),
    });
    await materialGate;
    if (response.destroyed) return;
    response.write(`${JSON.stringify(replay.materialCommand)}\n`);
    stream.materialFlushed = true;
    recordEvent("material-flushed", {
      command: replay.materialCommand.type,
      color: replay.materialCommand.color,
      responseStillOpen: true,
    });
    await commitGate;
    if (response.destroyed) return;
    response.write(`${JSON.stringify(replay.commitCommand)}\n`);
    stream.commitFlushed = true;
    recordEvent("commit-flushed", { command: replay.commitCommand.type });
    const responseFinished = new Promise((resolve) => {
      response.once("finish", () => {
        stream.ended = true;
        recordEvent("eof");
        resolve("finish");
      });
      response.once("close", () => resolve("close"));
    });
    response.end();
    stream.eofWritten = true;
    recordEvent("eof-written");
    await responseFinished;
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref();
  fixtureURL = `http://127.0.0.1:${server.address().port}/api/generate`;
  report.fixtureURL = fixtureURL;
  timelineStart = Date.now();

  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  context = await browser.newContext({
    viewport: VIEWPORT,
    reducedMotion: REDUCED_MOTION,
  });
  const testOrigin = new URL(TEST_URL).origin;

  await context.route("**/*", async (route) => {
    const requestURL = new URL(route.request().url());
    if (
      requestURL.origin === "https://fonts.googleapis.com" &&
      requestURL.pathname === "/css2"
    ) {
      report.fixtureFontStylesheets.push(requestURL.href);
      await route.fulfill({
        contentType: "text/css",
        body: "/* Deterministic fixture: use fallback fonts. */",
      });
      return;
    }
    if (
      (requestURL.protocol === "http:" || requestURL.protocol === "https:") &&
      requestURL.origin !== testOrigin
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
  await context.route("**/api/trial", (route) =>
    route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } }),
  );
  await context.route("**/api/generate", async (route) => {
    report.generationRequestCount += 1;
    await route.continue({ url: fixtureURL });
  });

  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    const failure = {
      method: request.method(),
      url: request.url(),
      failure: request.failure()?.errorText ?? "unknown",
    };
    report.requestFailures.push(failure);
    if (request.url().includes("/api/generate"))
      report.generationLifecycle.push({ event: "requestfailed", ...failure });
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/generate"))
      report.generationLifecycle.push({
        event: "response",
        url: response.url(),
        status: response.status(),
      });
  });
  page.on("requestfinished", (request) => {
    if (request.url().includes("/api/generate"))
      report.generationLifecycle.push({
        event: "requestfinished",
        url: request.url(),
      });
  });

  await page.goto(TEST_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator("canvas")).toBeVisible();
  await page.locator("#prompt").fill(PROMPT);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect
    .poll(() => report.generationRequestCount, {
      timeout: WAIT_TIMEOUT,
      message: "Timed out waiting for the single generation request.",
    })
    .toBe(1);
  await expect
    .poll(() => stream.initialFlushed, {
      timeout: WAIT_TIMEOUT,
      message:
        "Timed out waiting for the replay stream to flush initial commands.",
    })
    .toBe(true);
  await expect(page.locator(".building-message")).toBeVisible({
    timeout: WAIT_TIMEOUT,
  });
  let readyProject;
  await expect
    .poll(
      async () => {
        readyProject = (await storageSnapshot(page)).project;
        const readyEntity = readyProject?.entities?.find(
          (entity) => entity.id === replay.entity.id,
        );
        return Boolean(
          readyEntity?.stage === "ready" &&
          JSON.stringify(readyEntity.geometry) ===
            JSON.stringify(replay.entity.geometry) &&
          JSON.stringify(readyProject.game) ===
            JSON.stringify(replay.project.game),
        );
      },
      {
        timeout: WAIT_TIMEOUT,
        message:
          "Timed out waiting for refined replay entity and game program.",
      },
    )
    .toBe(true);
  await expect(page.locator(".scene-caption")).toHaveText(
    "Click an object to make it your own.",
    { timeout: WAIT_TIMEOUT },
  );
  await expect(page.locator(".building-message")).toBeVisible();
  report.checks = {
    oneStreamGenerationRequest: true,
    savedReplayCommandsApplied: true,
    refinedEntityReadyBeforeCommit: true,
    normalMotionDescentReady: true,
    buildingVisibleBeforePlay: true,
  };

  const playButton = page.getByRole("button", { name: "Play", exact: true });
  await playButton.click();
  await expect(playButton).toHaveClass(/active/);
  await expect(page.locator(".game-hud strong")).toHaveText("0");
  await page.keyboard.press("ArrowRight", { delay: 100 });
  await expect(page.locator(".game-hud strong")).toHaveText("7", {
    timeout: WAIT_TIMEOUT,
  });
  await expect(page.locator(".building-message")).toBeVisible();
  report.checks.playEnteredBeforeCommit = true;
  report.checks.realArrowRightScoredSevenWhileBuilding = true;
  report.scoreWhileBuilding = await page
    .locator(".game-hud strong")
    .textContent();
  report.playActiveWhileBuilding = await playButton.evaluate((button) =>
    button.classList.contains("active"),
  );
  assert.equal(report.scoreWhileBuilding, "7");
  assert.equal(report.playActiveWhileBuilding, true);
  assert.equal(stream.ended, false);

  releaseMaterial();
  let materialProject;
  await expect
    .poll(
      async () => {
        materialProject = (await storageSnapshot(page)).project;
        const materialEntity = materialProject?.entities?.find(
          (entity) => entity.id === replay.entity.id,
        );
        return Boolean(
          materialEntity?.color === MATERIAL_COLOR &&
          materialEntity.geometry?.tint === MATERIAL_COLOR,
        );
      },
      {
        timeout: WAIT_TIMEOUT,
        message:
          "Timed out waiting for compatible material update persistence.",
      },
    )
    .toBe(true);
  assert.equal(stream.materialFlushed, true);
  assert.equal(stream.commitFlushed, false);
  assert.equal(stream.ended, false);
  await expect(page.locator(".building-message")).toBeVisible();
  await expect(page.locator(".game-hud strong")).toHaveText("7");
  await expect(playButton).toHaveClass(/active/);
  report.checks.compatibleMaterialReachedAppBeforeEOF = true;
  report.checks.scorePreservedAfterMaterialUpdate = true;
  report.checks.playStayedActiveAfterMaterialUpdate = true;
  report.materialObservedWhileStreamOpen = !stream.ended;
  report.materialProject = {
    revision: materialProject.revision,
    entityColor: materialProject.entities.find(
      (entity) => entity.id === replay.entity.id,
    )?.color,
    geometryTint: materialProject.entities.find(
      (entity) => entity.id === replay.entity.id,
    )?.geometry?.tint,
    gameUnchanged:
      JSON.stringify(materialProject.game) ===
      JSON.stringify(replay.project.game),
  };
  assert.equal(report.materialObservedWhileStreamOpen, true);
  assert.equal(report.materialProject.gameUnchanged, true);

  releaseCommit();
  await expect
    .poll(() => stream.ended, {
      timeout: WAIT_TIMEOUT,
      message: "Timed out waiting for commit and EOF from the replay stream.",
    })
    .toBe(true);
  await expect(page.locator(".building-message")).toHaveCount(0, {
    timeout: WAIT_TIMEOUT,
  });
  await expect(page.getByText(COMMIT_MESSAGE, { exact: true })).toBeVisible({
    timeout: WAIT_TIMEOUT,
  });
  await expect(page.locator(".game-hud strong")).toHaveText("7");
  await expect(playButton).toHaveClass(/active/);
  report.checks.commitAndEOFObserved = true;
  report.checks.scorePreservedAfterEOF = true;
  report.checks.playStayedActiveAfterEOF = true;

  await page.keyboard.press("ArrowUp", { delay: 100 });
  await expect(page.locator(".win-card h2")).toHaveText("Adventure complete", {
    timeout: WAIT_TIMEOUT,
  });
  await expect(page.locator(".win-card p")).toHaveText("Final score: 7");
  await expect(page.locator(".game-hud strong")).toHaveText("7");
  await expect(playButton).toHaveClass(/active/);
  report.checks.realArrowUpWonWithScorePreserved = true;
  await page.waitForTimeout(500);

  const timelineNames = report.streamTimeline.map((event) => event.name);
  assert.ok(timelineNames.indexOf("initial-commands-flushed") >= 0);
  assert.ok(
    timelineNames.indexOf("material-flushed") >
      timelineNames.indexOf("initial-commands-flushed"),
  );
  assert.ok(
    timelineNames.indexOf("commit-flushed") >
      timelineNames.indexOf("material-flushed"),
  );
  assert.ok(
    timelineNames.indexOf("eof") > timelineNames.indexOf("commit-flushed"),
  );
  report.checks.materialBeforeCommitBeforeEOF = true;
  report.streamState = {
    received: stream.received,
    initialFlushed: stream.initialFlushed,
    materialFlushed: stream.materialFlushed,
    commitFlushed: stream.commitFlushed,
    eofWritten: stream.eofWritten,
    ended: stream.ended,
    closedBeforeEOF: stream.closedBeforeEOF,
    requestBodyBytes: stream.requestBodyBytes,
  };
  await new Promise((resolve) => setTimeout(resolve, 100));
  const unexpectedFailures = report.requestFailures.filter(
    (failure) =>
      !(
        failure.url === fixtureURL &&
        failure.failure === "net::ERR_ABORTED" &&
        stream.ended
      ),
  );
  assert.deepEqual(unexpectedFailures, []);
  assert.equal(report.fixtureServerRequestCount, 1);
  assert.deepEqual(report.blockedExternalHttpRequests, []);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  report.requestFailureNote = report.requestFailures.length
    ? "The rewritten localhost fixture request returned 200 and its commands were consumed through EOF; Chromium may report net::ERR_ABORTED afterward, matching the existing fixture harness behavior."
    : null;
  report.status = "passed";
  await page.screenshot({ path: `${EVIDENCE_DIR}/final.png` });
  report.screenshot = "final.png";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  if (page) {
    await page
      .screenshot({ path: `${EVIDENCE_DIR}/failure.png` })
      .catch(() => undefined);
    report.screenshot = "failure.png";
  }
  process.exitCode = 1;
} finally {
  releaseMaterial?.();
  releaseCommit?.();
  await writeFile(
    `${EVIDENCE_DIR}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log(JSON.stringify(report, null, 2));
}
