// Synthetic account/model/cloud responses; real editor, geometry worker and persistence.
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";
const base = process.env.TEST_URL || "http://localhost:3047",
  origin = new URL(base).origin;
const out =
  process.argv[2] || `test-results/hosted-chatgpt-generation-${Date.now()}`;
await mkdir(out, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), "orbsie-journal-fixture-"));
await build({
  entryPoints: ["src/lib/protocol.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(temp, "protocol.mjs"),
});
const { applyOperation } = await import(
  pathToFileURL(join(temp, "protocol.mjs")).href
);
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const report = {
  passed: false,
  syntheticAuthorization: true,
  syntheticInference: true,
  syntheticCloud: true,
  liveLogin: false,
  requests: 0,
  freeRequests: 0,
  errors: [],
  unexpected: [],
  checks: {},
};
let page;
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  const runs = new Map(),
    assets = new Map();
  let expired = false;
  const recipe = (revision) => ({
    version: 1,
    revision,
    output: "prism",
    nodes: [
      {
        id: "prism",
        kind: "extrude",
        profile: [
          [-1, -1],
          [1, -1],
          [0, 1],
        ],
        depth: revision ? 2 : 1,
      },
    ],
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url()),
      method = route.request().method(),
      path = url.pathname;
    if (url.origin !== origin) {
      report.unexpected.push(url.origin);
      return route.abort();
    }
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/config")
      return route.fulfill({
        json: {
          accounts: true,
          publishing: false,
          google: false,
          chatgptHosted: true,
          chatgptGeneration: true,
        },
      });
    if (path === "/api/auth/get-session")
      return route.fulfill({
        json: {
          user: { id: "fixture-owner", name: "Fixture" },
          session: { id: "fixture-session" },
        },
      });
    if (path === "/api/trial")
      return route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } });
    if (path === "/api/models") return route.fulfill({ json: { models: [] } });
    if (path === "/api/chatgpt/status")
      return route.fulfill({
        json: {
          lifecycle: "completed",
          authStatus: expired ? "disconnected" : "connected",
        },
      });
    if (path === "/api/chatgpt/models")
      return route.fulfill({
        json: {
          models: [
            {
              id: "gpt-5.6-luna",
              model: "gpt-5.6-luna",
              displayName: "Luna",
              supportedReasoningEfforts: ["low", "xhigh"],
              defaultReasoningEffort: "low",
            },
          ],
        },
      });
    if (path === "/api/projects") {
      if (method === "GET") return route.fulfill({ json: { projects: [] } });
      const data = route.request().postDataJSON();
      return route.fulfill({
        json: {
          revision: data.project.revision,
          snapshotToken: `fixture-${data.project.revision}`,
        },
      });
    }
    if (path === "/api/generated-models") {
      if (method === "PUT") {
        const data = route.request().postDataJSON();
        assets.set(data.metadata.sha256, data);
        return route.fulfill({ json: { metadata: data.metadata } });
      }
      return route.fulfill({ json: assets.get(url.searchParams.get("hash")) });
    }
    if (path === "/api/generation-runs") {
      if (method === "POST") {
        const d = route.request().postDataJSON();
        const run = {
          id: d.runId,
          projectId: d.project.id,
          sequence: 0,
          state: "running",
          checkpoint: d.project,
          prompt: d.prompt,
          baseRevision: d.project.revision,
          cloudBaselineCurrent: true,
          ...(d.selected ? { selected: d.selected } : {}),
        };
        runs.set(d.runId, {
          run,
          cursor: { runId: d.runId, sequence: 0, seen: new Set() },
        });
        return route.fulfill({ json: { run } });
      }
      const d = method === "GET" ? {} : route.request().postDataJSON();
      const item =
        runs.get(d.runId || url.searchParams.get("runId")) ||
        [...runs.values()]
          .reverse()
          .find((v) => v.run.projectId === url.searchParams.get("projectId"));
      if (!item)
        return route.fulfill({ status: 404, json: { error: "No run" } });
      if (method === "PUT") {
        const result = applyOperation(
          item.run.checkpoint,
          d.envelope,
          item.cursor,
        );
        item.cursor = result.cursor;
        item.run = {
          ...item.run,
          sequence: d.envelope.sequence,
          checkpoint: result.project,
          state:
            d.envelope.command.type === "commit_revision"
              ? "complete"
              : "running",
        };
      } else if (method === "PATCH") item.run.state = "cancelled";
      return route.fulfill({ json: { run: item.run } });
    }
    if (path === "/api/generate") {
      report.freeRequests++;
      return route.fulfill({
        status: 500,
        json: { error: "Wrong provider route" },
      });
    }
    if (path === "/api/chatgpt/generate") {
      const d = route.request().postDataJSON();
      assert.equal(d.model, "gpt-5.6-luna");
      assert.equal(d.effort, "low");
      assert.equal(d.localModeling, false);
      assert.equal(d.browserModeling, true);
      for (const field of ["key", "provider", "url", "capability"])
        assert(!(field in d));
      if (expired)
        return route.fulfill({
          status: 409,
          json: {
            error: "Connect your ChatGPT account first.",
            code: "CHATGPT_CONNECTION_REQUIRED",
          },
        });
      report.requests++;
      const revision = report.requests - 1;
      if (revision) assert.equal(d.selected, "prism");
      const commands = [
        ...(revision
          ? []
          : [
              {
                type: "reserve_entity",
                entity: {
                  id: "prism",
                  label: "ChatGPT prism",
                  position: [0, 1, 0],
                  scale: [1, 1, 1],
                  color: "#abcded",
                  stage: "seed",
                },
              },
            ]),
        {
          type: "set_geometry",
          id: "prism",
          geometry: {
            kind: "generated",
            detail: "refined",
            job: { backend: "browser-manifold", recipe: recipe(revision) },
          },
        },
        {
          type: "commit_revision",
          message: revision ? "Prism deepened." : "Prism created.",
        },
      ];
      return route.fulfill({
        contentType: "application/x-ndjson",
        body: commands.map((c) => JSON.stringify(c)).join("\n") + "\n",
      });
    }
    report.unexpected.push(path);
    return route.abort();
  });
  page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.setDefaultTimeout(30000);
  const legacyLink = new URL(base);
  legacyLink.hash = `chatgpt=${encodeURIComponent(JSON.stringify({ url: "http://127.0.0.1:41000", token: "a".repeat(64) }))}`;
  await page.goto(legacyLink.href);
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page
    .getByLabel("ChatGPT model", { exact: true })
    .selectOption("gpt-5.6-luna");
  await page
    .getByLabel("ChatGPT reasoning", { exact: true })
    .selectOption("low");
  await page.getByRole("button", { name: "Use ChatGPT", exact: true }).click();
  await page.locator("#prompt").fill("Create a new triangular prism");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const saved = async (revision) => {
    let project;
    await expect
      .poll(
        async () => {
          project = (await storageSnapshot(page)).project;
          return project?.entities.find((e) => e.id === "prism")?.geometry?.job
            ?.recipe?.revision;
        },
        { timeout: 45000 },
      )
      .toBe(revision);
    return project;
  };
  const first = await saved(0);
  assert.equal(first.entities[0].stage, "ready");
  assert.equal(first.entities[0].geometry.model.source, "browser-manifold");
  await page.getByRole("button", { name: "Show objects", exact: true }).click();
  await page
    .getByRole("button", { name: "ChatGPT prism ready", exact: true })
    .click();
  await page.locator("#prompt").fill("Make the prism deeper");
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  const second = await saved(1);
  assert.equal(second.entities.length, 1);
  assert.notEqual(
    first.entities[0].geometry.model.sha256,
    second.entities[0].geometry.model.sha256,
  );
  report.checks.targetedGeometryEdit = true;
  report.checks.browserGeneratedAssets = assets.size >= 2;
  await page.screenshot({ path: join(out, "edited.png") });
  expired = true;
  await page.locator("#prompt").fill("Make this taller");
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little creative power" }),
  ).toBeVisible();
  await expect(page.locator("#prompt")).toHaveValue("Make this taller");
  report.checks.expiredConnectionPreservesPrompt = true;
  await expect(
    page.getByRole("button", { name: "Connect ChatGPT", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little creative power" }),
  ).toBeVisible();
  await expect(page.locator("#prompt")).toHaveValue("Make this taller");
  report.checks.expiredRetryDoesNotUseFree = true;
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Continue your saved world" }).click();
  const reopened = await saved(1);
  assert.deepEqual(reopened.entities, second.entities);
  report.checks.reload = true;
  assert.equal(report.freeRequests, 0);
  assert.equal(report.requests, 2);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.unexpected, []);
  report.checks.legacyLinkDoesNotContactCompanion = true;
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error);
  if (page)
    await page.screenshot({ path: join(out, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  await rm(temp, { recursive: true, force: true });
}
