#!/usr/bin/env node
// Deterministic browser acceptance for one moving bounce platform. The
// generation response is a test-only NDJSON fixture; all gameplay evidence
// comes from rendered Three.js telemetry and real browser input.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

const appUrl = process.env.TEST_URL ?? "http://127.0.0.1:3068";
const appOrigin = new URL(appUrl).origin;
const output = resolve(
  process.argv[2] ?? "docs/evidence/moving-bounce-browser",
);
const appSourceCommit = process.env.ORBSIE_APP_SOURCE_COMMIT?.trim() || null;
const platformId = "moving-bounce-platform";
const catalogManifest = JSON.parse(
  await readFile(
    new URL("../assets/catalog/manifest.json", import.meta.url),
    "utf8",
  ),
);
const platformAsset = catalogManifest.assets.find(
  (asset) => asset.id === "kenney.nature.platform-grass",
);
assert(platformAsset, "Moving-bounce fixture requires the catalog platform.");
const evidence = {
  platformId,
  assetId: "kenney.nature.platform-grass",
  bounds: {
    min: [...platformAsset.bounds.min],
    max: [...platformAsset.bounds.max],
  },
  position: [-0.85, 0.35, 3.2],
  scale: [3, 3, 3],
  path: {
    points: [
      [-0.85, 0.35, 3.2],
      [1.1, 0.35, 3.2],
    ],
    duration: 2.8,
    loop: true,
  },
};
const game = {
  variables: [],
  rules: [
    {
      id: "start-moving-bounce",
      trigger: { type: "start" },
      conditions: [],
      actions: [
        {
          type: "move_path",
          entityId: platformId,
          points: evidence.path.points,
          duration: evidence.path.duration,
          loop: evidence.path.loop,
        },
      ],
    },
  ],
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const rootHead = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const verifierBytes = await readFile(new URL(import.meta.url));
const runtimeBytes = await readFile("public/player/runtime.js");
const runtimeCssBytes = await readFile("public/player/runtime.css");
const verifierSha256 = sha256(verifierBytes);
const runtimeSha256 = sha256(runtimeBytes);
const runtimeCssSha256 = sha256(runtimeCssBytes);

function reserveEntity(entity) {
  const { geometry, stage, ...rest } = entity;
  return {
    type: "reserve_entity",
    entity: { ...rest, stage: "seed" },
  };
}

const platformEntity = {
  id: platformId,
  label: "Moving bounce platform",
  position: evidence.position,
  color: "#74c884",
  scale: evidence.scale,
  geometry: {
    kind: "asset",
    detail: "refined",
    assetId: evidence.assetId,
  },
  behavior: { type: "bounce" },
  stage: "ready",
};
const fixtureCommands = [
  reserveEntity(platformEntity),
  {
    type: "set_geometry",
    id: platformId,
    geometry: platformEntity.geometry,
  },
  { type: "set_game", game },
  {
    type: "commit_revision",
    message:
      "A moving bounce platform is ready. Jump once, release, and watch it carry the bounce.",
  },
];
const fixtureBody =
  fixtureCommands.map((command) => JSON.stringify(command)).join("\n") + "\n";

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
      if (keyEvents.length < 128)
        keyEvents.push({
          type: "down",
          key: event.key,
          atPerformanceMs: performance.now(),
        });
    });
    window.addEventListener("keyup", (event) => {
      if (keyEvents.length < 128)
        keyEvents.push({
          type: "up",
          key: event.key,
          atPerformanceMs: performance.now(),
        });
    });
    window.addEventListener("orbsie-input", (event) => {
      if (inputEvents.length < 128)
        inputEvents.push({
          key: event.detail?.key,
          down: Boolean(event.detail?.down),
          pointerId: event.detail?.pointerId,
          atPerformanceMs: performance.now(),
        });
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
          const bounds = localBounds(object.geometry);
          if (!bounds) return;
          const parent = object.parent;
          const key = parent.uuid;
          if (!groups.has(key)) {
            const matrix = parent.matrixWorld.elements;
            groups.set(key, {
              uuid: key,
              worldBounds: worldBounds(matrix, bounds),
              scale: scaleFromMatrix(parent.matrix.elements),
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
        atPerformanceMs: performance.now(),
        player: playerBounds
          ? {
              visible: Boolean(
                playerMesh.parent?.visible && playerMesh.visible,
              ),
              center: center(playerBounds),
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

function platformView(telemetry) {
  const candidates = telemetry.groups
    .map((group) => ({
      ...group,
      dimensions: dimensions(group.worldBounds),
      center: [
        (group.worldBounds.min[0] + group.worldBounds.max[0]) / 2,
        (group.worldBounds.min[1] + group.worldBounds.max[1]) / 2,
        (group.worldBounds.min[2] + group.worldBounds.max[2]) / 2,
      ],
    }))
    .filter(
      (group) =>
        group.dimensions[0] > 1.8 &&
        group.dimensions[0] < 4 &&
        group.dimensions[1] < 1.2 &&
        group.dimensions[2] > 1.4 &&
        group.dimensions[2] < 3 &&
        group.center[1] > 0.2 &&
        group.center[1] < 2,
    )
    .sort(
      (a, b) =>
        b.dimensions[0] * b.dimensions[2] - a.dimensions[0] * a.dimensions[2],
    );
  return candidates[0] ?? null;
}

function compactTelemetry(telemetry) {
  const player = telemetry.player?.runtimeCenter
    ? {
        center: telemetry.player.runtimeCenter,
        visible: telemetry.player.visible,
      }
    : telemetry.player;
  const platform = platformView(telemetry);
  return {
    atPerformanceMs: telemetry.atPerformanceMs,
    player,
    platform: platform
      ? {
          center: platform.center,
          bounds: platform.worldBounds,
          dimensions: platform.dimensions,
        }
      : null,
    keyEvents: telemetry.keyEvents ?? [],
    inputEvents: telemetry.inputEvents ?? [],
  };
}

function overlap(player, platform) {
  if (!player || !platform) return false;
  return (
    Math.abs(player.center[0] - platform.center[0]) <=
      platform.dimensions[0] / 2 + 0.22 &&
    Math.abs(player.center[2] - platform.center[2]) <=
      platform.dimensions[2] / 2 + 0.22
  );
}

function contactHeight() {
  // Gameplay uses the trusted catalog bounds for support contact. The
  // rendered GLB may carry a different local origin, so rendered bounds are
  // retained for overlap while this source height stays authoritative.
  return (
    evidence.position[1] + evidence.bounds.max[1] * evidence.scale[1] + 0.42
  );
}

function descendingContact(samples, startAt = -Infinity, candidateStart = 1) {
  for (let index = candidateStart; index < samples.length; index++) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (
      !previous.player ||
      !current.player ||
      !previous.platform ||
      !current.platform ||
      current.atPerformanceMs < startAt
    )
      continue;
    const currentHeight = contactHeight();
    const previousHeight = contactHeight();
    if (
      previous.player.center[1] - current.player.center[1] < 0.02 ||
      previous.player.center[1] < previousHeight - 0.14 ||
      current.player.center[1] > currentHeight + 0.14 ||
      !overlap(current.player, current.platform)
    )
      continue;
    return {
      index,
      previous,
      current,
      contactHeight: currentHeight,
      descentDelta: current.player.center[1] - previous.player.center[1],
      descending: true,
      crossedHeight: true,
      overlap: true,
    };
  }
  return null;
}

// Require a low point near the support surface followed by two measured
// upward samples. A fall or a flat hold at the surface cannot pass this test.
function bounceTransition(samples, startAt = -Infinity) {
  // A slow screenshot or an unlucky sample can expose a near-surface frame
  // before the actual crossing. Try every candidate so frame timing cannot
  // hide a later, valid descending-contact/rebound bracket.
  for (
    let candidateStart = 1;
    candidateStart < samples.length;
    candidateStart++
  ) {
    const contact = descendingContact(samples, startAt, candidateStart);
    if (!contact) return null;
    let minimumIndex = contact.index;
    for (
      let index = contact.index + 1;
      index < Math.min(samples.length, contact.index + 5);
      index++
    ) {
      const previous = samples[index - 1]?.player?.center[1];
      const current = samples[index]?.player?.center[1];
      if (
        Number.isFinite(previous) &&
        Number.isFinite(current) &&
        current <= previous + 0.012
      )
        minimumIndex = index;
      else break;
    }
    const minimum = samples[minimumIndex]?.player?.center[1];
    if (
      !Number.isFinite(minimum) ||
      Math.abs(minimum - contact.contactHeight) > 0.18
    )
      continue;
    let upwardSteps = 0;
    const upwardDeltas = [];
    for (
      let index = minimumIndex + 1;
      index < Math.min(samples.length, minimumIndex + 10);
      index++
    ) {
      const previous = samples[index - 1]?.player?.center[1];
      const current = samples[index]?.player?.center[1];
      if (!Number.isFinite(previous) || !Number.isFinite(current)) {
        upwardSteps = 0;
        upwardDeltas.length = 0;
        continue;
      }
      const delta = current - previous;
      if (delta >= 0.015) {
        upwardSteps++;
        upwardDeltas.push(delta);
        if (upwardSteps >= 2 && current - minimum >= 0.08) {
          const ascentDeltas = upwardDeltas.slice(-2);
          return {
            contact,
            minimumIndex,
            ascentIndex: index,
            ascentDeltas,
            velocityDirectionReversal:
              contact.descentDelta < 0 &&
              ascentDeltas.every((delta) => delta > 0),
          };
        }
      } else if (delta !== 0) {
        // Preserve the ascent across unchanged rendered frames. Any actual
        // reversal or sub-threshold rise starts a fresh measured ascent.
        upwardSteps = 0;
        upwardDeltas.length = 0;
      }
    }
  }
  return null;
}

function regressionSample(y, index) {
  return {
    atPerformanceMs: index,
    player: { center: [0, y, 0], visible: true },
    platform: {
      center: [0, 0.5, 0],
      bounds: { min: [-1, 0, -1], max: [1, 0.6, 1] },
      dimensions: [2, 0.6, 2],
    },
  };
}

const continuedFall = [1.3, 1.16, 1.03, 0.91].map(regressionSample);
const flatAtSurface = [1.3, 1.16, 1.03, 1.02, 1.02, 1.02].map(regressionSample);
const repeatedFrameBounce = [1.3, 1.16, 1.05, 1.02, 1.02, 1.2, 1.2, 1.4].map(
  regressionSample,
);
const repeatedFrameTransition = bounceTransition(repeatedFrameBounce);
assert(
  repeatedFrameTransition?.velocityDirectionReversal,
  "Repeated rendered frames should preserve bounce ascent.",
);
assert.equal(bounceTransition(continuedFall), null);
assert.equal(bounceTransition(flatAtSurface), null);

function motionStats(samples) {
  const x = samples
    .map((sample) => sample.platform?.center[0])
    .filter(Number.isFinite);
  const y = samples
    .map((sample) => sample.platform?.center[1])
    .filter(Number.isFinite);
  const z = samples
    .map((sample) => sample.platform?.center[2])
    .filter(Number.isFinite);
  return {
    sampleCount: samples.length,
    xRange: x.length ? Math.max(...x) - Math.min(...x) : null,
    yRange: y.length ? Math.max(...y) - Math.min(...y) : null,
    zRange: z.length ? Math.max(...z) - Math.min(...z) : null,
  };
}

async function touchSession(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
  return cdp;
}

async function touchPoint(page, label, id) {
  const box = await page
    .getByRole("button", { name: label, exact: true })
    .boundingBox();
  if (!box) throw Error(`Missing visible touch control ${label}.`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, id };
}

async function runBounce(page, mode, report) {
  const read = async () =>
    compactTelemetry(await page.evaluate(() => window.__orbReadWorld()));
  let beforeJump;
  await expect
    .poll(
      async () => {
        const telemetry = await page.evaluate(() => window.__orbReadWorld?.());
        beforeJump = telemetry ? compactTelemetry(telemetry) : null;
        return Boolean(beforeJump?.player?.visible && beforeJump?.platform);
      },
      { timeout: 30000 },
    )
    .toBe(true);
  await page.mouse.click(
    mode === "touch" ? 195 : 1100,
    mode === "touch" ? 180 : 650,
  );
  await page.evaluate(
    () =>
      document.activeElement instanceof HTMLElement &&
      document.activeElement.blur(),
  );
  assert(
    beforeJump.player?.visible,
    `${mode}: player was not rendered before jump.`,
  );
  assert(beforeJump.platform, `${mode}: moving platform was not rendered.`);
  const inputStartAt = beforeJump.atPerformanceMs;
  let releaseAt;
  let cdp;
  let heldTouch = [];
  const samples = [beforeJump];
  const modeReport = {
    inputStartAt,
    releaseAt: null,
    samples,
  };
  report[mode] = modeReport;
  if (mode === "touch") {
    cdp = await touchSession(page);
    heldTouch = [
      await touchPoint(page, "Forward", 101),
      await touchPoint(page, "Jump", 102),
    ];
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: heldTouch,
    });
    for (let index = 0; index < 10; index++) {
      await page.waitForTimeout(50);
      samples.push(await read());
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    releaseAt = await page.evaluate(() => performance.now());
  } else {
    await page.keyboard.down("w");
    await page.keyboard.down(" ");
    for (let index = 0; index < 10; index++) {
      await page.waitForTimeout(50);
      samples.push(await read());
    }
    await page.keyboard.up(" ");
    await page.keyboard.up("w");
    releaseAt = await page.evaluate(() => performance.now());
  }
  modeReport.releaseAt = releaseAt;

  let contactBracket = null;
  let transition = null;
  for (let index = 0; index < 48; index++) {
    await page.waitForTimeout(32);
    const current = await read();
    samples.push(current);
    const contact = descendingContact(samples, releaseAt);
    if (contact && !contactBracket) {
      contactBracket = {
        ...contact,
        noJumpInputAfterRelease: releaseAt <= contact.current.atPerformanceMs,
      };
    }
    transition = bounceTransition(samples, releaseAt);
    if (transition) {
      contactBracket = {
        ...transition.contact,
        noJumpInputAfterRelease:
          releaseAt <= transition.contact.current.atPerformanceMs,
      };
      await page.screenshot({
        path: join(report.output, `${mode}-bounce-contact.png`),
      });
      await page.screenshot({
        path: join(report.output, `${mode}-bounce-ascent.png`),
      });
      break;
    }
  }
  assert(
    contactBracket,
    `${mode}: no descending rendered contact with bounce platform.`,
  );
  assert(
    contactBracket.noJumpInputAfterRelease,
    `${mode}: contact preceded jump release.`,
  );

  assert(
    transition,
    `${mode}: player did not ascend after rendered contact without jump input.`,
  );
  assert.equal(
    transition.velocityDirectionReversal,
    true,
    `${mode}: rendered vertical velocity did not reverse after contact.`,
  );
  const ascentSamples = samples.slice(transition.minimumIndex);

  const pathSamples = [...ascentSamples];
  for (let index = pathSamples.length; index < 30; index++) {
    await page.waitForTimeout(40);
    pathSamples.push(await read());
  }
  const pathMotion = motionStats(pathSamples);
  assert(
    pathMotion.xRange > 0.12,
    `${mode}: platform did not continue horizontal motion after bounce (xRange=${pathMotion.xRange}).`,
  );
  await page.screenshot({
    path: join(report.output, `${mode}-bounce-path.png`),
  });

  const telemetry = await page.evaluate(() => window.__orbReadWorld());
  const postReleaseJumpEvents = [
    ...(telemetry.keyEvents ?? [])
      .filter(
        (event) => event.atPerformanceMs >= releaseAt && event.key === " ",
      )
      .map((event) => ({ ...event, source: "keyboard" })),
    ...(telemetry.inputEvents ?? [])
      .filter(
        (event) =>
          event.atPerformanceMs >= releaseAt &&
          String(event.key).toLowerCase() === " " &&
          event.down,
      )
      .map((event) => ({ ...event, source: "touch" })),
  ];
  assert.equal(
    postReleaseJumpEvents.length,
    0,
    `${mode}: jump input occurred after release before/after bounce.`,
  );
  report[mode] = {
    ...modeReport,
    beforeJump,
    contact: contactBracket,
    transition,
    ascentSamples,
    pathMotion,
    postReleaseJumpEvents,
    keyEvents: telemetry.keyEvents ?? [],
    inputEvents: telemetry.inputEvents ?? [],
  };
}

function contentType(path) {
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
    }[path.split(".").pop()] ?? "application/octet-stream"
  );
}

await mkdir(output, { recursive: false });
const report = {
  status: "failed",
  scope:
    "One fixture intercepted through the real editor UI, reload recovery, ZIP export, desktop keyboard bounce, and exported 390x844 CDP touch bounce run",
  appUrl,
  appSourceCommit,
  sourceCommits: {
    repoHead: rootHead,
    appSourceAssumedFromRepoHead: appSourceCommit === null,
    verifierSha256,
    runtimeSha256,
    runtimeCssSha256,
  },
  fixture: {
    transport: "test-only intercepted application/x-ndjson",
    requestCount: 0,
    modelCalls: 0,
    providerCalls: 0,
    bodySha256: sha256(fixtureBody),
    contactHeight: contactHeight(),
    commands: fixtureCommands,
    requestSummaries: [],
  },
  externalRequests: [],
  standaloneRequests: [],
  pageErrors: [],
  checks: {},
  output,
};
report.checks.syntheticBounceRegression = {
  repeatedFrameBounceAccepted: Boolean(
    repeatedFrameTransition?.velocityDirectionReversal,
  ),
  continuedFallRejected: bounceTransition(continuedFall) === null,
  flatAtSurfaceRejected: bounceTransition(flatAtSurface) === null,
};

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
let editorContext;
let editorPage;
let standaloneContext;
let standalonePage;
let standaloneServer;
let failure;
try {
  editorContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
    recordVideo: { dir: output, size: { width: 1280, height: 800 } },
  });
  const rejectExternal = async (route, standaloneOrigin) => {
    const request = route.request();
    const target = new URL(request.url());
    if (target.origin === (standaloneOrigin ?? appOrigin))
      return route.fallback();
    if (target.protocol === "data:") return route.fallback();
    report.externalRequests.push(target.href);
    return route.abort();
  };
  await editorContext.route("**/*", (route) => rejectExternal(route));
  await editorContext.route("**/api/trial", (route) =>
    route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } }),
  );
  await editorContext.route("**/api/generate", async (route) => {
    report.fixture.requestCount += 1;
    const request = route.request().postDataJSON();
    const requestShapeValid = Boolean(
      request.provider === "free" &&
      request.localModeling === false &&
      request.browserModeling === true &&
      request.project &&
      typeof request.project.id === "string" &&
      request.selected === undefined &&
      request.project.entities.length === 0,
    );
    report.fixture.requestSummaries.push({
      prompt: request.prompt,
      selected: request.selected,
      revision: request.project.revision,
      entityIds: request.project.entities.map((entity) => entity.id),
      requestShapeValid,
    });
    if (!requestShapeValid)
      return route.fulfill({
        status: 400,
        json: { error: "Unexpected fixture request shape." },
      });
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: fixtureBody,
    });
  });
  editorPage = await editorContext.newPage();
  editorPage.setDefaultTimeout(30000);
  editorPage.on("pageerror", (error) =>
    report.pageErrors.push(`editor: ${error.message}`),
  );
  await editorPage.addInitScript(makeTelemetryInitScript());
  await editorPage.goto(appUrl);
  await editorPage.waitForSelector("canvas");
  await editorPage
    .getByPlaceholder("What experience to build?")
    .fill("Build a moving bounce platform game with one reachable jump.");
  await editorPage.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    editorPage.getByText("A moving bounce platform is ready.", {
      exact: false,
    }),
  ).toBeVisible({ timeout: 30000 });
  assert.equal(report.fixture.requestCount, 1);
  assert.equal(report.fixture.requestSummaries[0]?.requestShapeValid, true);
  await expect
    .poll(
      async () =>
        (await editorPage.evaluate(
          () => window.__orbReadWorld?.().groups?.length ?? 0,
        )) > 0,
    )
    .toBe(true);
  report.checks.createdThroughEditor = true;
  await editorPage.screenshot({ path: join(output, "editor-created.png") });

  await editorPage.reload();
  await expect(
    editorPage.getByRole("button", { name: "Continue your saved world" }),
  ).toBeVisible({ timeout: 15000 });
  report.checks.reloadPrompt = true;
  await editorPage
    .getByRole("button", { name: "Continue your saved world" })
    .click();
  await expect(
    editorPage.getByText("A moving bounce platform is ready.", {
      exact: false,
    }),
  ).toBeVisible({ timeout: 15000 });
  report.checks.reloadRecovery = true;
  await editorPage.screenshot({ path: join(output, "editor-reloaded.png") });

  await editorPage.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    editorPage.getByRole("button", { name: "Restart game" }),
  ).toBeVisible();
  report.checks.editorPlayReady = true;
  await runBounce(editorPage, "desktop", report);
  report.checks.desktopBounce = true;

  await editorPage
    .getByRole("button", { name: "Share Orb", exact: true })
    .click();
  const downloadPromise = editorPage.waitForEvent("download");
  await editorPage
    .getByRole("button", { name: /^Download your world/ })
    .click();
  const download = await downloadPromise;
  const archivePath = join(output, "world.zip");
  await download.saveAs(archivePath);
  const files = unzipSync(await readFile(archivePath));
  const exportedProject = JSON.parse(strFromU8(files["project.json"]));
  assert.equal(exportedProject.entities.length, 1);
  assert.deepEqual(exportedProject.entities[0].behavior, { type: "bounce" });
  assert.deepEqual(
    exportedProject.entities[0].geometry,
    platformEntity.geometry,
  );
  assert.deepEqual(exportedProject.game, game);
  assert(files["runtime.js"] && files["runtime.css"] && files["index.html"]);
  report.checks.exported = {
    archiveSha256: sha256(await readFile(archivePath)),
    projectSha256: sha256(files["project.json"]),
    projectRevision: exportedProject.revision,
    entityIds: exportedProject.entities.map((entity) => entity.id),
    gameRules: exportedProject.game.rules.map((rule) => rule.id),
  };

  standaloneServer = createServer((request, response) => {
    const path =
      new URL(request.url ?? "/", "http://standalone.local").pathname.slice(
        1,
      ) || "index.html";
    report.standaloneRequests.push({ method: request.method, path });
    const bytes = files[path];
    if (!bytes) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType(path),
      "Cache-Control": "no-store",
    });
    response.end(bytes);
  });
  await new Promise((resolveServer, rejectServer) => {
    standaloneServer.once("error", rejectServer);
    standaloneServer.listen(0, "127.0.0.1", resolveServer);
  });
  const standaloneOrigin = `http://127.0.0.1:${standaloneServer.address().port}`;
  standaloneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
    recordVideo: { dir: output, size: { width: 390, height: 844 } },
  });
  await standaloneContext.route("**/*", (route) =>
    rejectExternal(route, standaloneOrigin),
  );
  standalonePage = await standaloneContext.newPage();
  standalonePage.setDefaultTimeout(30000);
  standalonePage.on("pageerror", (error) =>
    report.pageErrors.push(`standalone: ${error.message}`),
  );
  await standalonePage.addInitScript(makeTelemetryInitScript());
  await standalonePage.goto(standaloneOrigin);
  await expect(standalonePage.locator("main[data-ready=true]")).toBeVisible({
    timeout: 30000,
  });
  report.checks.standaloneReady = true;
  await runBounce(standalonePage, "touch", report);
  report.checks.touchBounce = true;
  report.status = "passed";
} catch (error) {
  failure = error;
  report.error = error instanceof Error ? error.message : String(error);
  await editorPage
    ?.screenshot({ path: join(output, "failure-editor.png") })
    .catch(() => undefined);
  await standalonePage
    ?.screenshot({ path: join(output, "failure-standalone.png") })
    .catch(() => undefined);
} finally {
  const editorVideo = editorPage?.video();
  const standaloneVideo = standalonePage?.video();
  await standaloneContext?.close().catch(() => undefined);
  await editorContext?.close().catch(() => undefined);
  if (standaloneServer) {
    standaloneServer.closeAllConnections();
    await new Promise((resolveServer) => standaloneServer.close(resolveServer));
  }
  report.videos = {};
  if (editorVideo)
    await editorVideo
      .saveAs(join(output, "editor-desktop.webm"))
      .then(() => {
        report.videos.editor = "editor-desktop.webm";
      })
      .catch((error) => {
        report.videos.editorError = String(error);
      });
  if (standaloneVideo)
    await standaloneVideo
      .saveAs(join(output, "standalone-touch.webm"))
      .then(() => {
        report.videos.standalone = "standalone-touch.webm";
      })
      .catch((error) => {
        report.videos.standaloneError = String(error);
      });
  await browser.close().catch(() => undefined);
  report.standaloneRequests = report.standaloneRequests.filter(Boolean);
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
}
if (failure) process.exitCode = 1;
