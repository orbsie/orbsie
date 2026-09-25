#!/usr/bin/env node
// One local, read-only keyboard replay of the saved OpenRouter creation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import {
  assertFlagshipStoryCreation,
  recordFreshFlagshipGameplayFailure,
  runFreshFlagshipGameplay,
} from "./provider-browser-e2e.mjs";
import { buildFreshGameplayTargets } from "./lib/fresh-flagship-gameplay.mjs";

const DEFAULT_SOURCE_PATH =
  "docs/evidence/provider-e2e/openrouter-flagship-current-20260925/openrouter/story-created-project.json";
const REVISION_29_SOURCE_PATH =
  "docs/evidence/provider-e2e/openrouter-flagship-gpt6-luna-live-20260925-recheck/openrouter/story-created-project.json";
const REVISION_29_SOURCE = {
  projectId: "b2e30ab2-c77b-4f88-a623-f532a4df323b",
  revision: 29,
  sha256: "a7b8964167a6df97e1154124be5eb4f02a5ce8669ed6a0d048a8ae7405903b47",
};
const args = process.argv.slice(2);
const replayRevision29 = args.includes("--revision29");
const clearanceDiagnostic = args.includes("--clearance-diagnostic");
const clearancePathDiagnostic = args.includes("--clearance-path-diagnostic");
assert(
  !(clearanceDiagnostic && clearancePathDiagnostic),
  "Choose only one clearance diagnostic mode.",
);
assert(
  !(clearanceDiagnostic || clearancePathDiagnostic) || replayRevision29,
  "Clearance diagnostic modes require --revision29.",
);
const outputArgs = args.filter(
  (argument) =>
    argument !== "--revision29" &&
    argument !== "--clearance-diagnostic" &&
    argument !== "--clearance-path-diagnostic",
);
assert(outputArgs.length <= 1, "Provide at most one output directory.");
const sourcePath = replayRevision29
  ? REVISION_29_SOURCE_PATH
  : DEFAULT_SOURCE_PATH;
const outputPath = resolve(
  outputArgs[0] ??
    (clearancePathDiagnostic
      ? "docs/evidence/provider-e2e/openrouter-flagship-revision29-bounce1-anchor-path-diagnostic-20260925"
      : clearanceDiagnostic
        ? "docs/evidence/provider-e2e/openrouter-flagship-revision29-bounce1-clearance-diagnostic-20260925"
        : replayRevision29
          ? "docs/evidence/provider-e2e/openrouter-flagship-revision29-route-replay-20260925"
          : "docs/evidence/provider-e2e/openrouter-flagship-current-runtime-replay-20260925"),
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceProjectBytes = await readFile(resolve(sourcePath));
const sourceProject = JSON.parse(sourceProjectBytes.toString("utf8"));
const project = structuredClone(sourceProject);
if (replayRevision29) {
  assert.equal(project.id, REVISION_29_SOURCE.projectId);
  assert.equal(project.revision, REVISION_29_SOURCE.revision);
  assert.equal(sha256(sourceProjectBytes), REVISION_29_SOURCE.sha256);
} else {
  assert.equal(project.id, "2d8c071d-13be-4f4f-9c49-5d1d50c13b93");
  assert.equal(project.revision, 31);
}
let diagnosticMutation = null;
if (clearanceDiagnostic || clearancePathDiagnostic) {
  const bounceOne = project.entities.find((entity) => entity.id === "bounce-1");
  assert(bounceOne, "Pinned revision29 project is missing bounce-1.");
  assert.equal(bounceOne.stage, "ready");
  assert.equal(bounceOne.geometry?.kind, "platform");
  assert.equal(bounceOne.behavior?.type, "bounce");
  assert.equal(bounceOne.position[1], 0.7);
  const bounceOnePaths = [];
  for (const [ruleIndex, rule] of (project.game?.rules ?? []).entries()) {
    for (const [actionIndex, action] of rule.actions.entries()) {
      if (action.type === "move_path" && action.entityId === "bounce-1")
        bounceOnePaths.push({ ruleIndex, actionIndex, action });
    }
  }
  assert.equal(bounceOnePaths.length, 1);
  const { ruleIndex, actionIndex, action: bounceOnePath } = bounceOnePaths[0];
  if (clearanceDiagnostic) {
    bounceOne.position[1] = 0.4;
    diagnosticMutation = {
      entityId: "bounce-1",
      field: "position[1]",
      sourceValue: 0.7,
      diagnosticValue: 0.4,
      unchangedMovePath: {
        startPosition: [...bounceOnePath.points[0]],
        pointYValues: bounceOnePath.points.map((point) => point[1]),
      },
    };
    const restoredProject = structuredClone(project);
    restoredProject.entities.find(
      (entity) => entity.id === "bounce-1",
    ).position[1] = diagnosticMutation.sourceValue;
    assert.deepEqual(
      restoredProject,
      sourceProject,
      "Clearance diagnostic must change only bounce-1 position[1].",
    );
  } else {
    assert(bounceOnePath.points.length > 0);
    const sourcePointYValues = bounceOnePath.points.map((point) => {
      assert.equal(point[1], 0.7);
      return point[1];
    });
    const sourcePathStartPosition = [...bounceOnePath.points[0]];
    const changes = [
      {
        path: "entities[bounce-1].position[1]",
        sourceValue: bounceOne.position[1],
        diagnosticValue: 0.4,
      },
    ];
    bounceOne.position[1] = 0.4;
    for (const [pointIndex, point] of bounceOnePath.points.entries()) {
      changes.push({
        path: `game.rules[${ruleIndex}].actions[${actionIndex}].points[${pointIndex}][1]`,
        sourceValue: point[1],
        diagnosticValue: 0.4,
      });
      point[1] = 0.4;
    }
    diagnosticMutation = {
      entityId: "bounce-1",
      changes,
      movePath: {
        ruleIndex,
        actionIndex,
        sourceStartPosition: sourcePathStartPosition,
        diagnosticStartPosition: [...bounceOnePath.points[0]],
        sourcePointYValues,
        diagnosticPointYValues: bounceOnePath.points.map((point) => point[1]),
      },
    };
    const restoredProject = structuredClone(project);
    restoredProject.entities.find(
      (entity) => entity.id === "bounce-1",
    ).position[1] = 0.7;
    const restoredPath =
      restoredProject.game.rules[ruleIndex].actions[actionIndex];
    sourcePointYValues.forEach((value, index) => {
      restoredPath.points[index][1] = value;
    });
    assert.deepEqual(
      restoredProject,
      sourceProject,
      "Path diagnostic must change only bounce-1 anchor and path Y coordinates.",
    );
  }
}
const targetDocumentBytes =
  clearanceDiagnostic || clearancePathDiagnostic
    ? Buffer.from(JSON.stringify(project))
    : sourceProjectBytes;
const targetDocumentSha256 = sha256(targetDocumentBytes);
if (clearanceDiagnostic || clearancePathDiagnostic)
  assert.notEqual(targetDocumentSha256, sha256(sourceProjectBytes));
assert.equal(
  project.entities.filter((entity) => entity.geometry?.kind === "generated")
    .length,
  0,
);
let platforms;
let collectibles;
let portal;
if (replayRevision29) {
  const story = assertFlagshipStoryCreation(project);
  platforms = story.platforms;
  collectibles = story.collectibles;
  portal = story.portal;
} else {
  platforms = ["bounce-one", "bounce-two", "bounce-three"].map((id) => {
    const entity = project.entities.find((candidate) => candidate.id === id);
    assert(entity && entity.behavior?.type === "bounce");
    return entity;
  });
  collectibles = project.entities.filter(
    (entity) => entity.stage === "ready" && entity.behavior?.type === "collect",
  );
  const portals = project.entities.filter(
    (entity) => entity.stage === "ready" && entity.behavior?.type === "portal",
  );
  assert.equal(portals.length, 1);
  portal = portals[0];
}
assert.equal(collectibles.length, 5);
const targets = buildFreshGameplayTargets(
  project,
  { platforms, collectibles, portal },
  { expectedCollectibleCount: 5, expectedRevision: project.revision },
);

const catalog = JSON.parse(
  (await readFile("assets/catalog/manifest.json")).toString("utf8"),
);
const catalogAssets = new Map(catalog.assets.map((asset) => [asset.id, asset]));
const assetReferences = project.entities
  .filter((entity) => entity.geometry?.kind === "asset")
  .map((entity) => ({ entityId: entity.id, assetId: entity.geometry.assetId }));
assert.equal(assetReferences.length, replayRevision29 ? 2 : 3);
const files = new Map([["/project.json", targetDocumentBytes]]);
const runtimeEvidence = {};
for (const name of [
  "runtime.js",
  "runtime.css",
  "generated-geometry-worker.js",
  "asset-geometry-worker.js",
]) {
  const bytes = await readFile(resolve("public/player", name));
  files.set(`/${name}`, bytes);
  runtimeEvidence[name] = { bytes: bytes.byteLength, sha256: sha256(bytes) };
}
const assets = [];
for (const reference of assetReferences) {
  const asset = catalogAssets.get(reference.assetId);
  assert(asset, `Missing catalog record for ${reference.assetId}.`);
  const bytes = await readFile(resolve("public", asset.path.slice(1)));
  assert.equal(bytes.byteLength, asset.sizeBytes);
  assert.equal(sha256(bytes), asset.sha256);
  files.set(asset.path, bytes);
  assets.push({
    ...reference,
    path: asset.path,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  });
}
const html = Buffer.from(
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./runtime.css"></head><body><div id="root"></div><script type="module" src="./runtime.js"></script></body></html>',
);
files.set("/", html);
files.set("/favicon.ico", Buffer.alloc(0));

if (clearanceDiagnostic || clearancePathDiagnostic)
  await mkdir(outputPath, { mode: 0o700 });
else await mkdir(outputPath, { recursive: true, mode: 0o700 });
const localRequests = [];
const contentTypeForPath = (path) => {
  if (path === "/") return "text/html; charset=utf-8";
  const extension = path.split(".").at(-1);
  return (
    {
      css: "text/css; charset=utf-8",
      glb: "model/gltf-binary",
      js: "text/javascript; charset=utf-8",
      json: "application/json; charset=utf-8",
    }[extension] ?? "application/octet-stream"
  );
};
const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://snapshot.local").pathname;
  const bytes = files.get(path);
  const status = bytes ? 200 : path === "/favicon.ico" ? 204 : 404;
  const contentType = contentTypeForPath(path);
  if (localRequests.length < 256)
    localRequests.push({
      method: request.method ?? "GET",
      path,
      status,
      contentType: status === 200 ? contentType : null,
    });
  response.setHeader("Cache-Control", "no-store");
  if (status !== 200) return response.writeHead(status).end();
  response.setHeader("Content-Type", contentType);
  response.writeHead(200).end(request.method === "HEAD" ? undefined : bytes);
});
await new Promise((resolveServer, rejectServer) => {
  server.once("error", rejectServer);
  server.listen(0, "127.0.0.1", () => {
    server.off("error", rejectServer);
    resolveServer();
  });
});
const origin = `http://127.0.0.1:${server.address().port}`;
const serverPreflight = [];
for (const [path, expected] of [
  ["/", "text/html"],
  ["/runtime.js", "text/javascript"],
]) {
  const response = await fetch(`${origin}${path}`);
  const contentType = response.headers.get("content-type");
  serverPreflight.push({
    path,
    status: response.status,
    contentType,
    bodyBytes: Number(response.headers.get("content-length")) || null,
  });
  await response.body?.cancel();
  assert.equal(response.status, 200, `HTTP preflight failed for ${path}.`);
  assert(
    contentType?.startsWith(expected),
    `Unexpected content type for ${path}: ${contentType}`,
  );
}
const sanitizeDiagnosticText = (value) =>
  String(value ?? "")
    .replaceAll(origin, "[local-origin]")
    .replace(/https?:\/\/[^\s)'"<>]+/gi, "[url]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|or)-[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .slice(0, 300);
const report = {
  mode: clearancePathDiagnostic
    ? "single-static-revision29-bounce1-anchor-path-clearance-diagnostic"
    : clearanceDiagnostic
      ? "single-static-revision29-bounce1-clearance-diagnostic"
      : "single-static-saved-openrouter-creation-replay",
  routeSelection: replayRevision29
    ? "production-spawn-relative-validator"
    : "pinned-revision31-identifiers",
  status: "running",
  repoHead: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  sourceProject: {
    path: sourcePath,
    bytes: sourceProjectBytes.byteLength,
    sha256: sha256(sourceProjectBytes),
    projectId: project.id,
    revision: project.revision,
  },
  runtime: runtimeEvidence,
  serverPreflight,
  catalogAssets: assets,
  targets: {
    platforms: targets.platforms.map((entity) => entity.id),
    platformPositions: targets.platforms.map((entity) => ({
      id: entity.id,
      position: entity.position,
    })),
    collectibles: targets.collectibles.map((entity) => entity.id),
    portal: targets.portal.id,
  },
  providerCalls: 0,
  cloudCalls: 0,
  externalRequests: [],
  pageErrors: [],
  consoleErrors: [],
  requestFailures: [],
  localRequests,
  screenshots: [],
  readiness: null,
  flagshipStory: {
    status: "running",
    phases: { creation: { revision: project.revision } },
  },
};
if (clearanceDiagnostic || clearancePathDiagnostic) {
  report.targetDocument = {
    path: "/project.json",
    bytes: targetDocumentBytes.byteLength,
    sha256: targetDocumentSha256,
  };
  report.diagnosticMutation = diagnosticMutation;
}

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
let context;
try {
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin && report.externalRequests.length < 32)
      report.externalRequests.push({ origin: url.origin, path: url.pathname });
  });
  page.on("pageerror", (error) => {
    if (report.pageErrors.length < 32)
      report.pageErrors.push(sanitizeDiagnosticText(error.message));
  });
  page.on("console", (message) => {
    if (message.type() === "error" && report.consoleErrors.length < 32)
      report.consoleErrors.push(sanitizeDiagnosticText(message.text()));
  });
  page.on("requestfailed", (request) => {
    if (report.requestFailures.length >= 32) return;
    const url = new URL(request.url());
    report.requestFailures.push({
      origin: url.origin === origin ? "loopback" : "external",
      path: url.pathname,
      failure: sanitizeDiagnosticText(request.failure()?.errorText),
    });
  });
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort("blockedbyclient"),
  );
  await page.addInitScript(() => {
    window.__ORBSIE_GAMEPLAY_READ_REQUESTED__ = true;
  });
  try {
    await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  } catch (error) {
    report.navigationError = sanitizeDiagnosticText(error?.message);
  }
  try {
    await page.locator('main[data-ready="true"]').waitFor({ timeout: 30000 });
    report.readiness = await page.evaluate(() => {
      const observation = window.__ORBSIE_GAMEPLAY_READ__?.();
      return {
        status: "ready",
        projectId: observation?.projectId ?? null,
        revision: observation?.revision ?? null,
        renderer: observation?.renderer ?? null,
        initialPlayerPosition: observation?.player?.position ?? null,
        score: document.querySelector(".score")?.textContent ?? null,
      };
    });
    await page.screenshot({
      path: join(outputPath, "scene-ready.png"),
      fullPage: true,
    });
    report.screenshots.push("scene-ready.png");
  } catch {
    report.readiness = { status: "not-ready" };
  }

  let result;
  try {
    result = await runFreshFlagshipGameplay(page, project, targets, {
      surface: "standalone",
      inputMode: "keyboard",
      expectedCollectibleCount: 5,
      expectedRevision: project.revision,
      onWin: async () => {
        await page.screenshot({
          path: join(outputPath, "portal-win.png"),
          fullPage: true,
        });
        report.screenshots.push("portal-win.png");
      },
      onReset: async () => {
        await page.screenshot({
          path: join(outputPath, "ui-reset.png"),
          fullPage: true,
        });
        report.screenshots.push("ui-reset.png");
      },
    });
    assert.equal(result.projectId, project.id);
    assert.equal(result.revision, project.revision);
    assert.deepEqual(
      [...result.collectedIds].sort(),
      targets.collectibles.map((entity) => entity.id).sort(),
    );
    assert.equal(result.contacts.includes(targets.portal.id), true);
    assert.equal(result.win?.status, "won");
    assert.equal(result.win?.score, 5);
    assert.equal(result.reset?.status, "playing");
    assert.equal(result.reset?.score, 0);
    assert.equal(result.reset?.projectId, project.id);
    assert.equal(result.reset?.revision, project.revision);
    assert.equal(result.reset?.lifecycleAdvanced, true);
    report.flagshipStory = {
      status: "passed",
      phases: {
        creation: {
          status: "passed",
          revision: project.revision,
          gameplay: {
            status: "passed",
            projectId: project.id,
            revision: project.revision,
            contacts: result.contacts,
            collections: result.collectedIds,
            win: result.win,
            reset: result.reset,
          },
        },
      },
    };
    report.status = "passed";
  } catch (error) {
    recordFreshFlagshipGameplayFailure(report, "creation", project, error);
    const message = String(error?.message ?? "");
    const directTarget = /did not contact platform ([A-Za-z0-9_.:-]+)/.exec(
      message,
    )?.[1];
    const recovery =
      /could not recover reachable support ([A-Za-z0-9_.:-]+) before retrying ([A-Za-z0-9_.:-]+)/.exec(
        message,
      );
    if (targets.platforms.some((platform) => platform.id === directTarget)) {
      report.errorCode = {
        code: "platform-contact-not-observed",
        targetId: directTarget,
      };
    } else if (
      recovery &&
      targets.platforms.some((platform) => platform.id === recovery[1]) &&
      targets.platforms.some((platform) => platform.id === recovery[2])
    ) {
      report.errorCode = {
        code: "support-recovery-not-observed",
        supportId: recovery[1],
        retryTargetId: recovery[2],
      };
    } else {
      report.errorCode = { code: "fresh-gameplay-traversal-incomplete" };
    }
    report.status = "traversal-failed";
  }
  try {
    await page.screenshot({
      path: join(outputPath, "traversal-final.png"),
      fullPage: true,
    });
    report.screenshots.push("traversal-final.png");
  } catch {}

  const evidence =
    report.flagshipStory.phases.creation.gameplay?.failureEvidence;
  const last = evidence?.lastObservation;
  const movement = evidence?.movement?.distance > 0.12;
  const third = evidence?.platformEvidence?.find(
    (item) => item.id === "bounce-three",
  );
  const bounceOneEvidence = evidence?.platformEvidence?.find(
    (item) => item.id === "bounce-1",
  );
  const bounceOneObservedYValues = [
    ...(bounceOneEvidence?.jumpEvidence ?? []).flatMap((attempt) =>
      (attempt.samples ?? []).map((sample) => sample.platform?.position?.[1]),
    ),
  ]
    .filter(Number.isFinite)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((a, b) => a - b);
  if (clearanceDiagnostic || clearancePathDiagnostic) {
    report.diagnosticResult = {
      observedBounceOnePlatformYValues: bounceOneObservedYValues,
      observedContactFrames:
        (bounceOneEvidence?.groundedFrames ?? 0) +
        (bounceOneEvidence?.bounceFrames ?? 0),
      score: last?.gameScore ?? null,
      won: last?.won ?? null,
      reset: last?.reset ?? null,
    };
    if (clearancePathDiagnostic) {
      report.diagnosticResult.targetPlatformY = 0.4;
      report.diagnosticResult.targetPlatformYObserved =
        bounceOneObservedYValues.includes(0.4);
    }
  }
  const runtimeResponded =
    report.readiness?.status === "ready" &&
    last?.projectId === project.id &&
    last?.revision === project.revision &&
    ["webgl", "software"].includes(last?.renderer) &&
    report.pageErrors.length === 0 &&
    report.externalRequests.length === 0;
  if (report.status !== "passed") {
    if (
      clearanceDiagnostic &&
      diagnosticMutation.unchangedMovePath.pointYValues.every(
        (value) => value === diagnosticMutation.sourceValue,
      ) &&
      bounceOneObservedYValues.includes(diagnosticMutation.sourceValue)
    ) {
      report.diagnosis = {
        category: "diagnostic-anchor-overridden-by-authored-path",
        basis:
          "The anchor-only mutation was retained in the served document, but the unchanged move_path starts bounce-1 at its original Y and all path points keep Y constant there. Browser telemetry likewise observed bounce-1 at the original Y. This traversal did not test the lowered landing plane, and route versus driver uncertainty remains.",
        observedBounceOnePlatformYValues: bounceOneObservedYValues,
        routeOutcome: report.status,
      };
    } else if (report.navigationError?.includes("Download is starting")) {
      report.status = "replay-setup-failed";
      report.errorCode = { code: "standalone-shell-served-as-download" };
      report.diagnosis = {
        category: "replay-driver-setup-failure",
        basis:
          "Chromium treated the static standalone shell as a download before the player runtime loaded.",
      };
    } else if (
      report.pageErrors.length > 0 ||
      localRequests.some(
        (request) => request.status >= 400 && request.path !== "/favicon.ico",
      )
    ) {
      report.diagnosis = {
        category: "runtime-or-static-asset-failure",
        basis:
          "The local player reported an error or requested a missing runtime asset.",
      };
    } else if (
      runtimeResponded &&
      movement &&
      third?.maximumDisplacement >= 0.05
    ) {
      report.diagnosis = {
        category: "driver-uncertainty",
        basis:
          "The exact saved revision accepted keyboard movement and bounce-three moved, so this single failed traversal does not establish that the authored route is unreachable.",
        targetId: report.errorCode?.targetId ?? null,
        keyboardMovementDistance: evidence.movement.distance,
        bounceThreeMaximumDisplacement: third.maximumDisplacement,
      };
    } else {
      report.diagnosis = {
        category: "runtime-route-or-driver-unresolved",
        basis:
          "The bounded attempt lacked enough matching runtime and movement evidence to distinguish route failure from driver uncertainty.",
        revisionBoundObservation: Boolean(runtimeResponded),
        keyboardMovementObserved: Boolean(movement),
        bounceThreeMaximumDisplacement: third?.maximumDisplacement ?? null,
      };
    }
  }
} catch (error) {
  report.status = "runtime-or-static-asset-failure";
  report.diagnosis = {
    category: "runtime-or-static-asset-failure",
    detail: sanitizeDiagnosticText(
      error?.message ?? "local replay setup failed",
    ),
  };
} finally {
  await context?.close().catch(() => undefined);
  await browser.close();
  await new Promise((resolveServer) => server.close(resolveServer));
}

report.finishedAt = new Date().toISOString();
report.localRequests = localRequests;
await writeFile(
  join(outputPath, "report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);
console.log(
  JSON.stringify(
    { status: report.status, diagnosis: report.diagnosis, outputPath },
    null,
    2,
  ),
);
