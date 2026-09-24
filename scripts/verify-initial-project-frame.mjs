import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const output = resolve("docs/evidence/initial-project-framing");
const fixture = `
import { createRoot } from "react-dom/client";
import World from "./src/components/world";
import { useOrb } from "./src/lib/store";
import { blankProject } from "./src/lib/protocol";
import { _roots } from "@react-three/fiber";

const savedProject = {
  ...blankProject(),
  id: "saved-small-project",
  title: "Saved small subject",
  revision: 1,
  entities: [{
    id: "tiny-subject",
    label: "Tiny subject",
    position: [0, 0, 0],
    scale: [0.1, 0.1, 0.1],
    color: "#f0ac52",
    stage: "ready",
    geometry: { kind: "rock", detail: "coarse" },
  }],
};
useOrb.setState({
  project: savedProject,
  phase: "editing",
  playing: false,
  building: false,
  error: "",
  generationRecovery: undefined,
});
createRoot(document.getElementById("root")!).render(<World />);

(window as any).initialProjectFrameFixture = {
  ready: () => Boolean(document.querySelector("canvas")) &&
    document.querySelector('[aria-label^="Zoom in, currently"]') !== null,
  async openSaved() {
    useOrb.setState({
      project: blankProject(),
      phase: "landing",
      playing: false,
      building: false,
      error: "",
      generationRecovery: undefined,
    });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    return useOrb.getState().load(savedProject);
  },
  camera() {
    const label = document.querySelector('[aria-label^="Zoom in, currently"]');
    const canvas = document.querySelector("canvas");
    const state = canvas ? _roots.get(canvas)?.store.getState() : undefined;
    return {
      zoomLabel: label?.getAttribute("aria-label") ?? null,
      position: state?.camera.position.toArray() ?? null,
    };
  },
};
`;

const { outputFiles } = await build({
  stdin: {
    contents: fixture,
    resolveDir: process.cwd(),
    sourcefile: "initial-project-frame-fixture.tsx",
    loader: "tsx",
  },
  bundle: true,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  write: false,
});
const bundle = outputFiles[0].contents;
const server = createServer((request, response) => {
  if (request.url === "/fixture.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(bundle);
  } else if (request.url === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><title>Saved project framing fixture</title><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#07100f}canvas{display:block;width:100%;height:100%}</style><div id="root"></div><script type="module" src="/fixture.js"></script>',
    );
  } else {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const origin = `http://127.0.0.1:${server.address().port}`;
const errors = [];
const externalRequests = [];
let browser;
try {
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: "block",
  });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin)
      return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 500));
  });
  await page.goto(origin);
  await expect
    .poll(() => page.evaluate(() => window.initialProjectFrameFixture?.ready()))
    .toBe(true);
  await expect
    .poll(() =>
      page
        .locator('[aria-label^="Zoom in, currently"]')
        .getAttribute("aria-label"),
    )
    .toBe("Zoom in, currently 100%");
  const before = await page.evaluate(() =>
    window.initialProjectFrameFixture.camera(),
  );
  await page.screenshot({ path: resolve(output, "before-open.png") });

  assert.equal(
    await page.evaluate(() => window.initialProjectFrameFixture.openSaved()),
    true,
  );
  await expect
    .poll(() =>
      page
        .locator('[aria-label^="Zoom in, currently"]')
        .getAttribute("aria-label"),
    )
    .not.toBe("Zoom in, currently 100%");
  const after = await page.evaluate(() =>
    window.initialProjectFrameFixture.camera(),
  );
  await page.screenshot({ path: resolve(output, "after-open.png") });

  assert.notEqual(after.zoomLabel, before.zoomLabel);
  assert.ok(before.position && after.position);
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  await writeFile(
    resolve(output, "report.json"),
    `${JSON.stringify(
      {
        status: "passed",
        scope:
          "World renderer opens a populated saved project from landing; initial default camera compared with committed-bounds frame",
        providerCalls: 0,
        externalRequests,
        errors,
        before,
        after,
        screenshots: ["before-open.png", "after-open.png"],
      },
      null,
      2,
    )}\n`,
  );
  console.log("Saved small-project camera framing fixture passed.");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
