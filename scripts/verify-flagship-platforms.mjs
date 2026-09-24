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
import {
  basename,
  join,
  posix as posixPath,
  relative,
  resolve,
  sep,
} from "node:path";
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
  findFrameLandingEvidence,
  sourcePlatformContact,
  sourceLandingEvidence,
  selectCatalogManifest,
  touchControlLabel,
  touchLaunchKeys,
  validateFrameTelemetryDrain,
} from "./lib/flagship-platforms-verifier.mjs";

const defaultZipPath =
  "docs/evidence/provider-e2e/flagship-openrouter/openrouter/world.zip";
const zipPath = resolve(process.env.FLAGSHIP_GAME_ZIP ?? defaultZipPath);
const output = resolve(process.argv[2] ?? "docs/evidence/flagship-platforms");
const reanalyzeReport = process.env.FLAGSHIP_REANALYZE_REPORT;
const sequential = process.env.FLAGSHIP_SEQUENTIAL === "1";
const touchInput = process.env.FLAGSHIP_INPUT === "touch";
const publishedUrl = process.env.FLAGSHIP_PUBLISHED_URL;
const published = Boolean(publishedUrl);
const publishedTarget = published ? new URL(publishedUrl) : null;
const provider = (() => {
  const explicit = process.env.FLAGSHIP_PROVIDER;
  if (explicit) {
    if (!["openrouter", "gateway"].includes(explicit))
      throw Error("FLAGSHIP_PROVIDER must be openrouter or gateway.");
    return explicit;
  }
  const known = [
    ...new Set(
      zipPath
        .split(/[\\/]+/)
        .filter((part) => part === "openrouter" || part === "gateway"),
    ),
  ];
  if (known.length === 1) return known[0];
  if (zipPath === resolve(defaultZipPath)) return "openrouter";
  throw Error(
    "Cannot identify the saved ZIP provider; set FLAGSHIP_PROVIDER to openrouter or gateway.",
  );
})();
if (published && !["http:", "https:"].includes(publishedTarget.protocol))
  throw Error("FLAGSHIP_PUBLISHED_URL must use HTTP(S).");
if (touchInput && !sequential)
  throw Error("FLAGSHIP_INPUT=touch requires FLAGSHIP_SEQUENTIAL=1.");
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
const archivedCatalogBytes = files["assets/catalog/manifest.json"];
const repositoryCatalogBytes = archivedCatalogBytes
  ? null
  : await readFile(resolve("assets/catalog/manifest.json"));
const { manifest: catalogManifest, source: catalogManifestSource } =
  selectCatalogManifest(
    archivedCatalogBytes ? JSON.parse(strFromU8(archivedCatalogBytes)) : null,
    repositoryCatalogBytes
      ? JSON.parse(repositoryCatalogBytes.toString("utf8"))
      : null,
  );
const catalogManifestBytes = archivedCatalogBytes ?? repositoryCatalogBytes;
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
      ? `published-flagship-${touchInput ? "mobile-touch" : "desktop"}-platform-sequential-landing-carry`
      : "published-flagship-desktop-platform-landing-carry"
    : sequential
      ? `saved-${provider}-flagship-${touchInput ? "mobile-touch" : "desktop"}-platform-sequential-landing-carry`
      : `saved-${provider}-flagship-desktop-platform-landing-carry`,
  provider,
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
  catalogManifest: {
    source: catalogManifestSource,
    sha256: sha256(catalogManifestBytes),
  },
  zip: {
    path: (() => {
      const repoRelativePath = relative(process.cwd(), zipPath);
      return repoRelativePath.startsWith("..")
        ? basename(zipPath)
        : repoRelativePath.split(sep).join("/");
    })(),
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
      runtimePose:
        "Formation group local matrix; player group local center; matrix/query supportSurfaceHeight branch",
      playerHalfHeight: PLAYER_HALF_HEIGHT,
      catalogAssetId: entity.geometry.assetId,
      catalogBounds: catalogAssets.get(entity.geometry.assetId).bounds,
    },
  })),
  selectedPlatformIds: selectedPlatforms.map((entity) => entity.id),
  sequential,
  inputMode: touchInput ? "mobile-touch" : "desktop-keyboard",
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
const touchViewport = { width: 390, height: 844 };
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
            const runtimeMatrix = parent.matrix.elements;
            groups.set(key, {
              uuid: key,
              runtimeMatrix: Array.from(runtimeMatrix),
              worldMatrix: Array.from(matrix),
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
      const playerRuntimeBounds = playerMesh?.parent
        ? (() => {
            const local = localBounds(playerMesh.geometry);
            return local
              ? worldBounds(playerMesh.parent.matrix.elements, local)
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
      };
    };

    window.__orbStartFrameTelemetry = (mapping, capacity = 2048) => {
      if (!Number.isSafeInteger(capacity) || capacity < 2)
        throw new Error("Invalid frame telemetry capacity.");
      const ids = Object.entries(mapping ?? {});
      if (ids.length !== 3 || new Set(ids.map(([, uuid]) => uuid)).size !== 3)
        throw new Error(
          "Frame telemetry needs the three discovered platforms.",
        );

      let playerMesh;
      const platformMeshes = new Map();
      const wanted = new Set(ids.map(([, uuid]) => uuid));
      for (const scene of observed)
        scene.traverse((object) => {
          if (object.geometry?.type === "CapsuleGeometry") playerMesh = object;
          if (
            object.isMesh &&
            object.parent &&
            object.geometry &&
            wanted.has(object.parent.uuid) &&
            !platformMeshes.has(object.parent.uuid) &&
            localBounds(object.geometry)
          )
            platformMeshes.set(object.parent.uuid, object);
        });
      if (!playerMesh?.parent || !localBounds(playerMesh.geometry))
        throw new Error("Frame telemetry could not bind the observed player.");
      for (const [, uuid] of ids)
        if (!platformMeshes.has(uuid))
          throw new Error(`Frame telemetry could not bind platform ${uuid}.`);

      const platformRefs = Object.fromEntries(
        ids.map(([id, uuid]) => {
          const mesh = platformMeshes.get(uuid);
          return [id, { mesh, parent: mesh.parent }];
        }),
      );
      const playerParent = playerMesh.parent;
      const ring = new Array(capacity);
      let ringStart = 0;
      let ringCount = 0;
      let nextFrameId = 0;
      let lastDrainedFrameId = -1;
      let issue = null;
      let running = true;

      const isInObservedScene = (object) => {
        let current = object;
        while (current?.parent) current = current.parent;
        return Boolean(current?.isScene && observed.includes(current));
      };
      const captureObject = (object, expectedParent, frameId, player) => {
        if (
          !object ||
          object.parent !== expectedParent ||
          !object.geometry ||
          !isInObservedScene(object)
        )
          return null;
        const local = localBounds(object.geometry);
        if (!local) return null;
        const world = worldBounds(expectedParent.matrixWorld.elements, local);
        const runtime = worldBounds(expectedParent.matrix.elements, local);
        const visible = Boolean(expectedParent.visible && object.visible);
        const record = {
          frameId,
          visible,
          bounds: world,
          center: center(world),
        };
        if (player) {
          record.runtimeBounds = runtime;
          record.runtimeCenter = center(runtime);
        } else {
          record.uuid = expectedParent.uuid;
          record.runtimeMatrix = Array.from(expectedParent.matrix.elements);
          record.size = world.max.map((value, axis) => value - world.min[axis]);
          record.top = world.max[1];
        }
        return record;
      };
      const append = (sample) => {
        if (ringCount < capacity) {
          ring[(ringStart + ringCount) % capacity] = sample;
          ringCount++;
        } else {
          ring[ringStart] = sample;
          ringStart = (ringStart + 1) % capacity;
        }
      };
      const tick = (frameTimestampMs) => {
        if (!running) return;
        const frameId = nextFrameId++;
        const player = captureObject(playerMesh, playerParent, frameId, true);
        const platformSamples = {};
        for (const [id, ref] of Object.entries(platformRefs)) {
          platformSamples[id] = captureObject(
            ref.mesh,
            ref.parent,
            frameId,
            false,
          );
          if (!platformSamples[id]) {
            issue = `missing-platform-${id}`;
            running = false;
            return;
          }
        }
        if (!player) {
          issue = "missing-player";
          running = false;
          return;
        }
        append({
          frameId,
          frameTimestampMs,
          atPerformanceMs: performance.now(),
          player,
          platforms: platformSamples,
        });
        requestAnimationFrame(tick);
      };
      window.__orbDrainFrameTelemetry = () => {
        const samples = [];
        let droppedSinceLastDrain = 0;
        if (ringCount > 0) {
          const oldestFrameId = ring[ringStart].frameId;
          droppedSinceLastDrain = Math.max(
            0,
            oldestFrameId - (lastDrainedFrameId + 1),
          );
          for (let index = 0; index < ringCount; index++) {
            const sample = ring[(ringStart + index) % capacity];
            if (sample.frameId > lastDrainedFrameId) samples.push(sample);
          }
          if (samples.length) lastDrainedFrameId = samples.at(-1).frameId;
        }
        return {
          samples,
          droppedSinceLastDrain,
          issue,
          capacity,
          latestFrameId: nextFrameId - 1,
        };
      };
      window.__orbStopFrameTelemetry = () => {
        running = false;
      };
      requestAnimationFrame(tick);
      return { capacity, platformIds: ids.map(([id]) => id) };
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
    runtimeMatrix: candidate.runtimeMatrix,
    worldMatrix: candidate.worldMatrix,
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
  );
  return {
    atPerformanceMs: sample.atPerformanceMs,
    player: sample.player
      ? {
          center: sample.player.center,
          bounds: sample.player.bounds,
          runtimeCenter: sample.player.runtimeCenter,
          runtimeBounds: sample.player.runtimeBounds,
        }
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
    runtimePose:
      "Formation group local matrix; player group local center; matrix/query supportSurfaceHeight branch",
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
          atContactHeight: evidence.atContactHeight,
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
  const touchHeld = new Map();
  const cdp = touchInput ? await page.context().newCDPSession(page) : null;
  if (cdp)
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
    });
  let nextTouchId = 101;
  const inputLog = [];
  const touchButtonPoint = async (key) => {
    const label = touchControlLabel(key);
    const box = await page
      .getByRole("button", { name: label, exact: true })
      .boundingBox();
    if (!box) throw Error(`Missing visible touch control ${label}.`);
    const point = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      id: nextTouchId++,
    };
    const hit = await page.evaluate(
      ({ x, y, label }) => {
        const target = document.elementFromPoint(x, y);
        const button = target?.closest("button");
        return button?.getAttribute("aria-label") === label;
      },
      { ...point, label },
    );
    if (!hit) throw Error(`Touch coordinate missed control ${label}.`);
    return point;
  };
  const dispatchTouch = async (type, touchPoints) => {
    if (!cdp) throw Error("Touch dispatch requested without a CDP session.");
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  };
  const setKeys = async (keys, phase) => {
    const next = new Set(keys);
    if (touchInput) {
      for (const [key, point] of touchHeld)
        if (!next.has(key)) {
          await dispatchTouch("touchEnd", [point]);
          touchHeld.delete(key);
        }
      for (const key of next)
        if (!touchHeld.has(key)) {
          touchHeld.set(key, await touchButtonPoint(key));
          await dispatchTouch("touchStart", [...touchHeld.values()]);
        }
    } else {
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
    }
    inputLog.push({
      atPerformanceMs: await page.evaluate(() => performance.now()),
      phase,
      keys: [...(touchInput ? touchHeld.keys() : held)],
    });
  };
  const release = async (phase) => setKeys([], phase);
  const frameCapacity = 2048;
  const frameStart = await page.evaluate(
    ({ mapping, capacity }) =>
      window.__orbStartFrameTelemetry(mapping, capacity),
    { mapping, capacity: frameCapacity },
  );
  run.frameSamples = [];
  run.frameTelemetry = {
    method:
      "passive requestAnimationFrame samples of discovered rendered objects",
    capacity: frameStart.capacity,
    platformIds: frameStart.platformIds,
    lastFrameId: -1,
    postTakeoffFrameCount: 0,
    overflowCount: 0,
    issue: null,
  };
  const sample = async (phase) => {
    const observation = await page.evaluate(() => ({
      world: window.__orbReadWorld(),
      frames: window.__orbDrainFrameTelemetry(),
    }));
    const checked = validateFrameTelemetryDrain(
      observation.frames,
      run.frameTelemetry.lastFrameId,
      run.frameTelemetry.platformIds,
    );
    if (!checked.valid) {
      run.frameTelemetry.issue = checked.reason;
      if (observation.frames?.droppedSinceLastDrain > 0)
        run.frameTelemetry.overflowCount +=
          observation.frames.droppedSinceLastDrain;
      throw Error(`Frame telemetry failed safely: ${checked.reason}.`);
    }
    run.frameTelemetry.lastFrameId = checked.lastFrameId;
    const frameSamples = checked.samples;
    for (const frame of frameSamples) {
      frame.phase = phase;
      if (run.firstTakeoff && frame.frameId > run.firstTakeoff.frameId) {
        run.frameSamples.push(frame);
        run.frameTelemetry.postTakeoffFrameCount++;
        if (groundContact(frame)) run.groundContactSamples.push(frame);
      }
    }
    const compact = compactTelemetry(observation.world, mapping);
    compact.phase = phase;
    return { snapshot: compact, frames: frameSamples };
  };
  const groundContact = (sample) =>
    Boolean(
      sample.player &&
      (sample.player.runtimeCenter ?? sample.player.center)[1] <= 0.5,
    );
  const sourceCarried = (sample, entity, asset) => {
    const rendered = sample.platforms[entity.id];
    const player = sample.player;
    if (!player || !rendered) return false;
    const playerCenter = player.runtimeCenter ?? player.center;
    const source = sourcePlatformContact(entity, rendered, asset, playerCenter);
    if (!source) return false;
    return (
      playerOnPlatform(player, rendered) &&
      Math.abs(playerCenter[1] - source.contactY) <= 0.1 &&
      Math.abs(playerCenter[0] - source.center[0]) <=
        source.halfX + CONTACT_HORIZONTAL_TOLERANCE &&
      Math.abs(playerCenter[2] - source.center[2]) <=
        source.halfZ + CONTACT_HORIZONTAL_TOLERANCE
    );
  };
  const releaseHeld = async () => {
    if (touchInput) {
      for (const point of touchHeld.values())
        await dispatchTouch("touchEnd", [point]).catch(() => {});
      touchHeld.clear();
    }
    for (const key of held) await page.keyboard.up(key).catch(() => {});
    held.clear();
  };

  const execute = async () => {
    run.inputLog = inputLog;
    run.approachSamples = [];
    run.stages = [];
    run.groundContactSamples = [];
    run.groundContactSampling = {
      method:
        "correlated player samples captured on each requestAnimationFrame",
      sampleSource: "bounded browser ring drained through CDP by the driver",
      groundCenterYThreshold: 0.5,
      limitation:
        "The ring preserves every rendered frame after takeoff unless an overflow or object loss occurs; it cannot observe gameplay steps that do not render.",
    };
    run.sourceContactModel = ordered.map((entity) => ({
      id: entity.id,
      gameplay: "src/lib/gameplay.ts platformTop/isInsidePlatform",
      runtimePose:
        "Formation group local matrix; player group local center; matrix/query supportSurfaceHeight branch",
      assetId: entity.geometry.assetId,
      catalogBounds: catalogAssets.get(entity.geometry.assetId).bounds,
      entityPosition: entity.position,
      entityScale: entity.scale,
      playerHalfHeight: PLAYER_HALF_HEIGHT,
    }));
    await page.mouse.click(
      touchInput ? touchViewport.width / 2 : 1100,
      touchInput ? 180 : 850,
    );

    const first = ordered[0];
    for (let step = 0; step < 180; step++) {
      const observation = await sample("approach-platform-1");
      const current = observation.snapshot;
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
        const observation = await sample("favorable-gap-wait");
        const current = observation.snapshot;
        const gap = horizontalGapToPlatform(
          current.player?.runtimeCenter ?? current.player?.center,
          current.platforms[target.id],
          target,
          targetAsset,
          {
            margin: DEFAULT_JUMP_REACH_MARGIN,
            targetMotionMargin,
          },
        );
        const carried = sourceCarried(current, carrier, carrierAsset);
        const onGround = observation.frames.some(groundContact);
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
        frameSamples: [],
        carrySamples: [],
      };
      run.stages.push(stage);
      if (index > 0)
        await waitForFavorableGap(ordered[index - 1], entity, stage);
      const beforeJumpObservation = await sample(`before-jump-${index + 1}`);
      stage.beforeJump = beforeJumpObservation.snapshot;
      stage.frameSamples.push(...beforeJumpObservation.frames);
      const previousBeforeJump = stage.beforeJump;
      if (index === 0)
        run.firstTakeoff = {
          atPerformanceMs: await page.evaluate(() => performance.now()),
          frameId: run.frameTelemetry.lastFrameId,
          from: entity.id,
        };
      const launchDirection =
        touchInput &&
        previousBeforeJump.player &&
        previousBeforeJump.platforms[entity.id]
          ? movementKeys(
              previousBeforeJump.platforms[entity.id].center[0] -
                previousBeforeJump.player.center[0],
              previousBeforeJump.platforms[entity.id].center[2] -
                previousBeforeJump.player.center[2],
            )
          : [];
      const launchKeys = touchInput ? touchLaunchKeys(launchDirection) : [" "];
      stage.launchKeys = launchKeys;
      await setKeys(launchKeys, `jump-platform-${index + 1}`);
      await page.waitForTimeout(80);
      if (touchInput)
        await setKeys(launchDirection, `jump-release-platform-${index + 1}`);
      else await release(`jump-release-platform-${index + 1}`);
      let previousSample = previousBeforeJump;
      let previousFrameSample = beforeJumpObservation.frames.at(-1) ?? null;
      let landedAt;
      let landingProof;
      for (let step = 0; step < 42; step++) {
        const observation = await sample(`jump-platform-${index + 1}`);
        const current = observation.snapshot;
        stage.landingSamples.push(current);
        stage.frameSamples.push(...observation.frames);
        const frameEvidence = findFrameLandingEvidence(
          previousFrameSample,
          observation.frames,
          entity,
          asset,
        );
        previousFrameSample = frameEvidence.nextPreviousFrameSample;
        const diagnosticEvidence = sourceLandingEvidence(
          previousSample,
          current,
          entity,
          asset,
        );
        current.sourceContactDiagnostic = diagnosticEvidence.source
          ? {
              basis: "CDP snapshot diagnostic only",
              contactY: diagnosticEvidence.source.contactY,
              descending: diagnosticEvidence.descending,
              previousY: diagnosticEvidence.previousY,
              currentY: diagnosticEvidence.currentY,
              crossedContactHeight: diagnosticEvidence.crossedContactHeight,
              atContactHeight: diagnosticEvidence.atContactHeight,
              sourceOverlap: diagnosticEvidence.sourceOverlap,
              candidateAccepted: diagnosticEvidence.accepted,
            }
          : null;
        const evidence = frameEvidence.evidence;
        if (frameEvidence.landing && evidence?.accepted) {
          landedAt = frameEvidence.landing;
          landingProof = {
            contactY: evidence.source.contactY,
            descending: evidence.descending,
            previousY: evidence.previousY,
            currentY: evidence.currentY,
            crossedContactHeight: evidence.crossedContactHeight,
            atContactHeight: evidence.atContactHeight,
            sourceOverlap: evidence.sourceOverlap,
            accepted: evidence.accepted,
            source: evidence.source,
            frameId: landedAt.frameId,
            frameTimestampMs: landedAt.frameTimestampMs,
            atPerformanceMs: landedAt.atPerformanceMs,
          };
          current.landingFrameId = landedAt.frameId;
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
          `Sequential route did not observe strict source contact on ${entity.id} in correlated render frames.`,
        );

      await release(`carry-release-platform-${index + 1}`);
      for (let sampleIndex = 0; sampleIndex < 8; sampleIndex++) {
        const observation = await sample(`carry-platform-${index + 1}`);
        stage.carrySamples.push(observation.snapshot);
        stage.frameSamples.push(...observation.frames);
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
    run.noGroundContactObserved =
      run.frameTelemetry.postTakeoffFrameCount > 0 &&
      run.groundContactSamples.length === 0;
    if (run.frameTelemetry.postTakeoffFrameCount === 0)
      throw Error(
        "No correlated render-frame samples were captured after takeoff.",
      );
    if (!run.noGroundContactObserved)
      throw Error(
        `Sequential route observed ground contact in ${run.groundContactSamples.length} render frame(s) after the first takeoff.`,
      );
    run.screenshot = "sequential-platform-route.png";
    await page.screenshot({ path: join(output, run.screenshot) });
  };
  try {
    await execute();
  } finally {
    await releaseHeld();
    await page
      .evaluate(() => window.__orbStopFrameTelemetry?.())
      .catch(() => {});
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
    viewport: touchInput ? touchViewport : desktopViewport,
    isMobile: touchInput,
    hasTouch: touchInput,
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
  if (touchInput)
    await expect(
      page.getByRole("button", {
        name: touchControlLabel("d"),
        exact: true,
      }),
    ).toBeVisible();
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
      viewport: touchInput ? touchViewport : desktopViewport,
      inputMethod: touchInput
        ? "mobile CDP multitouch buttons"
        : "desktop keyboard",
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
