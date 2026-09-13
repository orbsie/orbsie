#!/usr/bin/env node
/**
 * Local browser fixture for the fresh-world gameplay driver.
 *
 * This uses the real Orbsie editor, renderer components, physics loop, input
 * handlers, and observation bridge. Only the generation transport is a local
 * deterministic NDJSON fixture; no provider, model, credential, or external
 * network request is used. The report is intentionally separate from provider
 * E2E.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import {
  observeFlagshipMovementDuringGeneration,
  runFreshFlagshipGameplay,
} from "./provider-browser-e2e.mjs";

const appUrl = process.env.TEST_URL ?? "http://localhost:3040";
const appOrigin = new URL(appUrl).origin;
const evidenceDir = resolve(
  process.env.ORBSIE_FRESH_GAMEPLAY_FIXTURE_EVIDENCE ??
    "docs/evidence/fresh-flagship-gameplay-fixture",
);
const requestedRenderer = process.env.ORBSIE_FRESH_GAMEPLAY_RENDERER ?? "all";
assert(
  requestedRenderer === "all" ||
    requestedRenderer === "webgl" ||
    requestedRenderer === "software",
  "ORBSIE_FRESH_GAMEPLAY_RENDERER must be all, webgl, or software.",
);

const entities = [
  {
    id: "fixture-platform-a",
    label: "First moving platform",
    position: [0, 0.2, 3],
    color: "#eedda5",
    scale: [1.6, 0.6, 1.6],
    geometry: { kind: "platform", detail: "refined" },
    behavior: { type: "move", speed: 0.8, amplitude: 0.22, axis: "y" },
    stage: "ready",
  },
  {
    id: "fixture-platform-b",
    label: "Second moving platform",
    position: [0, 0.8, 0.3],
    color: "#efc79c",
    scale: [1.6, 0.7, 1.6],
    geometry: { kind: "platform", detail: "refined" },
    behavior: { type: "move", speed: 0.7, amplitude: 0.35, axis: "x" },
    stage: "ready",
  },
  {
    id: "fixture-platform-c",
    label: "Bouncy moving platform",
    position: [0, 1.4, -2.5],
    color: "#ddc4e9",
    scale: [1.7, 0.7, 1.7],
    geometry: { kind: "platform", detail: "refined" },
    behavior: { type: "bounce" },
    stage: "ready",
  },
  ...[
    [-1.5, 0.8, 4],
    [1.4, 0.8, 2.6],
    [-1.2, 0.8, 1.2],
    [1.4, 0.8, -0.5],
    [-1.2, 0.8, -2.8],
  ].map((position, index) => ({
    id: `fixture-crystal-${index + 1}`,
    label: `Crystal ${index + 1}`,
    position,
    color: "#a1f0d7",
    scale: [0.6, 0.6, 0.6],
    geometry: { kind: "crystal", detail: "refined" },
    behavior: { type: "collect" },
    stage: "ready",
  })),
  {
    id: "fixture-portal",
    label: "Sunlight portal",
    position: [0, 0, -5.2],
    color: "#eddbb7",
    scale: [1.4, 1.4, 1.1],
    geometry: { kind: "arch", detail: "refined" },
    behavior: { type: "portal" },
    stage: "ready",
  },
];

const platforms = entities.slice(0, 3);
const collectibles = entities.slice(3, 8);
const portal = entities[8];
const collectibleRules = collectibles.map((entity, index) => ({
  id: `collect-${index + 1}`,
  trigger: { type: "collect", entityId: entity.id },
  conditions: [],
  actions: [{ type: "add_score", amount: 1 }],
}));
const game = {
  variables: [],
  rules: [
    {
      id: "move-bounce-platform",
      trigger: { type: "start" },
      conditions: [],
      actions: [
        {
          type: "move_path",
          entityId: platforms[2].id,
          points: [
            [...platforms[2].position],
            [0.8, platforms[2].position[1], platforms[2].position[2]],
          ],
          duration: 2,
          loop: true,
        },
      ],
    },
    ...collectibleRules,
    {
      id: "portal-win",
      trigger: { type: "collision", entityId: portal.id },
      conditions: [{ operand: { type: "score" }, comparison: "gte", value: 5 }],
      actions: [{ type: "win" }],
    },
  ],
};

function reserveEntity(entity) {
  const { geometry: _geometry, stage: _stage, ...rest } = entity;
  return { type: "reserve_entity", entity: { ...rest, stage: "seed" } };
}

const fixtureCommands = [
  ...entities.flatMap((entity) => [
    reserveEntity(entity),
    { type: "set_geometry", id: entity.id, geometry: entity.geometry },
  ]),
  { type: "set_game", game },
  {
    type: "commit_revision",
    message:
      "Local fresh gameplay fixture ready: collect five crystals, use three moving platforms, reach the portal, then restart.",
  },
];
const fixtureProject = {
  version: 1,
  title: "Local fresh gameplay fixture",
  seed: 42,
  entities,
  environment: { sky: "#dceee9", ground: "#91b977", water: "#59bdbb" },
  game,
  messages: [],
  revision: fixtureCommands.length,
};
const story = { platforms, collectibles, portal };

function installSoftwareFallback(context) {
  return context.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, attributes) {
      if (
        kind === "webgl2" ||
        kind === "webgl" ||
        kind === "experimental-webgl"
      )
        return null;
      return getContext.call(this, kind, attributes);
    };
  });
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return { promise, resolve: resolvePromise };
}

async function startGenerationStream() {
  const firstChunk =
    fixtureCommands
      .slice(0, 2)
      .map((command) => JSON.stringify(command))
      .join("\n") + "\n";
  const remainingChunks =
    fixtureCommands
      .slice(2)
      .map((command) => JSON.stringify(command))
      .join("\n") + "\n";
  const started = deferred();
  const release = deferred();
  const finished = deferred();
  let requestProject;
  let requests = 0;
  let responseFinished = false;
  const server = createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": appOrigin,
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      });
      response.end();
      return;
    }
    if (request.url !== "/api/generate-stream" || request.method !== "POST") {
      response.writeHead(404);
      response.end();
      return;
    }
    const body = [];
    for await (const chunk of request) body.push(chunk);
    requestProject = JSON.parse(Buffer.concat(body).toString("utf8")).project;
    requests += 1;
    response.writeHead(200, {
      "Access-Control-Allow-Origin": appOrigin,
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    });
    response.write(firstChunk);
    started.resolve();
    const markFinished = () => {
      responseFinished = true;
      finished.resolve();
    };
    response.once("finish", markFinished);
    response.once("close", markFinished);
    await release.promise;
    response.end(remainingChunks);
    markFinished();
  });
  await new Promise((resolveServer) =>
    server.listen(0, "127.0.0.1", resolveServer),
  );
  const address = server.address();
  assert(
    address && typeof address === "object",
    "Fixture stream did not bind.",
  );
  return {
    origin: `http://127.0.0.1:${address.port}`,
    started: started.promise,
    release: () => release.resolve(),
    finished: finished.promise,
    get requestProject() {
      return requestProject;
    },
    get requests() {
      return requests;
    },
    close: async () => {
      release.resolve();
      if (requests > 0 && !responseFinished) {
        await Promise.race([
          finished.promise,
          new Promise((resolveFinished) => setTimeout(resolveFinished, 1000)),
        ]);
      }
      server.closeAllConnections();
      await new Promise((resolveServer) => server.close(resolveServer));
    },
  };
}

async function runRenderer(browser, renderer) {
  const stream = await startGenerationStream();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => {
    window.__ORBSIE_GAMEPLAY_READ_REQUESTED__ = true;
  });
  await context.addInitScript(
    ({ streamUrl }) => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const requestUrl = new URL(
          typeof input === "string" ? input : input.url,
          window.location.href,
        );
        if (requestUrl.pathname !== "/api/generate")
          return originalFetch(input, init);
        return originalFetch(streamUrl, { ...init, credentials: "omit" });
      };
    },
    { streamUrl: `${stream.origin}/api/generate-stream` },
  );
  if (renderer === "software") await installSoftwareFallback(context);
  const blockedExternalRequests = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin !== appOrigin &&
      url.origin !== stream.origin &&
      url.protocol !== "data:"
    ) {
      blockedExternalRequests.push(url.href);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    if (url.origin === stream.origin) {
      await route.continue();
      return;
    }
    if (url.pathname === "/api/config") {
      await route.fulfill({
        json: { accounts: false, publishing: false, cloudRecovery: false },
      });
      return;
    }
    if (url.pathname === "/api/trial") {
      await route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } });
      return;
    }
    await route.fulfill({ json: {} });
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const requestFailures = [];
  const requestsSeen = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      consoleErrors.push(`${message.type()}: ${message.text()}`);
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") || url.origin !== appOrigin)
      requestsSeen.push(`${request.method()} ${request.url()}`);
  });
  page.on("requestfailed", (request) =>
    requestFailures.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown"}`,
      ),
  );
  let generationMovement;
  let result;
  try {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toHaveAttribute(
      "data-renderer-availability",
      "ready",
      { timeout: 30000 },
    );
    const prompt = page.locator("#prompt");
    await prompt.fill("Create the local fresh gameplay fixture.");
    await expect(prompt).toHaveValue("Create the local fresh gameplay fixture.");
    const create = page.getByRole("button", { name: "Create", exact: true });
    await expect(create).toBeEnabled({ timeout: 30000 });
    await create.click();
    await Promise.race([
      stream.started,
      page.waitForTimeout(30000).then(async () => {
        const mainState = await page
          .locator("main")
          .getAttribute("data-renderer-availability")
          .catch(() => null);
        throw new Error(
          `Fixture generation stream did not start (renderer=${mainState}, requests=${JSON.stringify(requestsSeen)}, failures=${JSON.stringify(requestFailures)}, pageErrors=${JSON.stringify(pageErrors)}, console=${JSON.stringify(consoleErrors.slice(-8))}).`,
        );
      }),
    ]);
    await expect(
      page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    assert(
      stream.requestProject?.id,
      "The fixture stream did not receive the source project ID.",
    );
    generationMovement = await observeFlagshipMovementDuringGeneration(
      page,
      {
        generationBodies: [{ projectId: stream.requestProject.id }],
        generationRequests: stream.requests,
        generationStatuses: [],
        generationRequestTimes: [{ atMs: Date.now() }],
      },
      { projectId: stream.requestProject.id, inputMode: "keyboard" },
    );
    stream.release();
    await stream.finished;
    await expect(
      page.getByText(fixtureCommands.at(-1).message, { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    assert(
      stream.requestProject?.id,
      "The fixture did not receive the source project ID.",
    );
    const project = {
      ...fixtureProject,
      id: stream.requestProject.id,
      messages: [
        {
          role: "user",
          text: "Create the local fresh gameplay fixture.",
        },
        { role: "assistant", text: fixtureCommands.at(-1).message },
      ],
    };
    result = await runFreshFlagshipGameplay(page, project, story, {
      inputMode: "keyboard",
    });
    assert.equal(result.renderer, renderer);
    assert.equal(result.collectedIds.length, 5);
    assert.equal(result.platformEvidence.length, 3);
    assert(
      result.platformEvidence.every(
        (entry) => entry.maximumDisplacement >= 0.05,
      ),
    );
    assert(
      result.platformEvidence.every(
        (entry) => entry.groundedFrames || entry.bounceFrames,
      ),
    );
    assert(result.platformEvidence.some((entry) => entry.bounceFrames > 0));
    assert.equal(result.win.status, "won");
    assert.equal(result.reset.scoreIds.length, 0);
    assert.equal(result.reset.projectId, project.id);
    assert.equal(stream.requests, 1);
    assert.deepEqual(blockedExternalRequests, []);
    // The software fixture deliberately blocks WebGL so the app exercises its
    // Canvas2D fallback. Three.js reports that expected initialization failure
    // as a page error; retain it in the report while failing on every other
    // renderer error.
    const expectedPageErrors =
      renderer === "software"
        ? pageErrors.filter(
            (message) => message === "THREE.WebGLRenderer: Error creating WebGL context.",
          )
        : [];
    const unexpectedPageErrors = pageErrors.filter(
      (message) => !expectedPageErrors.includes(message),
    );
    assert.deepEqual(unexpectedPageErrors, []);
    await page.screenshot({
      path: resolve(evidenceDir, `${renderer}-reset.png`),
      fullPage: true,
    });
    return {
      status: "passed",
      renderer,
      generationRequests: stream.requests,
      projectId: project.id,
      revision: project.revision,
      generationMovement,
      gameplay: result,
      pageErrors,
      expectedPageErrors,
      blockedExternalRequests,
    };
  } catch (error) {
    const partialEvidence = {
      renderer,
      generationRequests: stream.requests,
      projectId: stream.requestProject?.id ?? null,
      generationMovement:
        generationMovement ??
        (error && typeof error === "object"
          ? error.generationMovementEvidence ?? null
          : null),
      traversal:
        result ??
        (error && typeof error === "object"
          ? error.freshGameplayEvidence ?? null
          : null),
    };
    const fixtureDiagnostics = await page
      .evaluate(() => {
        const prompt = document.querySelector("#prompt");
        const create = Array.from(document.querySelectorAll("button")).find(
          (button) => button.textContent?.trim() === "Create",
        );
        const main = document.querySelector("main");
        return {
          readyState: document.readyState,
          mainRendererAvailability: main?.getAttribute(
            "data-renderer-availability",
          ),
          composerValue:
            prompt instanceof HTMLInputElement ||
            prompt instanceof HTMLTextAreaElement
              ? prompt.value
              : null,
          composerExists: Boolean(prompt),
          createExists: Boolean(create),
          createDisabled: create?.hasAttribute("disabled") ?? null,
          bodyText: document.body.innerText.slice(0, 1000),
        };
      })
      .catch((diagnosticError) => ({
        diagnosticError:
          diagnosticError instanceof Error
            ? diagnosticError.message
            : String(diagnosticError),
      }));
    const message = error instanceof Error ? error.message : String(error);
    const wrappedError = new Error(
      `${message} Fixture diagnostics: ${JSON.stringify({
        renderer,
        ...fixtureDiagnostics,
        pageErrors,
        consoleErrors,
        requestFailures,
        requestsSeen,
        partialEvidence,
      })}`,
    );
    wrappedError.fixtureEvidence = partialEvidence;
    throw wrappedError;
  } finally {
    await stream.close().catch(() => {});
    await page
      .screenshot({
        path: resolve(evidenceDir, `${renderer}-final.png`),
        fullPage: true,
      })
      .catch(() => {});
    await page.close().catch(() => {});
    await context.close();
  }
}

const report = {
  passed: false,
  scope:
    "Local deterministic browser fixture using the real Orbsie renderers, physics, input handlers, and opt-in observation bridge; no external provider/model/auth/network calls (local fixture HTTP only).",
  appUrl,
  renderers: {},
};
const browser = await chromium.launch({
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  await mkdir(evidenceDir, { recursive: true });
  const renderers =
    requestedRenderer === "all" ? ["webgl", "software"] : [requestedRenderer];
  for (const renderer of renderers) {
    try {
      report.renderers[renderer] = await runRenderer(browser, renderer);
    } catch (error) {
      if (error && typeof error === "object" && error.fixtureEvidence)
        report.renderers[renderer] = error.fixtureEvidence;
      throw error;
    }
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    resolve(evidenceDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
}
