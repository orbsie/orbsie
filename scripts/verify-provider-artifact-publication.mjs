#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, chmod, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, expect, request } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { assertLivePublicationOptIn } from "./lib/publication-acceptance.mjs";
import { createPublicationTransport } from "./lib/publication-transport.mjs";

const PRODUCTION_HOST = "orbsie.com";
const DEFAULT_SOURCE = "gateway";
const PUBLICATION_SOURCES = Object.freeze({
  gateway: Object.freeze({
    provider: "gateway",
    zipPath:
      "docs/evidence/provider-e2e/gateway-reload-recovery/gateway/world.zip",
    zipSha256:
      "6bde327ef0c63ca558ed35d5a74e26e55098077006f3b065c5effa7261da084b",
    projectId: "4a5d7783-c7fd-44e0-bf19-864bab9f9b08",
    revision: 9,
    projectSha256:
      "dca4cd48fcdce89b8a26cc305ae461d3f1d34bad36708224917d52f950e57105",
    sourceDigest:
      "1bf290c0ff72cd4d9412e94f6dbb41fa07d36d6cdae4995ad58216a35829b618",
    originModel: null,
  }),
  openrouter: Object.freeze({
    provider: "openrouter",
    zipPath:
      "docs/evidence/provider-e2e/input-game-union-policy/openrouter/world.zip",
    zipSha256:
      "c1aca064d323d1ceafb434fd7b67669cba07e4da2fb2005b6cb214bf423f561f",
    projectId: "3be44077-067b-4177-bf63-ad0ed4cc7a8a",
    revision: 8,
    projectSha256:
      "1953b8a4833cf87ccb4ebb8df66bae57c5c5707d2889250abbb4f0889ba5dc47",
    sourceDigest:
      "1376f1c06f0b6b26490de37b5e2f1b48ca88d390129be6f4b10e246014946bf6",
    originModel: "openai/gpt-5.6-luna",
  }),
});
const EXPECTED_ENTITY_IDS = ["original-tree", "original-mushroom"];
const GENERATION_PATHS = new Set([
  "/api/generate",
  "/api/chatgpt/generate",
  "/generate",
]);
const PENDING_STATES = new Set([
  "INITIALIZING",
  "QUEUED",
  "BUILDING",
  "VERIFYING",
]);
const CREDENTIAL_ROOT = join(homedir(), ".cache", "orbsie", "provider-tests");

class AcceptanceFailure extends Error {
  constructor(code) {
    super(code);
    this.name = "AcceptanceFailure";
    this.code = code;
  }
}

function ensure(condition, code) {
  if (!condition) throw new AcceptanceFailure(code);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function publicationSource(name = DEFAULT_SOURCE) {
  ensure(
    typeof name === "string" && Object.hasOwn(PUBLICATION_SOURCES, name),
    "config-source-invalid",
  );
  return PUBLICATION_SOURCES[name];
}

function canonicalJson(value) {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function exactKeys(value, expected, code) {
  ensure(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      canonicalJson(Object.keys(value).sort()) ===
        canonicalJson([...expected].sort()),
    code,
  );
}

function validateMetadata(metadata) {
  exactKeys(
    metadata,
    [
      "version",
      "sha256",
      "bytes",
      "bounds",
      "createdAt",
      "source",
      "kernelVersion",
    ],
    "fixture-model-metadata-shape",
  );
  ensure(metadata.version === 1, "fixture-model-version");
  ensure(/^[a-f0-9]{64}$/.test(metadata.sha256), "fixture-model-sha256");
  ensure(
    Number.isSafeInteger(metadata.bytes) && metadata.bytes > 0,
    "fixture-model-size",
  );
  ensure(metadata.source === "browser-manifold", "fixture-model-source");
  ensure(
    typeof metadata.kernelVersion === "string" &&
      metadata.kernelVersion.length > 0,
    "fixture-model-kernel",
  );
  ensure(
    typeof metadata.createdAt === "string" &&
      Number.isFinite(Date.parse(metadata.createdAt)),
    "fixture-model-created-at",
  );
  exactKeys(metadata.bounds, ["min", "max"], "fixture-model-bounds-shape");
  for (const side of [metadata.bounds.min, metadata.bounds.max])
    ensure(
      Array.isArray(side) &&
        side.length === 3 &&
        side.every((coordinate) => Number.isFinite(coordinate)),
      "fixture-model-bounds-values",
    );
  ensure(
    metadata.bounds.min.every(
      (value, index) => value <= metadata.bounds.max[index],
    ),
    "fixture-model-bounds-order",
  );
}

function validateInputGame(game) {
  exactKeys(game, ["variables", "rules"], "fixture-game-shape");
  ensure(
    Array.isArray(game.variables) && game.variables.length === 0,
    "fixture-game-variables",
  );
  ensure(
    Array.isArray(game.rules) && game.rules.length === 3,
    "fixture-game-rules",
  );
  const expected = [
    ["right-score", "right", "add_score", 7],
    ["up-win", "up", "win", undefined],
    ["left-lose", "left", "lose", undefined],
  ];
  for (let index = 0; index < expected.length; index += 1) {
    const [id, input, action, amount] = expected[index];
    const rule = game.rules[index];
    exactKeys(
      rule,
      ["id", "trigger", "conditions", "actions"],
      "fixture-game-rule-shape",
    );
    ensure(rule.id === id, "fixture-game-rule-id");
    ensure(
      rule.trigger?.type === "input" && rule.trigger.action === input,
      "fixture-game-trigger",
    );
    ensure(
      Array.isArray(rule.conditions) && rule.conditions.length === 0,
      "fixture-game-conditions",
    );
    ensure(
      Array.isArray(rule.actions) && rule.actions.length === 1,
      "fixture-game-actions",
    );
    const onlyAction = rule.actions[0];
    ensure(onlyAction?.type === action, "fixture-game-action-type");
    if (amount === undefined)
      exactKeys(onlyAction, ["type"], "fixture-game-action-shape");
    else {
      exactKeys(onlyAction, ["type", "amount"], "fixture-game-action-shape");
      ensure(onlyAction.amount === amount, "fixture-game-score-amount");
    }
  }
}

function validateEntity(entity, expectedId, sourceProvider) {
  const entityKeys = [
    "id",
    "label",
    "position",
    "scale",
    "rotation",
    "color",
    "geometry",
    "behavior",
    "assetPolicy",
    "stage",
  ];
  if (sourceProvider === "openrouter")
    entityKeys.splice(entityKeys.indexOf("rotation"), 1);
  exactKeys(entity, entityKeys, "fixture-entity-shape");
  ensure(entity.id === expectedId, "fixture-entity-id");
  ensure(entity.stage === "ready", "fixture-entity-stage");
  ensure(entity.assetPolicy === "new-only", "fixture-entity-asset-policy");
  ensure(entity.behavior?.type === "static", "fixture-entity-behavior");
  ensure(
    [entity.position, entity.scale, entity.rotation ?? [0, 0, 0]].every(
      (vector) =>
        Array.isArray(vector) &&
        vector.length === 3 &&
        vector.every((coordinate) => Number.isFinite(coordinate)),
    ),
    "fixture-entity-transform",
  );
  const geometryKeys = ["kind", "collision", "job", "model", "detail", "tint"];
  if (sourceProvider === "openrouter" && expectedId === "original-mushroom")
    geometryKeys.splice(geometryKeys.indexOf("tint"), 1);
  exactKeys(entity.geometry, geometryKeys, "fixture-geometry-shape");
  ensure(
    entity.geometry.kind === "generated" &&
      entity.geometry.collision === "none" &&
      entity.geometry.detail === "refined",
    "fixture-geometry-kind",
  );
  exactKeys(entity.geometry.job, ["backend", "recipe"], "fixture-job-shape");
  ensure(
    entity.geometry.job.backend === "browser-manifold" &&
      entity.geometry.job.recipe?.version === 1 &&
      Array.isArray(entity.geometry.job.recipe.nodes) &&
      entity.geometry.job.recipe.nodes.length > 0,
    "fixture-job-recipe",
  );
  validateMetadata(entity.geometry.model);
}

/** Validate and digest the immutable source fixture without contacting a server. */
export function preflightArtifact(zipBytes, sourceName = DEFAULT_SOURCE) {
  const source = publicationSource(sourceName);
  ensure(sha256(zipBytes) === source.zipSha256, "fixture-source-zip-hash");
  const files = unzipSync(new Uint8Array(zipBytes));
  for (const path of Object.keys(files))
    ensure(
      !path.startsWith("/") && !path.split("/").includes(".."),
      "fixture-unsafe-path",
    );
  const projectBytes = files["project.json"];
  ensure(projectBytes, "fixture-project-missing");
  let project;
  try {
    project = JSON.parse(strFromU8(projectBytes));
  } catch {
    throw new AcceptanceFailure("fixture-project-json");
  }
  exactKeys(
    project,
    [
      "version",
      "id",
      "title",
      "seed",
      "revision",
      "entities",
      "environment",
      "game",
      "messages",
    ],
    "fixture-project-shape",
  );
  ensure(project.version === 1, "fixture-project-version");
  ensure(project.id === source.projectId, "fixture-project-id");
  ensure(project.revision === source.revision, "fixture-project-revision");
  ensure(
    sha256(projectBytes) === source.projectSha256,
    "fixture-project-sha256",
  );
  ensure(
    typeof project.title === "string" && project.title.length > 0,
    "fixture-project-title",
  );
  ensure(Number.isSafeInteger(project.seed), "fixture-project-seed");
  exactKeys(
    project.environment,
    ["sky", "ground", "water"],
    "fixture-environment-shape",
  );
  ensure(Array.isArray(project.messages), "fixture-messages-shape");
  ensure(
    Array.isArray(project.entities) &&
      project.entities.length === EXPECTED_ENTITY_IDS.length,
    "fixture-entity-count",
  );
  EXPECTED_ENTITY_IDS.forEach((id, index) =>
    validateEntity(project.entities[index], id, source.provider),
  );
  validateInputGame(project.game);

  const models = project.entities.map((entity) => {
    const metadata = entity.geometry.model;
    const path = `models/generated/${metadata.sha256}.glb`;
    const bytes = files[path];
    ensure(bytes, "fixture-model-missing");
    ensure(bytes.byteLength === metadata.bytes, "fixture-model-size-mismatch");
    ensure(sha256(bytes) === metadata.sha256, "fixture-model-hash-mismatch");
    ensure(
      bytes.byteLength >= 12 &&
        strFromU8(bytes.subarray(0, 4)) === "glTF" &&
        new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        ).getUint32(4, true) === 2 &&
        new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        ).getUint32(8, true) === bytes.byteLength,
      "fixture-model-glb-header",
    );
    return { path, metadata, bytes };
  });
  ensure(
    new Set(models.map(({ metadata }) => metadata.sha256)).size ===
      models.length,
    "fixture-model-duplicate",
  );
  const zippedGlbs = Object.keys(files)
    .filter((path) => path.endsWith(".glb"))
    .sort();
  const expectedGlbs = models.map(({ path }) => path).sort();
  ensure(
    canonicalJson(zippedGlbs) === canonicalJson(expectedGlbs),
    "fixture-unexpected-glb-files",
  );

  const manifestBytes = files["models/generated/manifest.json"];
  ensure(manifestBytes, "fixture-model-manifest-missing");
  let manifest;
  try {
    manifest = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new AcceptanceFailure("fixture-model-manifest-json");
  }
  exactKeys(manifest, ["version", "models"], "fixture-model-manifest-shape");
  ensure(
    manifest.version === 1 && Array.isArray(manifest.models),
    "fixture-model-manifest-version",
  );
  const manifestModels = [...manifest.models].sort((a, b) =>
    String(a?.sha256).localeCompare(String(b?.sha256)),
  );
  const projectModels = models
    .map(({ metadata }) => metadata)
    .sort((a, b) => a.sha256.localeCompare(b.sha256));
  ensure(
    canonicalJson(manifestModels) === canonicalJson(projectModels),
    "fixture-model-manifest-mismatch",
  );

  const sourceDigest = sha256(
    Buffer.from(
      [
        "orbsie-provider-artifact-input-v1",
        canonicalJson(project),
        ...models
          .map(
            ({ path, metadata }) =>
              `${path}\t${metadata.sha256}\t${metadata.bytes}`,
          )
          .sort(),
      ].join("\n"),
    ),
  );
  ensure(sourceDigest === source.sourceDigest, "fixture-source-digest");
  return {
    sourceProvider: source.provider,
    sourceZipPath: source.zipPath,
    sourceZipSha256: source.zipSha256,
    sourceOriginModel: source.originModel,
    project,
    models,
    sourceDigest,
    sourceProjectBytes: projectBytes.byteLength,
    sourceProjectSha256: sha256(projectBytes),
    zipFileCount: Object.keys(files).length,
  };
}

function assertProductionBase(value) {
  ensure(
    typeof value === "string" && value.length > 0,
    "config-production-url-required",
  );
  let base;
  try {
    base = new URL(value);
  } catch {
    throw new AcceptanceFailure("config-production-url-invalid");
  }
  ensure(
    base.protocol === "https:" &&
      base.hostname === PRODUCTION_HOST &&
      !base.username &&
      !base.password &&
      base.pathname === "/" &&
      !base.search &&
      !base.hash &&
      !new Set(["localhost", "127.0.0.1", "::1"]).has(base.hostname),
    "config-production-url-invalid",
  );
  return base.origin;
}

function responseStatus(result) {
  return typeof result?.status === "number" ? result.status : 0;
}

function responseBody(result) {
  return result?.body && typeof result.body === "object" ? result.body : {};
}

function createBoundedTransport(base) {
  return createPublicationTransport(base, (url, init = {}) =>
    fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(30_000),
    }),
  );
}

function requireApiBody(result, code) {
  const status = responseStatus(result);
  ensure(status >= 200 && status < 300, `${code}-http-${status}`);
  const body = responseBody(result);
  ensure(!body.error, `${code}-rejected`);
  return body;
}

function sessionCookieHeader(storageState, base) {
  const cookies = Array.isArray(storageState?.cookies)
    ? storageState.cookies
    : [];
  const host = new URL(base).hostname;
  const scoped = cookies.filter(
    (cookie) =>
      typeof cookie?.name === "string" &&
      cookie.name.length > 0 &&
      typeof cookie?.value === "string" &&
      cookie.value.length > 0 &&
      typeof cookie?.domain === "string" &&
      (host === cookie.domain.replace(/^\./, "") ||
        host.endsWith(`.${cookie.domain.replace(/^\./, "")}`)),
  );
  ensure(scoped.length > 0, "account-session-cookie-missing");
  return scoped.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function savePrivateCredentials(runId, projectId, password, source) {
  await mkdir(CREDENTIAL_ROOT, { recursive: true, mode: 0o700 });
  await chmod(CREDENTIAL_ROOT, 0o700);
  const parentMode = await stat(CREDENTIAL_ROOT);
  ensure(
    parentMode.isDirectory() && (parentMode.mode & 0o077) === 0,
    "credential-directory-mode",
  );
  const email = `orbsie-provider-${runId}@example.com`;
  const path = join(CREDENTIAL_ROOT, `${runId}.json`);
  const data = {
    schemaVersion: 1,
    email,
    password,
    projectId,
    sourceProvider: source.provider,
    sourcePath: source.zipPath,
    sourceOriginModel: source.originModel,
    sourceZipSha256: source.zipSha256,
    sourceDigest: source.sourceDigest,
    sourceProjectSha256: source.projectSha256,
    sourceProjectId: source.projectId,
    sourceRevision: source.revision,
  };
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await chmod(path, 0o600);
  const fileMode = await stat(path);
  ensure(
    fileMode.isFile() && (fileMode.mode & 0o077) === 0,
    "credential-file-mode",
  );
  return { email, path };
}

async function writeReport(evidenceDir, report) {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    join(evidenceDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  await chmod(join(evidenceDir, "report.json"), 0o600);
}

async function runStage(report, evidenceDir, name, callback) {
  report.stages[name].status = "running";
  await writeReport(evidenceDir, report);
  try {
    await callback();
    report.stages[name].status = "passed";
  } catch (error) {
    report.stages[name].status = "failed";
    report.stages[name].failureCode =
      error instanceof AcceptanceFailure ? error.code : `${name}-failed`;
    report.status = "failed";
    report.failedStage = name;
    throw error;
  } finally {
    await writeReport(evidenceDir, report);
  }
}

async function loadRuntimeArtifacts() {
  const [runtimeJS, runtimeCSS] = await Promise.all([
    readFile("public/player/runtime.js"),
    readFile("public/player/runtime.css"),
  ]);
  return {
    js: { bytes: runtimeJS.byteLength, sha256: sha256(runtimeJS) },
    css: { bytes: runtimeCSS.byteLength, sha256: sha256(runtimeCSS) },
  };
}

function expectedPublishSnapshot(project) {
  return { ...project, messages: [] };
}

async function publicText(transport, url, code) {
  let result;
  try {
    result = await transport.publicGet(url, code);
  } catch {
    throw new AcceptanceFailure(`${code}-network`);
  }
  ensure(
    responseStatus(result) === 200,
    `${code}-http-${responseStatus(result)}`,
  );
  return result.text ?? "";
}

async function publicBytes(url, code) {
  let response;
  try {
    response = await fetch(url, {
      redirect: "error",
      credentials: "omit",
      headers: { "User-Agent": "OrbsiePublicationAcceptance/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new AcceptanceFailure(`${code}-network`);
  }
  ensure(response.status === 200, `${code}-http-${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function touchButton(page, cdp, name, id = 1) {
  const button =
    name instanceof RegExp
      ? page.getByRole("button", { name })
      : page.getByRole("button", { name, exact: true });
  let box;
  try {
    box = await button.boundingBox();
  } catch {
    throw new AcceptanceFailure("browser-touch-control-missing");
  }
  ensure(box, "browser-touch-control-missing");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id }],
  });
  await page.waitForTimeout(180);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

async function runGameplayMode(browser, deploymentUrl, evidenceDir, mode) {
  const context = await browser.newContext({
    viewport: mode.viewport,
    ...(mode.touch ? { isMobile: true, hasTouch: true } : {}),
  });
  const generationRoutes = [];
  let externalRoutes = 0;
  const pageErrors = [];
  const targetOrigin = new URL(deploymentUrl).origin;
  await context.route("**/*", async (route) => {
    let url;
    try {
      url = new URL(route.request().url());
    } catch {
      externalRoutes += 1;
      await route.abort("blockedbyclient");
      return;
    }
    if (GENERATION_PATHS.has(url.pathname)) {
      generationRoutes.push(url.pathname);
      await route.abort("blockedbyclient");
      return;
    }
    if (
      url.protocol === "data:" ||
      url.protocol === "blob:" ||
      url.origin === targetOrigin
    ) {
      await route.continue();
      return;
    }
    externalRoutes += 1;
    await route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", () => pageErrors.push(1));
  const result = {
    name: mode.name,
    viewport: mode.viewport,
    touch: mode.touch,
    status: "running",
    generationRequests: 0,
    externalRequests: 0,
    pageErrors: 0,
    cookies: 0,
    screenshot: mode.screenshot,
  };
  let cdp;
  try {
    let response;
    try {
      response = await page.goto(deploymentUrl, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.locator('main[data-ready="true"]')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
    } catch {
      throw new AcceptanceFailure("browser-world-readiness");
    }
    ensure(response?.ok(), `browser-world-http-${response?.status() ?? 0}`);
    const score = page.locator(".score");
    try {
      await expect(score).toHaveText("Score: 0");
      if (mode.touch) {
        await expect(page.locator(".controls")).toBeVisible();
        await expect(page.locator("footer")).toContainText(
          "Use the controls below to move and jump",
        );
        cdp = await context.newCDPSession(page);
        await touchButton(page, cdp, "Right");
        await expect(score).toHaveText("Score: 7");
        await touchButton(page, cdp, /Restart/);
        await expect(score).toHaveText("Score: 0");
        await touchButton(page, cdp, "Forward");
        await expect(page.locator(".win")).toContainText("Final score: 0");
        await touchButton(page, cdp, /Restart/);
        await expect(score).toHaveText("Score: 0");
        await touchButton(page, cdp, "Left");
      } else {
        await page.keyboard.press("d", { delay: 100 });
        await expect(score).toHaveText("Score: 7");
        await page.getByRole("button", { name: /Restart/ }).click();
        await expect(score).toHaveText("Score: 0");
        await page.keyboard.press("w", { delay: 100 });
        await expect(page.locator(".win")).toContainText("Final score: 0");
        await page.getByRole("button", { name: /Restart/ }).click();
        await expect(score).toHaveText("Score: 0");
        await page.keyboard.press("a", { delay: 100 });
      }
      await expect(page.locator(".win")).toContainText("Try another adventure");
    } catch (error) {
      if (error instanceof AcceptanceFailure) throw error;
      throw new AcceptanceFailure("browser-gameplay-interaction");
    }
    result.httpStatus = response.status();
    result.ready = true;
    result.canvas = true;
    result.scoreAfterRight = 7;
    result.win = true;
    result.loss = true;
    result.restart = true;
    await page.screenshot({ path: join(evidenceDir, mode.screenshot) });
    result.generationRequests = generationRoutes.length;
    result.externalRequests = externalRoutes;
    result.pageErrors = pageErrors.length;
    result.cookies = (await context.cookies()).length;
    ensure(result.generationRequests === 0, "browser-generation-request");
    ensure(result.externalRequests === 0, "browser-external-request");
    ensure(result.pageErrors === 0, "browser-page-error");
    ensure(result.cookies === 0, "browser-cookie");
    result.status = "passed";
    return result;
  } catch (error) {
    result.status = "failed";
    result.failureCode =
      error instanceof AcceptanceFailure ? error.code : "browser-mode-failed";
    result.generationRequests = generationRoutes.length;
    result.externalRequests = externalRoutes;
    result.pageErrors = pageErrors.length;
    try {
      result.cookies = (await context.cookies()).length;
    } catch {
      result.cookies = null;
    }
    try {
      const failureScreenshot = `failed-${mode.screenshot}`;
      await page.screenshot({ path: join(evidenceDir, failureScreenshot) });
      result.failureScreenshot = failureScreenshot;
    } catch {
      result.failureScreenshot = null;
    }
    throw Object.assign(new AcceptanceFailure(result.failureCode), {
      modeResult: result,
    });
  } finally {
    if (cdp) await cdp.detach().catch(() => undefined);
    await context.close();
  }
}

async function validateSignedOutGameplay(
  browser,
  deploymentUrl,
  evidenceDir,
  report,
) {
  const modes = [
    {
      name: "desktop-keyboard",
      viewport: { width: 1280, height: 800 },
      touch: false,
      screenshot: "signed-out-game-desktop.png",
    },
    {
      name: "portrait-touch",
      viewport: { width: 390, height: 844 },
      touch: true,
      screenshot: "signed-out-game-portrait-touch.png",
    },
    {
      name: "landscape-touch",
      viewport: { width: 844, height: 390 },
      touch: true,
      screenshot: "signed-out-game-landscape-touch.png",
    },
  ];
  report.browser = { modes: [] };
  for (const mode of modes) {
    try {
      report.browser.modes.push(
        await runGameplayMode(browser, deploymentUrl, evidenceDir, mode),
      );
    } catch (error) {
      if (error?.modeResult) report.browser.modes.push(error.modeResult);
      throw error;
    }
  }
  report.browser.status = "passed";
  report.browser.modeCount = modes.length;
}

function makeReport(base, source, projectId, runId) {
  return {
    schemaVersion: "orbsie.provider-artifact-publication/v1",
    status: "running",
    startedAt: new Date().toISOString(),
    baseOrigin: base,
    source: {
      provider: source.provider,
      originModel: source.originModel,
      path: source.zipPath,
      zipSha256: source.zipSha256,
      projectId: source.projectId,
      revision: source.revision,
      digest: source.sourceDigest,
      projectSha256: source.projectSha256,
      models: [],
    },
    acceptance: {
      runId,
      sourceProvider: source.provider,
      projectId,
      revision: source.revision,
      credentialFile: null,
    },
    account: { status: "not_run" },
    modelUploads: { status: "not_run", count: 0, models: [] },
    projectSave: { status: "not_run", revision: source.revision },
    publication: { status: "not_run" },
    publicArtifacts: { status: "not_run" },
    browser: { status: "not_run", modes: [] },
    stages: {
      preflight: { status: "not_run" },
      account: { status: "not_run" },
      modelUploads: { status: "not_run" },
      projectSave: { status: "not_run" },
      publishSubmission: { status: "not_run" },
      publicationReady: { status: "not_run" },
      publicArtifacts: { status: "not_run" },
      browser: { status: "not_run" },
    },
  };
}

async function runLiveAcceptance() {
  // This must stay ahead of credential creation, reads, and every network call.
  assertLivePublicationOptIn();

  const source = publicationSource(
    process.env.ORBSIE_PUBLICATION_SOURCE ?? DEFAULT_SOURCE,
  );
  const base = assertProductionBase(process.env.ORBSIE_TEST_URL);
  const evidenceSetting = process.env.ORBSIE_PUBLICATION_EVIDENCE_DIR;
  ensure(
    typeof evidenceSetting === "string" && evidenceSetting.trim().length > 0,
    "config-evidence-dir-required",
  );
  const evidenceDir = resolve(evidenceSetting);
  const runId = randomUUID();
  const projectId = `provider-artifact-${runId}`;
  const report = makeReport(base, source, projectId, runId);

  await mkdir(evidenceDir, { recursive: true });
  await writeReport(evidenceDir, report);

  let artifact;
  let runtimeArtifacts;
  let project;
  let credentials;
  let cookie;
  let transport;
  let submitted;
  let ready;
  let browser;

  try {
    await runStage(report, evidenceDir, "preflight", async () => {
      const zipBytes = await readFile(source.zipPath);
      artifact = preflightArtifact(zipBytes, source.provider);
      runtimeArtifacts = await loadRuntimeArtifacts();
      report.source.digest = artifact.sourceDigest;
      report.source.projectSha256 = artifact.sourceProjectSha256;
      report.source.zipSha256 = artifact.sourceZipSha256;
      report.source.projectBytes = artifact.sourceProjectBytes;
      report.source.zipFileCount = artifact.zipFileCount;
      report.source.entityIds = artifact.project.entities.map(({ id }) => id);
      report.source.gameRuleIds = artifact.project.game.rules.map(
        ({ id }) => id,
      );
      report.source.models = artifact.models.map(({ path, metadata }) => ({
        path,
        sha256: metadata.sha256,
        bytes: metadata.bytes,
      }));
      report.currentRuntime = runtimeArtifacts;
      project = structuredClone(artifact.project);
      project.id = projectId;
      project.messages = [];
    });

    await runStage(report, evidenceDir, "account", async () => {
      const password = randomBytes(24).toString("base64url");
      credentials = await savePrivateCredentials(
        runId,
        projectId,
        password,
        source,
      );
      report.acceptance.credentialFile = credentials.path;
      const auth = await request.newContext({
        baseURL: base,
        extraHTTPHeaders: { Origin: base },
        timeout: 30_000,
      });
      try {
        let signUp;
        try {
          signUp = await auth.post("/api/auth/sign-up/email", {
            data: {
              email: credentials.email,
              password,
              name: "Orbsie Provider Artifact Acceptance",
            },
            maxRedirects: 0,
          });
        } catch {
          throw new AcceptanceFailure("account-signup-network");
        }
        ensure(
          signUp.status() >= 200 && signUp.status() < 300,
          `account-signup-http-${signUp.status()}`,
        );
        cookie = sessionCookieHeader(await auth.storageState(), base);
      } finally {
        await auth.dispose();
      }
      report.account = { status: "created", credentialFile: credentials.path };
      transport = createBoundedTransport(base);
    });

    await runStage(report, evidenceDir, "modelUploads", async () => {
      for (const model of artifact.models) {
        let result;
        try {
          result = await transport.request(
            "/api/generated-models",
            {
              method: "PUT",
              cookie,
              body: JSON.stringify({
                metadata: model.metadata,
                glb: Buffer.from(model.bytes).toString("base64"),
              }),
            },
            "generated model upload",
          );
        } catch {
          throw new AcceptanceFailure("model-upload-network");
        }
        const body = requireApiBody(result, "model-upload");
        ensure(
          canonicalJson(body.metadata) === canonicalJson(model.metadata),
          "model-upload-metadata-mismatch",
        );
        report.modelUploads.models.push({
          sha256: model.metadata.sha256,
          bytes: model.metadata.bytes,
          status: "uploaded",
        });
        report.modelUploads.count += 1;
      }
      report.modelUploads.status = "uploaded";
    });

    await runStage(report, evidenceDir, "projectSave", async () => {
      let saved;
      try {
        saved = await transport.request(
          "/api/projects",
          {
            method: "PUT",
            cookie,
            body: JSON.stringify({
              project,
              baseRevision: null,
              baseSnapshotToken: null,
            }),
          },
          "fresh acceptance project save",
        );
      } catch {
        throw new AcceptanceFailure("project-save-network");
      }
      const saveBody = requireApiBody(saved, "project-save");
      ensure(saveBody.revision === project.revision, "project-save-revision");
      let readback;
      try {
        readback = await transport.request(
          `/api/projects?id=${encodeURIComponent(projectId)}`,
          { cookie },
          "acceptance project readback",
        );
      } catch {
        throw new AcceptanceFailure("project-readback-network");
      }
      const readbackBody = requireApiBody(readback, "project-readback");
      ensure(
        canonicalJson(readbackBody.project?.snapshot) ===
          canonicalJson(project),
        "project-readback-snapshot-mismatch",
      );
      report.projectSave = {
        status: "saved_and_verified",
        revision: project.revision,
        snapshotVerified: true,
      };
    });

    await runStage(report, evidenceDir, "publishSubmission", async () => {
      let result;
      try {
        result = await transport.request(
          "/api/publish",
          {
            method: "POST",
            cookie,
            body: JSON.stringify({
              projectId,
              revision: project.revision,
            }),
          },
          "fresh acceptance publication",
        );
      } catch {
        throw new AcceptanceFailure("publish-submit-network");
      }
      submitted = requireApiBody(result, "publish-submit");
      ensure(
        typeof submitted.deploymentId === "string" &&
          submitted.deploymentId.length > 0,
        "publish-submit-deployment-id",
      );
      ensure(
        typeof submitted.deploymentUrl === "string" &&
          new URL(submitted.deploymentUrl).protocol === "https:",
        "publish-submit-deployment-url",
      );
      ensure(
        typeof submitted.vercelProjectId === "string" &&
          submitted.vercelProjectId.length > 0,
        "publish-submit-vercel-project",
      );
      ensure(
        PENDING_STATES.has(submitted.state) || submitted.state === "READY",
        "publish-submit-state",
      );
      report.publication = {
        status: "submitted",
        revision: project.revision,
        deploymentId: submitted.deploymentId,
        deploymentUrl: submitted.deploymentUrl,
        vercelProjectId: submitted.vercelProjectId,
        initialState: submitted.state,
        polls: 0,
      };
    });

    await runStage(report, evidenceDir, "publicationReady", async () => {
      const rawPolls = process.env.ORBSIE_PUBLICATION_MAX_POLLS;
      const maxPolls = rawPolls === undefined ? 60 : Number(rawPolls);
      ensure(
        Number.isSafeInteger(maxPolls) && maxPolls >= 1 && maxPolls <= 120,
        "publication-poll-budget-invalid",
      );
      const rawDelay = process.env.ORBSIE_PUBLICATION_POLL_DELAY_MS;
      const delay = rawDelay === undefined ? 5_000 : Number(rawDelay);
      ensure(
        Number.isSafeInteger(delay) && delay >= 0 && delay <= 10_000,
        "publication-poll-delay-invalid",
      );
      for (let attempt = 0; attempt < maxPolls; attempt += 1) {
        let result;
        try {
          result = await transport.request(
            `/api/publish?projectId=${encodeURIComponent(projectId)}`,
            { cookie },
            "publication readiness poll",
          );
        } catch {
          throw new AcceptanceFailure("publication-poll-network");
        }
        const body = requireApiBody(result, "publication-poll");
        report.publication.polls = attempt + 1;
        report.publication.lastState =
          body.state === "READY" || PENDING_STATES.has(body.state)
            ? body.state
            : "unexpected";
        if (body.state === "READY") {
          ready = body;
          break;
        }
        ensure(PENDING_STATES.has(body.state), "publication-terminal-state");
        if (attempt + 1 < maxPolls && delay > 0)
          await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
      }
      ensure(ready, "publication-timeout");
      ensure(
        ready.deploymentId === submitted.deploymentId,
        "publication-deployment-mismatch",
      );
      ensure(
        ready.deploymentUrl === submitted.deploymentUrl,
        "publication-url-mismatch",
      );
      ensure(
        ready.vercelProjectId === submitted.vercelProjectId,
        "publication-project-mismatch",
      );
      ensure(
        ready.servedRevision === project.revision,
        "publication-served-revision",
      );
      report.publication.status = "ready";
      report.publication.servedRevision = ready.servedRevision;
      report.publication.readyState = ready.state;
    });

    await runStage(report, evidenceDir, "publicArtifacts", async () => {
      const publicTransport = createBoundedTransport(base);
      const projectText = await publicText(
        publicTransport,
        `${ready.deploymentUrl}/project.json`,
        "public-project",
      );
      const runtimeJS = await publicText(
        publicTransport,
        `${ready.deploymentUrl}/runtime.js`,
        "public-runtime-js",
      );
      const runtimeCSS = await publicText(
        publicTransport,
        `${ready.deploymentUrl}/runtime.css`,
        "public-runtime-css",
      );
      let servedProject;
      try {
        servedProject = JSON.parse(projectText);
      } catch {
        throw new AcceptanceFailure("public-project-json");
      }
      ensure(
        canonicalJson(servedProject) ===
          canonicalJson(expectedPublishSnapshot(project)),
        "public-project-snapshot-mismatch",
      );
      ensure(servedProject.id === projectId, "public-project-id");
      ensure(
        servedProject.revision === project.revision,
        "public-project-revision",
      );
      ensure(
        canonicalJson(servedProject.entities.map(({ id }) => id)) ===
          canonicalJson(EXPECTED_ENTITY_IDS),
        "public-project-entity-ids",
      );
      ensure(
        canonicalJson(servedProject.game) === canonicalJson(project.game),
        "public-project-game",
      );
      const runtimeJSInfo = {
        bytes: Buffer.byteLength(runtimeJS),
        sha256: sha256(Buffer.from(runtimeJS)),
      };
      const runtimeCSSInfo = {
        bytes: Buffer.byteLength(runtimeCSS),
        sha256: sha256(Buffer.from(runtimeCSS)),
      };
      ensure(
        runtimeJSInfo.sha256 === runtimeArtifacts.js.sha256 &&
          runtimeJSInfo.bytes === runtimeArtifacts.js.bytes,
        "public-runtime-js-mismatch",
      );
      ensure(
        runtimeCSSInfo.sha256 === runtimeArtifacts.css.sha256 &&
          runtimeCSSInfo.bytes === runtimeArtifacts.css.bytes,
        "public-runtime-css-mismatch",
      );
      const publishedModels = [];
      for (const model of artifact.models) {
        const bytes = await publicBytes(
          `${ready.deploymentUrl}/${model.path}`,
          "public-model",
        );
        ensure(
          bytes.byteLength === model.metadata.bytes &&
            sha256(bytes) === model.metadata.sha256,
          "public-model-integrity",
        );
        publishedModels.push({
          path: model.path,
          bytes: bytes.byteLength,
          sha256: model.metadata.sha256,
        });
      }
      const manifestText = await publicText(
        publicTransport,
        `${ready.deploymentUrl}/models/generated/manifest.json`,
        "public-model-manifest",
      );
      let publishedManifest;
      try {
        publishedManifest = JSON.parse(manifestText);
      } catch {
        throw new AcceptanceFailure("public-model-manifest-json");
      }
      ensure(
        canonicalJson(publishedManifest) ===
          canonicalJson({
            version: 1,
            models: artifact.models
              .map(({ metadata }) => metadata)
              .sort((left, right) => left.sha256.localeCompare(right.sha256)),
          }),
        "public-model-manifest-mismatch",
      );
      report.publicArtifacts = {
        status: "verified",
        projectId: servedProject.id,
        revision: servedProject.revision,
        entityIds: servedProject.entities.map(({ id }) => id),
        gameRuleIds: servedProject.game.rules.map(({ id }) => id),
        snapshotMatched: true,
        runtimeJS: { local: runtimeArtifacts.js, served: runtimeJSInfo },
        runtimeCSS: { local: runtimeArtifacts.css, served: runtimeCSSInfo },
        generatedModels: publishedModels,
        generatedManifestMatched: true,
      };
    });

    await runStage(report, evidenceDir, "browser", async () => {
      browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--use-gl=angle",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
        ],
      });
      try {
        await validateSignedOutGameplay(
          browser,
          ready.deploymentUrl,
          evidenceDir,
          report,
        );
      } finally {
        await browser.close();
        browser = undefined;
      }
    });

    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    if (!report.failedStage) report.failureCode = "acceptance-failed";
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    report.finishedAt = new Date().toISOString();
    await writeReport(evidenceDir, report);
    console.log(JSON.stringify(report, null, 2));
  }
  if (report.status !== "passed") process.exitCode = 1;
}

async function runOfflinePreflight() {
  try {
    const source = publicationSource(
      process.env.ORBSIE_PUBLICATION_SOURCE ?? DEFAULT_SOURCE,
    );
    const artifact = preflightArtifact(
      await readFile(source.zipPath),
      source.provider,
    );
    const runtime = await loadRuntimeArtifacts();
    console.log(
      JSON.stringify(
        {
          status: "preflight-passed",
          source: {
            provider: source.provider,
            originModel: source.originModel,
            path: source.zipPath,
            zipSha256: artifact.sourceZipSha256,
            projectId: artifact.project.id,
            revision: artifact.project.revision,
            digest: artifact.sourceDigest,
            projectSha256: artifact.sourceProjectSha256,
            models: artifact.models.map(({ path, metadata }) => ({
              path,
              sha256: metadata.sha256,
              bytes: metadata.bytes,
            })),
          },
          currentRuntime: runtime,
          networkRequests: 0,
          credentialReads: 0,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const failureCode =
      error instanceof AcceptanceFailure ? error.code : "preflight-failed";
    console.log(JSON.stringify({ status: "preflight-failed", failureCode }));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  if (process.argv.includes("--preflight")) await runOfflinePreflight();
  else {
    try {
      await runLiveAcceptance();
    } catch (error) {
      const failureCode =
        error instanceof AcceptanceFailure
          ? error.code
          : error?.name === "PublicationAcceptanceError"
            ? "live-opt-in-required"
            : "startup-failed";
      console.log(JSON.stringify({ status: "refused", failureCode }));
      process.exitCode = 1;
    }
  }
}
