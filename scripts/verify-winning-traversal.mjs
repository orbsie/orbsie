import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const base = process.env.TEST_URL ?? "https://orbsie.com";
const output = process.env.WIN_OUTPUT ?? "/tmp/orbsie-winning-traversal";
await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), "orbsie-win-"));
await build({
  stdin: {
    contents: `import {blankProject} from './src/lib/protocol'; import {fixtureEntities} from './src/lib/fixtures'; import {encodeWorld} from './src/lib/export'; export const project={...blankProject(),entities:fixtureEntities(),revision:1}; export const world=encodeWorld(project);`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(temp, "fixture.mjs"),
});
const { world, project } = await import(
  pathToFileURL(join(temp, "fixture.mjs"))
);
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const report = {
  url: base,
  startedAt: new Date().toISOString(),
  fixtureEntities: project.entities.length,
  inferenceCalls: 0,
  errors: [],
  runs: [],
};
try {
  for (const mobile of [false, true]) {
    const label = mobile ? "mobile-touch" : "desktop-keyboard";
    const viewport = mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 };
    const context = await browser.newContext({
      viewport,
      isMobile: mobile,
      hasTouch: mobile,
      recordVideo: { dir: join(output, label) },
    });
    // Three's existing devtools observation hook exposes scene references for
    // read-only telemetry. No store import, score injection or transform writes.
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
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => report.errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/generate") report.inferenceCalls++;
      // Read-only configuration/session checks are allowed. No account writes.
      if (route.request().method() !== "GET")
        throw Error(`Unexpected mutation: ${path}`);
      await route.continue();
    });
    await page.goto(`${base}/#orb=${world}`);
    await expect(
      page.getByText("Crystals collected", { exact: true }),
    ).toBeVisible();
    await page.waitForFunction(() => window.__orbReadPlayer()?.visible);
    await page.waitForTimeout(6000);
    const read = () => page.evaluate(() => window.__orbReadPlayer());
    const score = async () =>
      Number(
        (await page.locator(".game-hud strong").innerText()).match(
          /^\s*(\d+)/,
        )?.[1],
      );
    const run = {
      label,
      viewport,
      startedAt: new Date().toISOString(),
      start: await read(),
      checkpoints: [],
      inputSteps: 0,
    };
    report.runs.push(run);
    const cdp = mobile ? await context.newCDPSession(page) : null;
    const held = new Set();
    let touchHeld;
    const setKeys = async (keys) => {
      if (mobile) {
        const key = keys[0];
        if (touchHeld === key) return;
        if (touchHeld)
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
        touchHeld = key;
        if (key) {
          const box = await page
            .getByRole("button", {
              name: key === " " ? "Jump" : `Move ${key}`,
              exact: true,
            })
            .boundingBox();
          if (!box) throw Error(`Missing touch control ${key}`);
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [
              { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 },
            ],
          });
        }
      } else {
        for (const key of held)
          if (!keys.includes(key)) {
            await page.keyboard.up(key);
            held.delete(key);
          }
        for (const key of keys)
          if (!held.has(key)) {
            await page.keyboard.down(key);
            held.add(key);
          }
      }
    };
    if (!mobile) await page.mouse.click(1100, 850);
    await setKeys([" "]);
    await page.waitForTimeout(180);
    const airborne = await read();
    await setKeys([]);
    run.jump = { beforeY: run.start.y, airborneY: airborne.y };
    expect(airborne.y).toBeGreaterThan(run.start.y + 0.15);
    await page.waitForTimeout(800);
    const choices = [
      { x: 1, z: 0, keys: ["d"] },
      { x: -1, z: 0, keys: ["a"] },
      { x: 0, z: 1, keys: ["s"] },
      { x: 0, z: -1, keys: ["w"] },
      ...(mobile
        ? []
        : [
            { x: Math.SQRT1_2, z: Math.SQRT1_2, keys: ["d", "s"] },
            { x: Math.SQRT1_2, z: -Math.SQRT1_2, keys: ["d", "w"] },
            { x: -Math.SQRT1_2, z: Math.SQRT1_2, keys: ["a", "s"] },
            { x: -Math.SQRT1_2, z: -Math.SQRT1_2, keys: ["a", "w"] },
          ]),
    ];
    const targets = [
      ...project.entities.filter(
        (entity) => entity.behavior?.type === "collect",
      ),
      project.entities.find((entity) => entity.behavior?.type === "portal"),
    ];
    for (const target of targets) {
      let arrived = false;
      for (let i = 0; i < 180; i++) {
        const position = await read();
        const dx = target.position[0] - position.x,
          dz = target.position[2] - position.z;
        if (Math.hypot(dx, dz) < 0.42) {
          arrived = true;
          break;
        }
        // Invert the runtime's fixed camera-relative movement rotation.
        const inputX = Math.cos(0.5) * dx - Math.sin(0.5) * dz;
        const inputZ = Math.sin(0.5) * dx + Math.cos(0.5) * dz;
        const best = choices.reduce((a, b) =>
          a.x * inputX + a.z * inputZ > b.x * inputX + b.z * inputZ ? a : b,
        );
        await setKeys(best.keys);
        run.inputSteps++;
        await page.waitForTimeout(110);
      }
      await setKeys([]);
      if (!arrived)
        throw Error(
          `${label} could not reach ${target.id}: ${JSON.stringify(await read())}`,
        );
      const checkpoint = {
        target: target.id,
        position: await read(),
        collected: await score(),
      };
      run.checkpoints.push(checkpoint);
      console.log(label, JSON.stringify(checkpoint));
    }
    await expect(
      page.getByText("You found every crystal and made it home.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(await score()).toBe(5);
    run.won = true;
    run.finishedAt = new Date().toISOString();
    run.overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    expect(run.overflow).toBe(false);
    await page.screenshot({ path: join(output, `${label}-won.png`) });
    await context.close();
  }
} finally {
  await browser.close();
  await rm(temp, { recursive: true, force: true });
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
}
expect(report.errors).toEqual([]);
expect(report.inferenceCalls).toBe(0);
console.log(JSON.stringify(report, null, 2));
