import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

const zipPath =
  process.env.PLAYER_TOUCH_ZIP ??
  "docs/evidence/provider-e2e/gateway-reload-recovery/gateway/world.zip";
const evidenceDir =
  process.env.PLAYER_TOUCH_EVIDENCE ?? "docs/evidence/player-touch-layout";
const generationPaths = new Set([
  "/api/generate",
  "/api/chatgpt/generate",
  "/generate",
]);
const syntheticSafeAreaInsets = {
  portrait: { top: 47, right: 0, bottom: 34, left: 0 },
  landscape: { top: 0, right: 0, bottom: 21, left: 44 },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function contentType(path) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".glb")) return "model/gltf-binary";
  return "application/octet-stream";
}

async function makeStaticFiles() {
  const archive = unzipSync(await readFile(zipPath));
  const projectBytes = archive["project.json"];
  assert(projectBytes, "The touch fixture ZIP omitted project.json.");
  const project = JSON.parse(strFromU8(projectBytes));
  assert.equal(project.id, "4a5d7783-c7fd-44e0-bf19-864bab9f9b08");
  assert.equal(project.revision, 9);
  assert.equal(project.game?.rules?.length, 3);

  const files = new Map([
    [
      "/index.html",
      Buffer.from(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Touch fixture</title><link rel="stylesheet" href="/runtime.css"></head><body><div id="root"></div><script type="module" src="/runtime.js"></script></body></html>',
      ),
    ],
    ["/project.json", Buffer.from(projectBytes)],
    ["/runtime.js", await readFile("public/player/runtime.js")],
    ["/runtime.css", await readFile("public/player/runtime.css")],
    [
      "/generated-geometry-worker.js",
      await readFile("public/player/generated-geometry-worker.js"),
    ],
    [
      "/asset-geometry-worker.js",
      await readFile("public/player/asset-geometry-worker.js"),
    ],
  ]);
  for (const [name, bytes] of Object.entries(archive))
    if (name.startsWith("models/") || name.startsWith("assets/"))
      files.set(`/${name}`, Buffer.from(bytes));
  return {
    files,
    project,
    projectSha256: createHash("sha256").update(projectBytes).digest("hex"),
  };
}

function overlaps(a, b) {
  return Boolean(
    a &&
    b &&
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top,
  );
}

async function layoutSnapshot(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
        display: style.display,
        visibility: style.visibility,
      };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      touchPoints: navigator.maxTouchPoints,
      coarsePointer: matchMedia("(any-pointer: coarse)").matches,
      main: rect("main"),
      canvas: rect(".canvas"),
      header: rect("header"),
      score: rect(".score"),
      footer: rect("footer"),
      controls: rect(".controls"),
      buttons: [...document.querySelectorAll(".controls button")].map(
        (button) => {
          const box = button.getBoundingClientRect();
          return {
            label: button.getAttribute("aria-label"),
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
          };
        },
      ),
      help: document.querySelector("footer")?.textContent ?? "",
      safeArea: Object.fromEntries(
        ["top", "right", "bottom", "left"].map((side) => [
          side,
          getComputedStyle(document.querySelector("main"))
            .getPropertyValue(`--player-safe-${side}`)
            .trim(),
        ]),
      ),
    };
  });
}

function assertTouchLayout(layout, label, safeInsets = null) {
  assert(layout.main, `${label}: app root missing.`);
  assert(layout.canvas, `${label}: canvas container missing.`);
  assert(
    Math.abs(layout.main.width - layout.viewport.width) < 1 &&
      Math.abs(layout.main.height - layout.viewport.height) < 1,
    `${label}: app root does not fill the viewport.`,
  );
  assert(
    Math.abs(layout.canvas.width - layout.viewport.width) < 1 &&
      Math.abs(layout.canvas.height - layout.viewport.height) < 1,
    `${label}: canvas container does not fill the viewport.`,
  );
  for (const element of [layout.header, layout.score]) {
    assert(element, `${label}: header/score element missing.`);
    assert(element.left >= 0 && element.right <= layout.viewport.width);
    assert(element.top >= 0 && element.bottom <= layout.viewport.height);
  }
  assert(layout.controls, `${label}: touch controls missing.`);
  assert.equal(layout.controls.display, "flex", `${label}: controls hidden.`);
  assert.notEqual(
    layout.controls.visibility,
    "hidden",
    `${label}: controls hidden.`,
  );
  assert(layout.footer, `${label}: footer missing.`);
  assert(
    !overlaps(layout.footer, layout.controls),
    `${label}: footer overlaps controls.`,
  );
  for (const button of layout.buttons) {
    assert(button.left >= 0 && button.right <= layout.viewport.width);
    assert(button.top >= 0 && button.bottom <= layout.viewport.height);
  }
  assert.match(layout.help, /Use the controls below to move and jump/);
  assert(!/W A S D|Arrow keys|Space to jump/.test(layout.help));
  assert(!/Click flowers to bloom/.test(layout.help));
  if (safeInsets) {
    const safeRight = layout.viewport.width - safeInsets.right;
    const safeBottom = layout.viewport.height - safeInsets.bottom;
    for (const element of [
      layout.header,
      layout.score,
      layout.footer,
      layout.controls,
    ]) {
      assert(
        element.left >= safeInsets.left,
        `${label}: left unsafe-area inset covered.`,
      );
      assert(
        element.right <= safeRight,
        `${label}: right unsafe-area inset covered.`,
      );
      assert(
        element.top >= safeInsets.top,
        `${label}: top unsafe-area inset covered.`,
      );
      assert(
        element.bottom <= safeBottom,
        `${label}: bottom unsafe-area inset covered.`,
      );
    }
    for (const button of layout.buttons) {
      assert(button.left >= safeInsets.left);
      assert(button.right <= safeRight);
      assert(button.top >= safeInsets.top);
      assert(button.bottom <= safeBottom);
    }
  }
}

async function touchButton(page, cdp, name, id = 1) {
  const button = page.getByRole("button", { name, exact: true });
  const box = await button.boundingBox();
  assert(box, `Missing touch control ${name}.`);
  const point = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...point, id }],
  });
  await page.waitForTimeout(180);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

function assertSafeAreaShift(base, safe, expected, label) {
  const top = expected.top;
  const right = expected.right;
  const bottom = expected.bottom;
  const left = expected.left;
  const number = (value) => Number.parseFloat(value);
  for (const [side, expectedValue] of Object.entries(expected))
    assert.equal(
      number(safe.safeArea[side]),
      expectedValue,
      `${label}: synthetic ${side} inset was not applied.`,
    );
  assert(Math.abs(safe.header.top - base.header.top - top) < 1.5);
  assert(Math.abs(safe.score.top - base.score.top - top) < 1.5);
  assert(Math.abs(safe.header.left - base.header.left - left) < 1.5);
  assert(Math.abs(base.header.right - safe.header.right - right) < 1.5);
  assert(Math.abs(base.score.right - safe.score.right - right) < 1.5);
  assert(Math.abs(base.footer.bottom - safe.footer.bottom - bottom) < 1.5);
  assert(Math.abs(base.controls.bottom - safe.controls.bottom - bottom) < 1.5);
}

async function runMode(browser, origin, mode, report, projectSha256) {
  const context = await browser.newContext({
    viewport: mode.viewport,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const externalRequests = [];
  const generationRequests = [];
  const pageErrors = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (generationPaths.has(url.pathname)) {
      generationRequests.push(url.pathname);
      await route.abort("blockedbyclient");
      return;
    }
    if (
      url.protocol === "data:" ||
      url.protocol === "blob:" ||
      url.origin === origin
    ) {
      await route.continue();
      return;
    }
    externalRequests.push(url.origin || url.protocol);
    await route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const cdp = await context.newCDPSession(page);
  try {
    const safeInsets =
      syntheticSafeAreaInsets[
        mode.name === "portrait-touch" ? "portrait" : "landscape"
      ];
    const scenarios = [
      { name: "default", insets: null },
      { name: "synthetic-safe-area", insets: safeInsets },
    ];
    let defaultLayout = null;
    const scenarioReports = [];
    for (const scenario of scenarios) {
      await page.goto(origin, { waitUntil: "networkidle" });
      if (scenario.insets) {
        await page.addStyleTag({
          content: `main { --player-safe-top: ${scenario.insets.top}px !important; --player-safe-right: ${scenario.insets.right}px !important; --player-safe-bottom: ${scenario.insets.bottom}px !important; --player-safe-left: ${scenario.insets.left}px !important; }`,
        });
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
      }
      await expect(page.locator('main[data-ready="true"]')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".score")).toHaveText("Score: 0");
      await expect(page.locator("footer")).toContainText(
        "Use the controls below to move and jump",
      );
      const layout = await layoutSnapshot(page);
      const label = `${mode.name} ${scenario.name}`;
      assertTouchLayout(layout, label, scenario.insets);
      if (scenario.insets)
        assertSafeAreaShift(defaultLayout, layout, scenario.insets, label);
      else defaultLayout = layout;
      const suffix = scenario.insets ? "-safe-area" : "";
      await page.screenshot({
        path: `${evidenceDir}/${mode.name}${suffix}-ready.png`,
      });

      await touchButton(page, cdp, "Right");
      await expect(page.locator(".score")).toHaveText("Score: 7");
      await page.getByRole("button", { name: /Restart/ }).click();
      await expect(page.locator(".score")).toHaveText("Score: 0");
      await touchButton(page, cdp, "Forward");
      await expect(page.locator(".win")).toContainText("Final score: 0");
      await page.getByRole("button", { name: /Restart/ }).click();
      await expect(page.locator(".score")).toHaveText("Score: 0");
      await touchButton(page, cdp, "Left");
      await expect(page.locator(".win")).toContainText("Try another adventure");
      const finalLayout = await layoutSnapshot(page);
      assertTouchLayout(finalLayout, `${label} final`, scenario.insets);
      await page.screenshot({
        path: `${evidenceDir}/${mode.name}${suffix}-loss.png`,
      });
      scenarioReports.push({
        name: scenario.name,
        insets: scenario.insets,
        safeArea: layout.safeArea,
        controls: true,
        footer: finalLayout.help,
        scoreRight: 7,
        win: true,
        loss: true,
        restart: true,
      });
    }
    assert.deepEqual(generationRequests, []);
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(pageErrors, []);
    report.modes.push({
      name: mode.name,
      viewport: mode.viewport,
      projectSha256,
      scenarios: scenarioReports,
      generationRequests: generationRequests.length,
      externalRequests: externalRequests.length,
      pageErrors: pageErrors.length,
    });
  } finally {
    await context.close();
  }
}

const { files, project, projectSha256 } = await makeStaticFiles();
await mkdir(evidenceDir, { recursive: true });
const server = createServer((request, response) => {
  const requestedPath = decodeURIComponent(
    new URL(request.url ?? "/", "http://fixture").pathname,
  );
  const path = requestedPath === "/" ? "/index.html" : requestedPath;
  const bytes = files.get(path);
  if (!bytes || !["GET", "HEAD"].includes(request.method ?? "GET")) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": contentType(path),
  });
  if (request.method === "HEAD") response.end();
  else response.end(bytes);
});
const report = {
  status: "running",
  source: "current built public/player runtime",
  fixture: zipPath,
  projectId: project.id,
  revision: project.revision,
  projectSha256,
  inferenceCalls: 0,
  safeAreaEvidence: {
    kind: "synthetic-css-variable-injection",
    physicalDeviceCertification: false,
    note: "Representative notch and home-indicator insets were injected into the player CSS variables; this does not certify a physical device.",
  },
  modes: [],
  pageErrors: [],
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
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  for (const mode of [
    { name: "portrait-touch", viewport: { width: 390, height: 844 } },
    { name: "landscape-touch", viewport: { width: 844, height: 390 } },
  ])
    await runMode(browser, origin, mode, report, projectSha256);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error =
    error instanceof Error
      ? error.message.slice(0, 1000)
      : "touch fixture failed";
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(
    `${evidenceDir}/report.json`,
    `${JSON.stringify(report, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
  console.log(JSON.stringify(report, null, 2));
}
