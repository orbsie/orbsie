import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, posix as posixPath, resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import {
  createTraversalTouchInput,
  TRAVERSAL_TOUCH_LABELS,
} from "../../../scripts/lib/traversal-touch-input.mjs";

const zipPath = resolve(
  "docs/evidence/provider-e2e/flagship-openrouter/openrouter/world.zip",
);
const output = resolve("docs/evidence/traversal-multitouch");
await mkdir(output, { recursive: true });
const files = unzipSync(await readFile(zipPath));
const project = JSON.parse(strFromU8(files["project.json"]));
const mime = {
  css: "text/css",
  glb: "model/gltf-binary",
  html: "text/html",
  js: "text/javascript",
  json: "application/json",
  mjs: "text/javascript",
  png: "image/png",
  wasm: "application/wasm",
};
const server = createServer((request, response) => {
  const pathname = posixPath.normalize(
    new URL(request.url ?? "/", "http://fixture.local").pathname.slice(1) ||
      "index.html",
  );
  const bytes = files[pathname];
  if (!bytes || pathname.startsWith("../") || pathname === "..") {
    response.writeHead(404).end();
    return;
  }
  response.setHeader(
    "Content-Type",
    mime[pathname.split(".").pop()] ?? "application/octet-stream",
  );
  response.writeHead(200).end(bytes);
});
await new Promise((resolveServer, rejectServer) => {
  server.once("error", rejectServer);
  server.listen(0, "127.0.0.1", resolveServer);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const report = {
  status: "running",
  mode: "local-saved-world-traversal-touch-driver",
  sourceZip: zipPath,
  projectRevision: project.revision,
  viewport: { width: 390, height: 844 },
  trustedPointerEvents: [],
  inputEvents: [],
  checkpoints: {},
  externalRequests: [],
  pageErrors: [],
};
let context;
try {
  context = await browser.newContext({
    viewport: report.viewport,
    isMobile: true,
    hasTouch: true,
    recordVideo: { dir: output },
  });
  await context.addInitScript(() => {
    const observed = [];
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener("observe", (event) => {
      if (event.detail?.isScene) observed.push(event.detail);
    });
    window.__orbReadPlayer = () => {
      let player;
      for (const scene of observed)
        scene.traverse((object) => {
          if (object.geometry?.type === "CapsuleGeometry")
            player = object.parent;
        });
      return player
        ? {
            x: player.position.x,
            y: player.position.y,
            z: player.position.z,
            visible: player.visible,
          }
        : null;
    };
    window.__traversalTouchPointerEvents = [];
    window.__traversalTouchInputEvents = [];
    window.addEventListener("orbsie-input", (event) =>
      window.__traversalTouchInputEvents.push({
        key: event.detail?.key,
        down: event.detail?.down,
        pointerId: event.detail?.pointerId,
      }),
    );
    for (const type of ["pointerdown", "pointerup", "pointercancel"])
      window.addEventListener(
        type,
        (event) =>
          window.__traversalTouchPointerEvents.push({
            type: event.type,
            pointerId: event.pointerId,
            target: event.target?.getAttribute?.("aria-label") ?? null,
            isTrusted: event.isTrusted,
          }),
        true,
      );
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (
      new URL(request.url()).origin !== origin ||
      !["GET", "HEAD"].includes(request.method())
    ) {
      report.externalRequests.push(`${request.method()} ${request.url()}`);
      return route.abort();
    }
    return route.fallback();
  });
  await page.goto(origin);
  await expect(page.locator('main[data-ready="true"]')).toBeVisible({
    timeout: 30000,
  });
  await page.waitForFunction(() => window.__orbReadPlayer()?.visible);
  await page.waitForTimeout(1000);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
  const driver = createTraversalTouchInput({
    cdp,
    touchPoint: async (key, id) => {
      const label = TRAVERSAL_TOUCH_LABELS[key];
      const box = await page
        .getByRole("button", { name: label, exact: true })
        .boundingBox();
      assert(box, `Missing touch control ${label}`);
      const point = {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        id,
      };
      const hit = await page.evaluate(
        ({ x, y, label: expected }) =>
          document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label") ===
          expected,
        { ...point, label },
      );
      assert.equal(hit, true, `Touch coordinate missed control ${label}`);
      return point;
    },
  });
  const read = () => page.evaluate(() => window.__orbReadPlayer());
  const beforeDirection = await read();
  assert(beforeDirection?.visible, "Player telemetry did not become visible");
  await driver.setKeys(["d", "s"]);
  await page.waitForTimeout(300);
  const beforeJump = await read();
  await driver.setKeys(["d", "s", " "]);
  await page.waitForTimeout(180);
  const airborne = await read();
  await driver.setKeys(["d", "s"]);
  const afterJumpRelease = await read();
  await page.waitForTimeout(420);
  const afterHeldMovement = await read();
  await driver.setKeys(["s"]);
  await page.waitForTimeout(80);
  await driver.releaseAll();
  await page.waitForTimeout(150);
  report.trustedPointerEvents = await page.evaluate(
    () => window.__traversalTouchPointerEvents,
  );
  report.inputEvents = await page.evaluate(
    () => window.__traversalTouchInputEvents,
  );
  report.checkpoints = {
    beforeDirection,
    beforeJump,
    airborne,
    afterJumpRelease,
    afterHeldMovement,
    heldKeysAfterCleanup: driver.heldKeys(),
  };
  const pointerDowns = report.trustedPointerEvents.filter(
    (event) => event.type === "pointerdown",
  );
  const pointerUps = report.trustedPointerEvents.filter(
    (event) => event.type === "pointerup",
  );
  assert(
    pointerDowns.length >= 3,
    `Expected direction, diagonal, and jump pointerdowns: ${pointerDowns.length}`,
  );
  assert(
    pointerDowns.every((event) => event.isTrusted),
    "Pointer events were not trusted browser events",
  );
  assert(
    new Set(pointerDowns.slice(0, 3).map((event) => event.pointerId)).size ===
      3,
    "Initial three touches did not retain distinct browser pointer IDs",
  );
  const inputDowns = report.inputEvents.filter((event) => event.down);
  assert(inputDowns.some((event) => event.key === "d"), "Right input down was not observed");
  assert(inputDowns.some((event) => event.key === "s"), "Back input down was not observed");
  assert(inputDowns.some((event) => event.key === " "), "Jump input down was not observed");
  const jumpDownIndex = report.inputEvents.findIndex(
    (event) => event.key === " " && event.down,
  );
  const jumpUpIndex = report.inputEvents.findIndex(
    (event, index) =>
      index > jumpDownIndex && event.key === " " && !event.down,
  );
  assert(
    jumpDownIndex >= 0 && jumpUpIndex > jumpDownIndex,
    "Jump release was not observed",
  );
  assert(
    !report.inputEvents
      .slice(jumpDownIndex + 1, jumpUpIndex)
      .some(
        (event) =>
          (event.key === "d" || event.key === "s") && !event.down,
      ),
    "Directional input released before jump release",
  );
  assert(
    airborne.y > beforeJump.y + 0.12,
    `Jump did not produce observed ascent: ${beforeJump.y} -> ${airborne.y}`,
  );
  assert(
    Math.hypot(
      afterHeldMovement.x - afterJumpRelease.x,
      afterHeldMovement.z - afterJumpRelease.z,
    ) > 0.08,
    "Held diagonal movement did not continue after jump release",
  );
  assert(
    pointerUps.some((event) => event.isTrusted),
    "No trusted pointerup was observed",
  );
  assert.equal(report.externalRequests.length, 0);
  assert.equal(report.pageErrors.length, 0);
  report.status = "passed";
  await page.screenshot({ path: join(output, "trusted-multitouch.png") });
} catch (error) {
  report.status = "failed";
  report.failure = String(error);
  throw error;
} finally {
  if (context) await context.close().catch(() => {});
  await browser.close();
  await new Promise((resolveServer) => server.close(resolveServer));
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report, null, 2));
