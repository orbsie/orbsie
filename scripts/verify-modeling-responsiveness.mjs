/** Real isolated local Blender jobs with editor frame/input observations; no inference. */
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir, cpus, totalmem, release } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const execFile = promisify(execFileCallback);
const pageBytes = Number(
  (await execFile("getconf", ["PAGESIZE"])).stdout.trim(),
);
const clockTicks = Number(
  (await execFile("getconf", ["CLK_TCK"])).stdout.trim(),
);
assert(Number.isFinite(pageBytes) && Number.isFinite(clockTicks));
const origin = process.env.TEST_URL ?? "http://127.0.0.1:3035";
const evidence = "docs/evidence/modeling-responsiveness";
const directory = await mkdtemp(
  join(tmpdir(), "orbsie-modeling-responsiveness-"),
);
let browser, companion, page, sampling;
const jobs = [];
let rejectModelingFailure;
const modelingFailure = new Promise((_, reject) => {
  rejectModelingFailure = reject;
});
void modelingFailure.catch(() => {});
const processes = new Map();
const report = {
  passed: false,
  realProviderCalls: 0,
  scope:
    "Development system Blender runtime; real editor, loopback modeling transport and isolated construction. Software-rendered browser baseline, not clean-host packaged runtime or hardware GPU certification.",
  workload: {
    baselineEntities: 2,
    completedEntities: 5,
    generatedModels: 3,
    partsPerModel: 8,
    sphereSegments: 16,
    comparison: "Whole creation workload including decoding and added geometry",
  },
  hardware: {
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    ramBytes: totalmem(),
    kernel: release(),
  },
  jobs,
  pageErrors: [],
};
async function sampleProcesses() {
  let rss = 0;
  async function visit(pid) {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const name = stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")"));
      const fields = stat
        .slice(stat.lastIndexOf(")") + 2)
        .trim()
        .split(/\s+/);
      if (name === "blender") {
        // Read kernel page/tick sizes rather than assuming host defaults.
        rss += Number(fields[21]) * pageBytes;
        processes.set(
          pid,
          Math.max(
            processes.get(pid) ?? 0,
            Number(fields[11]) + Number(fields[12]),
          ),
        );
      }
      const children = (
        await readFile(`/proc/${pid}/task/${pid}/children`, "utf8")
      ).trim();
      for (const child of children.split(/\s+/).filter(Boolean))
        await visit(child);
    } catch (error) {
      if (!["ENOENT", "ESRCH"].includes(error.code)) throw error;
    }
  }
  await visit(process.pid);
  report.sampledPeakBlenderRSSBytes = Math.max(
    report.sampledPeakBlenderRSSBytes ?? 0,
    rss,
  );
}
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
  return {
    samples: sorted.length,
    meanMs: sorted.length
      ? sorted.reduce((a, b) => a + b, 0) / sorted.length
      : null,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: sorted.at(-1) ?? null,
  };
}
async function activity(label, durationMs) {
  const until = Date.now() + durationMs;
  let rounds = 0;
  while (Date.now() < until) {
    await page.locator("#prompt").fill("");
    await page
      .locator("#prompt")
      .pressSequentially(`${label} ${rounds}`, { delay: 25 });
    await expect(page.locator("#prompt")).toHaveValue(`${label} ${rounds}`);
    await page.mouse.move(1000, 570);
    await page.mouse.down();
    await page.mouse.move(1060, 595, { steps: 8 });
    await page.mouse.up();
    rounds++;
  }
  return rounds;
}
try {
  await mkdir(evidence, { recursive: true });
  await build({
    entryPoints: [
      "scripts/blender-modeling.ts",
      "scripts/modeling-companion.ts",
    ],
    bundle: true,
    platform: "node",
    format: "esm",
    outdir: directory,
    outExtension: { ".js": ".mjs" },
  });
  await copyFile(
    "scripts/blender-modeling.py",
    join(directory, "blender-modeling.py"),
  );
  const { runBlenderModelingJob } = await import(
    pathToFileURL(join(directory, "blender-modeling.mjs"))
  );
  const { startModelingCompanion } = await import(
    pathToFileURL(join(directory, "modeling-companion.mjs"))
  );
  // Preflight actual modeling, outside the measured editor comparison.
  await runBlenderModelingJob({
    version: 1,
    parts: [{ id: "preflight", shape: "box", color: "#ffffff" }],
  });
  companion = await startModelingCompanion({
    origin,
    build: async (job, options) => {
      const entry = { index: jobs.length, startedAt: Date.now(), stages: [] };
      jobs.push(entry);
      try {
        const result = await runBlenderModelingJob(job, {
          ...options,
          onProgress: (event) => {
            entry.stages.push({
              stage: event.stage,
              progress: event.progress,
              at: Date.now(),
            });
            options.onProgress?.(event);
          },
        });
        Object.assign(entry, {
          status: "complete",
          bytes: result.glb.byteLength,
          blenderVersion: result.blenderVersion,
        });
        return result;
      } catch (error) {
        entry.status = options.signal?.aborted ? "cancelled" : "failed";
        if (entry.status === "failed") {
          entry.error = String(error).slice(0, 500);
          rejectModelingFailure(error);
        }
        throw error;
      } finally {
        entry.endedAt = Date.now();
        entry.durationMs = entry.endedAt - entry.startedAt;
      }
    },
  });
  browser = await chromium.launch({
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  report.browserVersion = browser.version();
  page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => report.pageErrors.push(e.message));
  await page.addInitScript(() => {
    window.__responsiveness = { frames: [], inputs: [] };
    let previous;
    function frame(now) {
      if (previous !== undefined)
        window.__responsiveness.frames.push({
          at: performance.timeOrigin + now,
          ms: now - previous,
        });
      previous = now;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    for (const type of ["input", "pointermove"])
      document.addEventListener(
        type,
        () => {
          const at = performance.now();
          requestAnimationFrame((now) =>
            window.__responsiveness.inputs.push({
              at: performance.timeOrigin + at,
              ms: performance.now() - at,
              type,
            }),
          );
        },
        { passive: true },
      );
  });
  const reserve = (id, label, position) => ({
    type: "reserve_entity",
    entity: {
      id,
      label,
      position,
      scale: [1, 1, 1],
      color: "#79b5a0",
      stage: "seed",
    },
  });
  const modelingJob = {
    version: 1,
    parts: Array.from({ length: 8 }, (_, i) => ({
      id: `part-${i}`,
      shape: "sphere",
      segments: 16,
      color: i % 2 ? "#ed8fa3" : "#69bfad",
      position: [(i % 4) * 0.32, Math.floor(i / 4) * 0.32, 0],
      scale: [0.18, 0.18, 0.18],
    })),
  };
  let requests = 0;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config")
      return route.fulfill({ json: { accounts: false } });
    if (path === "/api/trial")
      return route.fulfill({ json: { enabled: true, remaining: 4 } });
    if (path === "/api/generate") {
      requests++;
      let commands;
      if (requests === 1)
        commands = [
          reserve("tree", "Retained tree", [-3, 0, 0]),
          {
            type: "set_geometry",
            id: "tree",
            geometry: { kind: "tree", detail: "refined" },
          },
          reserve("crystal", "Retained crystal", [3, 0, 0]),
          {
            type: "set_geometry",
            id: "crystal",
            geometry: { kind: "crystal", detail: "refined" },
          },
          { type: "commit_revision", message: "Baseline ready." },
        ];
      else if (requests === 2)
        commands = Array.from({ length: 3 }, (_, i) => [
          reserve(`built-${i}`, `Local model ${i}`, [-2 + i * 2, 0, 2]),
          {
            type: "set_geometry",
            id: `built-${i}`,
            geometry: {
              kind: "generated",
              job: modelingJob,
              detail: "refined",
            },
          },
        ])
          .flat()
          .concat({ type: "commit_revision", message: "Local models ready." });
      else
        commands = [
          reserve("cancelled", "Cancelled model", [0, 0, -2]),
          {
            type: "set_geometry",
            id: "cancelled",
            geometry: {
              kind: "generated",
              job: modelingJob,
              detail: "refined",
            },
          },
          {
            type: "commit_revision",
            message: "Cancellation unexpectedly finished.",
          },
        ];
      return route.fulfill({
        contentType: "application/x-ndjson",
        body:
          commands.map((command) => JSON.stringify(command)).join("\n") + "\n",
      });
    }
    return route.fulfill({ json: { models: [] } });
  });
  await page.goto(
    origin +
      "/#builder=" +
      encodeURIComponent(
        JSON.stringify({ url: companion.url, token: companion.token }),
      ),
  );
  await expect(
    page.getByText("Local Blender is connected.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.locator("#prompt").fill("Make a tree and a crystal");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByText("Baseline ready.", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(3000);
  report.webgl = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
      dpr: devicePixelRatio,
      width: canvas.width,
      height: canvas.height,
    };
  });
  const idleStart = Date.now();
  report.idleInteractionRounds = await activity("Idle typing", 6000);
  const idleEnd = Date.now();
  report.idleBackingBuffer = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return { width: c.width, height: c.height };
  });
  await page
    .locator("#prompt")
    .fill("Build three new models using local Blender");
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  await expect.poll(() => jobs.length, { timeout: 15000 }).toBe(1);
  await page.getByRole("button", { name: "Show objects", exact: true }).click();
  await page
    .locator(".object-list button")
    .filter({ hasText: "Retained tree" })
    .click();
  await expect(
    page.getByRole("button", { name: "Clear selected object" }),
  ).toBeVisible();
  report.selectionDuringModelingAt = Date.now();
  await page.getByRole("button", { name: "Clear selected object" }).click();
  await expect(page.locator(".object-list")).toHaveCount(0);
  sampling = setInterval(
    () =>
      void sampleProcesses().catch((error) => {
        report.samplingError = error.code ?? "sampling-failed";
      }),
    150,
  );
  report.activeInteractionRounds = await activity("Building typing", 7000);
  await Promise.race([
    expect(page.getByText("Local models ready.", { exact: true })).toBeVisible({
      timeout: 60000,
    }),
    modelingFailure,
  ]);
  clearInterval(sampling);
  sampling = undefined;
  report.activeBackingBuffer = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return { width: c.width, height: c.height };
  });
  assert.equal(jobs.length, 3);
  assert(
    jobs.some(
      (job) =>
        report.selectionDuringModelingAt >= job.startedAt &&
        report.selectionDuringModelingAt <= job.endedAt,
    ),
    "Selection must complete during actual modeling",
  );
  assert(jobs.every((job) => job.status === "complete"));
  await page.getByRole("button", { name: "Show objects", exact: true }).click();
  await page
    .locator(".object-list button")
    .filter({ hasText: "Retained tree" })
    .click();
  await expect(
    page.getByRole("button", { name: "Clear selected object" }),
  ).toBeVisible();
  report.selectionAfterModeling = true;
  await page.getByRole("button", { name: "Clear selected object" }).click();
  await page.screenshot({ path: join(evidence, "completed.png") });
  const samples = await page.evaluate(() => window.__responsiveness);
  const during = (at) =>
    jobs.some((job) => at >= job.startedAt && at <= job.endedAt);
  report.idle = {
    frames: distribution(
      samples.frames
        .filter((s) => s.at >= idleStart && s.at <= idleEnd)
        .map((s) => s.ms),
    ),
    inputDispatchToFrameCallback: distribution(
      samples.inputs
        .filter((s) => s.at >= idleStart && s.at <= idleEnd)
        .map((s) => s.ms),
    ),
  };
  report.active = {
    frames: distribution(
      samples.frames.filter((s) => during(s.at)).map((s) => s.ms),
    ),
    inputDispatchToFrameCallback: distribution(
      samples.inputs.filter((s) => during(s.at)).map((s) => s.ms),
    ),
  };
  assert(
    report.active.frames.samples > 10,
    "Need measured frames overlapping real Blender jobs",
  );
  assert(
    report.active.inputDispatchToFrameCallback.samples > 5,
    "Need input samples overlapping real Blender jobs",
  );
  report.performanceTargets = {
    normalFrameMs: 1000 / 60,
    fallbackFrameMs: 1000 / 30,
    activeP95MeetsFallback: report.active.frames.p95Ms <= 1000 / 30,
    note: "These measurements do not certify a hardware-GPU laptop. Passing this probe means functional measurement completed, not performance targets achieved.",
  };
  report.sampledBlenderCpuSeconds =
    [...processes.values()].reduce((a, b) => a + b, 0) / clockTicks;
  report.sampling = {
    intervalMs: 150,
    pageBytes,
    clockTicksPerSecond: clockTicks,
    note: "Sampled Blender processes only; short-lived work can be missed. GPU memory unavailable.",
  };
  // Exercise actual cancellation through the editor after a fourth Blender job starts.
  await page.locator("#prompt").fill("Build another new local model");
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  await expect.poll(() => jobs.length, { timeout: 15000 }).toBe(4);
  await expect
    .poll(
      () =>
        jobs[3].stages.some(
          (event) => event.stage === "modeling" && event.progress > 0,
        ),
      {
        timeout: 15000,
        intervals: [25],
      },
    )
    .toBe(true);
  const cancelStart = Date.now();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(() => jobs[3].status, { timeout: 10000 }).toBe("cancelled");
  report.cancellationMs = jobs[3].endedAt - cancelStart;
  await expect(
    page.getByText("Cancellation unexpectedly finished.", { exact: true }),
  ).toHaveCount(0);
  assert.deepEqual(report.pageErrors, []);
  report.fixtureGenerationRequests = requests;
  report.passed = true;
} catch (error) {
  report.error = String(error).replace(
    /#builder=[^\s]+/g,
    "#builder=[redacted]",
  );
  await page
    ?.screenshot({ path: join(evidence, "failure.png") })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  clearInterval(sampling);
  const cleanup = await Promise.allSettled([
    browser?.close(),
    companion?.close(),
  ]);
  report.cleanupFailures = cleanup.filter(
    (result) => result.status === "rejected",
  ).length;
  try {
    await rm(directory, { recursive: true, force: true });
  } catch {
    report.cleanupFailures++;
  }
  if (report.cleanupFailures) {
    report.passed = false;
    process.exitCode = 1;
  }
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
