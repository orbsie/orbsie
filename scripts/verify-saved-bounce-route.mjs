#!/usr/bin/env node
// Desktop-only acceptance for a saved moving-bounce world.
// The ZIP is served byte-for-byte from a local read-only HTTP snapshot. The
// driver uses real keyboard events and rendered Three.js telemetry; it never
// writes project/player state or calls a provider/model.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { posix as posixPath, resolve, join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import {
  PLAYER_HALF_HEIGHT,
  renderedDimensionsMatchSource,
  sourcePlatformContact,
} from "./lib/flagship-platforms-verifier.mjs";
import {
  bounceStageTransition,
  groundSamplesAfter,
  jumpDownEventsAfter,
  platformFootprintSteeringNeeded,
  PLATFORM_INTERCEPT_MARGIN,
  sequentialRouteAnalysis,
  runtimePlayerCenter,
} from "./lib/saved-bounce-route.mjs";
import { validateProjectGame } from "./lib/winning-traversal-contract.mjs";

const sourceName = process.env.SAVED_BOUNCE_ROUTE_SOURCE ?? "openrouter";
const sourceContracts = {
  openrouter: {
    label: "OpenRouter moving-bounce world",
    zip: "docs/evidence/provider-e2e/openrouter-moving-bounce-guidance/openrouter/world.zip",
    zipSha256:
      "70595a54bb59116fd4e7519e2d47e18190361d3fc9e161fc499b70e6f5f112b4",
    projectId: null,
    revision: null,
    platformIds: ["platform1", "platform2", "platform3"],
    preRouteCollectibleIds: ["crystal1", "crystal2", "crystal3", "crystal4"],
    preRouteJumpCollectibleIds: new Set(["crystal4"]),
    postBounceCollectibleId: "crystal5",
    expectedCollectibleCount: 5,
  },
  "gateway-current-seven": {
    label: "Gateway current seven collectible moving-bounce world",
    zip: "docs/evidence/provider-e2e/gateway-captured-offline/gateway/world-goal-7.zip",
    zipSha256:
      "33ed9d40916776583a1246701901d40247fd5712358d4c4a790cbeaff8e0668a",
    projectId: "d8d48be6-dae2-4531-a7cb-77e8906b4c75",
    revision: 37,
    platformIds: ["platform-1", "platform-2", "platform-3"],
    // Ground crystals and the two low elevated pickups are collected before
    // the bounce route. Crystal-3 is high enough to require the route.
    preRouteCollectibleIds: [
      "crystal-1",
      "crystal-2",
      "crystal-4",
      "crystal-5",
      "crystal-6",
      "crystal-7",
    ],
    preRouteJumpCollectibleIds: new Set(["crystal-2", "crystal-4"]),
    postBounceCollectibleId: "crystal-3",
    expectedCollectibleCount: 7,
  },
};
const source = sourceContracts[sourceName];
if (!source) {
  throw Error(
    `Unknown SAVED_BOUNCE_ROUTE_SOURCE ${sourceName}; expected ${Object.keys(sourceContracts).join(", ")}.`,
  );
}
const zipPath = resolve(process.env.SAVED_BOUNCE_ROUTE_ZIP ?? source.zip);
const requiredZipSha256 = source.zipSha256;
const output = resolve(
  process.argv[2] ?? "docs/evidence/saved-bounce-route-desktop",
);
const appSourceCommit = process.env.ORBSIE_APP_SOURCE_COMMIT?.trim() || null;
const desktopViewport = { width: 1440, height: 1000 };
const platformIds = source.platformIds;
const assetManifestPath = "assets/catalog/manifest.json";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const rootHead = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();

const zipBytes = await readFile(zipPath);
const zipSha256 = sha256(zipBytes);
assert.equal(
  zipSha256,
  requiredZipSha256,
  `Saved route ZIP changed: expected ${requiredZipSha256}, got ${zipSha256}.`,
);
const files = unzipSync(zipBytes);
const projectBytes = files["project.json"];
const runtimeBytes = files["runtime.js"];
const runtimeCssBytes = files["runtime.css"];
const indexBytes = files["index.html"];
assert(projectBytes && runtimeBytes && runtimeCssBytes && indexBytes);
const project = JSON.parse(strFromU8(projectBytes));
const catalogManifest = JSON.parse(
  (await readFile(resolve(assetManifestPath))).toString("utf8"),
);
const catalogAssets = new Map(
  catalogManifest.assets.map((asset) => [asset.id, asset]),
);
const contract = validateProjectGame(project, {
  expectedCollectibleCount: source.expectedCollectibleCount,
  portalComparison: "gte",
});
assert.equal(project.id, source.projectId ?? project.id);
assert.equal(project.revision, source.revision ?? project.revision);
const platforms = platformIds.map((id) => {
  const entity = project.entities.find((candidate) => candidate.id === id);
  assert(entity, `Missing saved route entity ${id}.`);
  assert.equal(
    entity.behavior?.type,
    "bounce",
    `${id} must remain a bounce platform.`,
  );
  assert.equal(entity.geometry?.kind, "asset");
  assert(catalogAssets.has(entity.geometry.assetId));
  return entity;
});
for (const id of platformIds) {
  const pathRules = project.game.rules.filter((rule) =>
    rule.actions?.some(
      (action) => action.type === "move_path" && action.entityId === id,
    ),
  );
  assert.equal(
    pathRules.length,
    1,
    `${id} must have one start move_path rule.`,
  );
  assert.equal(pathRules[0].trigger?.type, "start");
}

function contentType(pathname) {
  return (
    {
      css: "text/css",
      glb: "model/gltf-binary",
      html: "text/html",
      js: "text/javascript",
      json: "application/json",
      mjs: "text/javascript",
      png: "image/png",
      wasm: "application/wasm",
    }[pathname.split(".").pop()] ?? "application/octet-stream"
  );
}

function localBounds(geometry) {
  const box = geometry.boundingBox;
  if (
    box &&
    [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(
      Number.isFinite,
    )
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
}

function makeTelemetryInitScript() {
  return () => {
    const observed = [];
    const seenScenes = new WeakSet();
    const keyEvents = [];
    const inputEvents = [];
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      const scene = event.detail;
      if (scene?.isScene && !seenScenes.has(scene)) {
        seenScenes.add(scene);
        observed.push(scene);
      }
    });
    window.addEventListener("keydown", (event) => {
      if (keyEvents.length < 512)
        keyEvents.push({
          type: "down",
          key: event.key,
          atPerformanceMs: performance.now(),
        });
    });
    window.addEventListener("keyup", (event) => {
      if (keyEvents.length < 512)
        keyEvents.push({
          type: "up",
          key: event.key,
          atPerformanceMs: performance.now(),
        });
    });
    window.addEventListener("orbsie-input", (event) => {
      if (inputEvents.length < 512)
        inputEvents.push({
          key: event.detail?.key,
          down: Boolean(event.detail?.down),
          pointerId: event.detail?.pointerId,
          atPerformanceMs: performance.now(),
        });
    });

    const transform = (elements, point) => {
      const [x, y, z] = point;
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
          const bounds = (() => {
            const box = object.geometry.boundingBox;
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
            const position = object.geometry.getAttribute?.("position");
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
          })();
          if (!bounds) return;
          const parent = object.parent;
          const key = parent.uuid;
          if (!groups.has(key)) {
            const matrix = parent.matrixWorld.elements;
            groups.set(key, {
              uuid: key,
              runtimeMatrix: Array.from(parent.matrix.elements),
              worldMatrix: Array.from(matrix),
              worldBounds: worldBounds(matrix, bounds),
              localBounds: bounds,
              scale: scaleFromMatrix(parent.matrix.elements),
              childCount: parent.children.length,
            });
          }
        });
      const playerBounds = playerMesh
        ? (() => {
            const bounds = (() => {
              const box = playerMesh.geometry.boundingBox;
              if (!box) playerMesh.geometry.computeBoundingBox();
              const next = playerMesh.geometry.boundingBox;
              return next
                ? {
                    min: [next.min.x, next.min.y, next.min.z],
                    max: [next.max.x, next.max.y, next.max.z],
                  }
                : null;
            })();
            return bounds
              ? worldBounds(playerMesh.matrixWorld.elements, bounds)
              : null;
          })()
        : null;
      const playerRuntimeBounds = playerMesh?.parent
        ? (() => {
            const bounds = (() => {
              const box = playerMesh.geometry.boundingBox;
              if (!box) playerMesh.geometry.computeBoundingBox();
              const next = playerMesh.geometry.boundingBox;
              return next
                ? {
                    min: [next.min.x, next.min.y, next.min.z],
                    max: [next.max.x, next.max.y, next.max.z],
                  }
                : null;
            })();
            return bounds
              ? worldBounds(playerMesh.parent.matrix.elements, bounds)
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
              runtimeBounds: playerRuntimeBounds,
              runtimeCenter: playerRuntimeBounds
                ? center(playerRuntimeBounds)
                : null,
            }
          : null,
        groups: [...groups.values()],
        keyEvents: [...keyEvents],
        inputEvents: [...inputEvents],
      };
    };
  };
}

function dimensions(bounds) {
  return bounds.max.map((value, axis) => value - bounds.min[axis]);
}

function chooseMapping(telemetry) {
  const candidates = telemetry.groups
    .filter((candidate) => candidate.childCount >= 2)
    .map((candidate) => ({
      ...candidate,
      size: dimensions(candidate.worldBounds),
    }));
  const remaining = new Set(candidates.map((candidate) => candidate.uuid));
  const mapping = {};
  for (const entity of platforms) {
    const asset = catalogAssets.get(entity.geometry.assetId);
    const ranked = [...remaining]
      .map((uuid) => candidates.find((candidate) => candidate.uuid === uuid))
      .filter(Boolean)
      .filter((candidate) =>
        renderedDimensionsMatchSource(candidate, entity, asset),
      )
      .map((candidate) => {
        const center = candidate.worldBounds.min.map(
          (value, axis) => (value + candidate.worldBounds.max[axis]) / 2,
        );
        return {
          candidate,
          score: Math.hypot(
            center[0] - entity.position[0],
            center[2] - entity.position[2],
          ),
        };
      })
      .sort((a, b) => a.score - b.score);
    if (!ranked[0]) return null;
    mapping[entity.id] = ranked[0].candidate.uuid;
    remaining.delete(ranked[0].candidate.uuid);
  }
  return mapping;
}

function platformView(telemetry, uuid) {
  const group = telemetry.groups.find((candidate) => candidate.uuid === uuid);
  if (!group) return null;
  const bounds = group.worldBounds;
  return {
    uuid,
    runtimeMatrix: group.runtimeMatrix,
    worldMatrix: group.worldMatrix,
    bounds,
    center: bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2),
    size: dimensions(bounds),
    top: bounds.max[1],
  };
}

function compactTelemetry(telemetry, mapping) {
  return {
    atPerformanceMs: telemetry.atPerformanceMs,
    player: telemetry.player
      ? {
          visible: telemetry.player.visible,
          center: telemetry.player.center,
          bounds: telemetry.player.bounds,
          runtimeCenter: telemetry.player.runtimeCenter,
          runtimeBounds: telemetry.player.runtimeBounds,
        }
      : null,
    platforms: Object.fromEntries(
      platforms.map((entity) => {
        const view = platformView(telemetry, mapping[entity.id]);
        return [
          entity.id,
          view
            ? {
                runtimeMatrix: view.runtimeMatrix,
                worldMatrix: view.worldMatrix,
                center: view.center,
                size: view.size,
                bounds: view.bounds,
                top: view.top,
              }
            : null,
        ];
      }),
    ),
    keyEvents: telemetry.keyEvents ?? [],
    inputEvents: telemetry.inputEvents ?? [],
  };
}

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

function movementKeys(dx, dz) {
  const inputX = Math.cos(0.5) * dx - Math.sin(0.5) * dz;
  const inputZ = Math.sin(0.5) * dx + Math.cos(0.5) * dz;
  return choices.reduce((best, candidate) =>
    best.x * inputX + best.z * inputZ >
    candidate.x * inputX + candidate.z * inputZ
      ? best
      : candidate,
  ).keys;
}

function targetPosition(entity) {
  return [entity.position[0], entity.position[2]];
}

const report = {
  status: "running",
  scope: `Saved ${source.label}, desktop keyboard only; pre-route collectibles followed by moving bounce ${platformIds.join(" → ")}, ${source.postBounceCollectibleId}, portal win, and reset when physically reached.`,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  repoHead: rootHead,
  source: sourceName,
  appSourceCommit,
  sourceCommits: {
    repoHead: rootHead,
    appSourceAssumedFromRepoHead: appSourceCommit === null,
  },
  zip: {
    path: zipPath,
    sha256: zipSha256,
    requiredSha256: requiredZipSha256,
    bytes: zipBytes.byteLength,
    projectSha256: sha256(projectBytes),
    runtimeSha256: sha256(runtimeBytes),
    runtimeCssSha256: sha256(runtimeCssBytes),
    projectId: project.id,
    projectRevision: project.revision,
    title: project.title,
  },
  contract: {
    ...contract,
    expectedScore: contract.expectedScore,
  },
  platforms: platforms.map((entity) => ({
    id: entity.id,
    label: entity.label,
    position: entity.position,
    scale: entity.scale,
    geometry: entity.geometry,
    behavior: entity.behavior,
    sourceContact: {
      gameplay: "src/lib/gameplay.ts platformTop/isInsidePlatform",
      runtimePose:
        "Formation group local runtime matrix; Player local runtime center",
      playerHalfHeight: PLAYER_HALF_HEIGHT,
      catalogBounds: catalogAssets.get(entity.geometry.assetId).bounds,
    },
  })),
  inputMethod: "desktop keyboard",
  attemptedBrowserSessions: 1,
  modelCalls: 0,
  inferenceCalls: 0,
  externalRequests: [],
  serverRequests: [],
  blockedRequests: [],
  mutatingRequests: [],
  pageErrors: [],
  checks: {
    savedZipHash: true,
    projectGameContract: true,
    exactlyThreeMovingBouncePlatforms: true,
    focusedHelperRegressions: true,
  },
  runs: [],
  output,
};

await mkdir(output, { recursive: false });
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const standaloneServer = createServer((request, response) => {
  const normalized = posixPath.normalize(
    new URL(request.url ?? "/", "http://saved-route.local").pathname.slice(1),
  );
  const pathname = normalized === "." ? "index.html" : normalized;
  if (pathname.startsWith("../") || pathname === "..") {
    response.writeHead(400).end();
    return;
  }
  const bytes = files[pathname];
  report.serverRequests.push({ method: request.method, pathname });
  if (!bytes) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": contentType(pathname),
    "Cache-Control": "no-store",
  });
  if (request.method === "HEAD") response.end();
  else response.end(bytes);
});
await new Promise((resolveServer, rejectServer) => {
  standaloneServer.once("error", rejectServer);
  standaloneServer.listen(0, "127.0.0.1", resolveServer);
});
const standaloneOrigin = `http://127.0.0.1:${standaloneServer.address().port}`;
report.url = standaloneOrigin;

let context;
let page;
let mapping;
let allSamples = [];
let held = new Set();
let inputLog = [];
let firstTakeoffAt = null;
let failure;
const releaseHeld = async () => {
  if (!page) return;
  for (const key of held) await page.keyboard.up(key).catch(() => {});
  held.clear();
};

try {
  context = await browser.newContext({
    viewport: desktopViewport,
    reducedMotion: "reduce",
    recordVideo: { dir: output, size: desktopViewport },
  });
  await context.route("**/*", async (route) => {
    const target = new URL(route.request().url());
    if (target.origin === standaloneOrigin || target.protocol === "data:")
      return route.fallback();
    report.externalRequests.push(target.href);
    report.blockedRequests.push({
      url: target.href,
      method: route.request().method(),
    });
    return route.abort();
  });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.addInitScript(makeTelemetryInitScript());
  await page.goto(standaloneOrigin);
  await expect(page.locator("main[data-ready=true]")).toBeVisible({
    timeout: 30000,
  });
  report.checks.standaloneReady = true;

  const read = () => page.evaluate(() => window.__orbReadWorld?.());
  const score = async () => {
    const body = await page.locator("body").innerText();
    const match = body.match(/Score:\s*(\d+)/);
    return match ? Number(match[1]) : null;
  };
  const sample = async (phase) => {
    const raw = await read();
    assert(raw, "Rendered telemetry is unavailable.");
    const compact = compactTelemetry(raw, mapping);
    compact.phase = phase;
    compact.score = await score();
    allSamples.push(compact);
    return compact;
  };
  await expect
    .poll(
      async () => {
        const raw = await read();
        mapping = raw ? chooseMapping(raw) : null;
        return mapping ? 3 : 0;
      },
      { timeout: 30000 },
    )
    .toBe(3);
  report.checks.telemetryReady = true;
  report.mapping = mapping;
  await page.mouse.click(1100, 850);

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
  const release = (phase) => setKeys([], phase);
  const positionForPlatform = (current, id) =>
    current.platforms[id]?.center
      ? [current.platforms[id].center[0], current.platforms[id].center[2]]
      : null;
  const horizontalDistance = (current, x, z) => {
    const center = runtimePlayerCenter(current);
    return center ? Math.hypot(center[0] - x, center[2] - z) : Infinity;
  };

  async function moveOnGroundTo(x, z, phase, maxSteps = 180) {
    let last;
    for (let step = 0; step < maxSteps; step++) {
      last = await sample(phase);
      if (horizontalDistance(last, x, z) <= 0.24) {
        await release(`${phase}-arrived`);
        await page.waitForTimeout(65);
        return await sample(`${phase}-ready`);
      }
      const center = runtimePlayerCenter(last);
      await setKeys(movementKeys(x - center[0], z - center[2]), phase);
      await page.waitForTimeout(50);
    }
    throw Error(`${phase}: bounded ground approach did not reach target.`);
  }

  async function collectGroundCrystal(entity, shouldJump = false) {
    const [x, z] = targetPosition(entity);
    const before = await moveOnGroundTo(x, z, `ground-${entity.id}`);
    if (!shouldJump) {
      for (let index = 0; index < 8; index++) {
        await page.waitForTimeout(45);
        await sample(`collect-${entity.id}`);
      }
      return before;
    }
    const direction = movementKeys(
      x - runtimePlayerCenter(before)[0],
      z - runtimePlayerCenter(before)[2],
    );
    const jumpAt = await page.evaluate(() => performance.now());
    await setKeys([" ", ...direction], `jump-${entity.id}`);
    await page.waitForTimeout(80);
    await setKeys(direction, `jump-release-${entity.id}`);
    for (let index = 0; index < 34; index++) {
      await page.waitForTimeout(45);
      const current = await sample(`jump-${entity.id}`);
      if ((current.score ?? 0) >= 40) break;
    }
    return { before, jumpAt };
  }

  const crystals = project.entities.filter(
    (entity) => entity.behavior?.type === "collect",
  );
  for (const id of source.preRouteCollectibleIds) {
    const entity = crystals.find((candidate) => candidate.id === id);
    assert(entity, `Missing pre-route collectible ${id}.`);
    await collectGroundCrystal(
      entity,
      source.preRouteJumpCollectibleIds.has(id),
    );
  }
  report.checks.groundCollectionApproach = true;

  const routeRun = {
    label: `desktop-keyboard-${platformIds.join("-")}-${source.postBounceCollectibleId}-portal`,
    viewport: desktopViewport,
    inputMethod: "desktop keyboard",
    platformIds,
    mappingUuid: mapping,
    status: "running",
    stages: [],
    samples: allSamples,
    inputLog,
    groundContactSampling: {
      method: "rendered Player local runtime center sampled during route",
      threshold: 0.5,
      limitation:
        "No sampled telemetry can prove absence of ground contact between rendered frames.",
    },
    sourceContactModel: platforms.map((entity) => ({
      id: entity.id,
      gameplay: "src/lib/gameplay.ts platformTop/isInsidePlatform",
      runtimePose:
        "Formation local runtime matrix; Player local runtime center",
      assetId: entity.geometry.assetId,
      catalogBounds: catalogAssets.get(entity.geometry.assetId).bounds,
      entityPosition: entity.position,
      entityScale: entity.scale,
      playerHalfHeight: PLAYER_HALF_HEIGHT,
    })),
  };
  report.runs.push(routeRun);

  const recordStage = (stage, current) => {
    stage.samples.push(current);
    if (firstTakeoffAt !== null && runtimePlayerCenter(current)?.[1] <= 0.5)
      routeRun.groundContactSamples = [
        ...(routeRun.groundContactSamples ?? []),
        current,
      ];
  };
  const stageContact = (stage, entity) => {
    const asset = catalogAssets.get(entity.geometry.assetId);
    return bounceStageTransition(stage.samples, entity, asset, {
      startAt: stage.startAt,
    });
  };
  const steerToPlatform = async (current, entity, phase) => {
    const player = runtimePlayerCenter(current);
    if (!player) return;
    const platform = current.platforms[entity.id];
    const source = sourcePlatformContact(
      entity,
      platform,
      catalogAssets.get(entity.geometry.assetId),
      player,
    );
    if (
      !source ||
      !Number.isFinite(source.halfX) ||
      !Number.isFinite(source.halfZ)
    ) {
      await setKeys([], `${phase}-source-contact-unavailable`);
      return;
    }
    const halfX = source.halfX;
    const halfZ = source.halfZ;
    const target = source.center;
    const needsSteering = platformFootprintSteeringNeeded({
      playerCenter: player,
      target,
      halfX,
      halfZ,
      margin: PLATFORM_INTERCEPT_MARGIN,
    });
    await setKeys(
      needsSteering
        ? movementKeys(target[0] - player[0], target[2] - player[2])
        : [],
      phase,
    );
  };

  const firstPlatform = platforms[0];
  let beforeJump = await sample(`before-${firstPlatform.id}-jump`);
  let firstTarget = positionForPlatform(beforeJump, firstPlatform.id);
  if (!firstTarget)
    throw Error(
      `${firstPlatform.id}: rendered moving platform position unavailable.`,
    );
  // Move under the current platform pose, then start one real keyboard jump.
  if (horizontalDistance(beforeJump, firstTarget[0], firstTarget[1]) > 0.24)
    beforeJump = await moveOnGroundTo(
      firstTarget[0],
      firstTarget[1],
      `approach-${firstPlatform.id}`,
    );
  await release("pre-route-jump-release");
  const platform1Stage = {
    id: firstPlatform.id,
    label: firstPlatform.label,
    samples: [beforeJump],
    startAt: null,
    transition: null,
    jumpInputReleasedAt: null,
  };
  routeRun.stages.push(platform1Stage);
  await setKeys([" "], `jump-${firstPlatform.id}`);
  await page.waitForTimeout(80);
  await release(`jump-${firstPlatform.id}-release`);
  platform1Stage.jumpInputReleasedAt = await page.evaluate(() =>
    performance.now(),
  );
  firstTakeoffAt = platform1Stage.jumpInputReleasedAt;
  platform1Stage.startAt = platform1Stage.jumpInputReleasedAt;
  routeRun.firstTakeoffAt = firstTakeoffAt;

  const runFirstStage = async () => {
    for (let index = 0; index < 80; index++) {
      await page.waitForTimeout(38);
      const current = await sample(`jump-to-${firstPlatform.id}`);
      recordStage(platform1Stage, current);
      const transition = stageContact(platform1Stage, firstPlatform);
      await steerToPlatform(
        current,
        firstPlatform,
        `steer-${firstPlatform.id}`,
      );
      if (transition) {
        platform1Stage.transition = transition;
        platform1Stage.contactSample =
          platform1Stage.samples[transition.contactIndex];
        platform1Stage.ascentSamples = platform1Stage.samples.slice(
          transition.minimumIndex,
          transition.ascentIndex + 1,
        );
        return;
      }
    }
    throw Error(
      `${firstPlatform.id}: no descending contact followed by bounce ascent.`,
    );
  };
  await runFirstStage();

  const runAutoStage = async (entity, previousStage) => {
    const stage = {
      id: entity.id,
      label: entity.label,
      samples: [previousStage.samples.at(-1)],
      startAt: previousStage.samples.at(-1).atPerformanceMs,
      transition: null,
      jumpInputReleasedAt: firstTakeoffAt,
    };
    routeRun.stages.push(stage);
    for (let index = 0; index < 90; index++) {
      await page.waitForTimeout(38);
      const current = await sample(`bounce-to-${entity.id}`);
      recordStage(stage, current);
      await steerToPlatform(current, entity, `steer-${entity.id}`);
      const transition = stageContact(stage, entity);
      if (transition) {
        stage.transition = transition;
        stage.contactSample = stage.samples[transition.contactIndex];
        stage.ascentSamples = stage.samples.slice(
          transition.minimumIndex,
          transition.ascentIndex + 1,
        );
        return stage;
      }
    }
    throw Error(
      `${entity.id}: no descending contact followed by bounce ascent.`,
    );
  };
  const platform2Stage = await runAutoStage(platforms[1], platform1Stage);
  const platform3Stage = await runAutoStage(platforms[2], platform2Stage);

  const postBounceCollectible = crystals.find(
    (entity) => entity.id === source.postBounceCollectibleId,
  );
  assert(
    postBounceCollectible,
    `Missing post-route collectible ${source.postBounceCollectibleId}.`,
  );
  const portal = project.entities.find(
    (entity) => entity.behavior?.type === "portal",
  );
  const postBounce = {
    phase: `post-${platformIds.at(-1)}-${source.postBounceCollectibleId}-portal`,
    samples: [],
    scoreAtStart: allSamples.at(-1)?.score ?? null,
    collectible: {
      id: source.postBounceCollectibleId,
      reached: false,
      scoreAtContact: null,
    },
    portal: { reached: false, won: false },
  };
  routeRun.postBounce = postBounce;
  for (let index = 0; index < 110; index++) {
    const current = await sample(postBounce.phase);
    postBounce.samples.push(current);
    const player = runtimePlayerCenter(current);
    const target = postBounce.collectible.reached
      ? portal?.position
      : postBounceCollectible.position;
    if (target && player)
      await setKeys(
        movementKeys(target[0] - player[0], target[2] - player[2]),
        postBounce.collectible.reached
          ? "steer-portal"
          : `steer-${postBounce.collectible.id}`,
      );
    if (
      !postBounce.collectible.reached &&
      current.score >= contract.expectedScore
    ) {
      postBounce.collectible.reached = true;
      postBounce.collectible.scoreAtContact = current.score;
      postBounce.collectible.sample = current;
    }
    const bodyText = await page.locator("body").innerText();
    if (/Play again|Final score:/i.test(bodyText)) {
      postBounce.portal.reached = true;
      postBounce.portal.won = current.score >= contract.expectedScore;
      postBounce.portal.sample = current;
      break;
    }
    await page.waitForTimeout(38);
  }
  await release("route-end-release");
  const finalBounceAscentAt =
    routeRun.stages.at(-1)?.transition?.ascentAtPerformanceMs;
  routeRun.groundContactSamples = groundSamplesAfter(
    allSamples,
    firstTakeoffAt,
  );
  routeRun.postRouteGroundContactSamples = Number.isFinite(finalBounceAscentAt)
    ? routeRun.groundContactSamples.filter(
        (sample) => sample.atPerformanceMs > finalBounceAscentAt,
      )
    : [];
  routeRun.noGroundInterval = {
    fromTakeoffAt: firstTakeoffAt,
    throughFinalBounceAscentAt: finalBounceAscentAt ?? null,
    meaning:
      "No sampled ground reset is required from the first jump release through the third bounce ascent; later ground travel to the portal is recorded separately.",
  };
  routeRun.postReleaseJumpEvents = jumpDownEventsAfter(
    (await read()).keyEvents,
    firstTakeoffAt,
  );
  routeRun.routeAnalysis = sequentialRouteAnalysis(
    routeRun.stages,
    allSamples,
    {
      firstTakeoffAt,
      groundObservationEndAt: finalBounceAscentAt ?? Infinity,
      expectedStageIds: platformIds,
      jumpEvents: (await read()).keyEvents,
    },
  );
  routeRun.noGroundContactObserved =
    routeRun.routeAnalysis.noGroundResetObserved;
  routeRun.finalScore = allSamples.at(-1)?.score ?? null;
  routeRun.status =
    routeRun.routeAnalysis.passed &&
    routeRun.postReleaseJumpEvents.length === 0 &&
    postBounce.collectible.reached &&
    postBounce.portal.won
      ? "passed"
      : "failed";
  if (routeRun.status === "passed") {
    await expect(
      page.getByText("Adventure complete", { exact: true }),
    ).toBeVisible({
      timeout: 5000,
    });
    await page.getByRole("button", { name: "Play again", exact: true }).click();
    await expect.poll(score, { timeout: 5000 }).toBe(0);
    const winVisible = await page
      .getByText("Adventure complete", { exact: true })
      .isVisible()
      .catch(() => false);
    routeRun.reset = { score: await score(), winStatusVisible: winVisible };
    routeRun.status =
      routeRun.reset.score === 0 && !winVisible ? "passed" : "failed";
  }
  if (routeRun.status !== "passed")
    routeRun.failure = `The bounded desktop route did not prove all three bounce transitions, ${source.postBounceCollectibleId} collection (score ${contract.expectedScore}), portal victory, and reset. The no-ground assertion covers only the interval from the first jump release through the third bounce ascent; later ground travel is recorded separately.`;
  await page.screenshot({ path: join(output, "desktop-route-final.png") });
  if (routeRun.status !== "passed")
    await page.screenshot({ path: join(output, "desktop-route-failure.png") });
} catch (error) {
  failure = String(error).slice(0, 3000);
  report.failure = failure;
  if (page)
    await page
      .screenshot({ path: join(output, "desktop-route-failure.png") })
      .catch(() => {});
} finally {
  await releaseHeld().catch(() => {});
  report.finishedAt = new Date().toISOString();
  report.failure = report.failure ?? null;
  if (failure && report.runs[0]?.status === "running") {
    report.runs[0].status = "failed";
    report.runs[0].failure = failure;
  }
  report.finalTelemetrySampleCount = allSamples.length;
  report.status =
    !failure &&
    report.runs.length === 1 &&
    report.runs[0].status === "passed" &&
    report.externalRequests.length === 0 &&
    report.mutatingRequests.length === 0 &&
    report.blockedRequests.length === 0 &&
    report.pageErrors.length === 0
      ? "passed"
      : "failed";
  if (context) await context.close().catch(() => {});
  await browser.close().catch(() => {});
  await new Promise((resolveServer) => standaloneServer.close(resolveServer));
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
}

console.log(JSON.stringify(report, null, 2));
if (report.status !== "passed") process.exitCode = 1;
