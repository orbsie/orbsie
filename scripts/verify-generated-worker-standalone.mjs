// Serve the evidence ZIP with current public/player runtime/worker on loopback3031.
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await page.addInitScript(() => {
    const Original = window.Worker;
    window.__geometryResults = [];
    window.Worker = class extends Original {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          window.__geometryResults.push({
            error: data.error ?? null,
            hash: data.userData?.orbsieGeneratedHash,
            vertices: data.attributes?.position?.array?.length / 3,
          });
        });
      }
    };
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const responses = [];
  page.on("response", (r) => {
    if (
      r.url().includes("generated-geometry-worker") ||
      r.url().endsWith(".glb")
    )
      responses.push({ path: new URL(r.url()).pathname, status: r.status() });
  });
  await page.goto("http://127.0.0.1:3031", { waitUntil: "networkidle" });
  await page.waitForFunction(() =>
    window.__geometryResults.some((r) => r.hash && r.vertices > 0),
  );
  await page.waitForTimeout(1500);
  const results = await page.evaluate(() => window.__geometryResults);
  if (
    errors.length ||
    results.some((r) => r.error) ||
    !responses.some(
      (r) =>
        r.path.endsWith("generated-geometry-worker.js") && r.status === 200,
    )
  )
    throw Error(JSON.stringify({ errors, results, responses }));
  await page.screenshot({
    path: "docs/evidence/generated-worker/standalone.png",
  });
  const report = {
    scope:
      "Existing real Astra-generated vase snapshot played using current standalone runtime and geometry worker; no new inference. Screenshot requires visual inspection.",
    results,
    responses,
    errors,
  };
  await writeFile(
    "docs/evidence/generated-worker/standalone.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
