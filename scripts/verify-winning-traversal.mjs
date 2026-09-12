import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, posix as posixPath } from "node:path";
import { pathToFileURL } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { validateProjectGame } from "./lib/winning-traversal-contract.mjs";

const base = process.env.TEST_URL ?? "https://orbsie.com";
const published = process.env.WIN_PUBLISHED === "1";
const gameZipPath = process.env.WIN_GAME_ZIP;
const gameZip = Boolean(gameZipPath);
const output = process.env.WIN_OUTPUT ?? "/tmp/orbsie-winning-traversal";
await mkdir(output, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), "orbsie-win-"));
let world, project, standaloneServer, standaloneOrigin;
let snapshot;
let traversalContract;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function openStandaloneSnapshot(zipPath) {
  const absoluteZipPath = resolve(zipPath);
  const zipBytes = await readFile(absoluteZipPath);
  const files = unzipSync(zipBytes);
  const projectBytes = files["project.json"];
  const runtimeBytes = files["runtime.js"];
  const runtimeCssBytes = files["runtime.css"];
  if (!projectBytes || !runtimeBytes || !runtimeCssBytes)
    throw Error("Saved standalone ZIP is missing project or runtime files.");
  const loadedProject = JSON.parse(strFromU8(projectBytes));
  const contract = validateProjectGame(loadedProject);
  traversalContract = contract;
  snapshot = {
    zipPath: absoluteZipPath,
    zipSha256: sha256(zipBytes),
    projectSha256: sha256(projectBytes),
    runtimeSha256: sha256(runtimeBytes),
    runtimeCssSha256: sha256(runtimeCssBytes),
    projectRevision: loadedProject.revision,
    projectId: loadedProject.id,
    title: loadedProject.title,
    contract,
  };
  standaloneServer = createServer((request, response) => {
    const pathname = posixPath.normalize(
      new URL(request.url ?? "/", "http://snapshot.local").pathname.slice(1) ||
        "index.html",
    );
    if (pathname.startsWith("../") || pathname === "..") {
      response.writeHead(400).end();
      return;
    }
    const bytes = files[pathname];
    if (!bytes) {
      response.writeHead(404).end();
      return;
    }
    const extension = pathname.split(".").pop();
    response.setHeader(
      "Content-Type",
      {
        css: "text/css",
        glb: "model/gltf-binary",
        html: "text/html",
        js: "text/javascript",
        json: "application/json",
        mjs: "text/javascript",
        png: "image/png",
        txt: "text/plain",
        wasm: "application/wasm",
      }[extension] ?? "application/octet-stream",
    );
    response.writeHead(200);
    if (request.method !== "HEAD") response.end(bytes);
    else response.end();
  });
  await new Promise((resolveServer, rejectServer) => {
    standaloneServer.once("error", rejectServer);
    standaloneServer.listen(0, "127.0.0.1", resolveServer);
  });
  standaloneOrigin = `http://127.0.0.1:${standaloneServer.address().port}`;
  return { project: loadedProject, files };
}

if (published) {
  if (gameZip)
    throw Error("WIN_GAME_ZIP and WIN_PUBLISHED cannot be combined.");
  const origin = new URL(base);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw Error(
      "Published target must be an HTTPS URL without credentials or query.",
    );
  const response = await fetch(new URL("project.json", origin), {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error(`Published project HTTP ${response.status}`);
  project = await response.json();
  if (!Array.isArray(project.entities))
    throw Error("Published project snapshot has no entity list.");
  if (project.game) traversalContract = validateProjectGame(project);
} else if (gameZip) {
  ({ project } = await openStandaloneSnapshot(gameZipPath));
} else {
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
  ({ world, project } = await import(pathToFileURL(join(temp, "fixture.mjs"))));
}
const program = Boolean(traversalContract);
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
  url: standaloneOrigin ?? base,
  startedAt: new Date().toISOString(),
  mode: gameZip
    ? "flagship-project-game-standalone-traversal"
    : published
      ? program
        ? "published-flagship-game-traversal"
        : "published-signed-out-input-traversal"
      : "fixture-input-traversal",
  projectRevision: project.revision,
  entities: project.entities.length,
  inferenceCalls: 0,
  errors: [],
  externalRequests: [],
  mutatingRequests: [],
  runs: [],
};
if (snapshot) report.snapshot = snapshot;
if (traversalContract) report.contract = traversalContract;
try {
  const modes =
    process.env.WIN_INPUT === "mobile"
      ? [true]
      : process.env.WIN_INPUT === "desktop"
        ? [false]
        : [false, true];
  for (const mobile of modes) {
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
    if (gameZip) {
      await context.route("**/*", async (route) => {
        const request = route.request();
        const target = new URL(request.url());
        if (target.origin !== standaloneOrigin) {
          report.externalRequests.push(request.url());
          report.errors.push(`Unexpected external request: ${request.url()}`);
          return route.abort();
        }
        if (!["GET", "HEAD"].includes(request.method())) {
          report.mutatingRequests.push(`${request.method()} ${request.url()}`);
          report.errors.push(
            `Unexpected mutating request: ${request.method()} ${request.url()}`,
          );
          return route.abort();
        }
        return route.fallback();
      });
    } else if (published) {
      await context.route("**/*", async (route) => {
        const request = route.request();
        if (
          new URL(request.url()).origin !== new URL(base).origin ||
          !["GET", "HEAD"].includes(request.method())
        ) {
          report.errors.push("Unexpected external or mutating request");
          return route.abort();
        }
        return route.fallback();
      });
    }
    await page.goto(
      gameZip ? standaloneOrigin : published ? base : `${base}/#orb=${world}`,
    );
    await expect(
      gameZip || published
        ? page.locator('main[data-ready="true"]')
        : page.getByText("Crystals collected", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await page.waitForFunction(() => window.__orbReadPlayer()?.visible);
    await page.waitForTimeout(6000);
    const read = () => page.evaluate(() => window.__orbReadPlayer());
    const scoreLocator = page.locator(
      gameZip || published ? ".score" : ".game-hud strong",
    );
    const score = async () =>
      Number((await scoreLocator.innerText()).match(/(\d+)/)?.[1]);
    const run = {
      label,
      viewport,
      startedAt: new Date().toISOString(),
      start: await read(),
      checkpoints: [],
      inputSteps: 0,
      collectedIds: [],
    };
    if (gameZip)
      run.platformSupport = {
        directSupportObserved: false,
        method: "read-only player position telemetry",
        nearMovingPlatformHeightSamples: 0,
        maximumProximityCandidateStreak: 0,
        note: "Player position alone cannot distinguish a platform landing/carry from a jump-through trajectory. No support state or transform was injected.",
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
              name:
                gameZip || published
                  ? {
                      w: "Forward",
                      a: "Left",
                      s: "Back",
                      d: "Right",
                      " ": "Jump",
                    }[key]
                  : key === " "
                    ? "Jump"
                    : `Move ${key}`,
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
      ...(program
        ? traversalContract.collectibleIds.map((id) =>
            project.entities.find((entity) => entity.id === id),
          )
        : project.entities.filter(
            (entity) => entity.behavior?.type === "collect",
          )),
      project.entities.find(
        (entity) =>
          entity.id ===
          (program
            ? traversalContract.portalId
            : project.entities.find((e) => e.behavior?.type === "portal")?.id),
      ),
    ].filter(Boolean);
    expect(targets).toHaveLength(
      program
        ? traversalContract.collectibleIds.length + 1
        : project.entities.filter(
            (e) =>
              e.behavior?.type === "collect" || e.behavior?.type === "portal",
          ).length,
    );
    let expectedCollected = 0;
    for (const target of targets) {
      const approach = async () => {
        let arrived = false;
        for (let i = 0; i < 180; i++) {
          const position = await read();
          if (
            program &&
            target.id === traversalContract.portalId &&
            (await page
              .getByText("Adventure complete", { exact: true })
              .isVisible()
              .catch(() => false))
          ) {
            arrived = true;
            break;
          }
          if (gameZip && position) {
            const nearMovingPlatform = project.entities.some((entity) => {
              if (entity.behavior?.type !== "move") return false;
              const [x, y, z] = entity.position;
              const [amplitudeX, amplitudeZ] =
                entity.behavior.axis === "x"
                  ? [entity.behavior.amplitude ?? 0.5, 0]
                  : entity.behavior.axis === "z"
                    ? [0, entity.behavior.amplitude ?? 0.5]
                    : [0, 0];
              return (
                Math.abs(position.x - x) <= amplitudeX + 1.2 &&
                Math.abs(position.z - z) <= amplitudeZ + 1.2 &&
                Math.abs(position.y - 1.44) <= 0.15
              );
            });
            if (nearMovingPlatform) {
              run.platformSupport.nearMovingPlatformHeightSamples++;
              run.platformSupport._candidateStreak =
                (run.platformSupport._candidateStreak ?? 0) + 1;
              run.platformSupport.maximumProximityCandidateStreak = Math.max(
                run.platformSupport.maximumProximityCandidateStreak,
                run.platformSupport._candidateStreak,
              );
            } else run.platformSupport._candidateStreak = 0;
          }
          const dx = target.position[0] - position.x,
            dz = target.position[2] - position.z;
          if (Math.hypot(dx, dz) < (published ? 0.16 : gameZip ? 0.3 : 0.42)) {
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
          const distance = Math.hypot(dx, dz);
          await page.waitForTimeout(
            published || gameZip
              ? mobile && program
                ? Math.max(12, Math.min(70, distance * 60))
                : Math.max(20, Math.min(110, distance * 120))
              : 110,
          );
        }
        await setKeys([]);
        if (!arrived)
          throw Error(
            `${label} could not reach ${target.id}: ${JSON.stringify(await read())}`,
          );
      };
      await approach();
      if ((published || gameZip) && target.behavior?.type === "collect") {
        expectedCollected++;
        for (
          let attempt = 0;
          attempt < 3 && (await score()) < expectedCollected;
          attempt++
        ) {
          await page.waitForTimeout(900);
          await approach();
          const beforeJump = await read();
          await setKeys([" "]);
          await page.waitForTimeout(450);
          const airborne = await read();
          await setKeys([]);
          await page.waitForTimeout(350);
          (run.pickupJumps ??= []).push({
            target: target.id,
            attempt,
            beforeJump,
            airborne,
            collected: await score(),
          });
        }
        await expect.poll(score).toBe(expectedCollected);
        run.collectedIds.push(target.id);
      }
      const checkpoint = {
        target: target.id,
        position: await read(),
        collected: await score(),
        hud: await scoreLocator.innerText(),
      };
      run.checkpoints.push(checkpoint);
      console.log(label, JSON.stringify(checkpoint));
    }
    if (gameZip) {
      delete run.platformSupport._candidateStreak;
      run.platformSupport.disposition =
        "direct-support-not-observed; proximity samples are non-proof";
    }
    await expect(
      page.getByText(
        gameZip || published
          ? "Adventure complete"
          : "You found every crystal and made it home.",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    expect(await score()).toBe(
      program
        ? traversalContract.collectibleIds.length
        : project.entities.filter((e) => e.behavior?.type === "collect").length,
    );
    run.won = true;
    run.finishedAt = new Date().toISOString();
    run.overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    expect(run.overflow).toBe(false);
    await page.screenshot({ path: join(output, `${label}-won.png`) });
    if (gameZip || published) {
      await page
        .getByRole("button", { name: "↻ Restart", exact: true })
        .click();
      await expect.poll(score).toBe(0);
      await expect(
        page.getByText("Adventure complete", { exact: true }),
      ).toHaveCount(0);
      run.restart = gameZip
        ? {
            score: await score(),
            winStatusVisible: await page
              .getByText("Adventure complete", { exact: true })
              .isVisible()
              .catch(() => false),
          }
        : true;
      run.signedOut = (await context.cookies()).length === 0;
      expect(run.signedOut).toBe(true);
    }
    await context.close();
  }
  expect(report.errors).toEqual([]);
  expect(report.inferenceCalls).toBe(0);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = String(error).slice(0, 2000);
  throw error;
} finally {
  await browser.close();
  if (standaloneServer)
    await new Promise((resolveServer) => standaloneServer.close(resolveServer));
  await rm(temp, { recursive: true, force: true });
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
