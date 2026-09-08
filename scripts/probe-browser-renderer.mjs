/** Identify the actual browser renderer before accepting performance evidence. */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  const details = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      userAgent: navigator.userAgent,
      webgl: !!gl,
      renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
      vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : null,
    };
  });
  const hardwareRenderer =
    !!details.renderer &&
    !/swiftshader|llvmpipe|softpipe|software/i.test(details.renderer);
  const directory = "docs/evidence/browser-renderer";
  await mkdir(directory, { recursive: true });
  await writeFile(
    `${directory}/report.json`,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        ...details,
        hardwareRenderer,
        performanceCertification: "not-established",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ renderer: details.renderer, hardwareRenderer }));
} finally {
  await browser.close();
}
