import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { unzipSync } from "fflate";
const dir =
  process.env.ORBSIE_PLAYER_EVIDENCE_DIR ??
  `docs/evidence/player-readiness-${Date.now()}`;
const playerAssetRoot = process.env.ORBSIE_PLAYER_ASSET_ROOT ?? "public/player";
await mkdir(dir, { recursive: true });
const files = unzipSync(
  await readFile(
    "docs/evidence/game-program-chatgpt/run-ready-replay/world.zip",
  ),
);
for (const path of [
  "runtime.js",
  "runtime.css",
  "generated-geometry-worker.js",
  "asset-geometry-worker.js",
])
  files[path] = await readFile(playerAssetRoot + "/" + path);
const server = createServer((req, res) => {
  const path =
    new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
  const bytes = files[path];
  if (!bytes) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader(
    "Content-Type",
    {
      js: "text/javascript",
      css: "text/css",
      html: "text/html",
      json: "application/json",
    }[path.split(".").pop()] ?? "application/octet-stream",
  );
  res.end(bytes);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-webgl"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.locator(".message")).toContainText(
    "Your world is playable",
  );
  await expect(page.locator(".graphics-guidance")).toContainText("Check again");
  await expect(page.locator(".graphics-guidance")).toContainText(
    "Use graphics acceleration when available",
  );
  await expect(page.locator(".message")).not.toContainText("Opening");
  await expect(page.locator(".software-world")).toBeVisible();
  await expect(page.locator(".score")).toBeVisible();
  const beforeMovement = await page
    .locator(".software-world canvas")
    .screenshot();
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(250);
  await page.keyboard.up("ArrowRight");
  const afterMovement = await page
    .locator(".software-world canvas")
    .screenshot();
  assert.notDeepEqual(afterMovement, beforeMovement);
  await page.getByRole("button", { name: /Restart/ }).click();
  await expect(page.locator(".software-world")).toBeVisible();
  await page.screenshot({ path: dir + "/webgl-unavailable.png" });
  expect(errors).toEqual([
    "THREE.WebGLRenderer: Error creating WebGL context.",
  ]);
  await writeFile(
    dir + "/unavailable.json",
    JSON.stringify(
      {
        passed: true,
        scope:
          "Actual standalone browser with WebGL disabled and Canvas2D fallback",
        softwareFallbackVisible: true,
        scoreVisible: true,
        movementInputChangedFrame: true,
        restartRemainedAvailable: true,
        expectedContextErrors: errors,
        unexpectedPageErrors: [],
      },
      null,
      2,
    ) + "\n",
  );
  console.log("WebGL unavailable state passed");
} finally {
  await browser.close();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}
