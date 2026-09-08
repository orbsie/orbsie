/** Real WebGL renderer fixture; no app accounts, generation, or remote requests. */
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const directory = "docs/evidence/formation-continuity";
const temporary = await mkdtemp(join(tmpdir(), "orbsie-formation-test-"));
let server, browser, context, page;
const report = {
  passed: false,
  scope: "Shared World renderer in an isolated deterministic WebGL fixture",
  providerCalls: 0,
  errors: [],
  externalRequests: [],
  samples: [],
};
try {
  await mkdir(directory, { recursive: true });
  await build({
    entryPoints: ["scripts/formation-browser-fixture.tsx"],
    bundle: true,
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    outfile: join(temporary, "fixture.js"),
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const bundle = await readFile(join(temporary, "fixture.js"));
  server = createServer((request, response) => {
    if (request.url === "/fixture.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(bundle);
    } else if (request.url === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(
        '<!doctype html><title>Formation continuity fixture</title><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="root"></div><script type="module" src="/fixture.js"></script>',
      );
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: temporary, size: { width: 1280, height: 800 } },
  });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    report.externalRequests.push(new URL(route.request().url()).origin);
    return route.abort();
  });
  page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      report.errors.push(message.text().slice(0, 500));
  });
  await page.goto(origin);
  await expect
    .poll(
      () => page.evaluate(() => window.formationFixture?.ready() ?? false),
      { timeout: 30000 },
    )
    .toBeTruthy();
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.formationFixture.begin());
  await expect
    .poll(() => page.evaluate(() => window.formationFixture.updated()))
    .toBe(true);
  report.samples = await page.evaluate(() => window.formationFixture.verify());
  await page.screenshot({ path: `${directory}/rebased-start.png` });
  await page.evaluate(() => window.formationFixture.frame(0.5));
  await page.screenshot({ path: `${directory}/midpoint.png` });
  await page.evaluate(() => window.formationFixture.frame(1));
  await page.screenshot({ path: `${directory}/finished.png` });
  const thumbnail = await page.evaluate(() =>
    window.formationFixture.thumbnail(),
  );
  assert.match(thumbnail, /^data:image\/png;base64,/);
  const png = Buffer.from(thumbnail.split(",")[1], "base64");
  assert.equal(png.readUInt32BE(16), 320);
  assert.equal(png.readUInt32BE(20), 180);
  assert.ok(png.length < 200 * 1024);
  await writeFile(`${directory}/publication-thumbnail.png`, png);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.externalRequests, []);
  assert.equal(report.samples.length, 3);
  report.passed = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  const video = page?.video();
  await context?.close();
  if (video) await video.saveAs(`${directory}/continuity.webm`);
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
  await writeFile(
    `${directory}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
