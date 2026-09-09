#!/usr/bin/env node
// Real editor/worker/storage acceptance with deterministic provider responses.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { unzipSync, strFromU8 } from "fflate";
import { chromium, expect } from "@playwright/test";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";
const url = process.env.TEST_URL ?? "http://localhost:3047";
const output = process.argv[2];
if (!output) throw Error("Provide a new evidence directory.");
await mkdir(output, { recursive: false });
const extrusion = process.env.ORBSIE_MODELING_SHAPE === "extrusion";
const revolution = process.env.ORBSIE_MODELING_SHAPE === "revolution";
const mesh = process.env.ORBSIE_MODELING_SHAPE === "mesh";
const label = mesh
  ? "Browser pyramid"
  : revolution
    ? "Browser vase"
    : extrusion
      ? "Browser prism"
      : "Browser arch";
const recipe = (revision, radius) => {
  if (mesh)
    return {
      version: 1,
      revision,
      output: "pyramid",
      nodes: [
        {
          id: "pyramid",
          kind: "mesh",
          vertices: [
            [-1, 0, -1],
            [1, 0, -1],
            [0, 0, 1],
            [0, radius, 0],
          ],
          triangles: [
            [0, 1, 2],
            [0, 3, 1],
            [1, 3, 2],
            [2, 3, 0],
          ],
        },
      ],
    };
  return revolution
    ? {
        version: 1,
        revision,
        output: "vase",
        nodes: [
          {
            id: "vase",
            kind: "revolve",
            profile: [
              [0, -1],
              [0.5, -1],
              [radius, -0.4],
              [radius, 0.3],
              [0.6, 1],
              [0, 1],
            ],
            segments: 32,
          },
        ],
      }
    : extrusion
      ? {
          version: 1,
          revision,
          output: "prism",
          nodes: [
            {
              id: "prism",
              kind: "extrude",
              profile: [
                [-1.5, -1],
                [1.5, -1],
                [0, 1.5],
              ],
              depth: radius,
            },
          ],
        }
      : {
          version: 1,
          revision,
          output: "arch",
          nodes: [
            { id: "body", kind: "box", size: [4, 3, 1] },
            { id: "hole", kind: "cylinder", radius, depth: 2, axis: "z" },
            {
              id: "placed",
              kind: "transform",
              input: "hole",
              position: [0, -1, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            },
            {
              id: "arch",
              kind: "boolean",
              operation: "subtract",
              operands: ["body", "placed"],
            },
          ],
        };
};
const geometry = (revision, radius) => ({
  kind: "generated",
  detail: "refined",
  job: { backend: "browser-manifold", recipe: recipe(revision, radius) },
});
const report = {
  mode: "fixture-provider-real-editor-worker",
  shape: mesh
    ? "mesh"
    : revolution
      ? "revolution"
      : extrusion
        ? "extrusion"
        : "arch",
  requests: 0,
  pageErrors: [],
  blocked: [],
  checks: {},
};
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
let page;
let exportServer;
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  await context.route("**/*", async (route) => {
    const target = new URL(route.request().url());
    if (
      target.origin !== new URL(url).origin &&
      /^https?:$/.test(target.protocol)
    ) {
      report.blocked.push(target.href);
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
    assert.equal(request.localModeling, false);
    assert.equal(request.browserModeling, true);
    const initial = report.requests === 1;
    const invalidMeshEdit = mesh && report.requests === 3;
    const nextGeometry = geometry(
      initial ? 0 : invalidMeshEdit ? 2 : 1,
      initial ? 1.25 : 1.6,
    );
    if (invalidMeshEdit) {
      nextGeometry.job.recipe.nodes[0].triangles =
        nextGeometry.job.recipe.nodes[0].triangles.map(([a, b, c]) => [
          a,
          c,
          b,
        ]);
    }
    const commands = [
      ...(initial
        ? [
            {
              type: "reserve_entity",
              entity: {
                id: "arch",
                label,
                position: mesh ? [0, 0, 0] : [0, 1.5, 0],
                scale: [1, 1, 1],
                color: "#E4C79B",
                stage: "seed",
              },
            },
          ]
        : []),
      {
        type: "set_geometry",
        id: "arch",
        geometry: nextGeometry,
      },
      {
        type: "commit_revision",
        message: initial ? `${label} created.` : `${label} edited.`,
      },
    ];
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: commands.map((c) => JSON.stringify(c)).join("\n") + "\n",
    });
  });
  page = await context.newPage();
  page.on("pageerror", (e) => report.pageErrors.push(e.message));
  page.setDefaultTimeout(30000);
  const entry = new URL(url);
  entry.hash = `builder=${encodeURIComponent(JSON.stringify({ url: "http://127.0.0.1:9999", token: "a".repeat(43) }))}`;
  await page.goto(entry.href);
  await expect(page.locator("canvas")).toBeVisible();
  await page
    .getByPlaceholder("What experience to build?")
    .fill(
      mesh
        ? "Build an original pyramid from a custom triangle mesh"
        : revolution
          ? "Build a new vase by revolving a profile"
          : extrusion
            ? "Build a triangular prism from an outline"
            : "Build a new stone arch",
    );
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const saved = async (revision) => {
    let project;
    await expect
      .poll(
        async () => {
          project = (await storageSnapshot(page)).project;
          return project?.entities.find((e) => e.id === "arch")?.geometry?.job
            ?.recipe?.revision;
        },
        { timeout: 45000 },
      )
      .toBe(revision);
    return project;
  };
  const first = await saved(0);
  assert.equal(first.entities[0].geometry.model.source, "browser-manifold");
  assert.equal(first.entities[0].stage, "ready");
  await expect(page.getByText(/This model could not be loaded/)).toHaveCount(0);
  await page.waitForTimeout(1500); // Allow the bounded formation transition to settle for visual inspection.
  await page.screenshot({ path: `${output}/created.png` });
  await page.getByRole("button", { name: "Show objects", exact: true }).click();
  await page.getByRole("button", { name: label }).click();
  await page
    .locator("#prompt")
    .fill(
      mesh
        ? "Make the pyramid taller"
        : revolution
          ? "Make the vase wider"
          : extrusion
            ? "Make the extrusion deeper"
            : "Make the opening wider",
    );
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  const edited = await saved(1);
  assert.equal(edited.entities.length, 1);
  assert.equal(edited.entities[0].id, first.entities[0].id);
  assert.notEqual(
    edited.entities[0].geometry.model.sha256,
    first.entities[0].geometry.model.sha256,
  );
  report.checks.targetedEdit = {
    before: first.entities[0].geometry.model.sha256,
    after: edited.entities[0].geometry.model.sha256,
  };
  if (mesh) {
    const before = first.entities[0].geometry.model.bounds;
    const after = edited.entities[0].geometry.model.bounds;
    assert(
      after.max[1] > before.max[1],
      "The vertex edit must increase actual mesh height",
    );
    assert.equal(after.min[1], before.min[1]);
    assert.deepEqual(
      [after.min[0], after.max[0], after.min[2], after.max[2]],
      [before.min[0], before.max[0], before.min[2], before.max[2]],
    );
    report.checks.customMeshBounds = true;
  }
  if (revolution) {
    const before = first.entities[0].geometry.model.bounds;
    const after = edited.entities[0].geometry.model.bounds;
    assert(
      Math.abs(after.min[1] + 1) < 1e-5 && Math.abs(after.max[1] - 1) < 1e-5,
      "Revolution must preserve explicit Y heights",
    );
    assert(
      after.max[0] - after.min[0] > before.max[0] - before.min[0],
      "The radius edit must widen the actual mesh",
    );
    assert(
      Math.abs(after.max[0] - after.max[2]) < 1e-5,
      "Revolution radial axes must be X/Z",
    );
    report.checks.yUpRevolutionBounds = true;
  }
  await page.waitForTimeout(1500); // Allow the bounded formation transition to settle for visual inspection.
  await page.screenshot({ path: `${output}/edited.png` });
  if (mesh) {
    await page.locator("#prompt").fill("Try an invalid inverted mesh revision");
    await page
      .getByRole("button", { name: "Change this", exact: true })
      .click();
    await expect(page.locator(".toast.error")).toBeVisible({ timeout: 45000 });
    const afterFailure = (await storageSnapshot(page)).project;
    assert.deepEqual(afterFailure.entities, edited.entities);
    report.checks.invalidMeshPreservesFinishedObject = true;
    await page.screenshot({ path: `${output}/invalid-edit.png` });
  }
  await page.reload();
  const resume = page.getByRole("button", {
    name: "Continue your saved world",
  });
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(
    page.getByRole("button", { name: "Show objects", exact: true }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  const reopened = await saved(1);
  assert.deepEqual(reopened.entities, edited.entities);
  await page.waitForTimeout(1500); // Allow the bounded formation transition to settle for visual inspection.
  await page.screenshot({ path: `${output}/reloaded.png` });
  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download your world/ }).click();
  const download = await downloading;
  await download.saveAs(`${output}/world.zip`);
  const files = unzipSync(
    new Uint8Array(await readFile(`${output}/world.zip`)),
  );
  const exported = JSON.parse(strFromU8(files["project.json"]));
  assert.deepEqual(
    exported.entities,
    JSON.parse(JSON.stringify(reopened.entities)),
  );
  const modelHash = reopened.entities[0].geometry.model.sha256;
  const baked = files[`models/generated/${modelHash}.glb`];
  assert(baked, "Export must include the generated mesh");
  assert.equal(createHash("sha256").update(baked).digest("hex"), modelHash);
  assert(
    files["runtime.js"] && files["index.html"],
    "Export must include the player",
  );
  report.checks.bakedExport = true;
  const served = new Set();
  exportServer = createServer((request, response) => {
    const name =
      new URL(request.url, "http://localhost").pathname.slice(1) ||
      "index.html";
    const content = files[name];
    if (!content) {
      response.writeHead(404).end();
      return;
    }
    served.add(name);
    const extension = name.split(".").pop();
    const types = {
      html: "text/html",
      js: "text/javascript",
      css: "text/css",
      json: "application/json",
      wasm: "application/wasm",
      glb: "model/gltf-binary",
      png: "image/png",
    };
    response.writeHead(200, {
      "Content-Type": types[extension] || "application/octet-stream",
    });
    response.end(content);
  });
  await new Promise((resolve) => exportServer.listen(0, "127.0.0.1", resolve));
  const exportOrigin = `http://127.0.0.1:${exportServer.address().port}`;
  const standalone = await browser.newContext();
  await standalone.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== exportOrigin) {
      report.blocked.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const player = await standalone.newPage();
  player.on("pageerror", (error) => report.pageErrors.push(error.message));
  const playerStarted = performance.now();
  await player.goto(exportOrigin);
  await expect(player.locator('main[data-ready="true"]')).toBeVisible({
    timeout: 30_000,
  });
  report.checks.standaloneReadyMs = Math.round(
    performance.now() - playerStarted,
  );
  await expect
    .poll(() => served.has(`models/generated/${modelHash}.glb`))
    .toBe(true);
  // The player-ready marker precedes asset decoding and the bounded formation.
  // Capture after that transition, then inspect the rendered artifact separately.
  await player.waitForTimeout(2000);
  await expect(
    player.getByText(/could not be loaded|could not open/i),
  ).toHaveCount(0);
  await player.screenshot({ path: `${output}/standalone.png` });
  await standalone.close();
  report.checks.standaloneRendering = true;
  assert.equal(report.requests, mesh ? 3 : 2);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.blocked, []);
  report.checks.reload = true;
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error);
  if (page) {
    report.visibleText = await page
      .locator("body")
      .innerText()
      .catch(() => "unavailable");
    await page
      .screenshot({ path: `${output}/failure.png` })
      .catch(() => undefined);
  }
  throw error;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  if (exportServer) await new Promise((resolve) => exportServer.close(resolve));
}
