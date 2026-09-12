import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const output = resolve(
  process.env.INPUT_LATENCY_EVIDENCE ??
    "docs/evidence/input-consumption-latency",
);
const temporary = await mkdtemp(join(tmpdir(), "orbsie-input-latency-"));
const sourceFiles = [
  "src/components/world.tsx",
  "src/lib/player-input.ts",
  "scripts/input-latency-fixture.tsx",
  "scripts/verify-input-latency.mjs",
];
const sha256 = async (path) =>
  createHash("sha256").update(await readFile(path)).digest("hex");
const report = {
  schemaVersion: "orbsie.input-consumption-latency/v1",
  checkedAt: new Date().toISOString(),
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  sourceHashes: {},
  status: "running",
  scope:
    "One offline local production World renderer run measuring accepted press to consumePressed simulation-boundary latency.",
  latencyLabel:
    "simulation-consumption latency only; this is not rendered feedback, input-to-photon latency, or a device performance claim.",
  providerCalls: 0,
  externalRequests: [],
  pageErrors: [],
  browser: {},
  renderer: {},
  rawSnapshots: [],
  samplesMs: [],
  statistics: null,
  checks: {},
  evidence: [],
};
let server;
let browser;
let page;

function recordPage(pageInstance, origin) {
  pageInstance.on("pageerror", (error) => report.pageErrors.push(error.message));
  pageInstance.on("console", (message) => {
    if (message.type() === "error") report.pageErrors.push(message.text());
  });
  pageInstance.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "data:" || url.origin === origin) return;
    report.externalRequests.push(request.url());
  });
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index];
}

try {
  await mkdir(output, { recursive: true });
  await build({
    entryPoints: ["scripts/input-latency-fixture.tsx"],
    bundle: true,
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    outfile: join(temporary, "fixture.js"),
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const fixture = await readFile(join(temporary, "fixture.js"));
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://fixture.local").pathname;
    response.setHeader("Cache-Control", "no-store");
    if (path === "/fixture.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(fixture);
    } else if (path === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(
        '<!doctype html><title>Input latency fixture</title><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#07100f}button{font:16px sans-serif}</style><div id="root"></div><script type="module" src="/fixture.js"></script>',
      );
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 900, height: 600 },
    serviceWorkers: "block",
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    report.externalRequests.push(route.request().url());
    return route.abort();
  });
  page = await context.newPage();
  recordPage(page, origin);
  await page.goto(`${origin}/`);
  await expect
    .poll(() => page.evaluate(() => window.inputLatencyFixture?.ready() ?? false), {
      timeout: 30_000,
    })
    .toBe(true);

  const status = () => page.evaluate(() => window.inputLatencyFixture.status());
  const snapshotCount = () =>
    page.evaluate(() => window.inputLatencyFixture.status().latest?.sampleCount ?? 0);

  await page.keyboard.down("d");
  await expect.poll(snapshotCount, { timeout: 5000 }).toBe(1);
  await page.keyboard.down("d");
  await page.waitForTimeout(50);
  report.checks.keyboardRepeatDeduplicated = (await snapshotCount()) === 1;
  await page.keyboard.up("d");

  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 2,
  });
  const box = await page.getByRole("button", { name: "Move d", exact: true }).boundingBox();
  if (!box) throw Error("Missing production pointer input button.");
  const point = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    id: 101,
  };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point],
  });
  await expect.poll(snapshotCount, { timeout: 5000 }).toBe(2);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point, { ...point, id: 102 }],
  });
  await page.waitForTimeout(50);
  report.checks.touchHeldDuplicateDeduplicated = (await snapshotCount()) === 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });

  await page.keyboard.down("d");
  const countAfterBlur = await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    return window.inputLatencyFixture.status().latest?.sampleCount ?? 0;
  });
  await page.waitForTimeout(80);
  report.checks.noDelayedPressAfterBlur = (await snapshotCount()) === countAfterBlur;
  await page.keyboard.up("d");

  const finalStatus = await status();
  report.rawSnapshots = finalStatus.snapshots;
  report.samplesMs = finalStatus.latest?.samplesMs ?? [];
  report.browser = {
    userAgent: await page.evaluate(() => navigator.userAgent),
    platform: await page.evaluate(() => navigator.platform),
    hardwareConcurrency: await page.evaluate(() => navigator.hardwareConcurrency),
    devicePixelRatio: await page.evaluate(() => window.devicePixelRatio),
    viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
  };
  report.renderer = finalStatus.renderer;
  const finiteSamples = report.samplesMs.filter((sample) => Number.isFinite(sample) && sample >= 0);
  report.statistics = {
    count: finiteSamples.length,
    nearestRankP50Ms: percentile(finiteSamples, 0.5),
    p95Ms: percentile(finiteSamples, 0.95),
    maxMs: finiteSamples.length ? Math.max(...finiteSamples) : null,
  };
  report.checks.finiteSamples = finiteSamples.length === report.samplesMs.length;
  report.checks.samplesCaptured = report.samplesMs.length >= 2;
  report.checks.noPageErrors = report.pageErrors.length === 0;
  report.checks.noExternalRequests = report.externalRequests.length === 0;
  report.status = Object.values(report.checks).every(Boolean) ? "passed" : "failed";
  await page.screenshot({ path: join(output, "input-consumption-latency.png"), fullPage: true });
  report.evidence.push("input-consumption-latency.png");
} catch (error) {
  report.status = "failed";
  report.failure = error instanceof Error ? error.message : String(error);
  if (page) {
    await page.screenshot({ path: join(output, "input-consumption-latency-failure.png"), fullPage: true }).catch(() => {});
    report.evidence.push("input-consumption-latency-failure.png");
  }
} finally {
  for (const path of sourceFiles)
    report.sourceHashes[path] = await sha256(path).catch(() => null);
  report.networkAuditCompleted = true;
  await writeFile(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close().catch(() => {});
  await new Promise((resolveClose) => server?.close(() => resolveClose()));
  await rm(temporary, { recursive: true, force: true });
}

if (report.status !== "passed") {
  console.error(`Input latency verification failed: ${report.failure ?? "a correctness gate failed"}`);
  process.exitCode = 1;
}
