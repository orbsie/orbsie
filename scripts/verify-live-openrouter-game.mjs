import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { unzipSync, strFromU8 } from "fflate";
if (
  process.env.ORBSIE_LIVE_E2E !== "1" ||
  process.env.ORBSIE_OUTPUT_CAP_TOKENS !== "512"
)
  throw Error("Requires live opt-in and server-owned 512-token cap.");
process.loadEnvFile(".env.openrouter.local");
const key = process.env.OPENROUTER_API_KEY;
if (!key) throw Error("Missing local OpenRouter credential.");
const model = "openai/gpt-5.6-luna";
const base = "http://127.0.0.1:3024";
let generationRequests = 0;
let realCommands = [];
let calls = 0;
let beforeEntities;
let responseStatus;
const evidenceRun = process.env.ORBSIE_EVIDENCE_RUN ?? "";
if (evidenceRun && !/^[a-z0-9-]{1,32}$/.test(evidenceRun))
  throw Error("Invalid evidence run name.");
const directory =
  "docs/evidence/game-program-openrouter" +
  (evidenceRun ? `/run-${evidenceRun}` : "");
await mkdir(directory, { recursive: true });
const commands = [
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
  { type: "commit_revision", message: "Program ready." },
];
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
let server;
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    try {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/config")
        return route.fulfill({ json: { accounts: false } });
      if (path === "/api/trial")
        return route.fulfill({ json: { enabled: true, remaining: 3 } });
      if (path === "/api/generate") {
        calls++;
        if (calls === 1)
          return route.fulfill({
            contentType: "application/x-ndjson",
            body:
              commands
                .filter((c) => c.type !== "set_game")
                .map((c) => JSON.stringify(c))
                .join("\n") + "\n",
          });
        if (generationRequests)
          throw Error("Only one live request authorized per probe invocation.");
        generationRequests++;
        const request = route.request().postDataJSON();
        beforeEntities = request.project.entities;
        const response = await fetch(base + "/api/generate", {
          method: "POST",
          headers: { Origin: base, "Content-Type": "application/json" },
          body: JSON.stringify({
            ...request,
            provider: "openrouter",
            model,
            key,
          }),
          signal: AbortSignal.timeout(120000),
        });
        responseStatus = response.status;
        if (!response.ok)
          return route.fulfill({
            status: response.status,
            json: { error: `Live provider route returned ${response.status}` },
          });
        const body = await response.text();
        if (body.length > 16000)
          return route.fulfill({
            status: 502,
            json: { error: "Provider output exceeded probe budget" },
          });
        realCommands = body
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        await writeFile(
          directory + "/provider-response.json",
          JSON.stringify(
            {
              model,
              outputCapTokens: 512,
              responseStatus,
              generationRequests,
              commands: realCommands,
            },
            null,
            2,
          ) + "\n",
        );
        if (realCommands.at(-1)?.type !== "commit_revision")
          return route.fulfill({
            status: 502,
            json: { error: "Provider did not commit the game" },
          });
        return route.fulfill({ contentType: "application/x-ndjson", body });
      }
      return route.fulfill({ json: { models: [] } });
    } catch {
      return route.fulfill({
        status: 502,
        json: { error: "Live game probe transport failed" },
      });
    }
  });
  await page.goto(base);
  await page
    .locator("#prompt")
    .fill(
      "Create a collectible with custom scoring, timer, win and loss rules",
    );
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Program ready.", { exact: true })).toBeVisible();
  await page
    .locator("#prompt")
    .fill(
      "Keep every existing object unchanged. Add a game program with exactly three rules: pressing right adds 7 score; pressing up wins; pressing left loses. No timers or collection scoring. Output set_game then commit_revision only. Keep the reply under 400 tokens.",
    );
  const generationResponse = page.waitForResponse(
    (response) => response.url() === base + "/api/generate",
    { timeout: 125000 },
  );
  await page.getByRole("button", { name: "Change this", exact: true }).click();
  expect((await generationResponse).status()).toBe(200);
  expect(realCommands.some((command) => command.type === "set_game")).toBe(
    true,
  );
  await expect(
    page.getByText(realCommands.at(-1).message, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".game-hud strong")).toHaveText("0");
  await page.keyboard.down("d");
  await expect(page.locator(".game-hud strong")).toHaveText("7");
  await page.waitForTimeout(150);
  await page.keyboard.up("d");
  await expect(page.locator(".game-hud strong")).toHaveText("7");
  await page.keyboard.press("w", { delay: 100 });
  await expect(page.locator(".win-card")).toContainText("Final score: 7");
  await page.screenshot({ path: directory + "/editor-win.png" });
  await page.getByRole("button", { name: "Restart game", exact: true }).click();
  await expect(page.locator(".game-hud strong")).toHaveText("0");
  await page.keyboard.press("a", { delay: 100 });
  await expect(page.locator(".win-card")).toContainText(
    "Try another adventure",
  );
  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download your world/ }).click();
  await (await downloadPromise).saveAs(directory + "/world.zip");
  const files = unzipSync(await readFile(directory + "/world.zip"));
  const project = JSON.parse(strFromU8(files["project.json"]));
  expect(project.entities).toEqual(beforeEntities);
  expect(project.game).toBeDefined();
  expect(project.game.rules).toHaveLength(3);
  expect(files["src/lib/game-program.ts"]).toBeDefined();
  expect(files["src/lib/game-session.ts"]).toBeDefined();
  server = createServer((req, res) => {
    const path =
      new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
    const bytes = files[path];
    if (!bytes) {
      res.writeHead(404);
      res.end();
      return;
    }
    const ext = path.split(".").pop();
    res.setHeader(
      "Content-Type",
      {
        js: "text/javascript",
        css: "text/css",
        html: "text/html",
        json: "application/json",
      }[ext] ?? "application/octet-stream",
    );
    res.end(bytes);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const player = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const external = [];
  player.on("pageerror", (e) => errors.push(e.message));
  player.on("request", (r) => {
    if (!r.url().startsWith(origin) && !r.url().startsWith("data:"))
      external.push(r.url());
  });
  await player.goto(origin);
  await expect(player.locator("canvas")).toBeVisible();
  await expect(player.locator("main[data-ready=true]")).toBeVisible({
    timeout: 30000,
  }); // Allow the first WebGL frame to install input handlers.
  await expect(player.locator(".score")).toHaveText("Score: 0");
  await player.keyboard.press("d", { delay: 100 });
  await expect(player.locator(".score")).toHaveText("Score: 7");
  await player.keyboard.press("w", { delay: 100 });
  await expect(player.locator(".win")).toContainText("Final score: 7");
  await player.getByRole("button", { name: /Restart/ }).click();
  await expect(player.locator(".score")).toHaveText("Score: 0");
  await player.keyboard.press("a", { delay: 100 });
  await expect(player.locator(".win")).toContainText("Try another adventure");
  await player.screenshot({ path: directory + "/standalone-loss.png" });
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  const report = {
    mode: "real-openrouter-rules-on-fixture-scene-editor-and-downloaded-standalone",
    model,
    outputCapTokens: 512,
    generationRequests,
    responseStatus,
    unchangedEntities: true,
    commands: realCommands,
    realProviderCalls: generationRequests,
    passed: true,
    editorScore: 7,
    standaloneScore: 7,
    win: true,
    loss: true,
    restart: true,
    heldInputDeduplicated: true,
    programPreservedInZIP: true,
    sourceIncluded: true,
    externalRequests: external,
    pageErrors: errors,
  };
  await writeFile(
    directory + "/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} catch {
  process.exitCode = 1;
  const failure = {
    scope: "Live OpenRouter rules on fixture scene",
    status: "failed",
    model,
    outputCapTokens: 512,
    generationRequests,
    responseStatus,
    commands: realCommands,
    error:
      "Generation transport or browser gameplay verification did not complete.",
  };
  await writeFile(
    directory + "/failure.json",
    JSON.stringify(failure, null, 2) + "\n",
  );
  console.log(JSON.stringify(failure));
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
