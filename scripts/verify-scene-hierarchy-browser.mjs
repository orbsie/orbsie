#!/usr/bin/env node
// Deterministic shared-world fixture; no model or account calls.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { compressSync, strToU8 } from "fflate";
import { chromium, expect } from "@playwright/test";
const output = process.argv[2];
if (!output) throw Error("Provide a new evidence directory.");
await mkdir(output, { recursive: false });
let base = process.env.TEST_URL ?? "http://localhost:3047";
let server;
const standalone = process.env.ORBSIE_STANDALONE === "1";
const project = {
  version: 1,
  id: "hierarchy-browser",
  title: "Parented crystal",
  seed: 42,
  revision: 1,
  groups: [
    {
      id: "parent",
      label: "Translated parent",
      position: [-10, 0, 5],
      scale: [1, 1, 1],
    },
  ],
  entities: [
    {
      id: "crystal",
      label: "Parented crystal",
      parentId: "parent",
      position: [10, 0.5, 0],
      scale: [1, 1, 1],
      color: "#e5bd49",
      stage: "ready",
      geometry: { kind: "crystal", detail: "refined" },
      behavior: { type: "collect" },
    },
    {
      id: "portal",
      label: "Home",
      position: [0, 0, 5],
      scale: [1, 1, 1],
      color: "#63bdb1",
      stage: "ready",
      geometry: { kind: "arch", detail: "refined" },
      behavior: { type: "portal" },
    },
  ],
  environment: { sky: "#dceee9", ground: "#91b977", water: "#59bdbb" },
  messages: [],
};
if (standalone) {
  server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/project.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(project));
      return;
    }
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end(
        '<html><head><link rel="stylesheet" href="runtime.css"></head><body><div id="root"></div><script type="module" src="runtime.js"></script></body></html>',
      );
      return;
    }
    if (
      ![
        "/runtime.js",
        "/runtime.css",
        "/generated-geometry-worker.js",
        "/asset-geometry-worker.js",
      ].includes(path)
    ) {
      response.statusCode = 404;
      response.end();
      return;
    }
    try {
      response.setHeader(
        "content-type",
        path.endsWith(".css") ? "text/css" : "text/javascript",
      );
      response.end(await readFile(`public/player${path}`));
    } catch {
      response.statusCode = 500;
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}
const report = {
  mode: standalone
    ? "deterministic-standalone-hierarchy"
    : "deterministic-shared-world-hierarchy",
  passed: false,
  pageErrors: [],
  external: [],
  mutations: [],
  checks: {},
};
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.route("**/*", (route) => {
    const request = route.request(),
      u = new URL(request.url());
    if (
      u.origin !== new URL(base).origin &&
      !["data:", "blob:"].includes(u.protocol)
    ) {
      report.external.push(u.origin + u.pathname);
      return route.abort();
    }
    if (request.method() !== "GET") {
      report.mutations.push(u.pathname);
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  const encoded = Buffer.from(
    compressSync(strToU8(JSON.stringify(project))),
  ).toString("base64url");
  await page.goto(standalone ? base : `${base}/#orb=${encoded}`);
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByText("You found every crystal and made it home.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
  report.checks.parentedCollectionAtWorldSpawn = true;
  if (standalone)
    await expect(page.locator('main[data-ready="true"]')).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("You found every crystal and made it home.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
  report.checks.reloadHierarchy = true;
  await page.screenshot({ path: `${output}/won.png` });
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.external, []);
  assert.deepEqual(report.mutations, []);
  report.passed = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(
    `${output}/fixture.json`,
    JSON.stringify(project, null, 2) + "\n",
  );
}
console.log(JSON.stringify(report));
