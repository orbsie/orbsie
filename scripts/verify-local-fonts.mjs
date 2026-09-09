import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const url = process.env.TEST_URL ?? "http://localhost:3047";
const output = process.argv[2];
if (!output) throw Error("Provide evidence directory");
await mkdir(output, { recursive: false });
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const external = [],
    fonts = [];
  await page.route("**/*", (r) => {
    const target = new URL(r.request().url());
    if (
      /^https?:$/.test(target.protocol) &&
      target.origin !== new URL(url).origin
    ) {
      external.push(target.href);
      return r.abort();
    }
    return r.continue();
  });
  page.on("response", (r) => {
    if (new URL(r.url()).pathname.startsWith("/fonts/"))
      fonts.push({ path: new URL(r.url()).pathname, status: r.status() });
  });
  await page.goto(url);
  const loaded = await page.evaluate(async () => {
    const result = [];
    for (const family of ["DM Sans", "Manrope"]) {
      const faces = await document.fonts.load(`500 16px "${family}"`, "Orbsie");
      result.push({
        family,
        count: faces.length,
        loaded: faces.every((face) => face.status === "loaded"),
      });
    }
    return result;
  });
  assert(loaded.every((face) => face.count > 0 && face.loaded));
  assert(fonts.some((font) => font.path.endsWith(".woff2")));
  assert(fonts.every((font) => font.status === 200));
  assert.deepEqual(external, []);
  await page.locator("canvas").waitFor({ state: "visible" });
  await page.waitForTimeout(2000); // Let the initial renderer frame settle for visual review.
  await page.screenshot({ path: output + "/landing.png" });
  await writeFile(
    output + "/report.json",
    JSON.stringify(
      { status: "passed", loaded, fonts, external, liveModelCalls: 0 },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      status: "passed",
      loaded,
      fontRequests: fonts.length,
      externalRequests: external.length,
    }),
  );
} finally {
  await browser.close();
}
