#!/usr/bin/env node
// Deterministic browser review-loop fixture. It uses the real editor, renderer,
// canvas capture, IndexedDB save path, and synthetic review replies only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";

const base = process.env.TEST_URL ?? "http://localhost:3047";
const origin = new URL(base).origin;
const output = process.argv[2];
if (!output || process.argv.length !== 3)
  throw Error(
    "Usage: node scripts/verify-authoring-review-loop.mjs NEW_EVIDENCE_DIRECTORY",
  );
await mkdir(output, { recursive: false });

const clientRunId = "11111111-1111-4111-8111-111111111111";
const authoringRunId = "22222222-2222-4222-8222-222222222222";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .flatMap((key) =>
          value[key] === undefined ? [] : [[key, canonicalize(value[key])]],
        ),
    );
  }
  return value;
}

function entityProjection(entity) {
  return {
    id: entity.id,
    label: entity.label,
    position: entity.position,
    scale: entity.scale,
    ...(entity.rotation === undefined ? {} : { rotation: entity.rotation }),
    ...(entity.parentId === undefined ? {} : { parentId: entity.parentId }),
    color: entity.color,
    ...(entity.geometry === undefined ? {} : { geometry: entity.geometry }),
    ...(entity.behavior === undefined ? {} : { behavior: entity.behavior }),
    ...(entity.assetPolicy === undefined
      ? {}
      : { assetPolicy: entity.assetPolicy }),
    stage: entity.stage,
  };
}

function bindingProjection(project) {
  return {
    domainVersion: 1,
    version: project.version,
    id: project.id,
    title: project.title,
    seed: project.seed,
    revision: project.revision,
    entities: project.entities.map(entityProjection),
    groups: (project.groups ?? []).map((group) => ({
      id: group.id,
      label: group.label,
      position: group.position,
      ...(group.rotation === undefined ? {} : { rotation: group.rotation }),
      scale: group.scale,
      ...(group.parentId === undefined ? {} : { parentId: group.parentId }),
    })),
    environment: project.environment,
    ...(project.game === undefined ? {} : { game: project.game }),
  };
}

function sceneDigest(project) {
  const bytes = JSON.stringify(canonicalize(bindingProjection(project)));
  return createHash("sha256").update(bytes).digest("hex");
}

function imageDigest(dataUrl) {
  const separator = dataUrl.indexOf(",");
  assert(separator > 0, "review capture must be a data URL");
  return createHash("sha256")
    .update(Buffer.from(dataUrl.slice(separator + 1), "base64"))
    .digest("hex");
}

function initialStream() {
  return [
    {
      type: "reserve_entity",
      entity: {
        id: "lantern",
        label: "Lantern",
        position: [0, 0, 0],
        scale: [1, 1, 1],
        color: "#e4c79b",
        stage: "seed",
      },
    },
    {
      type: "set_geometry",
      id: "lantern",
      geometry: { kind: "platform", detail: "refined", tint: "#e4c79b" },
    },
    { type: "commit_revision", message: "Applied." },
  ];
}

function streamBody() {
  return `${initialStream()
    .map((command) => JSON.stringify(command))
    .join("\n")}\n`;
}

function correctionProject(project, reviewOrdinal = 1) {
  if (reviewOrdinal === 2)
    return {
      ...project,
      revision: project.revision + 2,
      environment: { ...project.environment, sky: "#88ccff" },
    };
  return {
    ...project,
    revision: project.revision + 3,
    entities: project.entities.map((entity) =>
      entity.id === "lantern"
        ? {
            ...entity,
            color: "#ff4b9e",
            geometry: entity.geometry
              ? { ...entity.geometry, tint: "#ff4b9e" }
              : undefined,
          }
        : entity,
    ),
    environment: { ...project.environment, sky: "#aabbff" },
  };
}

function reviewReply(
  project,
  phase,
  finalVerdict = "accept",
  reviewOrdinal = 1,
  twoCorrections = false,
) {
  const scope = "visual+structural";
  if (phase === "review") {
    const corrected = correctionProject(project, reviewOrdinal);
    const digest = sceneDigest(corrected);
    const second = reviewOrdinal === 2;
    const correctionCommands = second
      ? [{ type: "set_environment", sky: "#88ccff" }]
      : [
          { type: "set_environment", sky: "#aabbff" },
          { type: "set_material", id: "lantern", color: "#ff4b9e" },
        ];
    return {
      review: {
        version: 1,
        projectId: project.id,
        reviewedRevision: project.revision,
        scope,
        verdict: "revise",
        summary: "The sky needs a targeted correction.",
        issues: [{ summary: "The sky is too pale.", entityIds: [] }],
        corrections: correctionCommands,
      },
      corrections: [
        ...correctionCommands,
        { type: "commit_revision", message: "Review correction applied." },
      ],
      binding: { revision: corrected.revision, digest },
      revision: corrected.revision,
      digest,
      scope,
      remainingCalls: twoCorrections && !second ? 2 : 1,
    };
  }
  const digest = sceneDigest(project);
  return {
    review: {
      version: 1,
      projectId: project.id,
      reviewedRevision: project.revision,
      scope,
      verdict: finalVerdict,
      summary:
        finalVerdict === "accept"
          ? "The corrected scene is ready."
          : "The lantern still needs a hanging chain.",
      issues:
        finalVerdict === "accept"
          ? []
          : [
              {
                summary: "The lantern has no visible hanging chain.",
                entityIds: ["lantern"],
              },
            ],
      corrections: [],
    },
    corrections: [],
    binding: { revision: project.revision, digest },
    revision: project.revision,
    digest,
    scope,
    remainingCalls: 0,
  };
}

function applyJournalCommand(project, command) {
  let next = { ...project };
  if (command.type === "reserve_entity") {
    next = {
      ...next,
      entities: [...next.entities, { ...command.entity, stage: "seed" }],
    };
  } else if (command.type === "set_geometry") {
    next = {
      ...next,
      entities: next.entities.map((entity) =>
        entity.id !== command.id
          ? entity
          : {
              ...entity,
              geometry: command.geometry,
              stage: command.geometry.detail === "refined" ? "ready" : "coarse",
            },
      ),
    };
  } else if (command.type === "set_environment") {
    next = {
      ...next,
      environment: {
        ...next.environment,
        ...(command.sky === undefined ? {} : { sky: command.sky }),
        ...(command.ground === undefined ? {} : { ground: command.ground }),
        ...(command.water === undefined ? {} : { water: command.water }),
      },
    };
  } else if (command.type === "set_material") {
    next = {
      ...next,
      entities: next.entities.map((entity) =>
        entity.id !== command.id
          ? entity
          : {
              ...entity,
              color: command.color,
              geometry: entity.geometry
                ? { ...entity.geometry, tint: command.color }
                : undefined,
            },
      ),
    };
  } else if (command.type === "commit_revision") {
    next = {
      ...next,
      messages: [
        ...next.messages,
        { role: "assistant", text: command.message },
      ],
    };
  }
  return { ...next, revision: project.revision + 1 };
}

function cloudProjectView(project, snapshotToken) {
  return {
    id: project.id,
    title: project.title,
    revision: project.revision,
    snapshot: project,
    snapshotToken,
    updatedAt: "2026-09-22T00:00:00.000Z",
    publicUrl: null,
    publicationRevision: null,
  };
}

function runView(run) {
  return {
    run: {
      id: run.id,
      projectId: run.projectId,
      sequence: run.sequence,
      state: run.state,
      checkpoint: run.checkpoint,
      recoveryCheckpoint: run.recoveryCheckpoint,
      prompt: run.prompt,
      ...(run.selected === undefined ? {} : { selected: run.selected }),
      baseRevision: run.baseRevision,
      cloudBaselineCurrent: true,
    },
  };
}

function recoveryCheckpoint(project) {
  return {
    ...project,
    entities: project.entities.filter((entity) => entity.stage === "ready"),
  };
}

async function runRenderer(
  renderer,
  finalVerdict = "accept",
  twoCorrections = false,
  reviewFailure = false,
) {
  const evidenceName = twoCorrections
    ? `${renderer}-two-corrections`
    : reviewFailure
      ? `${renderer}-interrupted-review`
      : finalVerdict === "accept"
        ? renderer
        : `${renderer}-partial`;
  const args =
    renderer === "software"
      ? ["--disable-gpu"]
      : [
          "--use-gl=angle",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
        ];
  const browser = await chromium.launch({ args: ["--no-sandbox", ...args] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.addInitScript(() => {
    window.__orbsieSceneReviewFixture = {};
  });
  if (renderer === "software")
    await context.addInitScript(() => {
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
  const page = await context.newPage();
  const requests = [];
  let clientCorrelation;
  const pageErrors = [];
  const consoleErrors = [];
  const requestFailures = [];
  const unexpectedRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    requestFailures.push({
      url: request.url(),
      failure: request.failure()?.errorText ?? "unknown",
    }),
  );
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol.startsWith("http") && url.origin !== origin) {
      unexpectedRequests.push(url.href);
      await route.abort();
      return;
    }
    await route.fallback();
  });
  await context.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        accounts: false,
        publishing: false,
        google: false,
        chatgptHosted: false,
        chatgptGeneration: false,
        authoringReview: true,
      },
    }),
  );
  await context.route("**/api/trial", (route) =>
    route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } }),
  );
  await context.route("**/api/models", (route) =>
    route.fulfill({ json: { models: [] } }),
  );
  await context.route("**/api/projects", (route) =>
    route.fulfill({ json: { projects: [] } }),
  );
  await context.route("**/api/generate", async (route) => {
    const body = route.request().postDataJSON();
    requests.push({ kind: "initial", body });
    clientCorrelation = route.request().headers()["x-orbsie-client-run-id"];
    assert.match(clientCorrelation, /^[0-9a-f-]{36}$/);
    assert.equal(body.authoringReview, true);
    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        "X-Orbsie-Authoring-Run-Id": authoringRunId,
        "X-Orbsie-Review-Image-Supported": "1",
      },
      body: streamBody(),
    });
  });
  await context.route("**/api/generate/review", async (route) => {
    const body = route.request().postDataJSON();
    const phase = body.phase;
    requests.push({ kind: phase, body });
    assert.equal(
      route.request().headers()["x-orbsie-client-run-id"],
      clientCorrelation,
    );
    assert.equal(body.runId, authoringRunId);
    assert.equal(body.project.id, requests[0].body.project.id);
    assert.equal(body.reviewImage.projectId, body.project.id);
    assert.equal(body.reviewImage.revision, body.project.revision);
    assert.equal(body.structuralObservations.revision, body.project.revision);
    assert.equal(body.structuralObservations.renderer, renderer);
    const reviewOrdinal = requests.filter(
      (request) => request.kind === "review",
    ).length;
    if (reviewFailure) {
      assert.equal(phase, "review");
      await route.fulfill({
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
        body: JSON.stringify({ error: "Synthetic review failure." }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify(
        reviewReply(
          body.project,
          phase,
          finalVerdict,
          reviewOrdinal,
          twoCorrections,
        ),
      ),
    });
  });

  try {
    await page.goto(base);
    await expect(page.locator("canvas")).toBeVisible();
    await expect(
      page.locator("[data-renderer-availability=ready]"),
    ).toBeVisible();
    await page
      .getByPlaceholder("What experience to build?")
      .fill("Build a lantern");
    await expect(page.getByTestId("authoring-review-toggle")).toContainText(
      "Up to four model calls",
    );
    await page.getByRole("button", { name: "Create", exact: true }).click();
    if (reviewFailure) {
      await expect(page.locator(".authoring-activity-latest p")).toHaveText(
        "Scene saved, but review could not finish.",
        { timeout: 15_000 },
      );
      assert.equal(requests.length, 2);
      assert.equal(requests[1].kind, "review");
      const saved = await storageSnapshot(page);
      assert.equal(saved.project.revision, requests[1].body.project.revision);
      assert.deepEqual(
        saved.project.entities.map((entity) => entity.id),
        requests[1].body.project.entities.map((entity) => entity.id),
      );
      const continuation = page.getByTestId("interrupted-review-continuation");
      await expect(continuation).toBeVisible();
      await page.screenshot({
        path: `${output}/${evidenceName}-desktop.png`,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(continuation).toBeVisible();
      const continuationBounds = await continuation.boundingBox();
      assert(continuationBounds);
      assert(continuationBounds.x >= 0);
      assert(continuationBounds.x + continuationBounds.width <= 390);
      await page.screenshot({
        path: `${output}/${evidenceName}-phone.png`,
      });
      await continuation.click();
      await expect(
        page.getByRole("textbox", { name: "What experience to build?" }),
      ).toHaveValue(
        "Continue improving the saved scene based on the original request: Build a lantern",
      );
      assert.equal(
        requests.length,
        2,
        "drafting a continuation must not call the model",
      );
      await page.getByRole("button", { name: "Undo last change" }).click();
      await expect(continuation).toHaveCount(0);
      assert.equal(requests.length, 2);
      return {
        renderer,
        savedRevision: saved.project.revision,
        requestKinds: requests.map((request) => request.kind),
        draftedPrompt: `Continue improving the saved scene based on the original request: ${requests[0].body.prompt}`,
        extraRequestsAfterDraft: 0,
        continuationHiddenAfterRevisionChange: true,
      };
    }
    const terminalMessage =
      finalVerdict === "accept"
        ? "Scene verified. Changes are applied."
        : "The correction was applied; the final review still found: The lantern has no visible hanging chain.";
    await expect(page.locator(".authoring-activity-latest p")).toHaveText(
      terminalMessage,
      { timeout: 15_000 },
    );
    const finalIndex = twoCorrections ? 3 : 2;
    assert.equal(requests.length, finalIndex + 1);
    assert.equal(requests[1].kind, "review");
    if (twoCorrections) assert.equal(requests[2].kind, "review");
    assert.equal(requests[finalIndex].kind, "final-review");
    assert.equal(
      requests[2].body.project.revision > requests[1].body.project.revision,
      true,
    );
    if (twoCorrections)
      assert(
        requests[3].body.project.revision > requests[2].body.project.revision,
      );
    assert.equal(
      requests[finalIndex].body.reviewImage.revision,
      requests[finalIndex].body.project.revision,
    );
    assert.equal(requests[2].body.project.environment.sky, "#aabbff");
    const initialImageDigest = imageDigest(requests[1].body.reviewImage.image);
    const correctedImageDigest = imageDigest(
      requests[2].body.reviewImage.image,
    );
    assert.notEqual(
      initialImageDigest,
      correctedImageDigest,
      "corrected rendered revision must change the captured pixels",
    );
    const finalImageDigest = imageDigest(
      requests[finalIndex].body.reviewImage.image,
    );
    if (twoCorrections)
      assert.notEqual(
        correctedImageDigest,
        finalImageDigest,
        "second correction must change the captured pixels again",
      );
    const messageTexts = await page
      .locator(".chat-messages .message")
      .allTextContents();
    const initialCommitIndex = messageTexts.findIndex((text) =>
      text.includes("Applied."),
    );
    const correctionCommitIndex = messageTexts.findIndex((text) =>
      text.includes("Review correction applied."),
    );
    const terminalIndex = messageTexts.findIndex((text) =>
      text.includes(terminalMessage),
    );
    assert(initialCommitIndex >= 0);
    assert(correctionCommitIndex > initialCommitIndex);
    assert(terminalIndex > correctionCommitIndex);
    assert.match(
      messageTexts.at(-1) ?? "",
      new RegExp(
        finalVerdict === "accept"
          ? "Scene verified"
          : "final review still found",
      ),
    );
    const saved = await storageSnapshot(page);
    assert.equal(
      saved.project.environment.sky,
      twoCorrections ? "#88ccff" : "#aabbff",
    );
    assert.equal(
      saved.project.revision,
      requests[finalIndex].body.project.revision,
    );
    const continuation = page.getByTestId("authoring-review-continuation");
    if (finalVerdict === "revise") {
      assert(
        saved.project.messages.some(
          (message) =>
            message.text ===
            "The final review still found: The lantern has no visible hanging chain.",
        ),
      );
      await expect(continuation).toBeVisible();
      await continuation.click();
      await expect(
        page.getByRole("textbox", { name: "What experience to build?" }),
      ).toHaveValue(
        "Continue improving the scene and address this remaining review finding: The lantern has no visible hanging chain.",
      );
      assert.equal(
        requests.length,
        3,
        "drafting a continuation must not call the model",
      );
      await expect(continuation).toBeVisible();
    } else {
      await expect(continuation).toHaveCount(0);
    }

    await page.screenshot({ path: `${output}/${evidenceName}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".chat-panel")).toBeVisible();
    const reviewChoiceLayout = await page
      .getByTestId("authoring-review-toggle")
      .evaluate((element) => {
        const strong = element.querySelector("strong");
        const small = element.querySelector("small");
        if (!strong || !small) throw Error("review choice copy is incomplete");
        return {
          strongDisplay: getComputedStyle(strong).display,
          smallDisplay: getComputedStyle(small).display,
          strongBottom: strong.getBoundingClientRect().bottom,
          smallTop: small.getBoundingClientRect().top,
        };
      });
    assert.equal(reviewChoiceLayout.strongDisplay, "block");
    assert.equal(reviewChoiceLayout.smallDisplay, "block");
    assert(reviewChoiceLayout.smallTop >= reviewChoiceLayout.strongBottom);
    const bounds = await page
      .locator(".authoring-activity-message")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { x: box.x, width: box.width };
        }),
      );
    assert(bounds.every((box) => box.x >= 0 && box.x + box.width <= 390));
    if (finalVerdict === "revise") {
      const buttonBox = await continuation.boundingBox();
      assert(buttonBox);
      assert(buttonBox.x >= 0 && buttonBox.x + buttonBox.width <= 390);
    }
    await page.screenshot({ path: `${output}/${evidenceName}-phone.png` });
    assert.deepEqual(unexpectedRequests, []);
    const allowedPageErrors =
      renderer === "software"
        ? ["THREE.WebGLRenderer: Error creating WebGL context."]
        : [];
    const allowedConsoleErrors =
      renderer === "software"
        ? [
            "THREE.WebGLRenderer: THREE.WebGLRenderer: Error creating WebGL context.",
          ]
        : [];
    assert.deepEqual(pageErrors, allowedPageErrors);
    assert.deepEqual(consoleErrors, allowedConsoleErrors);
    assert(
      requestFailures.every(
        (failure) => failure.failure === "net::ERR_ABORTED",
      ),
    );
    return {
      renderer,
      finalVerdict,
      requestKinds: requests.map((request) => request.kind),
      initialRevision: requests[1].body.project.revision,
      correctedRevision: requests[finalIndex].body.project.revision,
      requestScopes: requests
        .slice(1)
        .map((request) =>
          request.body.reviewImage ? "visual+structural" : "structural-only",
        ),
      captureBytes: requests
        .slice(1)
        .map((request) => request.body.reviewImage.image.length),
      captureDigests: twoCorrections
        ? [initialImageDigest, correctedImageDigest, finalImageDigest]
        : [initialImageDigest, correctedImageDigest],
      pageErrors,
      consoleErrors,
      requestFailures,
      unexpectedRequests,
    };
  } catch (error) {
    console.error("Renderer fixture failed", {
      renderer,
      finalVerdict,
      requests: requests.map((request) => request.kind),
      activity: await page
        .locator(".authoring-activity-message")
        .allTextContents(),
      appError: await page.locator(".chat-error").allTextContents(),
      rendererAvailability: await page
        .locator("[data-renderer-availability]")
        .getAttribute("data-renderer-availability"),
      captureState: await page.evaluate(
        (kind) => window.__orbsieSceneReviewFixture?.[kind]?.read?.(),
        renderer,
      ),
      pageErrors,
      consoleErrors,
      requestFailures,
    });
    throw error;
  } finally {
    await browser.close();
  }
}

async function runSignedInJournalScenario(conflict) {
  const renderer = "software";
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.addInitScript(() => {
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
  const page = await context.newPage();
  const requests = [];
  const cloudEvents = [];
  const generationEvents = [];
  const pageErrors = [];
  const consoleErrors = [];
  const requestFailures = [];
  const unexpectedRequests = [];
  const state = {
    cloudProject: undefined,
    cloudToken: undefined,
    putCount: 0,
    conflictRead: false,
    runs: new Map(),
    latestRunId: undefined,
  };
  const initialToken = "a".repeat(64);
  const correctedToken = "b".repeat(64);
  const secondCorrectedToken = "d".repeat(64);
  const conflictToken = "c".repeat(64);
  let recovery;
  let clientCorrelation;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    requestFailures.push({
      url: request.url(),
      failure: request.failure()?.errorText ?? "unknown",
    }),
  );
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol.startsWith("http") && url.origin !== origin) {
      unexpectedRequests.push(url.href);
      await route.abort();
      return;
    }
    await route.fallback();
  });
  await context.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        accounts: true,
        publishing: false,
        google: false,
        chatgptHosted: false,
        chatgptGeneration: false,
        authoringReview: true,
      },
    }),
  );
  await context.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "fixture-user",
          name: "Fixture User",
          isAnonymous: false,
        },
      },
    }),
  );
  await context.route("**/api/trial", (route) =>
    route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } }),
  );
  await context.route("**/api/models", (route) =>
    route.fulfill({ json: { models: [] } }),
  );
  await context.route("**/api/projects**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET") {
      const id = url.searchParams.get("id");
      if (!id) {
        await route.fulfill({
          json: {
            projects: state.cloudProject
              ? [cloudProjectView(state.cloudProject, state.cloudToken)]
              : [],
          },
        });
        return;
      }
      assert.equal(id, state.cloudProject?.id);
      if (!state.cloudProject) {
        await route.fulfill({
          status: 404,
          json: { error: "World not found." },
        });
        return;
      }
      if (conflict && !state.conflictRead) {
        state.conflictRead = true;
        const concurrent = {
          ...state.cloudProject,
          revision: state.cloudProject.revision + 1,
          environment: {
            ...state.cloudProject.environment,
            sky: "#ff0000",
          },
        };
        cloudEvents.push({
          kind: "get-latest",
          revision: concurrent.revision,
          snapshotToken: conflictToken,
        });
        await route.fulfill({
          json: { project: cloudProjectView(concurrent, conflictToken) },
        });
        return;
      }
      cloudEvents.push({
        kind: "get-latest",
        revision: state.cloudProject.revision,
        snapshotToken: state.cloudToken,
      });
      await route.fulfill({
        json: {
          project: cloudProjectView(state.cloudProject, state.cloudToken),
        },
      });
      return;
    }
    assert.equal(request.method(), "PUT");
    const body = request.postDataJSON();
    state.putCount += 1;
    const putEvent = {
      kind: "put",
      count: state.putCount,
      revision: body.project.revision,
      baseRevision: body.baseRevision,
      baseSnapshotToken: body.baseSnapshotToken,
    };
    cloudEvents.push(putEvent);
    if (!state.cloudProject) {
      assert.equal(body.baseRevision, null);
      assert.equal(body.baseSnapshotToken, null);
      state.cloudProject = body.project;
      state.cloudToken = initialToken;
    } else {
      if (conflict) {
        throw Error("A conflicting correction segment attempted a second PUT.");
      }
      assert.equal(body.baseRevision, state.cloudProject.revision);
      assert.equal(body.baseSnapshotToken, state.cloudToken);
      state.cloudProject = body.project;
      state.cloudToken =
        state.putCount === 2
          ? correctedToken
          : state.putCount === 3
            ? secondCorrectedToken
            : assert.fail("A fourth signed-in cloud snapshot was unexpected.");
    }
    putEvent.snapshotToken = state.cloudToken;
    await route.fulfill({
      json: {
        revision: body.project.revision,
        snapshotToken: state.cloudToken,
        archivePending: false,
      },
    });
  });
  await context.route("**/api/generation-runs**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      const run = {
        id: body.runId,
        projectId: body.project.id,
        sequence: 0,
        state: "running",
        checkpoint: body.project,
        recoveryCheckpoint: body.project,
        prompt: body.prompt,
        selected: body.selected,
        baseRevision: body.project.revision,
      };
      state.runs.set(run.id, run);
      state.latestRunId = run.id;
      generationEvents.push({
        kind: "start",
        runId: run.id,
        projectRevision: body.project.revision,
      });
      await route.fulfill({ json: runView(run) });
      return;
    }
    if (request.method() === "PUT") {
      const body = request.postDataJSON();
      const run = state.runs.get(body.runId);
      assert(run, `unknown generation run ${body.runId}`);
      assert.equal(body.envelope.sequence, run.sequence + 1);
      run.checkpoint = applyJournalCommand(
        run.checkpoint,
        body.envelope.command,
      );
      run.recoveryCheckpoint = recoveryCheckpoint(run.checkpoint);
      run.sequence = body.envelope.sequence;
      if (body.envelope.command.type === "commit_revision")
        run.state = "complete";
      generationEvents.push({
        kind: "append",
        runId: run.id,
        sequence: run.sequence,
        command: body.envelope.command.type,
        envelopeCommand: body.envelope.command,
        checkpoint: run.checkpoint,
      });
      await route.fulfill({ json: runView(run) });
      return;
    }
    if (request.method() === "PATCH") {
      const body = request.postDataJSON();
      const run = state.runs.get(body.runId);
      assert(run);
      run.state = "cancelled";
      await route.fulfill({ json: runView(run) });
      return;
    }
    assert.equal(request.method(), "GET");
    const runId = url.searchParams.get("runId");
    const projectId = url.searchParams.get("projectId");
    const run = runId
      ? state.runs.get(runId)
      : [...state.runs.values()]
          .reverse()
          .find((entry) => entry.projectId === projectId);
    assert(run);
    generationEvents.push({
      kind: "read",
      runId: run.id,
      by: runId ? "id" : "project",
    });
    await route.fulfill({ json: runView(run) });
  });
  await context.route("**/api/generate", async (route) => {
    const body = route.request().postDataJSON();
    requests.push({ kind: "initial", body });
    clientCorrelation = route.request().headers()["x-orbsie-client-run-id"];
    assert.match(clientCorrelation, /^[0-9a-f-]{36}$/);
    assert.equal(body.authoringReview, true);
    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        "X-Orbsie-Authoring-Run-Id": authoringRunId,
        "X-Orbsie-Review-Image-Supported": "1",
      },
      body: streamBody(),
    });
  });
  await context.route("**/api/generate/review", async (route) => {
    const body = route.request().postDataJSON();
    requests.push({ kind: body.phase, body });
    assert.equal(
      route.request().headers()["x-orbsie-client-run-id"],
      clientCorrelation,
    );
    assert.equal(body.runId, authoringRunId);
    const reviewOrdinal = requests.filter(
      (request) => request.kind === "review",
    ).length;
    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify(
        reviewReply(
          body.project,
          body.phase,
          "accept",
          reviewOrdinal,
          !conflict,
        ),
      ),
    });
  });

  try {
    await page.goto(base);
    await expect(page.locator("canvas")).toBeVisible();
    await expect(
      page.locator("[data-renderer-availability=ready]"),
    ).toBeVisible();
    await page
      .getByPlaceholder("What experience to build?")
      .fill("Build a lantern");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.locator(".authoring-activity-latest p")).toHaveText(
      conflict
        ? "Scene saved, but review could not finish."
        : "Scene verified. Changes are applied.",
      { timeout: 15_000 },
    );

    const puts = cloudEvents.filter((event) => event.kind === "put");
    const latestReads = cloudEvents.filter(
      (event) => event.kind === "get-latest",
    );
    const starts = generationEvents.filter((event) => event.kind === "start");
    const appends = generationEvents.filter((event) => event.kind === "append");
    assert.equal(puts.length, conflict ? 1 : 3);
    assert.equal(latestReads.length, conflict ? 1 : 2);
    assert.equal(starts.length, conflict ? 1 : 3);
    assert.equal(appends.length, conflict ? 3 : 8);
    assert.equal(puts[0].baseRevision, null);
    if (conflict) {
      assert.equal(puts[0].baseSnapshotToken, null);
      assert.equal(requests.length, 2);
      assert.equal(latestReads[0].snapshotToken, conflictToken);
      assert.equal(
        appends.some((event) => event.runId === starts[1]?.runId),
        false,
      );
    } else {
      assert.equal(puts[1].baseRevision, puts[0].revision);
      assert.equal(puts[1].baseSnapshotToken, initialToken);
      assert.equal(puts[2].baseRevision, puts[1].revision);
      assert.equal(puts[2].baseSnapshotToken, correctedToken);
      assert.deepEqual(
        puts.map((put) => put.snapshotToken),
        [initialToken, correctedToken, secondCorrectedToken],
      );
      assert.equal(starts[0].projectRevision, puts[0].revision);
      assert.equal(starts[1].projectRevision, puts[1].revision);
      assert.equal(starts[2].projectRevision, puts[2].revision);
      assert.equal(new Set(starts.map((start) => start.runId)).size, 3);
      assert.deepEqual(
        requests.map((request) => request.kind),
        ["initial", "review", "review", "final-review"],
      );
      assert.deepEqual(
        requests.slice(1).map((request) => request.body.project.revision),
        [3, 6, 8],
      );
      assert.deepEqual(
        latestReads.map((read) => read.snapshotToken),
        [initialToken, correctedToken],
      );
      assert.deepEqual(
        appends
          .filter((event) => event.runId === starts[0].runId)
          .map((event) => event.sequence),
        [1, 2, 3],
      );
      assert.deepEqual(
        appends
          .filter((event) => event.runId === starts[1].runId)
          .map((event) => event.sequence),
        [1, 2, 3],
      );
      assert.deepEqual(
        appends
          .filter((event) => event.runId === starts[2].runId)
          .map((event) => event.sequence),
        [1, 2],
      );

      await page.reload();
      await expect(page.locator("canvas")).toBeVisible();
      await page
        .getByRole("button", { name: "Continue your saved world" })
        .click();
      await expect(
        page.getByRole("button", { name: "Your account and cloud worlds" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Your account and cloud worlds" })
        .click();
      await expect(
        page.getByRole("button", { name: "Recover latest generation" }),
      ).toBeVisible({ timeout: 10_000 });
      await page
        .getByRole("button", { name: "Recover latest generation" })
        .click();
      await expect(
        page.getByText(
          "Recovered the completed generation. Save it to your account when ready.",
          { exact: true },
        ),
      ).toBeVisible({ timeout: 15_000 });
      const recovered = await storageSnapshot(page);
      assert.equal(recovered.project.revision, 8);
      assert.equal(recovered.project.environment.sky, "#88ccff");
      assert.equal(recovered.project.entities[0].color, "#ff4b9e");
      const readsAfterReload = generationEvents.filter(
        (event) => event.kind === "read",
      );
      assert.deepEqual(
        readsAfterReload.map((event) => event.by),
        ["project", "id"],
      );
      assert.equal(
        cloudEvents.filter((event) => event.kind === "get-latest").length,
        3,
      );
      assert.equal(puts.length, 3);
      assert.equal(state.runs.get(starts[2].runId).state, "complete");
      recovery = {
        projectRevision: recovered.project.revision,
        sky: recovered.project.environment.sky,
        lanternColor: recovered.project.entities[0].color,
        generationRunId: starts[2].runId,
        generationRunState: state.runs.get(starts[2].runId).state,
      };
    }
    assert.deepEqual(unexpectedRequests, []);
    assert.deepEqual(
      pageErrors,
      Array.from(
        { length: conflict ? 1 : 2 },
        () => "THREE.WebGLRenderer: Error creating WebGL context.",
      ),
    );
    assert.deepEqual(
      consoleErrors,
      Array.from(
        { length: conflict ? 1 : 2 },
        () =>
          "THREE.WebGLRenderer: THREE.WebGLRenderer: Error creating WebGL context.",
      ),
    );
    assert(
      requestFailures.every(
        (failure) => failure.failure === "net::ERR_ABORTED",
      ),
    );
    return {
      conflict,
      requests: requests.map((request) => request.kind),
      reviewedRevisions: requests
        .slice(1)
        .map((request) => request.body.project.revision),
      cloudPuts: puts,
      cloudReads: cloudEvents.filter((event) => event.kind === "get-latest"),
      ...(recovery ? { recoveredFinalScene: recovery } : {}),
      generationStarts: starts,
      journalSegments: starts.map((start) => ({
        runId: start.runId,
        projectRevision: start.projectRevision,
        sequences: appends
          .filter((event) => event.runId === start.runId)
          .map((event) => event.sequence),
      })),
      generationAppends: appends.map((event) => ({
        runId: event.runId,
        sequence: event.sequence,
        command: event.command,
      })),
      pageErrors,
      consoleErrors,
      requestFailures,
    };
  } finally {
    await browser.close();
  }
}

const report = {
  passed: false,
  scope: "deterministic browser authoring review loop with real canvas capture",
  liveModelCalls: 0,
  renderers: {},
  secondCorrection: {},
  partialReview: {},
  failedReview: {},
  signedInJournal: {},
};
try {
  if (process.env.AUTHORING_REVIEW_FAILURE_ONLY === "1") {
    report.failedReview = await runRenderer("software", "accept", false, true);
  } else {
    report.renderers.webgl = await runRenderer("webgl");
    report.renderers.software = await runRenderer("software");
    report.secondCorrection.software = await runRenderer(
      "software",
      "accept",
      true,
    );
    report.partialReview.software = await runRenderer("software", "revise");
    report.failedReview.software = await runRenderer(
      "software",
      "accept",
      false,
      true,
    );
    report.signedInJournal.success = await runSignedInJournalScenario(false);
    report.signedInJournal.conflict = await runSignedInJournalScenario(true);
  }
  report.passed = true;
} finally {
  await writeFile(
    `${output}/report.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
assert.equal(report.passed, true);
console.log(`Authoring review fixture passed: ${output}`);
