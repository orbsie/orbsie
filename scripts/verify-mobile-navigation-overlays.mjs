#!/usr/bin/env node
// Check responsive overlay geometry in a local production build. Generation
// is deterministic and intercepted; no provider/model calls are made.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";

const appUrl = process.env.TEST_URL ?? "http://127.0.0.1:3019";
const appOrigin = new URL(appUrl).origin;
const outputArg = process.argv[2];
if (!outputArg)
  throw Error(
    "Provide a new evidence directory under docs/evidence/mobile-navigation-overlays/.",
  );
const evidenceRoot = resolve("docs/evidence/mobile-navigation-overlays");
const outputPath = resolve(outputArg);
const outputRelative = relative(evidenceRoot, outputPath);
if (outputRelative.startsWith("..") || outputRelative === "")
  throw Error(
    "Evidence output must be a new child of docs/evidence/mobile-navigation-overlays/.",
  );
await mkdir(evidenceRoot, { recursive: true });
await mkdir(outputPath, { recursive: false });

const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const ids = {
  group: "overlay-fixture-group",
  entity: "overlay-fixture-marker",
};
const commands = [
  {
    type: "create_group",
    group: {
      id: ids.group,
      label: "Overlay fixture group",
      position: [12000, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  },
  {
    type: "reserve_entity",
    entity: {
      id: ids.entity,
      label: "Overlay fixture marker",
      position: [0, 1, 0],
      scale: [1, 1, 1],
      parentId: ids.group,
      color: "#a1f0d7",
      behavior: { type: "static" },
      stage: "seed",
    },
  },
  {
    type: "set_geometry",
    id: ids.entity,
    geometry: { kind: "crystal", detail: "refined" },
  },
  { type: "commit_revision", message: "Placed the overlay fixture." },
];
const laneDefinitions = [
  { name: "portrait-390x844", viewport: { width: 390, height: 844 } },
  { name: "short-portrait-390x640", viewport: { width: 390, height: 640 } },
  { name: "short-landscape-844x390", viewport: { width: 844, height: 390 } },
];
const report = {
  status: "failed",
  appUrl,
  sourceCommit,
  testedWorktreeChanges: ["src/app/globals.css"],
  providerCalls: 0,
  renderer: "Forced Canvas2D fallback; compatibility advisory is present",
  viewports: {},
  blockedExternalOrigins: [],
  unexpectedApiPaths: [],
  assumptions: [
    "The local production server serves the checked-in CSS; /api/generate returns deterministic fixture NDJSON through Playwright routing.",
    "Viewport sizes are CSS pixels with Chromium mobile/touch emulation, not device certification.",
  ],
  limitations: [
    "No provider/model inference, native GPU, physical mobile hardware, or published-player layout is exercised.",
    "The CSS changes are scoped to private mobile workspace layouts; landing and published-player modes are not changed by these selectors.",
  ],
};

function ndjson(values) {
  return values.map((value) => JSON.stringify(value)).join("\n") + "\n";
}

function overlap(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function rounded(rect) {
  return Object.fromEntries(
    Object.entries(rect).map(([key, value]) => [
      key,
      Math.round(value * 10) / 10,
    ]),
  );
}

async function bounds(page, selector, label) {
  const element = page.locator(selector).first();
  await expect(element, `${label} should be visible`).toBeVisible();
  const rect = await element.boundingBox();
  assert(rect, `${label} should have a browser rectangle`);
  return { element, rect: rounded(rect) };
}

async function runViewport(browser, lane) {
  const result = {
    viewport: lane.viewport,
    generationRequests: 0,
    pageErrors: [],
    consoleErrors: [],
    blockedExternalOrigins: [],
    unexpectedApiPaths: [],
    checks: {},
  };
  report.viewports[lane.name] = result;
  const context = await browser.newContext({
    viewport: lane.viewport,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, attributes) {
      if (["webgl2", "webgl", "experimental-webgl"].includes(kind)) return null;
      return original.call(this, kind, attributes);
    };
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    if (target.origin !== appOrigin && /^https?:$/.test(target.protocol)) {
      result.blockedExternalOrigins.push(target.origin);
      await route.abort();
      return;
    }
    if (target.origin !== appOrigin) {
      await route.continue();
      return;
    }
    if (target.pathname === "/api/trial") {
      await route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } });
      return;
    }
    if (target.pathname === "/api/config") {
      await route.fulfill({ json: { accounts: false, publishing: false } });
      return;
    }
    if (target.pathname === "/api/models") {
      await route.fulfill({ json: [] });
      return;
    }
    if (target.pathname === "/api/generate") {
      result.generationRequests += 1;
      const body = request.postDataJSON();
      assert.equal(body.provider, "free");
      assert.equal(body.localModeling, false);
      assert.equal(body.browserModeling, true);
      assert.equal(body.key, "");
      assert.equal(body.selected, undefined);
      assert.equal(body.project.entities.length, 0);
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: ndjson(commands),
      });
      return;
    }
    if (target.pathname.startsWith("/api/")) {
      result.unexpectedApiPaths.push(target.pathname);
      await route.abort();
      return;
    }
    await route.continue();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => {
    if (/Error creating WebGL context/i.test(error.message)) return;
    result.pageErrors.push(error.message.slice(0, 300));
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/Error creating WebGL context/i.test(message.text())) return;
    result.consoleErrors.push(message.text().slice(0, 300));
  });

  try {
    await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page
      .getByPlaceholder("What experience to build?")
      .fill("Create a marker for mobile overlay layout testing");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(
      page.locator('main[data-renderer-availability="ready"]'),
    ).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator(".software-world")).toBeVisible();
    await expect(page.locator(".graphics-error.is-advisory")).toBeVisible();
    await expect(page.locator(".toast")).toBeVisible({ timeout: 10000 });

    const app = await bounds(
      page,
      "main.is-workspace:not(.is-public)",
      "private workspace",
    );
    const controls = await bounds(
      page,
      ".world-navigation-controls",
      "navigation controls",
    );
    const advisory = await bounds(
      page,
      ".graphics-error.is-advisory",
      "graphics advisory",
    );
    const toast = await bounds(page, ".toast", "notice toast");
    const chat = await bounds(page, ".chat-panel", "chat sheet");
    const heading = await bounds(
      page,
      ".workspace-heading",
      "workspace heading",
    );
    const toolbar = await bounds(page, ".play-toolbar", "action toolbar");
    const dismissGraphics = await bounds(
      page,
      '.graphics-error.is-advisory button[aria-label="Dismiss graphics advice"]',
      "graphics dismiss button",
    );
    const dismissToast = await bounds(
      page,
      '.toast button[aria-label="Dismiss message"]',
      "toast dismiss button",
    );
    const viewport = lane.viewport;
    for (const [label, item] of Object.entries({
      controls,
      advisory,
      toast,
      chat,
      heading,
      toolbar,
      dismissGraphics,
      dismissToast,
    })) {
      assert(
        item.rect.x >= 0 && item.rect.y >= 0,
        `${label} starts inside viewport`,
      );
      assert(
        item.rect.x + item.rect.width <= viewport.width + 1 &&
          item.rect.y + item.rect.height <= viewport.height + 1,
        `${label} fits inside viewport`,
      );
    }
    assert(
      !overlap(advisory.rect, toast.rect),
      "advisory and toast do not overlap",
    );
    assert(
      !overlap(advisory.rect, controls.rect),
      "advisory does not cover navigation controls",
    );
    assert(
      !overlap(toast.rect, controls.rect),
      "toast does not cover navigation controls",
    );
    assert(
      !overlap(advisory.rect, chat.rect),
      "advisory does not cover chat sheet",
    );
    assert(!overlap(toast.rect, chat.rect), "toast does not cover chat sheet");
    assert(
      !overlap(advisory.rect, heading.rect),
      "advisory does not cover workspace heading",
    );
    assert(
      !overlap(advisory.rect, toolbar.rect),
      "advisory does not cover action toolbar",
    );
    assert(
      !overlap(toast.rect, heading.rect),
      "toast does not cover workspace heading",
    );
    assert(
      !overlap(toast.rect, toolbar.rect),
      "toast does not cover action toolbar",
    );
    for (const [label, dismiss, parent] of [
      ["graphics dismiss", dismissGraphics.rect, advisory.rect],
      ["toast dismiss", dismissToast.rect, toast.rect],
    ]) {
      assert(
        dismiss.x >= parent.x &&
          dismiss.y >= parent.y &&
          dismiss.x + dismiss.width <= parent.x + parent.width &&
          dismiss.y + dismiss.height <= parent.y + parent.height,
        `${label} is reachable inside its overlay`,
      );
    }

    result.geometry = {
      controls: controls.rect,
      advisory: advisory.rect,
      toast: toast.rect,
      chatSheet: chat.rect,
      heading: heading.rect,
      toolbar: toolbar.rect,
      graphicsDismiss: dismissGraphics.rect,
      toastDismiss: dismissToast.rect,
    };
    result.checks = {
      allOverlaysInsideViewport: true,
      noOverlayIntersection: true,
      dismissButtonsVisibleAndContained: true,
      rendererReady: true,
      selectedFixtureStillSaved: false,
    };
    const saved = (await storageSnapshot(page)).project;
    const entity = saved?.entities?.find((item) => item.id === ids.entity);
    assert(entity && entity.parentId === ids.group);
    result.checks.selectedFixtureStillSaved = true;
    assert.equal(result.generationRequests, 1);
    assert.deepEqual(result.blockedExternalOrigins, []);
    assert.deepEqual(result.unexpectedApiPaths, []);
    assert.deepEqual(result.pageErrors, []);
    assert.deepEqual(result.consoleErrors, []);
    result.checks.noUnexpectedRequestsOrBrowserErrors = true;
    await page.screenshot({
      path: `${outputPath}/${lane.name}.png`,
      animations: "disabled",
    });
    await dismissGraphics.element.click();
    await expect(page.locator(".graphics-error.is-advisory")).toHaveCount(0);
    await dismissToast.element.click();
    await expect(page.locator(".toast")).toHaveCount(0);
    result.checks.bothDismissButtonsWork = true;
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({
  headless: true,
  timeout: 30000,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  for (const lane of laneDefinitions) {
    try {
      await runViewport(browser, lane);
    } catch (error) {
      const result = (report.viewports[lane.name] ??= {
        viewport: lane.viewport,
        checks: {},
      });
      result.failure = `${error?.name ?? "Error"}: ${String(error?.message ?? error).slice(0, 500)}`;
    }
  }
} finally {
  await browser.close();
}

for (const result of Object.values(report.viewports)) {
  report.blockedExternalOrigins.push(...(result.blockedExternalOrigins ?? []));
  report.unexpectedApiPaths.push(...(result.unexpectedApiPaths ?? []));
}
report.blockedExternalOrigins = [
  ...new Set(report.blockedExternalOrigins),
].sort();
report.unexpectedApiPaths = [...new Set(report.unexpectedApiPaths)].sort();
report.status =
  Object.values(report.viewports).length === laneDefinitions.length &&
  Object.values(report.viewports).every(
    (result) => !result.failure && result.checks?.bothDismissButtonsWork,
  )
    ? "passed"
    : "partial/failed";
await writeFile(
  `${outputPath}/report.json`,
  `${JSON.stringify(report, null, 2)}\n`,
);
const markdown = [
  "# Mobile navigation overlay evidence",
  "",
  `Status: **${report.status}**`,
  `Target: ${appUrl}`,
  `Source commit: ${sourceCommit}`,
  "Tested the production build with the current working-tree src/app/globals.css.",
  "Provider calls: 0; deterministic fixture NDJSON was intercepted.",
  "",
  ...Object.entries(report.viewports).map(([name, result]) => {
    if (result.failure) return `- **${name}**: failed: ${result.failure}`;
    return `- **${name}**: ${JSON.stringify(result.geometry)}; checks: ${JSON.stringify(result.checks)}`;
  }),
  "",
  "This is Chromium mobile/touch viewport evidence using the Canvas2D compatibility path, not physical-device or native-GPU certification.",
  "",
].join("\n");
await writeFile(`${outputPath}/report.md`, markdown);
console.log(`${report.status}: ${outputPath}`);
if (report.status !== "passed") process.exitCode = 1;
