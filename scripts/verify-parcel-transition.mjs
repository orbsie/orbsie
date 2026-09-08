import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const baseURL = process.env.ORBSIE_TEST_URL ?? "http://127.0.0.1:3017";
const baseOrigin = new URL(baseURL).origin;
const evidenceDir = resolve(
  process.env.ORBSIE_EVIDENCE_DIR ?? "docs/evidence/parcel-transition",
);

async function makeFixture() {
  const bundled = await build({
    stdin: {
      contents: `
        import { blankProject } from './src/lib/protocol';
        import { fixtureEntities } from './src/lib/fixtures';
        const project = blankProject();
        export const fixture = {
          ...project,
          id: 'parcel-transition-fixture',
          title: 'Parcel transition fixture',
          revision: 1,
          entities: fixtureEntities(true),
        };
      `,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString("base64")}`
  );
  return module.fixture;
}

function generationFixture(project) {
  const entity = project.entities[0];
  return [
    {
      type: "reserve_entity",
      entity: { ...entity, geometry: undefined, stage: "seed" },
    },
    {
      type: "set_geometry",
      id: entity.id,
      geometry: { ...entity.geometry, detail: "coarse" },
    },
    {
      type: "set_geometry",
      id: entity.id,
      geometry: entity.geometry,
    },
    {
      type: "commit_revision",
      message: "Fixture descent is ready.",
    },
  ];
}

async function installGuard(context, report) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === baseOrigin ||
      url.protocol === "data:" ||
      url.protocol === "blob:"
    ) {
      await route.continue();
      return;
    }
    report.externalRequests.push({
      origin: url.origin || url.protocol,
      path: url.pathname,
    });
    await route.abort("blockedbyclient");
  });
}

async function seedLocalProject(page, project) {
  await page.evaluate(async (value) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("keyval-store", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("keyval"))
          request.result.createObjectStore("keyval");
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("keyval", "readwrite");
        const store = transaction.objectStore("keyval");
        store.put({ [value.id]: value }, "orbsie-library");
        store.put(
          { project: value, history: [], future: [], savedAt: Date.now() },
          "orbsie-draft",
        );
        store.put(
          { [value.id]: { project: value, history: [], future: [] } },
          "orbsie-history",
        );
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, project);
}

async function observe(page, name, screenshot, report) {
  await page.screenshot({
    path: join(evidenceDir, screenshot),
    fullPage: true,
  });
  const state = await page.evaluate(() => ({
    appClass: document.querySelector(".app")?.className ?? null,
    canvasCount: document.querySelectorAll("canvas").length,
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    bodyText: document.body.innerText.slice(0, 1000),
  }));
  const item = { name, screenshot, ...state };
  report.scenarios.push(item);
  return item;
}

async function openLocalWorkspace(
  browser,
  fixture,
  report,
  reducedMotion = false,
) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await installGuard(context, report);
  await context.route("**/api/trial", (route) =>
    route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } }),
  );
  const page = await context.newPage();
  if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/generate")
      report.generationRequests.push({
        method: request.method(),
        url: request.url(),
      });
  });
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await seedLocalProject(page, fixture);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Continue your saved world" }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Continue your saved world" }).click();
  await expect(page.locator(".app.is-workspace")).toBeVisible({
    timeout: 30000,
  });
  await page.waitForTimeout(700);
  await observe(
    page,
    reducedMotion ? "reduced-motion-direct-open" : "direct-local-open",
    reducedMotion ? "reduced-motion-direct-open.png" : "direct-local-open.png",
    report,
  );
  await page
    .getByRole("button", { name: "Back to planet", exact: true })
    .click();
  await expect(page.locator(".app.is-landing")).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(reducedMotion ? 120 : 2200);
  await observe(
    page,
    reducedMotion ? "reduced-motion-planet" : "back-to-planet",
    reducedMotion ? "reduced-motion-planet.png" : "back-to-planet.png",
    report,
  );
  await page.getByRole("button", { name: "Continue your saved world" }).click();
  await expect(page.locator(".app.is-workspace")).toBeVisible({
    timeout: 30000,
  });
  await page.waitForTimeout(reducedMotion ? 120 : 4500);
  await observe(
    page,
    reducedMotion
      ? "reduced-motion-repeated-arrival"
      : "repeated-project-arrival",
    reducedMotion
      ? "reduced-motion-repeated-arrival.png"
      : "repeated-project-arrival.png",
    report,
  );
  await context.close();
}

async function runInitialDescent(browser, fixture, report) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await installGuard(context, report);
  await context.route("**/api/trial", (route) =>
    route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } }),
  );
  await context.route("**/api/generate", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body:
        generationFixture(fixture)
          .map((command) => JSON.stringify(command))
          .join("\n") + "\n",
    }),
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/generate")
      report.generationRequests.push({
        method: request.method(),
        url: request.url(),
      });
  });
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await expect(page.getByPlaceholder("What experience to build?")).toBeVisible({
    timeout: 30000,
  });
  await page
    .getByPlaceholder("What experience to build?")
    .fill("A fixture garden");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.locator(".app.is-workspace")).toBeVisible({
    timeout: 30000,
  });
  await page.waitForTimeout(180);
  await observe(
    page,
    "initial-descent-early",
    "initial-descent-early.png",
    report,
  );
  await page.waitForTimeout(520);
  await observe(page, "initial-descent-mid", "initial-descent-mid.png", report);
  await page.waitForTimeout(4000);
  await observe(
    page,
    "initial-descent-settled",
    "initial-descent-settled.png",
    report,
  );
  await context.close();
}

async function standaloneSourceCheck(report) {
  const source = JSON.parse(
    await readFile("public/player/source.json", "utf8"),
  );
  report.standalone = {
    sourceIncludesParcelTransition: Object.hasOwn(
      source,
      "src/lib/parcel-transition.ts",
    ),
    sourceEntryCount: Object.keys(source).length,
  };
  if (!report.standalone.sourceIncludesParcelTransition)
    throw Error("Standalone player source is missing parcel-transition.ts.");
}

const report = {
  url: baseURL,
  fixture: null,
  scenarios: [],
  generationRequests: [],
  externalRequests: [],
  pageErrors: [],
  standalone: null,
};

await mkdir(evidenceDir, { recursive: true });
const fixture = await makeFixture();
report.fixture = {
  id: fixture.id,
  entityCount: fixture.entities.length,
  title: fixture.title,
};
await standaloneSourceCheck(report);

const browser = await chromium.launch({
  headless: process.env.ORBSIE_HEADLESS !== "0",
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  await runInitialDescent(browser, fixture, report);
  await openLocalWorkspace(browser, fixture, report);
  await openLocalWorkspace(browser, fixture, report, true);
} finally {
  await browser.close();
}

if (report.pageErrors.length)
  throw Error(`Browser errors: ${report.pageErrors.join(" | ")}`);
const unexpectedExternalRequests = report.externalRequests.filter(
  ({ origin }) =>
    !["https://fonts.googleapis.com", "https://fonts.gstatic.com"].includes(
      origin,
    ),
);
if (unexpectedExternalRequests.length)
  throw Error(
    `Unexpected external requests blocked: ${JSON.stringify(unexpectedExternalRequests)}`,
  );
if (report.generationRequests.length !== 1)
  throw Error(
    `Expected one fixture generation request, got ${report.generationRequests.length}.`,
  );
for (const scenario of report.scenarios) {
  if (scenario.canvasCount !== 1)
    throw Error(`${scenario.name}: expected one canvas.`);
  if (scenario.scrollWidth > scenario.viewportWidth)
    throw Error(`${scenario.name}: horizontal overflow detected.`);
}

await writeFile(
  join(evidenceDir, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
