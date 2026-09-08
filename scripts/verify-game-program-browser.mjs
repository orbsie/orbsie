import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { unzipSync, strFromU8 } from "fflate";
const base = process.env.TEST_URL ?? "http://127.0.0.1:3024";
const directory = "docs/evidence/game-program";
await mkdir(directory, { recursive: true });
const rules = [
  {
    id: "contact",
    trigger: { type: "collision", entityId: "crystal" },
    actions: [{ type: "add_score", amount: 11 }],
  },
  {
    id: "collect",
    trigger: { type: "collect", entityId: "crystal" },
    actions: [{ type: "add_score", amount: 3 }],
  },
  {
    id: "timer",
    trigger: { type: "timer", seconds: 0.2, repeat: false },
    actions: [{ type: "add_score", amount: 2 }],
  },
  {
    id: "right",
    trigger: { type: "input", action: "right" },
    actions: [{ type: "add_score", amount: 7 }],
  },
  {
    id: "win",
    trigger: { type: "input", action: "up" },
    actions: [{ type: "win" }],
  },
  {
    id: "lose",
    trigger: { type: "input", action: "left" },
    actions: [{ type: "lose" }],
  },
];
const game = {
  variables: [],
  rules: rules.map((rule) => ({ ...rule, conditions: [] })),
};
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
  { type: "set_game", game },
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
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config")
      return route.fulfill({ json: { accounts: false } });
    if (path === "/api/trial")
      return route.fulfill({ json: { enabled: true, remaining: 3 } });
    if (path === "/api/generate")
      return route.fulfill({
        contentType: "application/x-ndjson",
        body: commands.map((c) => JSON.stringify(c)).join("\n") + "\n",
      });
    return route.fulfill({ json: { models: [] } });
  });
  await page.goto(base);
  await page
    .locator("#prompt")
    .fill(
      "Create a collectible with custom scoring, timer, win and loss rules",
    );
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Program ready.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".game-hud strong")).toHaveText("16");
  await page.keyboard.down("d");
  await expect(page.locator(".game-hud strong")).toHaveText("23");
  await page.waitForTimeout(150);
  await page.keyboard.up("d");
  await expect(page.locator(".game-hud strong")).toHaveText("23");
  await page.keyboard.press("w", { delay: 100 });
  await expect(page.locator(".win-card")).toContainText("Final score: 23");
  await page.screenshot({ path: directory + "/editor-win.png" });
  await page.getByRole("button", { name: "Restart game", exact: true }).click();
  await expect(page.locator(".game-hud strong")).toHaveText("16");
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
  expect(project.game).toEqual(game);
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
  await expect(player.locator(".score")).toHaveText("Score: 16");
  await player.evaluate(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "d", bubbles: true }),
    );
    document.body.dispatchEvent(
      new KeyboardEvent("keyup", { key: "d", bubbles: true }),
    );
  });
  await expect(player.locator(".score")).toHaveText("Score: 23");
  await player.keyboard.press("w", { delay: 100 });
  await expect(player.locator(".win")).toContainText("Final score: 23");
  await player.getByRole("button", { name: /Restart/ }).click();
  await expect(player.locator(".score")).toHaveText("Score: 16");
  await player.keyboard.press("a", { delay: 100 });
  await expect(player.locator(".win")).toContainText("Try another adventure");
  await player.screenshot({ path: directory + "/standalone-loss.png" });
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  const report = {
    mode: "deterministic-generation-real-editor-and-downloaded-standalone",
    realProviderCalls: 0,
    passed: true,
    editorScore: 23,
    standaloneScore: 23,
    collisionScored: true,
    win: true,
    loss: true,
    restart: true,
    heldInputDeduplicated: true,
    betweenFrameTapPreserved: true,
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
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
