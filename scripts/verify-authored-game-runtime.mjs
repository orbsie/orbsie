import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { unzipSync, zipSync, strFromU8 } from "fflate";
const provider = process.argv[2];
if (!["openrouter", "chatgpt"].includes(provider))
  throw Error("Choose openrouter or chatgpt saved evidence.");
const directory = `docs/evidence/game-program-${provider}`;
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
  const originalProjectSHA256 = createHash("sha256")
    .update(files["project.json"])
    .digest("hex");
  files["runtime.js"] = await readFile("public/player/runtime.js");
  files["runtime.css"] = await readFile("public/player/runtime.css");
  files["generated-geometry-worker.js"] = await readFile(
    "public/player/generated-geometry-worker.js",
  );
  const source = JSON.parse(
    await readFile("public/player/source.json", "utf8"),
  );
  for (const [path, text] of Object.entries(source))
    files[path] = new TextEncoder().encode(text);
  await writeFile(directory + "/runtime-replay.zip", zipSync(files));
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
  await expect(player.locator("main[data-ready=true]")).toBeVisible({
    timeout: 30000,
  });
  await expect(player.locator(".score")).toHaveText("Score: 0");
  await player.evaluate(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "d", bubbles: true }),
    );
    document.body.dispatchEvent(
      new KeyboardEvent("keyup", { key: "d", bubbles: true }),
    );
  });
  await expect(player.locator(".score")).toHaveText("Score: 7");
  await player.keyboard.press("w", { delay: 100 });
  await expect(player.locator(".win")).toContainText("Final score: 7");
  await player.getByRole("button", { name: /Restart/ }).click();
  await expect(player.locator(".score")).toHaveText("Score: 0");
  await player.keyboard.press("a", { delay: 100 });
  await expect(player.locator(".win")).toContainText("Try another adventure");
  await player.screenshot({ path: directory + "/runtime-replay-loss.png" });
  expect(external).toEqual([]);
  expect(errors).toEqual([]);

  await writeFile(
    directory + "/runtime-replay.json",
    JSON.stringify(
      {
        scope:
          "Replay the unchanged live-authored project with the current rebuilt runtime; no new provider call",
        passed: true,
        provider,
        originalProjectSHA256,
        currentRuntimeSHA256: createHash("sha256")
          .update(files["runtime.js"])
          .digest("hex"),
        betweenFrameTapPreserved: true,
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
