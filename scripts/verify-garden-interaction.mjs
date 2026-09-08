import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import sharp from "sharp";
import { installFixtureGeneration } from "./fixture-generation.mjs";

const appUrl = process.env.TEST_URL ?? "http://localhost:3031";
const appOrigin = new URL(appUrl).origin;
const appSourceCommit = process.env.ORBSIE_APP_SOURCE_COMMIT ?? null;
const evidenceDirectory = "docs/evidence/garden-interaction";

const report = {
  passed: false,
  scope:
    "One deterministic local garden generation, reload persistence, export, and standalone flower interaction run",
  appUrl,
  appSourceCommit,
  sourceCommitSupplied: Boolean(appSourceCommit),
  fixtureGeneration: true,
  liveProviderCalls: 0,
  generationRequests: 0,
  externalRequests: [],
  standaloneExternalRequests: [],
  pageErrors: [],
  checks: {},
};

function flowerPixel(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 28 || max < 90) return false;
  const pink = r > 115 && b > 95 && r > g * 1.12 && b > g * 1.04;
  const yellow = r > 135 && g > 115 && b < 185 && r > b * 1.18;
  const lavender = b > 125 && b > r * 1.04 && r > g * 0.92;
  return pink || yellow || lavender;
}

async function coloredComponents(page) {
  const screenshot = await page.screenshot();
  const { data, info } = await sharp(screenshot)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const mask = new Uint8Array(width * height);
  for (let y = 130; y < height - 90; y++) {
    for (let x = 80; x < width - 40; x++) {
      const offset = (y * width + x) * 4;
      if (flowerPixel(data[offset], data[offset + 1], data[offset + 2]))
        mask[y * width + x] = 1;
    }
  }
  const components = [];
  const stack = [];
  for (let y = 130; y < height - 90; y++) {
    for (let x = 80; x < width - 40; x++) {
      const start = y * width + x;
      if (!mask[start]) continue;
      mask[start] = 0;
      stack.push(start);
      let area = 0;
      let xsum = 0;
      let ysum = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      while (stack.length) {
        const index = stack.pop();
        const cx = index % width;
        const cy = Math.floor(index / width);
        area += 1;
        xsum += cx;
        ysum += cy;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);
        for (const [nx, ny] of [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ]) {
          if (nx < 80 || nx >= width - 40 || ny < 130 || ny >= height - 90)
            continue;
          const next = ny * width + nx;
          if (mask[next]) {
            mask[next] = 0;
            stack.push(next);
          }
        }
      }
      if (area >= 20)
        components.push({
          area,
          x: xsum / area,
          y: ysum / area,
          minX,
          maxX,
          minY,
          maxY,
        });
    }
  }
  return components.sort((a, b) => b.area - a.area);
}

function nearestComponent(components, point) {
  return components
    .map((component) => ({
      component,
      distance: Math.hypot(component.x - point.x, component.y - point.y),
    }))
    .sort((a, b) => a.distance - b.distance)[0]?.component;
}

async function bloomFromRenderedFlower(page, beforePath, afterPath) {
  const before = await coloredComponents(page);
  assert.ok(before.length, "No rendered flower color was found before click.");
  const candidate =
    before.find(
      (component) =>
        component.maxX - component.minX <= 70 &&
        component.maxY - component.minY <= 70,
    ) ?? before[0];
  await page.waitForTimeout(350);
  const baseline = nearestComponent(await coloredComponents(page), candidate);
  assert.ok(
    baseline &&
      Math.hypot(baseline.x - candidate.x, baseline.y - candidate.y) < 3,
    "Flower moved before click.",
  );
  assert.ok(
    Math.abs(baseline.area / candidate.area - 1) < 0.05,
    "Flower area was not stable before click.",
  );
  await page.screenshot({ path: beforePath });
  await page.mouse.click(candidate.x, candidate.y);
  await page.waitForTimeout(350);
  const after = await coloredComponents(page);
  await page.screenshot({ path: afterPath });
  const nearby = (component) =>
    component &&
    Math.hypot(component.x - candidate.x, component.y - candidate.y) < 80;
  const afterCandidate = nearestComponent(after, candidate);
  assert.ok(
    nearby(afterCandidate),
    "The clicked flower was not rendered after click.",
  );
  assert.ok(
    afterCandidate.area > candidate.area * 1.12,
    `Flower pixels did not expand after click (${candidate.area} -> ${afterCandidate.area}).`,
  );
  await page.mouse.click(afterCandidate.x, afterCandidate.y);
  await page.waitForTimeout(350);
  const restored = nearestComponent(await coloredComponents(page), candidate);
  assert.ok(
    restored &&
      Math.hypot(restored.x - candidate.x, restored.y - candidate.y) < 3,
    "Flower did not return to its original position.",
  );
  assert.ok(
    Math.abs(restored.area / candidate.area - 1) < 0.05,
    "Second click did not restore the original flower size.",
  );
  await page.screenshot({
    path: afterPath.replace("-after.png", "-restored.png"),
  });
  return {
    baseline,
    restored,
    before: candidate,
    after: afterCandidate,
    componentCountBefore: before.length,
    componentCountAfter: after.length,
  };
}

function contentType(path) {
  return (
    {
      html: "text/html",
      js: "text/javascript",
      css: "text/css",
      json: "application/json",
    }[path.split(".").pop()] ?? "application/octet-stream"
  );
}

let browser;
let context;
let page;
let standalonePage;
let standaloneServer;
try {
  await mkdir(evidenceDirectory, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await installFixtureGeneration(context);
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin) return route.fallback();
    if (url.origin === "https://fonts.googleapis.com")
      return route.fulfill({
        status: 200,
        contentType: "text/css",
        body: "/* deterministic local font stub */",
      });
    if (url.origin === "https://fonts.gstatic.com")
      return route.fulfill({ status: 200, body: "" });
    report.externalRequests.push(url.href);
    return route.abort();
  });
  page = await context.newPage();
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.origin === appOrigin &&
      url.pathname === "/api/generate" &&
      request.method() === "POST"
    )
      report.generationRequests += 1;
  });

  await page.goto(appUrl);
  await page.waitForSelector("canvas");
  await page
    .getByPlaceholder("What experience to build?")
    .fill("A garden whose flowers open when clicked");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByText("Your little garden is ready.", { exact: false }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".scene-caption")).toContainText(
    "Click an object to make it your own.",
  );
  report.checks.generation = true;
  await page.screenshot({ path: `${evidenceDirectory}/generated.png` });

  await page.reload();
  await expect(
    page.getByRole("button", { name: "Continue your saved world" }),
  ).toBeVisible({ timeout: 15000 });
  report.checks.reloadRecoveryPrompt = true;
  await page.getByRole("button", { name: "Continue your saved world" }).click();
  await expect(
    page.getByText("Your little garden is ready.", { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".scene-caption")).toContainText(
    "Click an object to make it your own.",
  );
  report.checks.authoredGardenRestored = true;
  await page.screenshot({ path: `${evidenceDirectory}/reloaded.png` });

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Restart game" }),
  ).toBeVisible();
  await page.waitForTimeout(1200);
  report.checks.playReady = true;
  report.checks.editorBloom = await bloomFromRenderedFlower(
    page,
    `${evidenceDirectory}/editor-flower-before.png`,
    `${evidenceDirectory}/editor-flower-after.png`,
  );

  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download your world/ }).click();
  const download = await downloadPromise;
  const archivePath = `${evidenceDirectory}/garden.zip`;
  await download.saveAs(archivePath);
  report.checks.exported = true;
  const files = unzipSync(await readFile(archivePath));
  const exportedProject = JSON.parse(strFromU8(files["project.json"]));
  assert.equal(exportedProject.title, "The daydream garden");
  assert.equal(
    exportedProject.entities.filter(
      (entity) => entity.behavior?.type === "bloom",
    ).length,
    12,
  );
  assert.ok(files["index.html"]);
  assert.ok(files["runtime.js"]);
  report.checks.exportedProject = {
    title: exportedProject.title,
    entities: exportedProject.entities.length,
    bloomingFlowers: exportedProject.entities.filter(
      (entity) => entity.behavior?.type === "bloom",
    ).length,
  };

  standaloneServer = createServer((request, response) => {
    const path =
      new URL(request.url ?? "/", "http://standalone.local").pathname.slice(
        1,
      ) || "index.html";
    const bytes = files[path];
    if (!bytes) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType(path),
      "Cache-Control": "no-store",
    });
    response.end(bytes);
  });
  await new Promise((resolve) =>
    standaloneServer.listen(0, "127.0.0.1", resolve),
  );
  const standaloneOrigin = `http://127.0.0.1:${standaloneServer.address().port}`;
  const standaloneContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await standaloneContext.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === standaloneOrigin || url.protocol === "data:")
      return route.continue();
    report.standaloneExternalRequests.push(url.href);
    return route.abort();
  });
  standalonePage = await standaloneContext.newPage();
  standalonePage.on("pageerror", (error) =>
    report.pageErrors.push(`standalone: ${error.message}`),
  );
  await standalonePage.goto(standaloneOrigin);
  await expect(standalonePage.locator("main[data-ready=true]")).toBeVisible({
    timeout: 20000,
  });
  report.checks.standaloneReady = true;
  report.checks.standaloneBloom = await bloomFromRenderedFlower(
    standalonePage,
    `${evidenceDirectory}/standalone-flower-before.png`,
    `${evidenceDirectory}/standalone-flower-after.png`,
  );
  await standalonePage.screenshot({
    path: `${evidenceDirectory}/standalone-settled.png`,
  });
  await standaloneContext.close();
  standalonePage = undefined;

  assert.equal(report.generationRequests, 1);
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(report.standaloneExternalRequests, []);
  assert.deepEqual(report.pageErrors, []);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
  await page
    ?.screenshot({ path: `${evidenceDirectory}/failure.png` })
    .catch(() => undefined);
  await standalonePage
    ?.screenshot({
      path: `${evidenceDirectory}/standalone-failure.png`,
    })
    .catch(() => undefined);
} finally {
  await standalonePage
    ?.context()
    .close()
    .catch(() => undefined);
  if (standaloneServer) {
    standaloneServer.closeAllConnections();
    await new Promise((resolve) => standaloneServer.close(resolve));
  }
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await writeFile(
    `${evidenceDirectory}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(
    "/tmp/orbsie-garden-report.md",
    `# Garden interaction evidence\n\n` +
      `- App URL: ${appUrl}\n` +
      `- App source commit: ${appSourceCommit ?? "unverified (ORBSIE_APP_SOURCE_COMMIT not set)"}\n` +
      `- Result: ${report.passed ? "passed" : "failed"}\n` +
      `- Fixture generation requests: ${report.generationRequests}; live provider calls: 0; fixture generation: ${report.fixtureGeneration}\n` +
      `- Evidence directory: ${evidenceDirectory}\n` +
      `- Checks: ${Object.keys(report.checks).join(", ") || "none"}\n` +
      (report.error ? `- Error: ${report.error}\n` : "") +
      `\nScope is one deterministic garden generation, reload recovery, ZIP export, and standalone rendered flower interaction. Bloom evidence is based on a real pointer click at a rendered flower pixel and increased nearby flower-color pixels after the click. It does not certify arbitrary generated worlds, mobile/touch behavior, physical performance, or provider/model integration.\n`,
  );
  console.log(JSON.stringify(report));
}
