// Serve public/ on loopback port 3021 before running this bounded worker probe.
import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const bytes = await readFile("docs/evidence/local-modeling/model.glb");
const hash = createHash("sha256").update(bytes).digest("hex");
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3021", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(
    async ({ base64, hash }) => {
      const worker = new Worker("/player/generated-geometry-worker.js", {
        type: "module",
      });
      const start = performance.now();
      let ticks = 0;
      const timer = setInterval(() => ticks++, 10);
      try {
        return await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(Error("Worker timeout")),
            30000,
          );
          worker.onerror = (e) => {
            clearTimeout(timeout);
            reject(Error(e.message));
          };
          worker.onmessage = ({ data }) => {
            clearTimeout(timeout);
            if (data.error) return reject(Error(data.error));
            resolve({
              elapsedMs: performance.now() - start,
              mainThreadTicks: ticks,
              vertices: data.attributes.position.array.length / 3,
              box: data.box,
              hash: data.userData.orbsieGeneratedHash,
            });
          };
          const buffer = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          worker.postMessage(
            {
              bytes: buffer,
              hash,
              maxVertices: 100000,
              maxGeometryBytes: 24 * 1024 * 1024,
            },
            [buffer.buffer],
          );
        });
      } finally {
        clearInterval(timer);
        worker.terminate();
      }
    },
    { base64: bytes.toString("base64"), hash },
  );
  if (result.hash !== hash || result.vertices <= 0)
    throw Error("Invalid worker result");
  await mkdir("docs/evidence/generated-worker", { recursive: true });
  await writeFile(
    "docs/evidence/generated-worker/probe.json",
    JSON.stringify(
      {
        target: "http://127.0.0.1:3021",
        fixture: "docs/evidence/local-modeling/model.glb",
        ...result,
        scope:
          "Single real browser worker decode; not a workload performance benchmark.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
