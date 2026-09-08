import { cpus, platform, release, totalmem } from "node:os";
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Fixture-only shared playback: no generation requests or model calls.
const url = process.env.TEST_URL ?? "http://localhost:3001";
const output = process.env.PERF_OUTPUT ?? "/tmp/orbsie-render";
const recording = process.env.PERF_RECORD_VIDEO !== "0";
await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), "orbsie-perf-"));
await build({
  stdin: {
    contents: `import {blankProject} from './src/lib/protocol'; import {fixtureEntities} from './src/lib/fixtures'; import {encodeWorld} from './src/lib/export'; const project={...blankProject(),entities:fixtureEntities(),revision:1}; export const world=encodeWorld(project);`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(temp, "fixture.mjs"),
});
const { world } = await import(pathToFileURL(join(temp, "fixture.mjs")));
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: Number(process.env.PERF_DPR ?? 1),
  ...(recording
    ? { recordVideo: { dir: output, size: { width: 1440, height: 1000 } } }
    : {}),
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/api/generate", (route) => {
  errors.push("Unexpected generation request");
  return route.abort();
});
await page.goto(`${url}/#orb=${world}`);
await page.waitForSelector("canvas");
await page.waitForTimeout(18000);
const measurements = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const intervals = [];
      let last;
      function sample(now) {
        if (last !== undefined) intervals.push(now - last);
        last = now;
        if (intervals.length < 240) requestAnimationFrame(sample);
        else {
          intervals.sort((a, b) => a - b);
          const canvas = document.querySelector("canvas");
          const gl = canvas.getContext("webgl2");
          const debug = gl.getExtension("WEBGL_debug_renderer_info");
          resolve({
            medianMs: intervals[120],
            p95Ms: intervals[228],
            samples: intervals.length,
            sortedFrameIntervalsMs: intervals,
            canvas: { width: canvas.width, height: canvas.height },
            devicePixelRatio,
            renderer: debug
              ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
              : gl.getParameter(gl.RENDERER),
            userAgent: navigator.userAgent,
          });
        }
      }
      requestAnimationFrame(sample);
    }),
);
await page.screenshot({ path: join(output, "playback.png") });
const report = {
  checkedAt: new Date().toISOString(),
  sourceCommit: process.env.ORBSIE_APP_SOURCE_COMMIT ?? "unverified",
  buildMode: process.env.ORBSIE_BUILD_MODE ?? "unverified",
  host: {
    platform: platform(),
    release: release(),
    cpu: cpus()[0]?.model ?? "unknown",
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
  },
  scope:
    "Fixed 14-entity fixture frame scheduling; not native-GPU certification",
  url,
  fixtureEntities: 14,
  viewport: { width: 1440, height: 1000 },
  recording,
  ...measurements,
  errors,
};
await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await context.close();
await browser.close();
await rm(temp, { recursive: true, force: true });
if (errors.length) process.exitCode = 1;
