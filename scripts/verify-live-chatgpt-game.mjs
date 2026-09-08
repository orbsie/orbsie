/**
 * Opt-in browser acceptance for real ChatGPT game rules through the local
 * companion. The browser starts with a synthetic fixture scene; only the
 * follow-up rule edit reaches the authenticated local ChatGPT client.
 */
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { LocalChatGPT } from "./local-chatgpt.mjs";

const replayPath = process.env.ORBSIE_GAME_COMMAND_REPLAY;
if (!replayPath && process.env.ORBSIE_LIVE_E2E !== "1")
  throw Error("Set ORBSIE_LIVE_E2E=1 to authorize the real-provider check.");

const base = "http://127.0.0.1:3024";
const evidenceRun = process.env.ORBSIE_EVIDENCE_RUN ?? "";
if (evidenceRun && !/^[a-z0-9-]{1,32}$/.test(evidenceRun))
  throw Error("Invalid evidence run name.");
const evidenceDirectory =
  "docs/evidence/game-program-chatgpt" +
  (evidenceRun ? `/run-${evidenceRun}` : "");
const reportPath = join(evidenceDirectory, "report.json");
const report = {
  scope:
    "Real ChatGPT rules on a fixture scene through the loopback HTTP bridge; not settings pairing.",
  status: "running",
  stage: "startup",
  model: undefined,
  reasoning: "low",
  serviceTier: "default",
  browserGenerationRequests: 0,
  clientGenerateCalls: 0,
  commands: [],
  commandTypes: [],
  pageErrors: [],
  externalRequests: [],
};

const fixtureCommands = [
  {
    type: "reserve_entity",
    entity: {
      id: "crystal",
      label: "Crystal",
      position: [0, 0, 5],
      scale: [1, 1, 1],
      color: "#eeaa44",
      stage: "seed",
      behavior: { type: "collect" },
    },
  },
  {
    type: "set_geometry",
    id: "crystal",
    geometry: { kind: "crystal", detail: "refined" },
  },
  {
    type: "commit_revision",
    message: "Program ready.",
  },
];
const followupPrompt =
  "Keep every existing object unchanged. Add a game program with exactly three rules: pressing right adds 7 score; pressing up wins; pressing left loses. No timers or collection scoring. Output set_game then commit_revision only. Keep the reply under 400 tokens.";

let browser;
let currentPage;
let replayCommands;
let server;
let client;
let companion;
let temporaryDirectory;
let realCommands = [];
let beforeEntities;
let browserGenerationCalls = 0;
let routeFailure;

function safeError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/token[=:][^\s]+/gi, "token=[redacted]");
}

async function persistReport() {
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
}

function parseNdjson(text) {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function gameRuleChecks(game) {
  assert.ok(game && Array.isArray(game.rules), "set_game must contain rules");
  assert.equal(game.rules.length, 3, "ChatGPT must return exactly three rules");
  const byInput = new Map(
    game.rules
      .filter((rule) => rule.trigger?.type === "input")
      .map((rule) => [rule.trigger.action, rule]),
  );
  const right = byInput.get("right");
  const up = byInput.get("up");
  const left = byInput.get("left");
  assert.equal(right?.actions?.length, 1, "right rule must have one action");
  assert.deepEqual(right.actions[0], {
    type: "add_score",
    amount: 7,
  });
  assert.deepEqual(up?.actions, [{ type: "win" }]);
  assert.deepEqual(left?.actions, [{ type: "lose" }]);
  return {
    rightAdds7: true,
    upWins: true,
    leftLoses: true,
    exactRuleCount: true,
  };
}

async function closeStaticServer() {
  if (!server) return;
  const active = server;
  server = undefined;
  active.closeAllConnections?.();
  await new Promise((resolve) => active.close(resolve));
}

try {
  await mkdir(evidenceDirectory, { recursive: true });
  temporaryDirectory = await mkdtemp("/tmp/orbsie-live-chatgpt-game-");
  const workDirectory = join(temporaryDirectory, "work");
  await mkdir(workDirectory);
  if (replayPath) {
    const saved = JSON.parse(await readFile(replayPath, "utf8"));
    assert.equal(saved.model, "gpt-6-astra");
    replayCommands = saved.commands;
    report.scope =
      "Replay saved ChatGPT-authored commands through editor and newly exported ZIP; no inference or settings pairing.";
    report.model = saved.model;
    report.replayedCommands = true;
  } else {
    report.stage = "compile-companion";
    await build({
      entryPoints: ["scripts/chatgpt-companion.ts", "src/lib/protocol.ts"],
      outdir: temporaryDirectory,
      outbase: ".",
      outExtension: { ".js": ".mjs" },
      bundle: true,
      platform: "node",
      format: "esm",
    });
    const { startChatGPTCompanion } = await import(
      pathToFileURL(join(temporaryDirectory, "scripts/chatgpt-companion.mjs"))
    );
    client = new LocalChatGPT(workDirectory);
    report.stage = "connect-local-chatgpt";
    const model = await client.connect();
    assert.equal(model, "gpt-6-astra");
    report.model = model;
    companion = await startChatGPTCompanion({
      client: {
        generate: (...args) => {
          report.clientGenerateCalls++;
          return client.generate(...args);
        },
        close: () => client.close(),
      },
      model,
      origin: base,
    });
    const healthResponse = await fetch(`${companion.url}/health`, {
      headers: {
        Origin: base,
        Authorization: `Bearer ${companion.token}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.deepEqual(
      { model: health.model, effort: health.effort },
      { model: "gpt-6-astra", effort: "low" },
    );
  }
  report.stage = "browser-fixture";
  await persistReport();

  browser = await chromium.launch({
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const pageErrors = report.pageErrors;
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  currentPage = page;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/**", async (route) => {
    try {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/config")
        return await route.fulfill({ json: { accounts: false } });
      if (path === "/api/trial")
        return await route.fulfill({ json: { enabled: true, remaining: 3 } });
      if (path === "/api/models")
        return await route.fulfill({ json: { models: [] } });
      if (path !== "/api/generate") return await route.fulfill({ json: {} });

      browserGenerationCalls++;
      report.browserGenerationRequests = browserGenerationCalls;
      if (browserGenerationCalls === 1) {
        return await route.fulfill({
          contentType: "application/x-ndjson",
          body:
            fixtureCommands
              .map((command) => JSON.stringify(command))
              .join("\n") + "\n",
        });
      }
      if (browserGenerationCalls !== 2)
        throw Error("Only one ChatGPT follow-up is authorized per invocation.");

      const request = route.request().postDataJSON();
      beforeEntities = structuredClone(request.project.entities);
      report.stage = "chatgpt-followup-request";
      const payload = {
        prompt: request.prompt,
        project: request.project,
        localModeling: Boolean(request.localModeling),
        ...(request.selected ? { selected: request.selected } : {}),
      };
      const response = replayCommands
        ? new Response(
            replayCommands
              .map((command) => JSON.stringify(command))
              .join("\n") + "\n",
          )
        : await fetch(`${companion.url}/generate`, {
            method: "POST",
            headers: {
              Origin: base,
              Authorization: `Bearer ${companion.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(180000),
          });
      if (!replayCommands) report.companionHttpStatus = response.status;
      const body = await response.text();
      if (!response.ok) {
        routeFailure = `ChatGPT companion returned HTTP ${response.status}.`;
        report.routeFailure = routeFailure;
        await persistReport();
        return await route.fulfill({
          status: 502,
          json: { error: "Local ChatGPT bridge failed." },
        });
      }
      if (body.length > 16000)
        throw Error("ChatGPT command stream exceeded the probe budget.");
      realCommands = parseNdjson(body);
      const setGame = realCommands.find(
        (command) => command.type === "set_game",
      );
      report.commands = realCommands;
      report.commandTypes = realCommands.map((command) => command.type);
      report.gameRuleChecks = gameRuleChecks(setGame?.game);
      assert.equal(realCommands.at(-1)?.type, "commit_revision");
      await persistReport();
      return await route.fulfill({
        contentType: "application/x-ndjson",
        body,
      });
    } catch (error) {
      routeFailure = safeError(error);
      report.routeFailure = routeFailure;
      await persistReport().catch(() => {});
      try {
        await route.fulfill({
          status: 502,
          json: { error: "Local ChatGPT bridge failed." },
        });
      } catch {
        await route.abort().catch(() => {});
      }
    }
  });

  await page.goto(base);
  await page
    .locator("#prompt")
    .fill("Create a collectible with custom scoring");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Program ready.", { exact: true })).toBeVisible();
  await page.locator("#prompt").fill(followupPrompt);
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  await expect
    .poll(() => realCommands.some((command) => command.type === "set_game"), {
      timeout: 180000,
    })
    .toBe(true);
  assert.equal(report.clientGenerateCalls, replayCommands ? 0 : 1);
  assert.equal(report.browserGenerationRequests, 2);
  report.stage = "editor-play";
  await persistReport();
  await expect(
    page.getByText(realCommands.at(-1).message, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator("canvas")).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.locator(".game-hud strong")).toHaveText("0");
  await page.keyboard.down("d");
  await expect(page.locator(".game-hud strong")).toHaveText("7");
  await page.waitForTimeout(150);
  await page.keyboard.up("d");
  await expect(page.locator(".game-hud strong")).toHaveText("7");
  await page.keyboard.press("w", { delay: 100 });
  await expect(page.locator(".win-card")).toContainText("Final score: 7");
  await page.screenshot({ path: join(evidenceDirectory, "editor-win.png") });
  await page.getByRole("button", { name: "Restart game", exact: true }).click();
  await expect(page.locator(".game-hud strong")).toHaveText("0");
  await page.keyboard.press("a", { delay: 100 });
  await expect(page.locator(".win-card")).toContainText(
    "Try another adventure",
  );

  report.stage = "export";
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  await page.getByRole("button", { name: /^Download your world/ }).click();
  await (await downloadPromise).saveAs(join(evidenceDirectory, "world.zip"));
  const files = unzipSync(await readFile(join(evidenceDirectory, "world.zip")));
  const project = JSON.parse(strFromU8(files["project.json"]));
  assert.deepEqual(project.entities, beforeEntities);
  report.gameRuleChecks = gameRuleChecks(project.game);
  assert.equal(project.game.rules.length, 3);
  assert.ok(files["src/lib/game-program.ts"]);
  assert.ok(files["src/lib/game-session.ts"]);
  await persistReport();

  server = createServer((request, response) => {
    const path =
      new URL(request.url, "http://localhost").pathname.slice(1) ||
      "index.html";
    const bytes = files[path];
    if (!bytes) {
      response.writeHead(404);
      response.end();
      return;
    }
    const ext = path.split(".").pop();
    response.setHeader(
      "Content-Type",
      {
        js: "text/javascript",
        mjs: "text/javascript",
        css: "text/css",
        html: "text/html",
        json: "application/json",
      }[ext] ?? "application/octet-stream",
    );
    response.end(bytes);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const standaloneOrigin = `http://127.0.0.1:${server.address().port}`;
  report.stage = "standalone-play";
  await persistReport();
  const player = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  currentPage = player;
  player.on("pageerror", (error) => pageErrors.push(error.message));
  player.on("request", (request) => {
    if (
      !request.url().startsWith(standaloneOrigin) &&
      !request.url().startsWith("data:")
    )
      report.externalRequests.push(request.url());
  });
  await player.goto(standaloneOrigin);
  await expect(player.locator("canvas")).toBeVisible();
  await expect(player.locator("main[data-ready=true]")).toBeVisible({
    timeout: 30000,
  });
  await expect(player.locator(".score")).toHaveText("Score: 0");
  await player.keyboard.press("d", { delay: 100 });
  await expect(player.locator(".score")).toHaveText("Score: 7");
  await player.keyboard.press("w", { delay: 100 });
  await expect(player.locator(".win")).toContainText("Final score: 7");
  await player.getByRole("button", { name: /Restart/ }).click();
  await expect(player.locator(".score")).toHaveText("Score: 0");
  await player.keyboard.press("a", { delay: 100 });
  await expect(player.locator(".win")).toContainText("Try another adventure");
  await player.screenshot({
    path: join(evidenceDirectory, "standalone-loss.png"),
  });
  assert.deepEqual(report.externalRequests, []);
  assert.deepEqual(pageErrors, []);

  Object.assign(report, {
    status: "passed",
    stage: "complete",
    fixtureGenerationRequests: 1,
    browserGenerationRequests: 2,
    clientGenerateCalls: replayCommands ? 0 : 1,
    editorScore: 7,
    standaloneScore: 7,
    win: true,
    loss: true,
    restart: true,
    heldInputDeduplicated: true,
    unchangedEntities: true,
    programPreservedInZIP: true,
    sourceIncluded: true,
  });
} catch (error) {
  if (currentPage)
    await currentPage
      .screenshot({ path: join(evidenceDirectory, "failure.png") })
      .catch(() => {});
  report.status = "failed";
  report.stage = report.stage || "failed";
  report.error = safeError(error);
  process.exitCode = 1;
} finally {
  try {
    await browser?.close();
  } catch (error) {
    report.cleanupError = safeError(error);
  }
  try {
    await closeStaticServer();
  } catch (error) {
    report.cleanupError = safeError(error);
  }
  try {
    if (companion) await companion.close();
    else client?.close();
  } catch (error) {
    report.cleanupError = safeError(error);
  }
  try {
    if (temporaryDirectory)
      await rm(temporaryDirectory, { recursive: true, force: true });
  } catch (error) {
    report.cleanupError = safeError(error);
  }
  try {
    await persistReport();
  } catch (error) {
    report.evidenceWriteError = safeError(error);
  }
  console.log(JSON.stringify(report));
}
