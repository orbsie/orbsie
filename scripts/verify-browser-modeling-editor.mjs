#!/usr/bin/env node
// Real editor/worker/storage acceptance with deterministic provider responses.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";
const url = process.env.TEST_URL ?? "http://localhost:3047";
const output = process.argv[2];
if (!output) throw Error("Provide a new evidence directory.");
await mkdir(output, { recursive: false });
const extrusion = process.env.ORBSIE_MODELING_SHAPE === "extrusion";
const label = extrusion ? "Browser prism" : "Browser arch";
const recipe = (revision, radius) =>
  extrusion
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
const geometry = (revision, radius) => ({
  kind: "generated",
  detail: "refined",
  job: { backend: "browser-manifold", recipe: recipe(revision, radius) },
});
const report = {
  mode: "fixture-provider-real-editor-worker",
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
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  await context.route("**/*", async (route) => {
    const target = new URL(route.request().url());
    if (target.hostname === "fonts.googleapis.com")
      return route.fulfill({ contentType: "text/css", body: "" });
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
    const commands = [
      ...(initial
        ? [
            {
              type: "reserve_entity",
              entity: {
                id: "arch",
                label,
                position: [0, 1.5, 0],
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
        geometry: geometry(initial ? 0 : 1, initial ? 1.25 : 1.6),
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
      extrusion
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
    .fill(extrusion ? "Make the extrusion deeper" : "Make the opening wider");
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
  await page.waitForTimeout(1500); // Allow the bounded formation transition to settle for visual inspection.
  await page.screenshot({ path: `${output}/edited.png` });
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
  assert.equal(report.requests, 2);
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
}
