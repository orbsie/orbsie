import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { unzipSync } from "fflate";
const dir = "docs/evidence/player-readiness";
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
])
  files[path] = await readFile("public/player/" + path);
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
    "Your world needs WebGL2",
  );
  await expect(page.locator(".message")).not.toContainText("Opening");
  await expect(page.locator(".score")).toBeHidden();
  await page.screenshot({ path: dir + "/webgl-unavailable.png" });
  expect(errors).toEqual([
    "THREE.WebGLRenderer: Error creating WebGL context.",
  ]);
  await writeFile(
    dir + "/unavailable.json",
    JSON.stringify(
      {
        passed: true,
        scope: "Actual standalone browser with WebGL disabled",
        loadingReplacedWithFailure: true,
        scoreHidden: true,
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
