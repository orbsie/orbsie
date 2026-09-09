#!/usr/bin/env node
// Deterministic hierarchy/editor acceptance. Provider and trial calls are intercepted;
// this script never makes a model or account request.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { unzipSync, strFromU8 } from "fflate";
import { chromium, expect } from "@playwright/test";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";

const url = process.env.TEST_URL ?? "http://localhost:3047";
const output = process.argv[2];
if (!output) throw Error("Provide a new evidence directory.");
await mkdir(output, { recursive: false });
const rootHead = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const suppliedSourceCommit = process.env.ORBSIE_APP_SOURCE_COMMIT?.trim();
if (suppliedSourceCommit && !/^[a-f0-9]{7,40}$/i.test(suppliedSourceCommit))
  throw Error("ORBSIE_APP_SOURCE_COMMIT must be a 7-40 character hex commit.");
const sourceCommit = suppliedSourceCommit ?? rootHead;

const ids = {
  group: "hierarchy5e5217f",
  prop: "runtimecaeb0c6",
  collectible: "checkpointfb541d2",
  platform: "platform-scene-01",
  unrelated: "unrelated-entity-01",
};
const labels = {
  prop: "Baked box prop",
  collectible: "Play collectible",
  platform: "Moving platform",
  unrelated: "Unrelated tree",
};

const propRecipe = (revision, width) => ({
  version: 1,
  revision,
  output: "box",
  nodes: [{ id: "box", kind: "box", size: [width, 1, 1] }],
});

const propGeometry = (revision, width) => ({
  kind: "generated",
  collision: "none",
  detail: "refined",
  job: { backend: "browser-manifold", recipe: propRecipe(revision, width) },
});

const fixture = {
  version: 1,
  stableIds: ids,
  labels,
  group: {
    id: ids.group,
    label: "Display group",
    position: [-1, 0, -2],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  },
  scenario2Group: {
    id: ids.group,
    position: [1.25, 0, -1.25],
    rotation: [0, 0.4, 0],
  },
  propRecipe: propRecipe(0, 2),
  editedPropRecipe: propRecipe(1, 3),
};

function reserveEntity({ id, label, position, color, behavior, parentId }) {
  return {
    type: "reserve_entity",
    entity: {
      id,
      label,
      position,
      scale: [1, 1, 1],
      ...(parentId ? { parentId } : {}),
      color,
      behavior,
      stage: "seed",
    },
  };
}

function initialCommands() {
  return [
    { type: "create_group", group: fixture.group },
    reserveEntity({
      id: ids.prop,
      label: labels.prop,
      position: [0, 1, 0],
      color: "#e4c79b",
      behavior: { type: "static" },
      parentId: ids.group,
    }),
    {
      type: "set_geometry",
      id: ids.prop,
      geometry: propGeometry(0, 2),
    },
    reserveEntity({
      id: ids.collectible,
      label: labels.collectible,
      position: [2, 0.8, 0],
      color: "#a1f0d7",
      behavior: { type: "collect" },
      parentId: ids.group,
    }),
    {
      type: "set_geometry",
      id: ids.collectible,
      geometry: { kind: "crystal", detail: "refined" },
    },
    reserveEntity({
      id: ids.platform,
      label: labels.platform,
      position: [0, 0.3, 2],
      color: "#efc79c",
      behavior: { type: "move", speed: 0.5, amplitude: 0.4, axis: "x" },
      parentId: ids.group,
    }),
    {
      type: "set_geometry",
      id: ids.platform,
      geometry: { kind: "platform", detail: "refined" },
    },
    reserveEntity({
      id: ids.unrelated,
      label: labels.unrelated,
      position: [-4, 0, 3],
      color: "#77a664",
      behavior: { type: "static" },
    }),
    {
      type: "set_geometry",
      id: ids.unrelated,
      geometry: { kind: "tree", detail: "refined" },
    },
    {
      type: "commit_revision",
      message: "The display group and its playable objects are ready.",
    },
  ];
}

function scenario2Commands() {
  return [
    {
      type: "set_group_transform",
      id: ids.group,
      position: fixture.scenario2Group.position,
      rotation: fixture.scenario2Group.rotation,
    },
    {
      type: "commit_revision",
      message: "Moved the display group while preserving its objects.",
    },
  ];
}

function scenario3Commands() {
  return [
    {
      type: "set_geometry",
      id: ids.prop,
      geometry: propGeometry(1, 3),
    },
    {
      type: "commit_revision",
      message:
        "Widened the selected box prop and kept the scene hierarchy intact.",
    },
  ];
}

function ndjson(commands) {
  return commands.map((command) => JSON.stringify(command)).join("\n") + "\n";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutRevision(project) {
  const value = clone(project);
  delete value.revision;
  return value;
}

function entityWithoutGeometry(entity) {
  const value = clone(entity);
  delete value.geometry;
  return value;
}

function assertSameProjectExceptRevision(actual, expected, message) {
  assert.deepEqual(withoutRevision(actual), withoutRevision(expected), message);
}

function assertGlbIntegrity(bytes, expectedHash) {
  assert(bytes instanceof Uint8Array && bytes.byteLength >= 28);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67, "GLB magic");
  assert.equal(view.getUint32(4, true), 2, "GLB version");
  assert.equal(view.getUint32(8, true), bytes.byteLength, "GLB length");
  const chunks = [];
  for (let offset = 12; offset < bytes.byteLength;) {
    assert(offset + 8 <= bytes.byteLength, "GLB chunk header");
    const length = view.getUint32(offset, true);
    assert.equal(length % 4, 0, "GLB chunk alignment");
    assert(offset + 8 + length <= bytes.byteLength, "GLB chunk range");
    chunks.push({
      type: view.getUint32(offset + 4, true),
      start: offset + 8,
      length,
    });
    offset += 8 + length;
  }
  assert.equal(chunks.length, 2, "GLB has JSON and BIN chunks");
  assert.equal(chunks[0].type, 0x4e4f534a, "GLB JSON chunk");
  assert.equal(chunks[1].type, 0x004e4942, "GLB BIN chunk");
  const json = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(chunks[0].start, chunks[0].start + chunks[0].length),
    ),
  );
  assert.equal(json.asset?.version, "2.0");
  assert(json.buffers?.[0]?.byteLength > 0, "GLB has binary geometry");
  assert(json.meshes?.length > 0, "GLB has a mesh");
  assert(json.meshes[0].primitives?.length > 0, "GLB mesh has primitives");
  assert(json.nodes?.length > 0 && json.scenes?.length > 0, "GLB scene graph");
  return json;
}

const report = {
  mode: "deterministic-scene-hierarchy-editor",
  provider: "fixture-intercepted",
  liveProvider: false,
  sourceCommits: {
    app: sourceCommit,
    appAssumedFromRootHead: suppliedSourceCommit === undefined,
    rootHead,
  },
  stableIds: ids,
  requests: 0,
  requestSummaries: [],
  pageErrors: [],
  external: [],
  standaloneExternal: [],
  standaloneEditorRequests: [],
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
let exportServer;
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
        [ids.prop, ids.collectible, ids.platform, ids.unrelated],
      );
      return route.fulfill({
        contentType: "application/x-ndjson",
        body: ndjson(scenario2Commands()),
      });
    }
    if (report.requests === 3) {
      assert.equal(request.selected, ids.prop);
      assert.deepEqual(
        request.project.groups?.find((group) => group.id === ids.group),
        {
          ...fixture.group,
          position: fixture.scenario2Group.position,
          rotation: fixture.scenario2Group.rotation,
        },
      );
      assert.deepEqual(
        request.project.entities.map((entity) => entity.id),
        [ids.prop, ids.collectible, ids.platform, ids.unrelated],
      );
      return route.fulfill({
        contentType: "application/x-ndjson",
        body: ndjson(scenario3Commands()),
      });
    }
    throw Error(`Unexpected generation request ${report.requests}`);
  });
  await context.addInitScript(() => {
    const errors = [];
    window.__orbsieFixtureErrors = errors;
    new MutationObserver(() => {
      const message = document
        .querySelector(".toast.error")
        ?.textContent?.trim();
      if (message && errors.at(-1) !== message && errors.length < 8)
        errors.push(message.slice(0, 1000));
    }).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });

  page = await context.newPage();
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.setDefaultTimeout(30000);
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

  // Scenario 1: create the stable group and four entities, including one
  // generated browser-manifold box whose baked model is retained locally.
  await page
    .getByPlaceholder("What experience to build?")
    .fill("Build a playable display group with a box prop and a collectible");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const created = await waitProject(
    (project) =>
      project.groups?.some((group) => group.id === ids.group) &&
      project.entities.length === 4 &&
      project.entities.find((entity) => entity.id === ids.prop)?.geometry?.model
        ?.source === "browser-manifold",
  );
  assert.equal(created.groups?.length, 1);
  assert.deepEqual(
    created.entities.map((entity) => entity.id),
    [ids.prop, ids.collectible, ids.platform, ids.unrelated],
  );
  const createdProp = created.entities.find((entity) => entity.id === ids.prop);
  for (const id of [ids.prop, ids.collectible, ids.platform])
    assert.equal(
      created.entities.find((entity) => entity.id === id)?.parentId,
      ids.group,
      `${id} must be contained by the display group`,
    );
  assert.deepEqual(createdProp.geometry.job.recipe, fixture.propRecipe);
  assert.equal(createdProp.stage, "ready");
  assert.equal((await storageSnapshot(page)).sensitive, false);
  report.checks.scenario1CreatedHierarchy = true;
  report.checks.persistedGroupsAndEntities = true;
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${output}/scenario1-created.png` });

  // Scenario 2: enter Play, provide visible keyboard input evidence, then edit
  // only the parent group. Authored child geometry and IDs must survive.
  const beforeGroupEdit = clone(created);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toHaveClass(/active/);
  const hudBeforeGroupEdit = await page.locator(".game-hud").innerText();
  const captionBeforeGroupEdit = await page
    .locator(".scene-caption")
    .innerText();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${output}/scenario2-play-input.png` });
  report.checks.playModeAndInputSubmitted = {
    input: "ArrowRight",
    hud: hudBeforeGroupEdit,
    caption: captionBeforeGroupEdit,
  };
  await page
    .locator("#prompt")
    .fill(
      "Move the display group while I play, preserving its box prop and collectible",
    );
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  const moved = await waitProject(
    (project) =>
      project.groups?.find((group) => group.id === ids.group)?.position?.[0] ===
        fixture.scenario2Group.position[0] &&
      project.groups?.find((group) => group.id === ids.group)?.rotation?.[1] ===
        fixture.scenario2Group.rotation[1],
  );
  const movedGroup = moved.groups?.find((group) => group.id === ids.group);
  assert.deepEqual(clone(movedGroup), {
    ...fixture.group,
    position: fixture.scenario2Group.position,
    rotation: fixture.scenario2Group.rotation,
  });
  assert.deepEqual(
    moved.entities.map((entity) => entity.id),
    beforeGroupEdit.entities.map((entity) => entity.id),
  );
  for (const id of [ids.prop, ids.collectible, ids.platform, ids.unrelated]) {
    const before = beforeGroupEdit.entities.find((entity) => entity.id === id);
    const after = moved.entities.find((entity) => entity.id === id);
    assert.deepEqual(
      entityWithoutGeometry(after),
      entityWithoutGeometry(before),
    );
    assert.deepEqual(clone(after.geometry), clone(before.geometry));
  }
  assert.deepEqual(
    clone(moved.entities.find((entity) => entity.id === ids.unrelated)),
    clone(
      beforeGroupEdit.entities.find((entity) => entity.id === ids.unrelated),
    ),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Play", exact: true })
      .getAttribute("class"),
    "active",
  );
  const hudAfterGroupEdit = await page.locator(".game-hud").innerText();
  const captionAfterGroupEdit = await page
    .locator(".scene-caption")
    .innerText();
  assert.equal(
    hudAfterGroupEdit,
    hudBeforeGroupEdit,
    "Play HUD must survive the group pose edit",
  );
  assert.equal(
    captionAfterGroupEdit,
    captionBeforeGroupEdit,
    "Play scene caption must survive the group pose edit",
  );
  report.checks.playHudPreservedDuringGroupEdit = {
    before: hudBeforeGroupEdit,
    after: hudAfterGroupEdit,
  };
  report.checks.playSceneCaptionPreservedDuringGroupEdit = {
    before: captionBeforeGroupEdit,
    after: captionAfterGroupEdit,
  };
  report.checks.scenario2PlayGroupPosePreservesEntities = true;
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${output}/scenario2-group-edited.png` });

  // Scenario 3: use the visible object list to select the prop, then replace
  // only its generated recipe. The group and all other entity fields remain.
  const beforePropEdit = clone(moved);
  await page.getByRole("button", { name: "Show objects", exact: true }).click();
  await page.getByRole("button", { name: labels.prop }).click();
  await expect(page.getByText(labels.prop, { exact: true })).toBeVisible();
  assert.equal(
    await page
      .getByRole("button", { name: "Edit", exact: true })
      .getAttribute("class"),
    "active",
  );
  await page
    .locator("#prompt")
    .fill(
      "Widen this selected box prop while preserving every other object and the group pose",
    );
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  const edited = await waitProject(
    (project) =>
      project.entities.find((entity) => entity.id === ids.prop)?.geometry?.job
        ?.recipe?.revision === 1,
  );
  assert.deepEqual(clone(edited.groups), clone(beforePropEdit.groups));
  assert.deepEqual(
    edited.entities.map((entity) => entity.id),
    beforePropEdit.entities.map((entity) => entity.id),
  );
  for (const id of [ids.collectible, ids.platform, ids.unrelated])
    assert.deepEqual(
      clone(edited.entities.find((entity) => entity.id === id)),
      clone(beforePropEdit.entities.find((entity) => entity.id === id)),
    );
  const beforeProp = beforePropEdit.entities.find(
    (entity) => entity.id === ids.prop,
  );
  const afterProp = edited.entities.find((entity) => entity.id === ids.prop);
  assert.deepEqual(
    entityWithoutGeometry(afterProp),
    entityWithoutGeometry(beforeProp),
  );
  assert.equal(afterProp.geometry.kind, "generated");
  assert.equal(afterProp.geometry.collision, beforeProp.geometry.collision);
  assert.equal(afterProp.geometry.detail, beforeProp.geometry.detail);
  assert.equal(afterProp.geometry.job.backend, "browser-manifold");
  assert.notDeepEqual(
    afterProp.geometry.job.recipe,
    beforeProp.geometry.job.recipe,
  );
  assert.equal(afterProp.geometry.job.recipe.nodes[0].size[0], 3);
  assert.notEqual(
    afterProp.geometry.model.sha256,
    beforeProp.geometry.model.sha256,
  );
  assert.equal(afterProp.geometry.model.source, "browser-manifold");
  report.checks.scenario3UiSelectedRecipeOnly = true;
  report.checks.selectedRequest = report.requestSummaries[2]?.selected;
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${output}/scenario3-prop-edited.png` });

  // Undo/redo must restore complete authored snapshots, modulo the monotonic
  // revision counter used by the store.
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  const undone = await waitProject(
    (project) =>
      project.entities.find((entity) => entity.id === ids.prop)?.geometry?.job
        ?.recipe?.revision === 0,
  );
  assertSameProjectExceptRevision(
    undone,
    beforePropEdit,
    "Undo restored exact scene snapshot",
  );
  report.checks.exactUndoSnapshot = true;
  await page
    .getByRole("button", { name: "Redo last change", exact: true })
    .click();
  const redone = await waitProject(
    (project) =>
      project.entities.find((entity) => entity.id === ids.prop)?.geometry?.job
        ?.recipe?.revision === 1,
  );
  assertSameProjectExceptRevision(
    redone,
    edited,
    "Redo restored exact scene snapshot",
  );
  report.checks.exactRedoSnapshot = true;

  await page.reload();
  await expect(
    page.getByRole("button", { name: "Continue your saved world" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue your saved world" }).click();
  await expect(page.locator("canvas")).toBeVisible();
  const reopened = await waitProject(
    (project) =>
      project.entities.find((entity) => entity.id === ids.prop)?.geometry?.job
        ?.recipe?.revision === 1,
  );
  assertSameProjectExceptRevision(
    reopened,
    redone,
    "Reload restored persisted hierarchy snapshot",
  );
  assert.equal((await storageSnapshot(page)).sensitive, false);
  report.checks.reloadPersistence = true;
  await page.screenshot({ path: `${output}/reloaded.png` });

  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download your world/ }).click();
  const download = await downloading;
  const zipPath = `${output}/world.zip`;
  await download.saveAs(zipPath);
  const files = unzipSync(new Uint8Array(await readFile(zipPath)));
  const exported = JSON.parse(strFromU8(files["project.json"]));
  assert.deepEqual(clone(exported.groups), clone(reopened.groups));
  assert.deepEqual(clone(exported.entities), clone(reopened.entities));
  const exportedProp = exported.entities.find(
    (entity) => entity.id === ids.prop,
  );
  const modelHash = exportedProp.geometry.model.sha256;
  const modelPath = `models/generated/${modelHash}.glb`;
  assert(files[modelPath], "ZIP includes the generated box model");
  const gltf = assertGlbIntegrity(files[modelPath], modelHash);
  assert(gltf.meshes[0].primitives[0].indices !== undefined);
  assert(
    files["models/generated/manifest.json"],
    "ZIP includes model manifest",
  );
  assert(
    files["runtime.js"] && files["index.html"],
    "ZIP includes standalone player",
  );
  report.checks.exportProjectHierarchy = true;
  report.checks.exportRuntimeSha256 = createHash("sha256")
    .update(files["runtime.js"])
    .digest("hex");
  report.checks.bakedGlbIntegrity = {
    path: modelPath,
    sha256: modelHash,
    bytes: files[modelPath].byteLength,
  };

  exportServer = createServer((request, response) => {
    const name =
      new URL(request.url, "http://localhost").pathname.slice(1) ||
      "index.html";
    const content = files[name];
    if (!content) {
      response.writeHead(404).end();
      return;
    }
    const extension = name.split(".").pop();
    const types = {
      html: "text/html",
      js: "text/javascript",
      css: "text/css",
      json: "application/json",
      glb: "model/gltf-binary",
      wasm: "application/wasm",
    };
    response.writeHead(200, {
      "Content-Type": types[extension] || "application/octet-stream",
    });
    response.end(content);
  });
  await new Promise((resolve) => exportServer.listen(0, "127.0.0.1", resolve));
  const exportOrigin = `http://127.0.0.1:${exportServer.address().port}`;
  const standalone = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const served = new Set();
  await standalone.route("**/*", (route) => {
    const request = route.request();
    const target = new URL(request.url());
    if (target.origin !== exportOrigin) {
      report.standaloneExternal.push(target.href);
      return route.abort();
    }
    if (target.pathname.startsWith("/api/"))
      report.standaloneEditorRequests.push(target.pathname);
    served.add(target.pathname.slice(1) || "index.html");
    return route.continue();
  });
  const player = await standalone.newPage();
  const standaloneErrors = [];
  player.on("pageerror", (error) => standaloneErrors.push(error.message));
  await player.goto(exportOrigin);
  await expect(player.locator('main[data-ready="true"]')).toBeVisible({
    timeout: 30000,
  });
  await expect.poll(() => served.has(modelPath)).toBe(true);
  await player.waitForTimeout(1500);
  await expect(
    player.getByText(/could not be loaded|could not open/i),
  ).toHaveCount(0);
  await player.screenshot({ path: `${output}/standalone.png` });
  assert.deepEqual(standaloneErrors, []);
  assert.deepEqual(report.standaloneExternal, []);
  assert.deepEqual(report.standaloneEditorRequests, []);
  assert(served.has("project.json") && served.has("runtime.js"));
  report.checks.standaloneReady = true;
  report.checks.standaloneNoEditorOrExternalRequests = true;
  await standalone.close();

  assert.equal(report.requests, 3);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.external, []);
  report.status = "passed";
} catch (error) {
  failure = error;
  report.error = String(error);
  if (page) {
    report.transientErrors = await page
      .evaluate(() => window.__orbsieFixtureErrors ?? [])
      .catch(() => []);
    const snapshot = await storageSnapshot(page).catch(() => null);
    report.savedState = snapshot?.project
      ? {
          revision: snapshot.project.revision,
          groups: snapshot.project.groups,
          entities: snapshot.project.entities.map((entity) => ({
            id: entity.id,
            parentId: entity.parentId,
            stage: entity.stage,
            recipeRevision: entity.geometry?.job?.recipe?.revision,
          })),
        }
      : null;
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
  if (exportServer) await new Promise((resolve) => exportServer.close(resolve));
}

console.log(JSON.stringify(report));
if (failure) {
  console.error(`Scene hierarchy editor acceptance failed: ${failure.message}`);
  process.exitCode = 1;
}
