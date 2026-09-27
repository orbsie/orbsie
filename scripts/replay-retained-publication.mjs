#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
import {
  assertFlagshipStoryCreation,
  assertPublicationArtifactRecordsMatch,
  assertPublicationProjectMatches,
  assertPublicationWorldContentMatches,
  captureCurrentTargetArtifacts,
  emptyReport,
  installTrafficGuard,
  openFlagshipResumeProject,
  parseExportedZipBytes,
  runPublication,
  seedFlagshipProject,
} from "./provider-browser-e2e.mjs";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRIVATE_ROOT = resolve(homedir(), ".cache/orbsie/provider-tests");
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function inside(parent, target) {
  const path = relative(parent, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseOptions(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--help" || name === "-h") return { help: true };
    assert(name.startsWith("--"), `Unexpected argument: ${name}`);
    assert(!values.has(name), `Repeated argument: ${name}`);
    const value = argv[index + 1];
    assert(value && !value.startsWith("--"), `${name} needs a value.`);
    values.set(name, value);
    index += 1;
  }
  const expected = [
    "--raw-report",
    "--zip",
    "--zip-sha256",
    "--ancestor-project",
    "--ancestor-sha256",
    "--storage-state",
    "--app-url",
    "--evidence-dir",
    "--summary",
  ];
  const allowed = new Set([...expected, "--resume-existing-cas"]);
  assert.deepEqual(
    [...values.keys()].filter((key) => expected.includes(key)).sort(),
    [...expected].sort(),
    `Required options: ${expected.join(", ")}`,
  );
  for (const key of values.keys())
    assert(allowed.has(key), `Unexpected argument: ${key}`);
  assert(
    !values.has("--resume-existing-cas") ||
      values.get("--resume-existing-cas") === "1",
    "--resume-existing-cas must be set to 1.",
  );
  return Object.fromEntries(
    [...values].map(([key, value]) => [
      key.slice(2).replaceAll("-", ""),
      value,
    ]),
  );
}

export function validateRetainedLiveReport(
  report,
  project,
  actualZipSha256,
  expectedZipSha256,
) {
  assert.match(actualZipSha256, SHA256_PATTERN, "ZIP hash is malformed.");
  assert.match(
    expectedZipSha256,
    SHA256_PATTERN,
    "Expected ZIP hash is malformed.",
  );
  assert.equal(
    actualZipSha256,
    expectedZipSha256,
    "Retained ZIP hash mismatch.",
  );
  assert.equal(
    report?.provider,
    "openrouter",
    "Source report is not OpenRouter.",
  );
  assert.equal(report?.model, "openai/gpt-6-luna", "Source model mismatch.");
  assert.equal(report?.reasoning, "low", "Source reasoning mode mismatch.");
  assert.equal(report?.serviceTier, "default", "Source service tier mismatch.");
  assert.equal(report?.outputCapTokens, 4096, "Source output cap mismatch.");
  assert.equal(
    report?.generationBudget,
    3,
    "Source generation budget mismatch.",
  );
  assert.equal(
    report?.traffic?.generationRequests,
    3,
    "Source call count mismatch.",
  );
  assert.deepEqual(
    report?.traffic?.generationStatuses,
    [200, 200, 200],
    "Source generation did not complete in three successful calls.",
  );
  assert.equal(report?.traffic?.interceptedGeneration, false);
  assert.equal(report?.fallbackUsed, false, "Source report used a fallback.");
  const projectId = project?.id;
  assert.equal(typeof projectId, "string", "ZIP project has no ID.");
  assert(
    Number.isSafeInteger(project?.revision),
    "ZIP project has no revision.",
  );
  assert.equal(report?.creation?.status, "passed");
  assert.equal(report?.creation?.gameplayDuringGeneration?.status, "passed");
  assert(
    report.creation.gameplayDuringGeneration.generationRequestsAtMovement ===
      1 &&
      report.creation.gameplayDuringGeneration.generationResponsesAtMovement ===
        1 &&
      report.creation.gameplayDuringGeneration
        .generationStreamOpenAtMovement === true &&
      report.creation.gameplayDuringGeneration
        .generationStreamOpenAfterMovement === true &&
      report.creation.gameplayDuringGeneration.movementDistance > 0.1 &&
      report.creation.gameplayDuringGeneration.projectId === projectId &&
      report.creation.gameplayDuringGeneration.before?.projectId ===
        projectId &&
      report.creation.gameplayDuringGeneration.after?.projectId === projectId &&
      report.creation.gameplayDuringGeneration.before?.revision ===
        report.creation.gameplayDuringGeneration.revisionBefore &&
      report.creation.gameplayDuringGeneration.after?.revision ===
        report.creation.gameplayDuringGeneration.revisionAfter &&
      report.creation.gameplayDuringGeneration.revisionAfter >
        report.creation.gameplayDuringGeneration.revisionBefore &&
      hasPlayerMovement(
        report.creation.gameplayDuringGeneration.before?.player?.position,
        report.creation.gameplayDuringGeneration.after?.player?.position,
      ),
    "Source report does not bind movement to the open creation stream.",
  );
  assert.equal(report?.edit?.status, "passed");
  assert.equal(report?.edit?.type, "flagship-story");
  assert.equal(report?.edit?.selectedIdPreserved, true);
  const story = report?.flagshipStory;
  assert.equal(story?.status, "passed");
  assert.equal(story?.scope, "fresh-gameplay-and-persistence");
  assert.equal(story?.generationBudget, 3);
  const phaseKeys = ["creation", "mushroom", "goal7", "undo"];
  for (const key of phaseKeys)
    assert(story.phases?.[key], `Source report is missing the ${key} phase.`);
  assert.equal(story.phases.undo.revision, project.revision);
  assert.equal(
    project.revision,
    42,
    "Retained source is not the expected revision 42.",
  );
  const finalTargets = assertFlagshipStoryCreation(project);
  const finalCollectibleIds = finalTargets.collectibles
    .map((entity) => entity.id)
    .sort();
  const finalPlatformIds = finalTargets.platforms
    .map((entity) => entity.id)
    .sort();
  const finalPortalId = finalTargets.portal.id;
  const mushroomTargetId = story.phases.mushroom.targetId;
  assert.equal(typeof mushroomTargetId, "string");
  assert(
    project.entities.some((entity) => entity.id === mushroomTargetId),
    "Mushroom edit target is absent from the retained project.",
  );

  let previousRevision = -1;
  const expectedCounts = { creation: 5, mushroom: null, goal7: 7, undo: 5 };
  for (const key of phaseKeys) {
    const phase = story.phases[key];
    assert.equal(
      key === "creation" ? report.creation.status : phase.status,
      "passed",
      `Source ${key} phase did not pass.`,
    );
    assert(
      Number.isSafeInteger(phase.revision),
      `Source ${key} has no revision.`,
    );
    assert(
      phase.revision > previousRevision,
      "Source phases are not revision ordered.",
    );
    previousRevision = phase.revision;
    if (key === "mushroom") continue;
    const gameplay = phase.gameplay;
    assert.equal(
      gameplay?.status,
      "passed",
      `Source ${key} gameplay did not pass.`,
    );
    assert.equal(
      gameplay.projectId,
      projectId,
      `Source ${key} changed project ID.`,
    );
    assert.equal(
      gameplay.revision,
      phase.revision,
      `Source ${key} gameplay revision mismatch.`,
    );
    const expectedCount = expectedCounts[key];
    assert.equal(
      new Set(gameplay.expectedCollectibleIds ?? []).size,
      expectedCount,
      `Source ${key} has duplicate crystal target IDs.`,
    );
    assert.equal(
      new Set(gameplay.collectedIds ?? []).size,
      expectedCount,
      `Source ${key} has duplicate collected crystal IDs.`,
    );
    assert.equal(
      gameplay.expectedCollectibleIds?.length,
      expectedCount,
      `Source ${key} collectible target count mismatch.`,
    );
    assert.equal(gameplay.collectedIds?.length, expectedCount);
    assert.deepEqual(
      [...gameplay.collectedIds].sort(),
      [...gameplay.expectedCollectibleIds].sort(),
      `Source ${key} did not collect its expected crystals.`,
    );
    if (expectedCount === 5)
      assert.deepEqual(
        [...gameplay.expectedCollectibleIds].sort(),
        finalCollectibleIds,
        `Source ${key} changed the retained five-crystal set.`,
      );
    if (expectedCount === 7) {
      const expected = [...gameplay.expectedCollectibleIds].sort();
      assert(
        finalCollectibleIds.every((id) => expected.includes(id)) &&
          expected.filter((id) => !finalCollectibleIds.includes(id)).length ===
            2,
        "Source goal-seven phase is not the retained five crystals plus two additions.",
      );
    }
    assert.equal(gameplay.won, true);
    assert.equal(gameplay.score, expectedCount);
    assert.equal(gameplay.win?.projectId, projectId);
    assert.equal(gameplay.win?.revision, phase.revision);
    assert.equal(gameplay.win?.status, "won");
    assert.equal(gameplay.win?.score, expectedCount);
    assert.equal(gameplay.win?.portalId, finalPortalId);
    assert((gameplay.contacts ?? []).includes(gameplay.win.portalId));
    const reset = gameplay.reset;
    assert.equal(reset?.projectId, projectId);
    assert.equal(reset?.revision, phase.revision);
    assert.equal(reset?.status, "playing");
    assert.equal(reset?.score, 0);
    assert.equal(reset?.lifecycleAdvanced, true);
    assert(
      Array.isArray(gameplay.platformEvidence) &&
        gameplay.platformEvidence.length === 3 &&
        deepEqualSorted(
          gameplay.platformEvidence.map((platform) => platform.id),
          finalPlatformIds,
        ) &&
        gameplay.platformEvidence.every(
          (platform) =>
            platform.behavior === "bounce" &&
            platform.bounceFrames > 0 &&
            (platform.groundedFrames > 0 || platform.bounceFrames > 0) &&
            Number.isFinite(platform.maximumDisplacement) &&
            platform.maximumDisplacement >= 0.05,
        ),
      `Source ${key} lacks three moving/bouncy platform contacts.`,
    );
    const before = gameplay.movement?.before;
    const after = gameplay.movement?.after;
    assert.equal(before?.projectId, projectId);
    assert.equal(after?.projectId, projectId);
    assert.equal(before?.revision, phase.revision);
    assert.equal(after?.revision, phase.revision);
    assert(
      hasPlayerMovement(before?.player?.position, after?.player?.position) &&
        gameplay.movement.distance > 0.1,
      `Source ${key} lacks bound player movement evidence.`,
    );
  }
  assert.equal(previousRevision, project.revision);
  assert.equal(report.export, "blocked");
  assert.match(
    report.error ?? "",
    /Exported project changed the published world content/,
    "Source report does not identify the retained export mismatch.",
  );
  return {
    provider: "openrouter",
    model: "openai/gpt-6-luna",
    calls: 3,
    statuses: [200, 200, 200],
    fallbackUsed: false,
    scope: "fresh-gameplay-and-persistence",
    projectRevision: project.revision,
    phases: Object.fromEntries(
      phaseKeys.map((key) => [key, story.phases[key].revision]),
    ),
    zipSha256: actualZipSha256,
  };
}

function deepEqualSorted(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
  );
}

export function prepareCASContinuationProject({
  ancestor,
  cloudRecord,
  retainedProject,
}) {
  assert.equal(
    ancestor?.revision,
    35,
    "Captured mushroom ancestor revision mismatch.",
  );
  assert.equal(
    retainedProject?.revision,
    42,
    "Retained ZIP revision mismatch.",
  );
  assert.equal(
    ancestor?.id,
    retainedProject?.id,
    "Ancestor and ZIP project IDs differ.",
  );
  assert.equal(
    cloudRecord?.id,
    ancestor.id,
    "Cloud project ID differs from the ancestor.",
  );
  assert.equal(
    cloudRecord?.revision,
    ancestor.revision,
    "Cloud project revision differs from the ancestor.",
  );
  assert.match(
    cloudRecord?.snapshotToken ?? "",
    SHA256_PATTERN,
    "Cloud ancestor has no valid snapshot token.",
  );
  assertPublicationProjectMatches(
    cloudRecord?.snapshot,
    ancestor,
    "Cloud mushroom ancestor",
  );
  assertPublicationWorldContentMatches(
    retainedProject,
    ancestor,
    "Retained ZIP ancestor comparison",
  );
  assert.equal(
    retainedProject.messages?.length,
    0,
    "Retained ZIP must have no messages.",
  );
  assert(
    Array.isArray(ancestor.messages),
    "Captured ancestor transcript is malformed.",
  );
  assert(
    Array.isArray(cloudRecord.snapshot.messages),
    "Cloud transcript is malformed.",
  );
  assert.equal(
    ancestor.messages.length,
    4,
    "Captured ancestor transcript length mismatch.",
  );
  assert.equal(
    cloudRecord.snapshot.messages.length,
    5,
    "Cloud transcript length mismatch.",
  );
  assert.deepEqual(
    cloudRecord.snapshot.messages.slice(0, ancestor.messages.length),
    ancestor.messages,
    "Cloud transcript does not preserve the captured ancestor prefix.",
  );
  const project = {
    ...retainedProject,
    messages: structuredClone(cloudRecord.snapshot.messages),
  };
  assert.equal(project.revision, 42);
  assert.equal(project.messages.length, cloudRecord.snapshot.messages.length);
  return {
    project,
    baseRevision: cloudRecord.revision,
    baseSnapshotToken: cloudRecord.snapshotToken,
    ancestorRevision: ancestor.revision,
    ancestorMessageCount: ancestor.messages.length,
    cloudMessageCount: cloudRecord.snapshot.messages.length,
  };
}

export function prepareExistingCASContinuationProject({
  ancestor,
  cloudRecord,
  retainedProject,
}) {
  assert.equal(
    ancestor?.revision,
    35,
    "Captured mushroom ancestor revision mismatch.",
  );
  assert.equal(
    retainedProject?.revision,
    42,
    "Retained ZIP revision mismatch.",
  );
  assert.equal(
    ancestor?.id,
    retainedProject?.id,
    "Ancestor and ZIP project IDs differ.",
  );
  assert.equal(
    cloudRecord?.id,
    ancestor.id,
    "Cloud project ID differs from the ancestor.",
  );
  assert.equal(
    cloudRecord?.revision,
    42,
    "Existing CAS cloud revision mismatch.",
  );
  assert.match(
    cloudRecord?.snapshotToken ?? "",
    SHA256_PATTERN,
    "Existing CAS cloud snapshot token is missing.",
  );
  assertPublicationProjectMatches(
    cloudRecord?.snapshot,
    retainedProject,
    "Existing CAS cloud snapshot",
  );
  assert.equal(
    retainedProject.messages?.length,
    0,
    "Retained ZIP must have no messages.",
  );
  assert(
    Array.isArray(ancestor.messages),
    "Captured ancestor transcript is malformed.",
  );
  assert(
    Array.isArray(cloudRecord.snapshot.messages),
    "Cloud transcript is malformed.",
  );
  assert.equal(
    ancestor.messages.length,
    4,
    "Captured ancestor transcript length mismatch.",
  );
  assert.equal(
    cloudRecord.snapshot.messages.length,
    5,
    "Cloud transcript length mismatch.",
  );
  assert.deepEqual(
    cloudRecord.snapshot.messages.slice(0, ancestor.messages.length),
    ancestor.messages,
    "Cloud transcript does not preserve the captured ancestor prefix.",
  );
  return {
    project: {
      ...retainedProject,
      messages: structuredClone(cloudRecord.snapshot.messages),
    },
    baseRevision: cloudRecord.revision,
    baseSnapshotToken: cloudRecord.snapshotToken,
    ancestorRevision: ancestor.revision,
    ancestorMessageCount: ancestor.messages.length,
    cloudMessageCount: cloudRecord.snapshot.messages.length,
  };
}

async function openCloudBaselineInUI(page, project) {
  await page
    .getByRole("button", { name: "Close dialog", exact: true })
    .click()
    .catch(() => undefined);
  const account = page.getByRole("button", {
    name: "Your account and cloud worlds",
    exact: true,
  });
  await expect(account).toBeVisible({ timeout: 30000 });
  await account.click();
  const escapedTitle = project.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cloudCopy = page.getByRole("button", {
    name: new RegExp(
      `${escapedTitle}[\\s\\S]*Revision ${project.revision} · Cloud`,
    ),
  });
  await expect(cloudCopy).toBeVisible({ timeout: 30000 });
  await cloudCopy.click();
  await expect(page.locator(".workspace-heading h2")).toContainText(
    project.title,
    { timeout: 30000 },
  );
  const opened = await storageSnapshot(page);
  assertPublicationProjectMatches(
    opened.project,
    project,
    "UI-opened cloud baseline",
  );
  assert.deepEqual(
    opened.project.messages,
    project.messages,
    "UI-opened cloud baseline changed the preserved transcript.",
  );
  return true;
}

function hasPlayerMovement(before, after) {
  return (
    Array.isArray(before) &&
    Array.isArray(after) &&
    before.length === 3 &&
    after.length === 3 &&
    before.every(Number.isFinite) &&
    after.every(Number.isFinite) &&
    before.some((coordinate, index) => coordinate !== after[index])
  );
}

function helpText() {
  return `Usage: node scripts/replay-retained-publication.mjs \\
  --raw-report PRIVATE.json --zip PRIVATE.zip --zip-sha256 SHA256 \\
  --ancestor-project PRIVATE.json --ancestor-sha256 SHA256 \\
  --storage-state PRIVATE.json --app-url http://127.0.0.1:3055 \\
  --evidence-dir PRIVATE-NEW-CACHE-DIR --summary docs/evidence/.../report.json \\
  [--resume-existing-cas 1]

Run from the repository root. By default, this compares the captured ancestor
with the current cloud snapshot, preserves its message tail in one CAS save,
then opens that baseline in Orbsie and performs one UI cloud save/publish. With
--resume-existing-cas 1, it verifies an existing revision-42 snapshot and
skips the direct CAS write. It never loads provider credentials or calls
models; both same-origin generation routes are aborted and counted. A failed
CAS or publish is not retried.
`;
}

async function assertPrivateFile(path, label) {
  const resolved = resolve(path);
  assert(
    inside(PRIVATE_ROOT, resolved),
    `${label} must be under the private provider-test cache.`,
  );
  const details = await lstat(resolved);
  assert(
    details.isFile() && !details.isSymbolicLink(),
    `${label} must be a regular file.`,
  );
  assert.equal(details.mode & 0o777, 0o600, `${label} must have mode 0600.`);
  return resolved;
}

async function readPrivateJSON(path, label) {
  const resolved = await assertPrivateFile(path, label);
  return JSON.parse(await readFile(resolved, "utf8"));
}

function validateStorageState(value) {
  const state = value?.storageState;
  assert(
    state && typeof state === "object",
    "Account state envelope is missing.",
  );
  assert(Array.isArray(state.cookies), "Account state cookies are malformed.");
  assert(Array.isArray(state.origins), "Account state origins are malformed.");
  assert(
    state.cookies.some(
      (cookie) =>
        typeof cookie?.name === "string" &&
        typeof cookie?.value === "string" &&
        typeof cookie?.domain === "string" &&
        cookie.domain.includes("127.0.0.1"),
    ),
    "Account state has no loopback session cookie.",
  );
  return state;
}

function validateAppUrl(value) {
  const url = new URL(value);
  assert.equal(url.protocol, "http:", "App URL must use local HTTP.");
  assert(
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
    "App URL must point to loopback.",
  );
  return url.origin;
}

async function requireFreshEvidenceDirectory(path) {
  const resolved = resolve(path);
  assert(
    inside(PRIVATE_ROOT, resolved),
    "Private evidence must stay in the provider-test cache.",
  );
  await mkdir(dirname(resolved), { recursive: true, mode: 0o700 });
  await mkdir(resolved, { mode: 0o700 });
  const details = await lstat(resolved);
  assert(details.isDirectory() && !details.isSymbolicLink());
  assert.equal(
    details.mode & 0o777,
    0o700,
    "Private evidence directory must have mode 0700.",
  );
  return resolved;
}

function validateSummaryPath(path) {
  const resolved = resolve(path);
  const evidenceRoot = resolve(REPO_ROOT, "docs/evidence");
  assert(
    isAbsolute(resolved) && inside(evidenceRoot, resolved),
    "Summary must be a new file under docs/evidence.",
  );
  return resolved;
}

async function appPreflight(appOrigin) {
  const response = await fetch(new URL("/api/config", appOrigin), {
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  assert(response.ok, `Local app config returned HTTP ${response.status}.`);
  const config = await response.json();
  assert.equal(config.accounts, true, "Local app accounts are disabled.");
  assert.equal(config.publishing, true, "Local app publishing is disabled.");
  assert.equal(
    config.generationMaxTokens,
    4096,
    "Local app token cap differs from the reviewed build.",
  );
  return { accounts: true, publishing: true, generationMaxTokens: 4096 };
}

export function summarizePublication(report, liveBinding, continuation = {}) {
  const deployment = report.publicationDeployment ?? { status: "not-started" };
  const publication = report.publication ?? { status: "not-started" };
  const gameplay = publication.gameplay;
  return {
    schemaVersion: 1,
    runType: report.zeroCASResume
      ? "offline-zero-CAS-resume-from-revision42-not-original-live-browser-session"
      : "offline-cas-assisted-continuation-not-original-live-browser-session",
    checkedAt: new Date().toISOString(),
    status:
      ["READY", "verified"].includes(report.directCloudCASave?.status) &&
      continuation.cloudBaselineOpenedInUI === true &&
      continuation.publicationSaveUsedCloudBaseline === true &&
      report.cloudSave?.status === "READY" &&
      deployment.status === "READY" &&
      publication.status === "READY" &&
      Boolean(report.publicationTraffic) &&
      report.publicationTraffic?.generationRequests?.length === 0 &&
      report.publicationTraffic?.blockedGenerationRequests?.length === 0 &&
      report.publicationTraffic?.editorProviderRequests?.length === 0 &&
      report.publicationTraffic?.blockedExternalRequests === 0 &&
      report.signedInGenerationRequests?.length === 0 &&
      report.signedInBlockedGenerationRequests?.length === 0
        ? "passed"
        : "incomplete",
    source: liveBinding,
    localTarget: report.localTarget ?? null,
    continuation: {
      mode: report.zeroCASResume
        ? "zero-direct-cas-resume-from-revision42"
        : "direct-cloud-cas-then-ui-publication",
      ancestorRevision: continuation.ancestorRevision ?? null,
      ancestorMessageCount: continuation.ancestorMessageCount ?? null,
      cloudMessageCount: continuation.cloudMessageCount ?? null,
      messagesPreserved: continuation.messagesPreserved === true,
      directCloudCASave: report.directCloudCASave ?? { status: "not-started" },
      cloudBaselineOpenedInUI: continuation.cloudBaselineOpenedInUI === true,
      publicationSaveUsedCloudBaseline:
        continuation.publicationSaveUsedCloudBaseline === true,
      failurePhase: report.continuationFailurePhase ?? null,
    },
    cloudSave: report.cloudSave ?? { status: "not-started" },
    signedInTraffic: {
      generationAttempts: report.signedInGenerationRequests?.length ?? null,
      blockedGenerationAttempts:
        report.signedInBlockedGenerationRequests?.length ?? null,
    },
    deployment: {
      mode: deployment.mode ?? "real",
      status: deployment.status ?? "not-started",
      httpStatus: deployment.httpStatus ?? null,
      deploymentUrl: deployment.deploymentUrl ?? null,
    },
    signedOutPlayback: {
      status: publication.status ?? "not-started",
      mode: publication.mode ?? "not-started",
      deploymentStatus: publication.deploymentStatus ?? null,
      revision: Number.isSafeInteger(publication.revision)
        ? publication.revision
        : null,
      signedOut: publication.signedOut === true,
      trafficStatus: report.publicationTraffic ? "observed" : "not-run",
      gameplay: gameplay
        ? {
            status: gameplay.status,
            surface: gameplay.surface,
            inputMode: gameplay.inputMode,
            expectedCollectibleCount: gameplay.expectedCollectibleCount,
            collectedCount: gameplay.collectedIds?.length ?? 0,
            won: gameplay.won === true,
            score: gameplay.score,
            platformContacts:
              gameplay.platformEvidence?.filter(
                (platform) =>
                  platform.groundedFrames > 0 || platform.bounceFrames > 0,
              ).length ?? 0,
            movingPlatforms:
              gameplay.platformEvidence?.filter(
                (platform) => platform.maximumDisplacement >= 0.05,
              ).length ?? 0,
            bouncyPlatforms:
              gameplay.platformEvidence?.filter(
                (platform) =>
                  platform.behavior === "bounce" && platform.bounceFrames > 0,
              ).length ?? 0,
            reset: gameplay.reset
              ? {
                  status: gameplay.reset.status,
                  score: gameplay.reset.score,
                  lifecycleAdvanced: gameplay.reset.lifecycleAdvanced === true,
                }
              : null,
            failureEvidenceRecorded: Boolean(gameplay.failureEvidence),
          }
        : null,
      editorProviderRequests:
        report.publicationTraffic?.editorProviderRequests ?? null,
      generationAttempts: report.publicationTraffic?.generationRequests ?? null,
      blockedGenerationAttempts:
        report.publicationTraffic?.blockedGenerationRequests ?? null,
      blockedExternalRequests:
        report.publicationTraffic?.blockedExternalRequests ?? null,
    },
    limitations: [
      "This is a zero-model-call CAS-assisted offline continuation; it does not prove uninterrupted browser continuity from the live authoring session.",
    ],
  };
}

async function getCloudProject(page, projectId) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/projects?id=${encodeURIComponent(id)}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    let body = {};
    try {
      body = await response.json();
    } catch {
      // Status and required project shape below report malformed responses.
    }
    return {
      status: response.status,
      project: body?.project ?? null,
      snapshotToken:
        typeof body?.project?.snapshotToken === "string"
          ? body.project.snapshotToken
          : null,
    };
  }, projectId);
}

async function putCloudProject(page, project, baseRevision, baseSnapshotToken) {
  return page.evaluate(
    async ({
      project: candidate,
      baseRevision: revision,
      baseSnapshotToken: token,
    }) => {
      const response = await fetch("/api/projects", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: candidate,
          baseRevision: revision,
          baseSnapshotToken: token,
        }),
      });
      let body = {};
      try {
        body = await response.json();
      } catch {
        // The caller records no response body or token.
      }
      return {
        status: response.status,
        revision: Number.isSafeInteger(body?.revision) ? body.revision : null,
        snapshotTokenPresent:
          typeof body?.snapshotToken === "string" &&
          /^[a-f0-9]{64}$/.test(body.snapshotToken),
        conflictPresent: Boolean(body?.conflict),
      };
    },
    { project, baseRevision, baseSnapshotToken },
  );
}

export async function replayRetainedPublication(options) {
  assert.equal(
    resolve("."),
    REPO_ROOT,
    "Run this command from the repository root.",
  );
  const summaryPath = validateSummaryPath(options.summary);
  const appOrigin = validateAppUrl(options.appurl);
  const zipPath = await assertPrivateFile(options.zip, "Retained ZIP");
  const reportPath = await assertPrivateFile(
    options.rawreport,
    "Retained source report",
  );
  const storageStatePath = await assertPrivateFile(
    options.storagestate,
    "Synthetic account state",
  );
  const ancestorPath = await assertPrivateFile(
    options.ancestorproject,
    "Captured mushroom ancestor project",
  );
  const evidenceDir = await requireFreshEvidenceDirectory(options.evidencedir);
  const [zipBytes, sourceReport, storageEnvelope, ancestorBytes] =
    await Promise.all([
      readFile(zipPath),
      readPrivateJSON(reportPath, "Retained source report"),
      readPrivateJSON(storageStatePath, "Synthetic account state"),
      readFile(ancestorPath),
    ]);
  const actualZipSha256 = digest(zipBytes);
  const liveBindingHash = digest(await readFile(reportPath));
  const actualAncestorSha256 = digest(ancestorBytes);
  assert.equal(
    actualAncestorSha256,
    options.ancestorsha256,
    "Captured mushroom ancestor hash mismatch.",
  );
  const ancestor = JSON.parse(ancestorBytes.toString("utf8"));
  const state = validateStorageState(storageEnvelope);
  const parsed = parseExportedZipBytes(zipBytes, {}, 42);
  const liveBinding = validateRetainedLiveReport(
    sourceReport,
    parsed.project,
    actualZipSha256,
    options.zipsha256,
  );
  liveBinding.sourceReportSha256 = liveBindingHash;
  assert.equal(
    ancestor.revision,
    35,
    "Captured mushroom ancestor revision mismatch.",
  );
  assert.equal(
    ancestor.id,
    parsed.project.id,
    "Ancestor and ZIP project IDs differ.",
  );
  assertPublicationWorldContentMatches(
    parsed.project,
    ancestor,
    "Retained ZIP ancestor comparison",
  );
  assert.equal(
    parsed.project.messages?.length,
    0,
    "Retained ZIP must have no messages.",
  );
  assert.equal(
    ancestor.messages?.length,
    4,
    "Captured ancestor transcript length mismatch.",
  );
  liveBinding.ancestorProjectSha256 = actualAncestorSha256;
  const target = await appPreflight(appOrigin);
  const targetArtifacts = await captureCurrentTargetArtifacts({
    appOrigin,
    approvedOrigins: new Set([appOrigin]),
  });
  try {
    assertPublicationArtifactRecordsMatch(
      parsed.publicationArtifacts,
      targetArtifacts,
    );
  } catch {
    throw new Error(
      "Local player artifact bytes do not match the retained ZIP; no account or publication action was started.",
    );
  }
  const report = emptyReport({
    provider: "openrouter",
    expectedModel: "openai/gpt-6-luna",
    baseOrigin: appOrigin,
    keyScope: "local-only",
    outputCap: 4096,
    generationBudget: 0,
    flagshipStory: true,
    publication: true,
    viewportMode: "desktop",
  });
  report.offlineContinuation = true;
  report.localTarget = target;
  report.export = "retained-private-zip-validated";
  report.standalonePlayback = "not-replayed-in-this-publication-continuation";
  const evidence = {
    generationRequests: [],
    blockedGenerationRequests: [],
    blockGenerationRequests: true,
    blockedExternalRequests: 0,
    blockedExternalOrigins: new Set(),
    interceptedGeneration: false,
  };
  const config = {
    provider: "openrouter",
    expectedModel: "openai/gpt-6-luna",
    baseOrigin: appOrigin,
    keyScope: "local-only",
    outputCap: 4096,
    generationBudget: 0,
    flagshipStory: true,
    publication: true,
    flagshipResume: false,
  };
  const browser = await chromium.launch({ headless: true });
  let context;
  let page;
  const actualGenerationRequests = [];
  const continuation = {
    ancestorRevision: ancestor.revision,
    ancestorMessageCount: ancestor.messages.length,
    cloudMessageCount: null,
    messagesPreserved: false,
    cloudBaselineOpenedInUI: false,
    publicationSaveUsedCloudBaseline: false,
  };
  let phase = "browser-setup";
  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      storageState: state,
    });
    const approvedOrigins = new Set([appOrigin]);
    await installTrafficGuard(context, config, approvedOrigins, evidence);
    page = await context.newPage();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.origin === appOrigin &&
        ["/api/generate", "/api/chatgpt/generate"].includes(url.pathname)
      )
        actualGenerationRequests.push(url.pathname);
    });
    await page.goto(appOrigin, { waitUntil: "domcontentloaded" });
    phase = "initial-cloud-read";
    const initialCloud = await getCloudProject(page, parsed.project.id);
    assert.equal(initialCloud.status, 200, "Authenticated cloud GET failed.");
    const resumeExistingCAS = options.resumeexistingcas === "1";
    let candidate = resumeExistingCAS
      ? prepareExistingCASContinuationProject({
          ancestor,
          cloudRecord: initialCloud.project,
          retainedProject: parsed.project,
        })
      : prepareCASContinuationProject({
          ancestor,
          cloudRecord: initialCloud.project,
          retainedProject: parsed.project,
        });
    if (resumeExistingCAS) {
      report.zeroCASResume = true;
      report.directCloudCASave = {
        mode: "verified-existing-revision42-no-direct-cas-write",
        status: "verified",
        writePerformed: false,
        revision: initialCloud.project.revision,
        snapshotMatchedRetainedZip: true,
        snapshotTokenPresent: Boolean(initialCloud.snapshotToken),
      };
    }
    continuation.cloudMessageCount = candidate.cloudMessageCount;
    continuation.messagesPreserved =
      candidate.project.messages.length === candidate.cloudMessageCount;
    const expectedCloudMessages = structuredClone(candidate.project.messages);
    phase = "local-candidate-open";
    await seedFlagshipProject(page, candidate.project, []);
    let verifiedCloud;
    if (resumeExistingCAS) {
      // seedFlagshipProject reloads once after writing the exact local draft.
      // This makes the Orbsie account list fetch the current revision-42 row.
      phase = "revision42-reload-verification";
      const refreshedCloud = await getCloudProject(page, candidate.project.id);
      assert.equal(refreshedCloud.status, 200, "Post-reload cloud GET failed.");
      candidate = prepareExistingCASContinuationProject({
        ancestor,
        cloudRecord: refreshedCloud.project,
        retainedProject: parsed.project,
      });
      assert.deepEqual(
        candidate.project.messages,
        expectedCloudMessages,
        "Revision-42 cloud messages changed after reload.",
      );
      assert.match(
        refreshedCloud.snapshotToken ?? "",
        SHA256_PATTERN,
        "Post-reload cloud snapshot token is missing.",
      );
      verifiedCloud = refreshedCloud;
      report.directCloudCASave.postReloadVerification = "passed";
      report.directCloudCASave.verifiedRevision =
        refreshedCloud.project.revision;
      report.directCloudCASave.snapshotMatchedAfterReload = true;
      await openFlagshipResumeProject(page, candidate.project);
    } else {
      await openFlagshipResumeProject(page, candidate.project);
      phase = "cloud-cas-preflight";
      // Refresh the server-issued token immediately before the single CAS. Any
      // intervening cloud write will fail the CAS; the write is never retried.
      const currentCloud = await getCloudProject(page, candidate.project.id);
      assert.equal(currentCloud.status, 200, "Cloud CAS preflight GET failed.");
      candidate = prepareCASContinuationProject({
        ancestor,
        cloudRecord: currentCloud.project,
        retainedProject: parsed.project,
      });
      phase = "cloud-cas-write";
      const casResult = await putCloudProject(
        page,
        candidate.project,
        candidate.baseRevision,
        candidate.baseSnapshotToken,
      );
      report.directCloudCASave = {
        mode: "real-cas-assisted-continuation",
        status:
          casResult.status === 200 && casResult.revision === 42
            ? "READY"
            : "failed",
        writePerformed: true,
        httpStatus: casResult.status,
        revision: casResult.revision,
        revisionMatched: casResult.revision === 42,
        snapshotTokenReturned: casResult.snapshotTokenPresent,
        conflictPresent: casResult.conflictPresent,
        baseRevision: candidate.baseRevision,
        generationRequestsAtWrite: actualGenerationRequests.length,
      };
      assert.equal(
        report.directCloudCASave.status,
        "READY",
        `Single cloud CAS write failed with HTTP ${casResult.status}; it will not be retried.`,
      );
      assert.equal(
        report.directCloudCASave.snapshotTokenReturned,
        true,
        "Cloud CAS response did not return the new snapshot token.",
      );
      phase = "cloud-cas-verify";
      const postCASCloud = await getCloudProject(page, candidate.project.id);
      assert.equal(postCASCloud.status, 200, "Post-CAS cloud GET failed.");
      assert.equal(postCASCloud.project?.revision, 42);
      const savedCandidate = prepareExistingCASContinuationProject({
        ancestor,
        cloudRecord: postCASCloud.project,
        retainedProject: parsed.project,
      });
      assert.deepEqual(
        savedCandidate.project.messages,
        candidate.project.messages,
      );
      candidate = savedCandidate;
      verifiedCloud = postCASCloud;
      report.directCloudCASave.verifiedRevision = postCASCloud.project.revision;
      report.directCloudCASave.postWriteVerification = "passed";
      report.directCloudCASave.messagesPreserved = true;

      // The app populated its in-memory cloud list at the old revision before
      // this direct CAS. Reload once so UI selection sees the committed row.
      phase = "cloud-baseline-refresh";
      await page.reload({ waitUntil: "domcontentloaded" });
      await openFlagshipResumeProject(page, candidate.project);
      const refreshedCloud = await getCloudProject(page, candidate.project.id);
      assert.equal(refreshedCloud.status, 200, "Post-reload cloud GET failed.");
      const refreshedCandidate = prepareExistingCASContinuationProject({
        ancestor,
        cloudRecord: refreshedCloud.project,
        retainedProject: parsed.project,
      });
      assert.deepEqual(refreshedCandidate.project, candidate.project);
      candidate = refreshedCandidate;
      verifiedCloud = refreshedCloud;
      report.directCloudCASave.postReloadVerification = "passed";
      report.directCloudCASave.snapshotMatchedAfterReload = true;
    }
    phase = "cloud-baseline-open-in-ui";
    await openCloudBaselineInUI(page, candidate.project);
    continuation.cloudBaselineOpenedInUI = true;
    const publicationSaveRequests = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.origin !== appOrigin ||
        url.pathname !== "/api/projects" ||
        request.method() !== "PUT"
      )
        return;
      let body = {};
      try {
        body = request.postDataJSON();
      } catch {
        body = {};
      }
      let projectMatches = false;
      try {
        assertPublicationProjectMatches(
          body.project,
          candidate.project,
          "Publication UI cloud save",
        );
        projectMatches = true;
      } catch {
        // A bounded boolean below preserves the mismatch without raw payloads.
      }
      publicationSaveRequests.push({
        projectMatches,
        baseRevision: body.baseRevision ?? null,
        baseSnapshotTokenMatches:
          body.baseSnapshotToken === verifiedCloud.snapshotToken,
      });
    });
    phase = "ui-publication-save-and-publish";
    assert.deepEqual(
      actualGenerationRequests,
      [],
      "Signed-in setup attempted model generation; refusing to start publication.",
    );
    report.localTarget = {
      ...target,
      sourceZipPlayerArtifactsMatched: true,
    };
    await runPublication(
      page,
      browser,
      config,
      report,
      approvedOrigins,
      candidate.project.revision,
      evidenceDir,
      candidate.project,
      parsed.publicationArtifacts,
      targetArtifacts,
    );
    continuation.publicationSaveUsedCloudBaseline =
      publicationSaveRequests.length === 1 &&
      publicationSaveRequests[0].projectMatches &&
      publicationSaveRequests[0].baseRevision === 42 &&
      publicationSaveRequests[0].baseSnapshotTokenMatches;
    report.publicationCloudBaseline = {
      openedInUI: continuation.cloudBaselineOpenedInUI,
      saveRequestCount: publicationSaveRequests.length,
      saveUsedRevision42Token: continuation.publicationSaveUsedCloudBaseline,
    };
    report.signedInGenerationRequests = actualGenerationRequests;
    report.signedInBlockedGenerationRequests =
      evidence.blockedGenerationRequests;
    if (
      actualGenerationRequests.length > 0 ||
      evidence.blockedGenerationRequests.length > 0
    ) {
      report.publication = {
        ...report.publication,
        mode: "blocked",
        status: "zero-generation-guard-observed-attempt",
      };
    }
  } catch {
    report.continuationFailurePhase = phase;
    report.offlineContinuationFailure = "offline-publication-replay-failed";
  } finally {
    report.signedInGenerationRequests ??= actualGenerationRequests;
    report.signedInBlockedGenerationRequests ??=
      evidence.blockedGenerationRequests;
    if (context) await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
  const summary = summarizePublication(report, liveBinding, continuation);
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o644,
  });
  return { report, summary, summaryPath, evidenceDir };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(helpText());
      process.exitCode = 0;
    } else {
      const result = await replayRetainedPublication(options);
      process.stdout.write(
        `${JSON.stringify({ summary: result.summary, summaryPath: result.summaryPath })}\n`,
      );
      process.exitCode = result.summary.status === "passed" ? 0 : 2;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "offline-replay-failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
