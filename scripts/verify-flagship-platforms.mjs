#!/usr/bin/env node
// Desktop-only acceptance for landing on and being carried by the three
// moving catalog platforms in the saved OpenRouter flagship ZIP or its
// read-only published deployment.
//
// This verifier serves the ZIP bytes directly, observes only rendered Three.js
// objects, and drives the game through real keyboard events. It never imports
// the app store, writes scene/player state, or makes a model/account request.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { posix as posixPath, resolve, join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import {
  CONTACT_HORIZONTAL_TOLERANCE,
  DEFAULT_JUMP_REACH_MARGIN,
  GRAVITY,
  JUMP_SPEED,
  PLAYER_HALF_HEIGHT,
  PLAYER_MOVE_SPEED,
  horizontalGapToPlatform,
  jumpReachModel,
  movingTargetMotionBound,
  renderedDimensionsMatchSource,
  sourcePlatformContact,
  sourceLandingEvidence,
} from "./lib/flagship-platforms-verifier.mjs";

const zipPath = resolve(
  process.env.FLAGSHIP_GAME_ZIP ??
    "docs/evidence/provider-e2e/flagship-openrouter/openrouter/world.zip",
);
const output = resolve(process.argv[2] ?? "docs/evidence/flagship-platforms");
const reanalyzeReport = process.env.FLAGSHIP_REANALYZE_REPORT;
const sequential = process.env.FLAGSHIP_SEQUENTIAL === "1";
const publishedUrl = process.env.FLAGSHIP_PUBLISHED_URL;
const published = Boolean(publishedUrl);
const publishedTarget = published ? new URL(publishedUrl) : null;
if (published && !["http:", "https:"].includes(publishedTarget.protocol))
  throw Error("FLAGSHIP_PUBLISHED_URL must use HTTP(S).");
if (!reanalyzeReport) await mkdir(output, { recursive: false });

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rootHead = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const verifierBytes = await readFile(new URL(import.meta.url));
const verifierSha256 = sha256(verifierBytes);
const verifierHelperPath = "scripts/lib/flagship-platforms-verifier.mjs";
const verifierHelperSha256 = sha256(
  await readFile(resolve(verifierHelperPath)),
);
const verifierDirty = Boolean(
  execFileSync(
    "git",
    [
      "status",
      "--short",
      "--untracked-files=no",
      "--",
      "scripts/verify-flagship-platforms.mjs",
    ],
    { encoding: "utf8" },
  ).trim(),
);
const startedAt = new Date().toISOString();
const zipBytes = await readFile(zipPath);
const files = unzipSync(zipBytes);
const projectBytes = files["project.json"];
const runtimeBytes = files["runtime.js"];
const runtimeCssBytes = files["runtime.css"];
if (!projectBytes || !runtimeBytes || !runtimeCssBytes)
  throw Error(
    "Flagship ZIP is missing project.json, runtime.js, or runtime.css.",
  );
const project = JSON.parse(strFromU8(projectBytes));
const platforms = project.entities.filter(
  (entity) =>
    entity.stage === "ready" &&
    entity.behavior?.type === "move" &&
    entity.geometry?.kind === "asset",
);
assert.equal(
  platforms.length,
  3,
  "Expected exactly three moving catalog platforms.",
);
assert.equal(
  new Set(platforms.map((entity) => entity.id)).size,
  3,
  "Moving platform IDs must be unique.",
);
const selectedPlatformId = process.env.FLAGSHIP_PLATFORM_ID;
if (
  selectedPlatformId &&
  !platforms.some((entity) => entity.id === selectedPlatformId)
)
  throw Error(`Unknown flagship platform ID ${selectedPlatformId}.`);
const selectedPlatforms = selectedPlatformId
  ? platforms.filter((entity) => entity.id === selectedPlatformId)
  : platforms;
for (const entity of platforms) {
  if (entity.parentId !== undefined || entity.rotation !== undefined)
    throw Error(
      `Unsupported source-contact transform for ${entity.id}: expected an unparented, unrotated entity.`,
    );
  if (entity.behavior.axis === "y")
    throw Error(
      `Unsupported source-contact motion for ${entity.id}: Y-moving platforms require a runtime clock transform.`,
    );
}
const catalogManifest = JSON.parse(
  (await readFile(resolve("assets/catalog/manifest.json"))).toString("utf8"),
);
const catalogAssets = new Map(
  catalogManifest.assets.map((asset) => [asset.id, asset]),
);
for (const entity of platforms) {
  const assetId = entity.geometry.assetId;
  if (!catalogAssets.has(assetId))
    throw Error(`Missing local catalog metadata for ${assetId}.`);
}

if (reanalyzeReport) {
  const retained = JSON.parse(
    (await readFile(resolve(reanalyzeReport))).toString("utf8"),
  );
  for (const run of retained.runs ?? []) {
    const entity = platforms.find((candidate) => candidate.id === run.id);
    if (!entity) continue;
    run.analysis = carryAnalysis(
      [...(run.landedAt ? [run.landedAt] : []), ...(run.carrySamples ?? [])],
      entity,
    );
    run.status = run.analysis.carried ? "passed" : "failed";
    if (run.status === "passed") delete run.failure;
    else
      run.failure =
        "The bounded jump/release run did not produce rendered landing and carry displacement evidence.";
  }
  retained.analysisUpdatedAt = new Date().toISOString();
  retained.status =
    retained.runs?.length === 3 &&
    retained.runs.every((run) => run.status === "passed")
      ? "passed"
      : "failed";
  await writeFile(resolve(reanalyzeReport), JSON.stringify(retained, null, 2));
  console.log(JSON.stringify(retained, null, 2));
  process.exitCode = retained.status === "passed" ? 0 : 1;
  process.exit();
}

let standaloneServer;
let standaloneOrigin;
const targetOrigin = publishedTarget?.origin;
const serverRequests = [];
if (!published) {
  standaloneServer = createServer((request, response) => {
    const normalized = posixPath.normalize(
      new URL(request.url ?? "/", "http://snapshot.local").pathname.slice(1),
    );
    const pathname = normalized === "." ? "index.html" : normalized;
    if (pathname.startsWith("../") || pathname === "..") {
      response.writeHead(400).end();
      return;
    }
    const bytes = files[pathname];
    if (!bytes) {
      response.writeHead(404).end();
      return;
    }
    serverRequests.push({ method: request.method, pathname });
    const extension = pathname.split(".").pop();
    response.setHeader(
      "Content-Type",
      {
        css: "text/css",
        glb: "model/gltf-binary",
        html: "text/html",
        js: "text/javascript",
        json: "application/json",
        mjs: "text/javascript",
        png: "image/png",
        wasm: "application/wasm",
      }[extension] ?? "application/octet-stream",
    );
    response.writeHead(200);
    if (request.method !== "HEAD") response.end(bytes);
    else response.end();
  });
  await new Promise((resolveServer, rejectServer) => {
    standaloneServer.once("error", rejectServer);
    standaloneServer.listen(0, "127.0.0.1", resolveServer);
  });
  standaloneOrigin = `http://127.0.0.1:${standaloneServer.address().port}`;
}

const report = {
  status: "running",
  mode: published
    ? sequential
      ? "published-flagship-desktop-platform-sequential-landing-carry"
      : "published-flagship-desktop-platform-landing-carry"
    : sequential
      ? "saved-openrouter-flagship-desktop-platform-sequential-landing-carry"
      : "saved-openrouter-flagship-desktop-platform-landing-carry",
  provider: "openrouter",
  liveProvider: false,
  startedAt,
  finishedAt: null,
  repoHead: rootHead,
  verifier: {
    path: "scripts/verify-flagship-platforms.mjs",
    sha256: verifierSha256,
    dirty: verifierDirty,
    helperPath: verifierHelperPath,
    helperSha256: verifierHelperSha256,
  },
  zip: {
    path: zipPath,
    sha256: sha256(zipBytes),
    bytes: zipBytes.byteLength,
    projectSha256: sha256(projectBytes),
    runtimeSha256: sha256(runtimeBytes),
    runtimeCssSha256: sha256(runtimeCssBytes),
    projectId: project.id,
    projectRevision: project.revision,
    title: project.title,
  },
  runtime: {
    runtimeSha256: sha256(runtimeBytes),
    runtimeBytes: runtimeBytes.byteLength,
    runtimeCssSha256: sha256(runtimeCssBytes),
    runtimeCssBytes: runtimeCssBytes.byteLength,
  },
  platforms: platforms.map((entity) => ({
    id: entity.id,
    label: entity.label,
    position: entity.position,
    scale: entity.scale,
    geometry: entity.geometry,
    behavior: entity.behavior,
    collisionSource: {
      gameplay: "src/lib/gameplay.ts platformTop/isInsidePlatform",
      playerHalfHeight: PLAYER_HALF_HEIGHT,
      catalogAssetId: entity.geometry.assetId,
      catalogBounds: catalogAssets.get(entity.geometry.assetId).bounds,
    },
  })),
  selectedPlatformIds: selectedPlatforms.map((entity) => entity.id),
  sequential,
  driverExperiments: 0,
  maxDriverExperiments: sequential ? 1 : selectedPlatforms.length,
  inferenceCalls: 0,
  externalRequests: [],
  mutatingRequests: [],
  blockedRequests: [],
  pageErrors: [],
  publicRequests: [],
  serverRequests,
  runs: [],
};

const desktopViewport = { width: 1440, height: 1000 };
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

function publishableProject(projectSnapshot) {
  const copy = JSON.parse(JSON.stringify(projectSnapshot));
  delete copy.id;
  delete copy.revision;
  delete copy.messages;
  return copy;
}

async function readPublishedAsset(pathname) {
  const response = await fetch(new URL(pathname, publishedTarget), {
    redirect: "error",
  });
  if (!response.ok)
    throw Error(`Published ${pathname} HTTP ${response.status}.`);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    status: response.status,
  };
}

function geometryBounds(geometry) {
  const box = geometry.boundingBox;
  if (
    box &&
    Number.isFinite(box.min.x) &&
    Number.isFinite(box.min.y) &&
    Number.isFinite(box.min.z) &&
    Number.isFinite(box.max.x) &&
    Number.isFinite(box.max.y) &&
    Number.isFinite(box.max.z)
  )
    return {
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
    };
  const position = geometry.getAttribute?.("position");
  if (!position || !position.count) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < position.count; index++) {
    min[0] = Math.min(min[0], position.getX(index));
    min[1] = Math.min(min[1], position.getY(index));
    min[2] = Math.min(min[2], position.getZ(index));
    max[0] = Math.max(max[0], position.getX(index));
    max[1] = Math.max(max[1], position.getY(index));
    max[2] = Math.max(max[2], position.getZ(index));
  }
  return { min, max };
}

function makeInitScript() {
  return () => {
    const observed = [];
    const seenScenes = new WeakSet();
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const scene = event.detail;
      if (scene?.isScene && !seenScenes.has(scene)) {
        seenScenes.add(scene);
        observed.push(scene);
      }
    });

    const localBounds = (geometry) => {
      const box = geometry.boundingBox;
      if (
        box &&
        [
          box.min.x,
          box.min.y,
          box.min.z,
          box.max.x,
          box.max.y,
          box.max.z,
        ].every(Number.isFinite)
      )
        return {
          min: [box.min.x, box.min.y, box.min.z],
          max: [box.max.x, box.max.y, box.max.z],
        };
      const position = geometry.getAttribute?.("position");
      if (!position || !position.count) return null;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let index = 0; index < position.count; index++) {
        const point = [
          position.getX(index),
          position.getY(index),
          position.getZ(index),
        ];
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], point[axis]);
          max[axis] = Math.max(max[axis], point[axis]);
        }
      }
      return { min, max };
    };
    const transform = (elements, point) => {
      const x = point[0],
        y = point[1],
        z = point[2];
      const w =
        elements[3] * x + elements[7] * y + elements[11] * z + elements[15];
      return [
        (elements[0] * x + elements[4] * y + elements[8] * z + elements[12]) /
          (w || 1),
        (elements[1] * x + elements[5] * y + elements[9] * z + elements[13]) /
          (w || 1),
        (elements[2] * x + elements[6] * y + elements[10] * z + elements[14]) /
          (w || 1),
      ];
    };
    const worldBounds = (elements, bounds) => {
      const points = [];
      for (const x of [bounds.min[0], bounds.max[0]])
        for (const y of [bounds.min[1], bounds.max[1]])
          for (const z of [bounds.min[2], bounds.max[2]])
            points.push(transform(elements, [x, y, z]));
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const point of points)
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], point[axis]);
          max[axis] = Math.max(max[axis], point[axis]);
        }
      return { min, max };
    };
    const center = (bounds) =>
      bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2);
    const scaleFromMatrix = (elements) => [
      Math.hypot(elements[0], elements[1], elements[2]),
      Math.hypot(elements[4], elements[5], elements[6]),
      Math.hypot(elements[8], elements[9], elements[10]),
    ];

    window.__orbReadWorld = () => {
      let playerMesh;
      const groups = new Map();
      for (const scene of observed)
        scene.traverse((object) => {
          if (object.geometry?.type === "CapsuleGeometry") playerMesh = object;
          if (!object.isMesh || !object.parent || !object.geometry) return;
          const bounds = localBounds(object.geometry);
          if (!bounds) return;
          const parent = object.parent;
          const key = parent.uuid;
          if (!groups.has(key)) {
            const matrix = parent.matrixWorld.elements;
            groups.set(key, {
              uuid: key,
              vertexCount:
                object.geometry.getAttribute?.("position")?.count ?? 0,
              localBounds: bounds,
              worldBounds: worldBounds(matrix, bounds),
              scale: scaleFromMatrix(matrix),
              childCount: parent.children.length,
            });
          }
        });
      const playerBounds = playerMesh
        ? (() => {
            const local = localBounds(playerMesh.geometry);
            return local
              ? worldBounds(playerMesh.matrixWorld.elements, local)
              : null;
          })()
        : null;
      return {
        observedScenes: observed.length,
        atPerformanceMs: performance.now(),
        player: playerBounds
          ? {
              visible: Boolean(
                playerMesh.parent?.visible && playerMesh.visible,
              ),
              bounds: playerBounds,
              center: center(playerBounds),
            }
          : null,
        groups: [...groups.values()],
      };
    };
  };
}

function dimensions(bounds) {
  return bounds.max.map((value, axis) => value - bounds.min[axis]);
}

function chooseCandidates(telemetry) {
  const candidates = telemetry.groups
    .map((candidate) => ({
      ...candidate,
      size: dimensions(candidate.worldBounds),
    }))
    .filter((candidate) => candidate.childCount >= 2);
  const remaining = new Set(candidates.map((candidate) => candidate.uuid));
  const mapping = {};
  for (const entity of platforms) {
    const expected = entity.scale;
    const asset = catalogAssets.get(entity.geometry.assetId);
    const ranked = [...remaining]
      .map((uuid) => candidates.find((candidate) => candidate.uuid === uuid))
      .filter(Boolean)
      .filter((candidate) =>
        renderedDimensionsMatchSource(candidate, entity, asset),
      )
      .map((candidate) => {
        const scaleError = candidate.scale.reduce(
          (sum, value, axis) => sum + Math.abs(value - expected[axis]),
          0,
        );
        const center = candidate.worldBounds.min.map(
          (value, axis) => (value + candidate.worldBounds.max[axis]) / 2,
        );
        const positionError = Math.hypot(
          center[0] - entity.position[0],
          center[2] - entity.position[2],
        );
        return { candidate, score: scaleError * 100 + positionError };
      })
      .sort((a, b) => a.score - b.score);
    if (!ranked[0]) return null;
    mapping[entity.id] = ranked[0].candidate.uuid;
    remaining.delete(ranked[0].candidate.uuid);
  }
  return mapping;
}

function platformView(telemetry, uuid) {
  const candidate = telemetry.groups.find((group) => group.uuid === uuid);
  if (!candidate) return null;
  const bounds = candidate.worldBounds;
  return {
    uuid,
    bounds,
    center: bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2),
    size: dimensions(bounds),
    top: bounds.max[1],
  };
}

function playerOnPlatform(player, platform) {
  if (!player || !platform) return false;
  const pb = player.bounds;
  const sb = platform.bounds;
  const platformHeight = sb.max[1] - sb.min[1];
  // Tie contact to observed mesh dimensions. A loose absolute y threshold can
  // call an airborne pass a landing.
  const verticalTolerance = Math.max(0.045, platformHeight * 2.5);
  const verticalGap = pb.min[1] - sb.max[1];
  const horizontalOverlap =
    pb.max[0] >= sb.min[0] &&
    pb.min[0] <= sb.max[0] &&
    pb.max[2] >= sb.min[2] &&
    pb.min[2] <= sb.max[2];
  return horizontalOverlap && Math.abs(verticalGap) <= verticalTolerance;
}

function movementKeys(dx, dz) {
  const inputX = Math.cos(0.5) * dx - Math.sin(0.5) * dz;
  const inputZ = Math.sin(0.5) * dx + Math.cos(0.5) * dz;
  const best = choices.reduce((a, b) =>
    a.x * inputX + a.z * inputZ > b.x * inputX + b.z * inputZ ? a : b,
  );
  return best.keys;
}

function compactTelemetry(sample, mapping) {
  const platformsSample = Object.fromEntries(
    platforms.map((entity) => {
      const view = platformView(sample, mapping[entity.id]);
      return [
        entity.id,
        view
          ? {
              atPerformanceMs: sample.atPerformanceMs,
              center: view.center,
              size: view.size,
              bounds: view.bounds,
              top: view.top,
            }
          : null,
      ];
    }),
  );
  return {
    atPerformanceMs: sample.atPerformanceMs,
    player: sample.player
      ? { center: sample.player.center, bounds: sample.player.bounds }
      : null,
    platforms: platformsSample,
  };
}

function carryAnalysis(samples, entity) {
  const platformSamples = samples
    .map((sample) => ({ sample, view: sample.platforms[entity.id] }))
    .map((entry, index) => ({ ...entry, index }))
    .filter(({ view }) => view);
  const onTop = platformSamples.filter(({ sample, view }) =>
    playerOnPlatform(sample.player, view),
  );
  const axis = entity.behavior.axis === "z" ? 2 : 0;
  const axisName = axis === 2 ? "z" : "x";
  const streaks = [];
  for (const entry of onTop) {
    const prior = streaks.at(-1);
    if (!prior || entry.index !== prior.at(-1).index + 1) streaks.push([entry]);
    else prior.push(entry);
  }
  let best = null;
  let bestStreak = [];
  for (const streak of streaks) {
    if (streak.length < 2) continue;
    const first = streak[0];
    let streakBest = null;
    let maximumError = 0;
    for (let index = 1; index < streak.length; index++) {
      const current = streak[index];
      const platformDelta = current.view.center[axis] - first.view.center[axis];
      const playerDelta =
        current.sample.player.center[axis] - first.sample.player.center[axis];
      const error = Math.abs(playerDelta - platformDelta);
      maximumError = Math.max(maximumError, error);
      const candidate = {
        fromPerformanceMs: first.sample.atPerformanceMs,
        toPerformanceMs: current.sample.atPerformanceMs,
        platformDelta,
        playerDelta,
        error,
        streakLength: streak.length,
      };
      if (
        !streakBest ||
        Math.abs(platformDelta) > Math.abs(streakBest.platformDelta)
      )
        streakBest = candidate;
    }
    if (streakBest) {
      streakBest.maximumErrorAcrossStreak = maximumError;
      if (
        !best ||
        Math.abs(streakBest.platformDelta) > Math.abs(best.platformDelta)
      ) {
        best = streakBest;
        bestStreak = streak;
      }
    }
  }
  const displacementThreshold = 0.08;
  const carried = Boolean(
    bestStreak.length >= 4 &&
    best &&
    Math.abs(best.platformDelta) >= displacementThreshold &&
    best.error <= Math.abs(best.platformDelta) * 0.28,
  );
  const landed = Math.max(...streaks.map((streak) => streak.length), 0) >= 2;
  return {
    axis: axisName,
    onTopSampleCount: onTop.length,
    maximumConsecutiveOnTopSampleStreak: Math.max(
      ...streaks.map((streak) => streak.length),
      0,
    ),
    totalSamples: samples.length,
    maximumPlatformDisplacement: best ? Math.abs(best.platformDelta) : 0,
    maximumPlayerDisplacement: best ? Math.abs(best.playerDelta) : 0,
    maximumDisplacementErrorAcrossChosenStreak:
      best?.maximumErrorAcrossStreak ?? null,
    comparison: best,
    landed,
    carried,
    disposition: carried
      ? "landed-and-carried"
      : landed
        ? "landed-without-carry-proof"
        : "no-rendered-landing-observed",
  };
}

async function runPlatform(page, entity, mapping, run, asset) {
  const held = new Set();
  const inputLog = [];
  const setKeys = async (keys, phase) => {
    const next = new Set(keys);
    for (const key of held)
      if (!next.has(key)) {
        await page.keyboard.up(key);
        held.delete(key);
      }
    for (const key of next)
      if (!held.has(key)) {
        await page.keyboard.down(key);
        held.add(key);
      }
    inputLog.push({
      atPerformanceMs: await page.evaluate(() => performance.now()),
      phase,
      keys: [...held],
    });
  };
  const release = async (phase) => setKeys([], phase);
  const read = () => page.evaluate(() => window.__orbReadWorld());
  const sample = async (phase) => {
    const raw = await read();
    const compact = compactTelemetry(raw, mapping);
    compact.phase = phase;
    return compact;
  };

  run.inputLog = inputLog;
  run.approachSamples = [];
  run.landingSamples = [];
  run.carrySamples = [];
  run.sourceContactModel = {
    gameplay: "src/lib/gameplay.ts platformTop/isInsidePlatform",
    assetId: asset.id,
    catalogBounds: asset.bounds,
    entityPosition: entity.position,
    entityScale: entity.scale,
    playerHalfHeight: PLAYER_HALF_HEIGHT,
  };
  await page.mouse.click(1100, 850);
  for (let step = 0; step < 180; step++) {
    const current = await sample("approach");
    run.approachSamples.push(current);
    const view = current.platforms[entity.id];
    if (!current.player || !view)
      throw Error(`Missing rendered telemetry for ${entity.id}.`);
    const dx = view.center[0] - current.player.center[0];
    const dz = view.center[2] - current.player.center[2];
    if (Math.hypot(dx, dz) <= 0.22) break;
    await setKeys(movementKeys(dx, dz), "approach");
    await page.waitForTimeout(55);
    if (step === 179)
      throw Error(
        `Could not approach ${entity.id} within the bounded driver window.`,
      );
  }
  await release("pre-jump-release");
  await page.waitForTimeout(70);
  const beforeJump = await sample("before-jump");
  run.beforeJump = beforeJump;
  await setKeys([" "], "jump");
  await page.waitForTimeout(80);
  await release("jump-release");

  let previousSample = beforeJump;
  let landedAt;
  let landingProof;
  for (let step = 0; step < 42; step++) {
    const current = await sample("jump");
    run.landingSamples.push(current);
    const evidence = sourceLandingEvidence(
      previousSample,
      current,
      entity,
      asset,
    );
    current.sourceContact = evidence.source
      ? {
          contactY: evidence.source.contactY,
          descending: evidence.descending,
          previousY: evidence.previousY,
          currentY: evidence.currentY,
          crossedContactHeight: evidence.crossedContactHeight,
          sourceOverlap: evidence.sourceOverlap,
          accepted: evidence.accepted,
        }
      : null;
    if (evidence.accepted) {
      landedAt = current;
      landingProof = {
        ...current.sourceContact,
        source: evidence.source,
      };
      await release("landing-release");
      break;
    }
    previousSample = current;
    const view = current.platforms[entity.id];
    if (current.player && view) {
      const dx = view.center[0] - current.player.center[0];
      const dz = view.center[2] - current.player.center[2];
      await setKeys(
        Math.hypot(dx, dz) > 0.12 ? movementKeys(dx, dz) : [],
        "airborne-correction",
      );
    }
    await page.waitForTimeout(45);
  }
  run.landedAt = landedAt ?? null;
  run.landingProof = landingProof ?? null;
  if (!landingProof)
    run.landingFailure = {
      reason:
        "No descending sample satisfied the source catalog contact-height crossing and source X/Z overlap criteria.",
      finalSample: run.landingSamples.at(-1)?.sourceContact ?? null,
    };
  await release("carry-release");
  for (let index = 0; index < 20; index++) {
    run.carrySamples.push(await sample("released-input"));
    await page.waitForTimeout(70);
  }
  run.inputReleasedBeforeCarrySampling = true;
  run.analysis = carryAnalysis(
    [...(landedAt ? [landedAt] : []), ...run.carrySamples],
    entity,
  );
  run.screenshot = `${entity.id}-released.png`;
  await page.screenshot({ path: join(output, run.screenshot) });
}

async function runSequentialPlatforms(page, ordered, mapping, run) {
  const held = new Set();
  const inputLog = [];
  const setKeys = async (keys, phase) => {
    const next = new Set(keys);
    for (const key of held)
      if (!next.has(key)) {
        await page.keyboard.up(key);
        held.delete(key);
      }
    for (const key of next)
      if (!held.has(key)) {
        await page.keyboard.down(key);
        held.add(key);
      }
    inputLog.push({
      atPerformanceMs: await page.evaluate(() => performance.now()),
      phase,
      keys: [...held],
    });
  };
  const release = async (phase) => setKeys([], phase);
  const read = () => page.evaluate(() => window.__orbReadWorld());
  const sample = async (phase) => {
    const compact = compactTelemetry(await read(), mapping);
    compact.phase = phase;
    return compact;
  };
  const groundContact = (sample) =>
    Boolean(sample.player && sample.player.center[1] <= 0.5);
  const sourceCarried = (sample, entity, asset) => {
    const rendered = sample.platforms[entity.id];
    const player = sample.player;
    const source = sourcePlatformContact(entity, rendered, asset);
    if (!player || !rendered || !source) return false;
    return (
      playerOnPlatform(player, rendered) &&
      Math.abs(player.center[1] - source.contactY) <= 0.1 &&
      Math.abs(player.center[0] - source.center[0]) <=
        source.halfX + CONTACT_HORIZONTAL_TOLERANCE &&
      Math.abs(player.center[2] - source.center[2]) <=
        source.halfZ + CONTACT_HORIZONTAL_TOLERANCE
    );
  };
  const recordSample = (samples, value) => {
    samples.push(value);
    if (groundContact(value)) run.groundContactSamples.push(value);
  };
  const releaseHeld = async () => {
    for (const key of held) await page.keyboard.up(key).catch(() => {});
    held.clear();
  };

  const execute = async () => {
    run.inputLog = inputLog;
    run.approachSamples = [];
    run.stages = [];
    run.groundContactSamples = [];
    run.groundContactSampling = {
      method: "rendered player telemetry sampled during jump and carry steps",
      jumpStepWaitMs: 45,
      carryStepWaitMs: 70,
      groundCenterYThreshold: 0.5,
      limitation:
        "No sampled telemetry can prove absence of ground contact between frames.",
    };
    run.sourceContactModel = ordered.map((entity) => ({
      id: entity.id,
      gameplay: "src/lib/gameplay.ts platformTop/isInsidePlatform",
      assetId: entity.geometry.assetId,
      catalogBounds: catalogAssets.get(entity.geometry.assetId).bounds,
      entityPosition: entity.position,
      entityScale: entity.scale,
      playerHalfHeight: PLAYER_HALF_HEIGHT,
    }));
    await page.mouse.click(1100, 850);

    const first = ordered[0];
    for (let step = 0; step < 180; step++) {
      const current = await sample("approach-platform-1");
      run.approachSamples.push(current);
      const view = current.platforms[first.id];
      if (!current.player || !view)
        throw Error(`Missing rendered telemetry for ${first.id}.`);
      const dx = view.center[0] - current.player.center[0];
      const dz = view.center[2] - current.player.center[2];
      if (Math.hypot(dx, dz) <= 0.22) break;
      await setKeys(movementKeys(dx, dz), "approach-platform-1");
      await page.waitForTimeout(55);
      if (step === 179)
        throw Error(
          `Could not approach ${first.id} within the bounded sequential driver window.`,
        );
    }
    await release("pre-jump-platform-1");
    await page.waitForTimeout(70);

    const waitForFavorableGap = async (carrier, target, stage) => {
      const carrierAsset = catalogAssets.get(carrier.geometry.assetId);
      const targetAsset = catalogAssets.get(target.geometry.assetId);
      const maxWaitMs = 5000;
      const pollMs = 70;
      const startedAtPerformanceMs = await page.evaluate(() =>
        performance.now(),
      );
      const baseReach = jumpReachModel({
        margin: DEFAULT_JUMP_REACH_MARGIN,
      });
      const targetMotionMargin = movingTargetMotionBound(
        target,
        baseReach.flightTime,
      );
      const wait = {
        carrierId: carrier.id,
        targetId: target.id,
        phase: `carried-${carrier.id}-before-jump-${target.id}`,
        status: "waiting",
        maxWaitMs,
        pollMs,
        startedAtPerformanceMs,
        reachModel: {
          ...jumpReachModel({
            margin: DEFAULT_JUMP_REACH_MARGIN,
            targetMotionMargin,
          }),
          moveSpeed: PLAYER_MOVE_SPEED,
          jumpSpeed: JUMP_SPEED,
          gravity: GRAVITY,
          note: "Derived from src/lib/gameplay.ts; base margin reserves sampling time and targetMotionMargin bounds target travel during flight.",
        },
        samples: [],
      };
      stage.favorableGapWait = wait;
      const deadline = Date.now() + maxWaitMs;
      let last;
      while (Date.now() <= deadline) {
        const current = await sample("favorable-gap-wait");
        const gap = horizontalGapToPlatform(
          current.player?.center,
          current.platforms[target.id],
          target,
          targetAsset,
          {
            margin: DEFAULT_JUMP_REACH_MARGIN,
            targetMotionMargin,
          },
        );
        const carried = sourceCarried(current, carrier, carrierAsset);
        const onGround = groundContact(current);
        last = {
          atPerformanceMs: current.atPerformanceMs,
          playerCenter: current.player?.center ?? null,
          carrierCenter: current.platforms[carrier.id]?.center ?? null,
          targetCenter: current.platforms[target.id]?.center ?? null,
          gap: gap?.gap ?? null,
          maxReach: gap?.maxTravel ?? null,
          reachable: gap?.reachable ?? false,
          carried,
          groundContact: onGround,
        };
        wait.samples.push(last);
        if (onGround) {
          run.groundContactSamples.push(current);
          wait.status = "failed-ground-contact";
          wait.final = last;
          throw Error(
            `Sequential favorable-gap wait reached ground before ${target.id}.`,
          );
        }
        if (!carried) {
          wait.status = "failed-carrier-lost";
          wait.final = last;
          throw Error(
            `Sequential favorable-gap wait lost carried support on ${carrier.id}.`,
          );
        }
        if (gap?.reachable) {
          wait.status = "ready";
          wait.final = last;
          wait.waitedMs = Math.max(
            0,
            current.atPerformanceMs - startedAtPerformanceMs,
          );
          return current;
        }
        await page.waitForTimeout(pollMs);
      }
      wait.status = "timeout";
      wait.final = last ?? null;
      wait.waitedMs = maxWaitMs;
      throw Error(
        `Sequential favorable-gap wait timed out before ${target.id}; ` +
          `gap ${last?.gap ?? "unknown"} exceeds reachable ${last?.maxReach ?? "unknown"}.`,
      );
    };

    const landAndCarry = async (entity, index) => {
      const asset = catalogAssets.get(entity.geometry.assetId);
      const stage = {
        id: entity.id,
        label: entity.label,
        behavior: entity.behavior,
        beforeJump: null,
        landingSamples: [],
        carrySamples: [],
      };
      run.stages.push(stage);
      if (index > 0)
        await waitForFavorableGap(ordered[index - 1], entity, stage);
      stage.beforeJump = await sample(`before-jump-${index + 1}`);
      const previousBeforeJump = stage.beforeJump;
      if (index === 0)
        run.firstTakeoff = {
          atPerformanceMs: await page.evaluate(() => performance.now()),
          from: entity.id,
        };
      await setKeys([" "], `jump-platform-${index + 1}`);
      await page.waitForTimeout(80);
      await release(`jump-release-platform-${index + 1}`);
      let previousSample = previousBeforeJump;
      let landedAt;
      let landingProof;
      for (let step = 0; step < 42; step++) {
        const current = await sample(`jump-platform-${index + 1}`);
        recordSample(stage.landingSamples, current);
        const evidence = sourceLandingEvidence(
          previousSample,
          current,
          entity,
          asset,
        );
        current.sourceContact = evidence.source
          ? {
              contactY: evidence.source.contactY,
              descending: evidence.descending,
              previousY: evidence.previousY,
              currentY: evidence.currentY,
              crossedContactHeight: evidence.crossedContactHeight,
              sourceOverlap: evidence.sourceOverlap,
              accepted: evidence.accepted,
            }
          : null;
        if (evidence.accepted) {
          landedAt = current;
          landingProof = {
            ...current.sourceContact,
            source: evidence.source,
          };
          await release(`landing-release-platform-${index + 1}`);
          break;
        }
        previousSample = current;
        const view = current.platforms[entity.id];
        if (current.player && view) {
          const dx = view.center[0] - current.player.center[0];
          const dz = view.center[2] - current.player.center[2];
          await setKeys(
            Math.hypot(dx, dz) > 0.12 ? movementKeys(dx, dz) : [],
            `airborne-correction-platform-${index + 1}`,
          );
        }
        await page.waitForTimeout(45);
      }
      stage.landedAt = landedAt ?? null;
      stage.landingProof = landingProof ?? null;
      if (!landingProof)
        throw Error(
          `Sequential route did not land on ${entity.id} from the prior platform.`,
        );

      await release(`carry-release-platform-${index + 1}`);
      for (let sampleIndex = 0; sampleIndex < 8; sampleIndex++) {
        recordSample(
          stage.carrySamples,
          await sample(`carry-platform-${index + 1}`),
        );
        await page.waitForTimeout(70);
      }
      stage.inputReleasedBeforeCarrySampling = true;
      stage.analysis = carryAnalysis(
        [stage.landedAt, ...stage.carrySamples],
        entity,
      );
      if (!stage.analysis.carried)
        throw Error(
          `Sequential route landed on ${entity.id} but did not prove rendered carry displacement.`,
        );
      stage.status = "passed";
    };

    for (let index = 0; index < ordered.length; index++)
      await landAndCarry(ordered[index], index);
    run.finalLanding = run.stages.at(-1).landingProof;
    run.noGroundContactObserved = run.groundContactSamples.length === 0;
    if (!run.noGroundContactObserved)
      throw Error(
        `Sequential route observed ground contact in ${run.groundContactSamples.length} sampled frame(s) after the first takeoff.`,
      );
    run.screenshot = "sequential-platform-route.png";
    await page.screenshot({ path: join(output, run.screenshot) });
  };
  try {
    await execute();
  } finally {
    await releaseHeld();
  }
}

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});

try {
  if (published) {
    const [publishedProjectAsset, publishedRuntimeAsset, publishedCssAsset] =
      await Promise.all([
        readPublishedAsset("project.json"),
        readPublishedAsset("runtime.js"),
        readPublishedAsset("runtime.css"),
      ]);
    let publishedProject;
    try {
      publishedProject = JSON.parse(strFromU8(publishedProjectAsset.bytes));
      assert.deepEqual(
        publishableProject(publishedProject),
        publishableProject(project),
      );
    } catch {
      throw Error(
        "Published project snapshot differs from the flagship source after ignoring only id, revision, and messages.",
      );
    }
    report.published = {
      url: publishedTarget.href,
      projectId: publishedProject.id,
      projectRevision: publishedProject.revision,
      snapshotComparison: {
        passed: true,
        ignoredFields: ["id", "revision", "messages"],
      },
      servedRuntime: {
        projectJson: {
          status: publishedProjectAsset.status,
          sha256: sha256(publishedProjectAsset.bytes),
        },
        runtimeJs: {
          status: publishedRuntimeAsset.status,
          sha256: sha256(publishedRuntimeAsset.bytes),
          bytes: publishedRuntimeAsset.bytes.byteLength,
        },
        runtimeCss: {
          status: publishedCssAsset.status,
          sha256: sha256(publishedCssAsset.bytes),
          bytes: publishedCssAsset.bytes.byteLength,
        },
      },
    };
  }
  const context = await browser.newContext({
    viewport: desktopViewport,
    recordVideo: { dir: output },
  });
  await context.addInitScript(makeInitScript());
  await context.route("**/*", async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    if (target.pathname === "/api/generate") report.inferenceCalls++;
    const allowedOrigin = published ? targetOrigin : standaloneOrigin;
    if (published)
      report.publicRequests.push({
        method: request.method(),
        pathname: target.pathname,
      });
    if (target.origin !== allowedOrigin) {
      report.externalRequests.push(request.url());
      return route.abort();
    }
    if (!["GET", "HEAD"].includes(request.method())) {
      report.mutatingRequests.push(`${request.method()} ${request.url()}`);
      return route.abort();
    }
    if (published && target.pathname.startsWith("/api/")) {
      report.blockedRequests.push(`${request.method()} ${target.pathname}`);
      return route.abort();
    }
    return route.fallback();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.goto(published ? publishedTarget.href : standaloneOrigin);
  await expect(page.locator('main[data-ready="true"]')).toBeVisible({
    timeout: 30000,
  });
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__orbReadWorld())).player?.visible,
    )
    .toBe(true);
  let initial;
  let mapping;
  await expect
    .poll(
      async () => {
        initial = await page.evaluate(() => window.__orbReadWorld());
        mapping = chooseCandidates(initial);
        return mapping ? Object.keys(mapping).length : 0;
      },
      { timeout: 30000 },
    )
    .toBe(3);
  report.renderedPlatformMapping = mapping;
  report.initialRenderedTelemetry = compactTelemetry(initial, mapping);
  if (sequential) {
    if (selectedPlatforms.length !== 3)
      throw Error(
        "Sequential mode requires all three moving platforms; omit FLAGSHIP_PLATFORM_ID.",
      );
    report.driverExperiments++;
    const run = {
      id: "sequential-platform-route",
      label: "Moving platforms 1 → 2 → 3",
      platformIds: selectedPlatforms.map((entity) => entity.id),
      viewport: desktopViewport,
      inputMethod: "desktop keyboard",
      mappingUuid: mapping,
      status: "running",
    };
    report.runs.push(run);
    try {
      await runSequentialPlatforms(page, selectedPlatforms, mapping, run);
      run.status = run.noGroundContactObserved ? "passed" : "failed";
    } catch (error) {
      run.status = "failed";
      run.failure = String(error).slice(0, 2000);
    }
  } else
    for (const entity of selectedPlatforms) {
      const asset = catalogAssets.get(entity.geometry.assetId);
      report.driverExperiments++;
      const run = {
        id: entity.id,
        label: entity.label,
        behavior: entity.behavior,
        geometrySource: entity.geometry,
        viewport: desktopViewport,
        inputMethod: "desktop keyboard",
        mappingUuid: mapping[entity.id],
        status: "running",
      };
      report.runs.push(run);
      try {
        await runPlatform(page, entity, mapping, run, asset);
        run.status = run.analysis.carried ? "passed" : "failed";
        if (!run.analysis.carried)
          run.failure =
            "The bounded jump/release run did not produce rendered landing and carry displacement evidence.";
      } catch (error) {
        run.status = "failed";
        run.failure = String(error).slice(0, 2000);
      }
      // Fresh page state for the next platform; this keeps each jump independent
      // while retaining the same immutable ZIP bytes and runtime.
      if (entity !== selectedPlatforms.at(-1)) {
        await page.reload();
        await expect(page.locator('main[data-ready="true"]')).toBeVisible({
          timeout: 30000,
        });
        await expect
          .poll(
            async () =>
              (await page.evaluate(() => window.__orbReadWorld())).player
                ?.visible,
          )
          .toBe(true);
        await expect
          .poll(
            async () => {
              const current = await page.evaluate(() =>
                window.__orbReadWorld(),
              );
              const nextMapping = chooseCandidates(current);
              if (nextMapping) mapping = nextMapping;
              return nextMapping ? 3 : 0;
            },
            { timeout: 30000 },
          )
          .toBe(3);
      }
    }
  await context.close();
} catch (error) {
  report.failure = String(error).slice(0, 2000);
} finally {
  await browser.close();
  if (standaloneServer)
    await new Promise((resolveServer) => standaloneServer.close(resolveServer));
  report.finishedAt = new Date().toISOString();
  report.status =
    !report.failure &&
    report.driverExperiments === (sequential ? 1 : selectedPlatforms.length) &&
    report.runs.length === (sequential ? 1 : selectedPlatforms.length) &&
    report.runs.every((run) => run.status === "passed") &&
    report.inferenceCalls === 0 &&
    report.externalRequests.length === 0 &&
    report.mutatingRequests.length === 0 &&
    report.blockedRequests.length === 0 &&
    report.pageErrors.length === 0
      ? "passed"
      : "failed";
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
}

console.log(JSON.stringify(report, null, 2));
if (report.status !== "passed") process.exitCode = 1;
