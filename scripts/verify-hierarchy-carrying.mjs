#!/usr/bin/env node
// Deterministic browser acceptance for parented platform carrying. Provider
// calls are intercepted; this script never makes a model or account request.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";

const url = process.env.TEST_URL ?? "http://localhost:3047";
const output = process.argv[2];
if (!output) throw Error("Provide a new evidence directory.");
await mkdir(output, { recursive: false });

const rootHead = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const runtimeBytes = await readFile("public/player/runtime.js");
const runtimeGitHead = execFileSync(
  "git",
  ["log", "-1", "--format=%H", "--", "public/player/runtime.js"],
  { encoding: "utf8" },
).trim();
const suppliedSourceCommit = process.env.ORBSIE_APP_SOURCE_COMMIT?.trim();
if (suppliedSourceCommit && !/^[a-f0-9]{7,40}$/i.test(suppliedSourceCommit))
  throw Error("ORBSIE_APP_SOURCE_COMMIT must be a 7-40 character hex commit.");

const ids = {
  group: "carry-group-01",
  platform: "carry-platform-01",
  unrelated: "carry-unrelated-prop-01",
};
const labels = {
  group: "Off-center carrying group",
  platform: "Large carrying platform",
  unrelated: "Unrelated tree prop",
};

// The platform starts over the player after a short A-key repositioning. Its
// static behavior keeps the parent-pose carrying check deterministic.
const fixture = {
  version: 1,
  stableIds: ids,
  labels,
  group: {
    id: ids.group,
    label: labels.group,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  },
  platform: {
    id: ids.platform,
    label: labels.platform,
    parentId: ids.group,
    position: [-1.5, 0.45, 4],
    scale: [3.4, 0.5, 2.8],
    color: "#efc79c",
    stage: "ready",
    geometry: { kind: "platform", detail: "refined" },
    behavior: { type: "static" },
  },
  unrelated: {
    id: ids.unrelated,
    label: labels.unrelated,
    position: [4.4, 0, -3.5],
    scale: [1.1, 1.2, 1.1],
    color: "#77a664",
    stage: "ready",
    geometry: { kind: "tree", detail: "refined" },
    behavior: { type: "static" },
  },
  editedGroup: {
    id: ids.group,
    label: labels.group,
    position: [0.35, 0.05, 0.2],
    rotation: [0, Math.PI / 2, 0],
    scale: [1.2, 1.2, 1.2],
  },
};

function reserveEntity(entity) {
  const { geometry, stage, ...rest } = entity;
  return {
    type: "reserve_entity",
    entity: { ...rest, geometry: undefined, stage: "seed" },
  };
}

function initialCommands() {
  return [
    { type: "create_group", group: fixture.group },
    reserveEntity(fixture.platform),
    {
      type: "set_geometry",
      id: ids.platform,
      geometry: fixture.platform.geometry,
    },
    reserveEntity(fixture.unrelated),
    {
      type: "set_geometry",
      id: ids.unrelated,
      geometry: fixture.unrelated.geometry,
    },
    {
      type: "commit_revision",
      message: "The off-center platform is ready for a carrying check.",
    },
  ];
}

function editCommands() {
  return [
    {
      type: "set_group_transform",
      id: ids.group,
      position: fixture.editedGroup.position,
      rotation: fixture.editedGroup.rotation,
      scale: fixture.editedGroup.scale,
    },
    {
      type: "commit_revision",
      message:
        "Rotated and scaled the carrying group while preserving its prop.",
    },
  ];
}

function ndjson(commands) {
  return commands.map((command) => JSON.stringify(command)).join("\n") + "\n";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function composeTransform(node) {
  return new Matrix4().compose(
    new Vector3(...node.position),
    new Quaternion().setFromEuler(
      new Euler(...(node.rotation ?? [0, 0, 0]), "XYZ"),
    ),
    new Vector3(...node.scale),
  );
}

function expectedPlayerAfterCarry(playerBefore) {
  const beforeSupport = composeTransform(fixture.group).multiply(
    composeTransform(fixture.platform),
  );
  const afterSupport = composeTransform(fixture.editedGroup).multiply(
    composeTransform(fixture.platform),
  );
  const contactBefore = new Vector3(
    playerBefore.x,
    playerBefore.y - 0.42,
    playerBefore.z,
  );
  const expectedContact = contactBefore
    .applyMatrix4(beforeSupport.clone().invert())
    .applyMatrix4(afterSupport);
  return {
    x: expectedContact.x,
    y: expectedContact.y + 0.42,
    z: expectedContact.z,
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function axisDrift(samples) {
  if (!samples.length) return null;
  const axes = ["x", "y", "z"];
  return Object.fromEntries(
    axes.map((axis) => {
      const values = samples.map((sample) => sample[axis]);
      return [axis, Math.max(...values) - Math.min(...values)];
    }),
  );
}

const report = {
  mode: "deterministic-hierarchy-carrying-browser",
  provider: "fixture-intercepted",
  liveProvider: false,
  sourceCommits: {
    app: suppliedSourceCommit ?? rootHead,
    appAssumedFromRootHead: suppliedSourceCommit === undefined,
    rootHead,
    runtimeGitHead,
    runtimeSha256: createHash("sha256").update(runtimeBytes).digest("hex"),
  },
  stableIds: ids,
  requests: 0,
  requestSummaries: [],
  pageErrors: [],
  external: [],
  mutations: [],
  checks: {},
  status: "failed",
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
let page;
let failure;

try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  const appOrigin = new URL(url).origin;
  await context.route("**/*", async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    if (target.origin !== appOrigin && /^https?:$/.test(target.protocol)) {
      report.external.push(target.href);
      return route.abort();
    }
    if (request.method() !== "GET" && !target.pathname.startsWith("/api/")) {
      report.mutations.push(target.pathname);
      return route.abort();
    }
    return route.fallback();
  });
  await context.route("**/api/trial", (route) =>
    route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } }),
  );
  await context.route("**/api/generate", async (route) => {
    report.requests++;
    const request = route.request().postDataJSON();
    assert.equal(request.provider, "free");
    assert.equal(request.localModeling, false);
    assert.equal(request.browserModeling, true);
    assert.equal(request.key, "");
    assert(request.project && typeof request.project.id === "string");
    report.requestSummaries.push({
      request: report.requests,
      prompt: request.prompt,
      selected: request.selected,
      revision: request.project.revision,
      groupIds: (request.project.groups ?? []).map((group) => group.id),
      entityIds: request.project.entities.map((entity) => entity.id),
    });
    if (report.requests === 1) {
      assert.equal(request.selected, undefined);
      assert.equal(request.project.entities.length, 0);
      return route.fulfill({
        contentType: "application/x-ndjson",
        body: ndjson(initialCommands()),
      });
    }
    if (report.requests === 2) {
      assert.equal(request.selected, undefined);
      assert.deepEqual(
        request.project.groups?.find((group) => group.id === ids.group),
        fixture.group,
      );
      assert.deepEqual(
        request.project.entities.map((entity) => entity.id),
        [ids.platform, ids.unrelated],
      );
      assert.deepEqual(
        request.project.entities.find((entity) => entity.id === ids.platform)
          ?.parentId,
        ids.group,
      );
      return route.fulfill({
        contentType: "application/x-ndjson",
        body: ndjson(editCommands()),
      });
    }
    throw Error(`Unexpected generation request ${report.requests}`);
  });

  // Read-only devtools observation. The verifier never writes player, score,
  // transform or store state through this hook.
  await context.addInitScript(() => {
    const observed = [];
    const keyEvents = [];
    window.__orbKeyEvents = keyEvents;
    window.addEventListener("keydown", (event) => {
      if (keyEvents.length < 64)
        keyEvents.push({
          type: "down",
          key: event.key,
          target: event.target?.nodeName,
        });
    });
    window.addEventListener("keyup", (event) => {
      if (keyEvents.length < 64)
        keyEvents.push({
          type: "up",
          key: event.key,
          target: event.target?.nodeName,
        });
    });
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

  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.goto(url);
  await expect(page.locator("canvas")).toBeVisible();

  const waitProject = async (predicate, timeout = 45000) => {
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
  };
  const readPlayer = () => page.evaluate(() => window.__orbReadPlayer());
  await page
    .getByPlaceholder("What experience to build?")
    .fill(
      "Build a large off-center platform that carries the player with its parent",
    );
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const created = await waitProject(
    (project) =>
      project.groups?.some((group) => group.id === ids.group) &&
      project.entities.length === 2 &&
      project.entities.find((entity) => entity.id === ids.platform)?.stage ===
        "ready",
  );
  assert.deepEqual(
    created.entities.map((entity) => entity.id),
    [ids.platform, ids.unrelated],
  );
  assert.deepEqual(
    created.entities.find((entity) => entity.id === ids.platform)?.parentId,
    ids.group,
  );
  report.checks.initialHierarchyAndPlatform = true;
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toHaveClass(/active/);
  await page.waitForFunction(() => window.__orbReadPlayer()?.visible);
  // Blur the composer so gameplay key events reach the Player listener.
  await page.locator("canvas").click({ position: { x: 800, y: 450 } });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });

  // Move into the off-center support, then jump and allow the actual physics
  // step to descend onto its top surface.
  const movementSamples = [await readPlayer()];
  await page.keyboard.down("ArrowUp");
  for (let index = 0; index < 7; index++) {
    await page.waitForTimeout(80);
    movementSamples.push(await readPlayer());
  }
  await page.keyboard.up("ArrowUp");
  const moved = movementSamples.at(-1);
  await page.keyboard.press("Space");
  let airborne = await readPlayer();
  for (let index = 0; index < 24 && airborne.y <= 0.6; index++) {
    await page.waitForTimeout(50);
    airborne = await readPlayer();
  }
  assert(airborne?.visible, "player must be visible during the jump");
  assert(airborne.y > 0.6, `expected airborne player, got y=${airborne.y}`);
  report.checks.keyboardJump = {
    movementSamples,
    moved,
    airborne,
    movementInput: "ArrowUp",
    keyEvents: await page.evaluate(() => window.__orbKeyEvents),
    jumpInput: "Space",
  };
  const beforeSupportTop =
    fixture.platform.position[1] + 0.52 * fixture.platform.scale[1];
  let beforeSamples = [];
  for (let index = 0; index < 50 && beforeSamples.length < 5; index++) {
    const sample = await readPlayer();
    if (Math.abs(sample.y - (beforeSupportTop + 0.42)) < 0.1) {
      const candidate = [...beforeSamples, sample];
      if ((axisDrift(candidate)?.y ?? Infinity) < 0.08)
        beforeSamples = candidate;
      else beforeSamples = [sample];
    } else beforeSamples = [];
    await page.waitForTimeout(120);
  }
  const beforePlayer = beforeSamples.at(-1);
  assert(beforePlayer?.visible, "player must be visible after landing");
  assert(
    Math.abs(beforePlayer.y - (beforeSupportTop + 0.42)) < 0.1,
    `player did not land on platform top: y=${beforePlayer.y}, expected=${
      beforeSupportTop + 0.42
    }`,
  );
  assert(
    Math.abs(beforePlayer.x - fixture.platform.position[0]) <=
      0.55 * fixture.platform.scale[0] + 0.25 &&
      Math.abs(beforePlayer.z - fixture.platform.position[2]) <=
        0.55 * fixture.platform.scale[2] + 0.25,
    `player is not horizontally supported: ${JSON.stringify(beforePlayer)}`,
  );
  report.checks.actualKeyboardLanding = {
    samples: beforeSamples,
    drift: axisDrift(beforeSamples),
    supportTop: beforeSupportTop,
  };
  assert((axisDrift(beforeSamples)?.y ?? Infinity) < 0.08);
  const scoreBefore = await page.locator(".game-hud").innerText();
  await page.screenshot({ path: `${output}/platform-landed.png` });
  report.checks.actualKeyboardLanding.hud = scoreBefore;

  const beforeEdit = clone((await storageSnapshot(page)).project);
  await page
    .locator("#prompt")
    .fill(
      "Rotate the carrying group 90 degrees around Y, scale it uniformly by 1.2, and move it slightly while I am standing on the platform",
    );
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  const edited = await waitProject(
    (project) =>
      project.groups?.find((group) => group.id === ids.group)?.rotation?.[1] ===
        fixture.editedGroup.rotation[1] &&
      project.groups?.find((group) => group.id === ids.group)?.scale?.[0] ===
        fixture.editedGroup.scale[0],
  );
  assert.deepEqual(
    edited.groups?.find((group) => group.id === ids.group),
    fixture.editedGroup,
  );
  assert.deepEqual(
    clone(edited.entities.find((entity) => entity.id === ids.unrelated)),
    clone(beforeEdit.entities.find((entity) => entity.id === ids.unrelated)),
  );
  assert.deepEqual(
    edited.entities.find((entity) => entity.id === ids.platform)?.position,
    beforeEdit.entities.find((entity) => entity.id === ids.platform)?.position,
  );
  assert.deepEqual(
    edited.entities.find((entity) => entity.id === ids.platform)?.scale,
    beforeEdit.entities.find((entity) => entity.id === ids.platform)?.scale,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Play", exact: true })
      .getAttribute("class"),
    "active",
  );
  const expected = expectedPlayerAfterCarry(beforePlayer);
  const afterSamples = [];
  for (let index = 0; index < 7; index++) {
    afterSamples.push(await readPlayer());
    await page.waitForTimeout(120);
  }
  const afterPlayer = afterSamples[0];
  assert(afterPlayer?.visible, "player must remain visible after parent edit");
  const maxDistance = Math.max(
    ...afterSamples.map((sample) => distance(sample, expected)),
  );
  assert(
    maxDistance < 0.2,
    `player was not carried by the edited parent: expected=${JSON.stringify(
      expected,
    )}, samples=${JSON.stringify(afterSamples)}`,
  );
  const afterDrift = axisDrift(afterSamples);
  assert((afterDrift?.x ?? Infinity) < 0.1);
  assert((afterDrift?.y ?? Infinity) < 0.1);
  assert((afterDrift?.z ?? Infinity) < 0.1);
  const scoreAfter = await page.locator(".game-hud").innerText();
  assert.equal(scoreAfter, scoreBefore, "parent edit changed score/HUD");
  await page.screenshot({ path: `${output}/carried-after-parent-edit.png` });
  report.checks.parentEdit = {
    expectedPlayer: expected,
    samples: afterSamples,
    maxDistance,
    drift: afterDrift,
    hudBefore: scoreBefore,
    hudAfter: scoreAfter,
  };
  report.checks.parentMatrixCarry = true;
  report.checks.unrelatedEntityUnchanged = true;
  report.checks.playStateAndScorePreserved = true;

  assert.equal(report.requests, 2);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.external, []);
  assert.deepEqual(report.mutations, []);
  report.status = "passed";
} catch (error) {
  failure = error;
  report.error = String(error).slice(0, 3000);
  if (page) {
    report.transientErrors = await page
      .evaluate(() => window.__orbsieFixtureErrors ?? [])
      .catch(() => []);
    report.visibleText = await page
      .locator("body")
      .innerText()
      .catch(() => "unavailable");
    await page
      .screenshot({ path: `${output}/failure.png` })
      .catch(() => undefined);
  }
} finally {
  await writeFile(
    `${output}/fixture.json`,
    JSON.stringify(fixture, null, 2) + "\n",
  );
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
if (failure) {
  console.error(`Hierarchy carrying acceptance failed: ${failure.message}`);
  process.exitCode = 1;
}
