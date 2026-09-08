import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { unzipSync, strFromU8 } from "fflate";
const directory = "docs/evidence/game-program-openrouter";
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
  const files = unzipSync(await readFile(directory + "/world.zip"));
  const project = JSON.parse(strFromU8(files["project.json"]));

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
  await player.waitForTimeout(1000);
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

  await writeFile(
    directory + "/standalone-replay.json",
    JSON.stringify(
      {
        scope:
          "Replay previously live-authored exported ZIP without another provider call",
        passed: true,
        realProviderCalls: 0,
        errors,
        externalRequests: external,
        score: 7,
        win: true,
        loss: true,
        restart: true,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Standalone replay passed");
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
