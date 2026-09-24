#!/usr/bin/env node
// Bounded live OpenRouter CREATE acceptance. The browser talks to the real
// local app and server routes; route handling only observes, continues up to
// the configured authorized calls, and aborts any later generation/review call.
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { chromium, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";

const MODEL = "openai/gpt-6-luna";
const OUTPUT_CAP = 4096;
const DEFAULT_LIVE_BUDGET = 3;
const APPROVED_LIVE_BUDGET = 4;
const LIVE_BUDGET_ENV = "ORBSIE_LIVE_AUTHORING_REVIEW_CALL_LIMIT";
const FOUR_CALL_APPROVAL_ENV =
  "ORBSIE_LIVE_AUTHORING_REVIEW_FOUR_CALLS_APPROVED";
const MAX_SCENE_ENTITIES = 160;
const MAX_PROCEDURAL_PARTS_PER_ENTITY = 32;
const MAX_REVIEW_FINDINGS = 4;
const MAX_REVIEW_ISSUES = 8;
const MAX_REVIEW_ISSUE_SUMMARY_LENGTH = 300;
const MAX_REQUEST_FAILURE_DETAILS = 16;
const PART_SHAPES = ["box", "sphere", "cylinder", "cone", "torus", "lathe"];
const PART_SHAPE_CATEGORIES = [...PART_SHAPES, "absent", "unknown"];
const PART_SCALE_FACTOR_BINS = [
  "belowHalf",
  "halfToOne",
  "oneToTwo",
  "twoToFour",
  "fourPlus",
  "unknown",
];
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const GENERATION_PATHS = new Set(["/api/generate", "/api/generate/review"]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCENE_STAGES = ["seed", "coarse", "ready"];
const GEOMETRY_KINDS = [
  "tree",
  "mushroom",
  "platform",
  "arch",
  "crystal",
  "pond",
  "flower",
  "rock",
  "custom",
  "asset",
  "generated",
];
const PROCEDURAL_GEOMETRY_KINDS = new Set(GEOMETRY_KINDS.slice(0, 9));
const COLOR_FAMILIES = [
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
  "brown",
  "white",
  "gray",
  "black",
  "other",
  "absent",
];

class AcceptanceError extends Error {
  constructor(stage, code, status) {
    super(code);
    this.stage = stage;
    this.code = code;
    this.status = Number.isInteger(status) ? status : undefined;
  }
}

/** @param {Record<string, string | undefined>} [environment=process.env] */
export function configuredLiveCallLimit(environment = process.env) {
  const requested = environment[LIVE_BUDGET_ENV];
  const approved = environment[FOUR_CALL_APPROVAL_ENV];
  if (requested === undefined && approved === undefined)
    return DEFAULT_LIVE_BUDGET;
  if (requested === "3" && approved === undefined) return DEFAULT_LIVE_BUDGET;
  if (requested === "4" && approved === "1") return APPROVED_LIVE_BUDGET;
  throw new AcceptanceError(
    "configuration",
    requested === "4" || approved !== undefined
      ? "four-call-budget-approval-required"
      : "invalid-live-call-limit",
  );
}

function guardFailure(code) {
  return { allowed: false, code };
}

/** Pure request gate used by the route hook and deterministic tests. */
/**
 * @param {{
 *   call: Record<string, any>;
 *   previousCalls?: Array<Record<string, any>>;
 *   liveCallLimit?: number;
 *   outputCap?: number;
 *   serviceTier?: string;
 *   retryCount?: number;
 *   expectedInitialRevision?: number | null;
 * }} options
 */
export function authorizeAuthoringReviewCall({
  call,
  previousCalls = [],
  liveCallLimit = DEFAULT_LIVE_BUDGET,
  outputCap = OUTPUT_CAP,
  serviceTier = "default",
  retryCount = 0,
  expectedInitialRevision = null,
}) {
  if (![DEFAULT_LIVE_BUDGET, APPROVED_LIVE_BUDGET].includes(liveCallLimit))
    return guardFailure("invalid-live-call-limit");
  if (outputCap !== OUTPUT_CAP) return guardFailure("4096-output-cap-required");
  if (serviceTier !== "default")
    return guardFailure("default-service-tier-required");
  if (!Number.isSafeInteger(retryCount) || retryCount !== 0)
    return guardFailure("automatic-retry-detected");
  if (call?.method !== "POST") return guardFailure("post-required");
  if (
    !Number.isSafeInteger(call?.ordinal) ||
    call.ordinal !== previousCalls.length + 1
  )
    return guardFailure("unexpected-call-ordinal");
  if (!Number.isSafeInteger(call.ordinal) || call.ordinal > liveCallLimit)
    return guardFailure("live-call-budget-exceeded");
  if (!["initial-generation", "review", "final-review"].includes(call.phase))
    return guardFailure("unexpected-review-phase");
  if (!call.modelMatched || !call.providerMatched)
    return guardFailure("exact-luna-model-required");

  let expectedPhase;
  if (call.ordinal === 1) {
    expectedPhase = "initial-generation";
  } else if (call.ordinal === 2) {
    expectedPhase = "review";
  } else {
    const reviewHistory = previousCalls.filter(
      (prior) => prior.phase === "review",
    );
    if (reviewHistory.some((prior) => !Number.isInteger(prior.remainingCalls)))
      return guardFailure("review-remaining-calls-missing");
    if (
      reviewHistory.some(
        (prior, index) =>
          index > 0 &&
          prior.remainingCalls >= reviewHistory[index - 1].remainingCalls,
      )
    )
      return guardFailure("review-remaining-calls-nondecreasing");
    const latestReview = [...previousCalls]
      .reverse()
      .find((prior) => prior.phase === "review");
    if (!latestReview || latestReview.verdict !== "revise")
      return guardFailure("review-sequence-invalid");
    if (!Number.isInteger(latestReview.remainingCalls))
      return guardFailure("review-remaining-calls-missing");
    if (
      !Number.isInteger(latestReview.responseBindingRevision) ||
      typeof latestReview.responseBindingDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(latestReview.responseBindingDigest)
    )
      return guardFailure("review-response-binding-invalid");
    if (latestReview.remainingCalls === 2) {
      if (liveCallLimit !== APPROVED_LIVE_BUDGET)
        return guardFailure("four-call-budget-approval-required");
      expectedPhase = "review";
    } else if (latestReview.remainingCalls === 1) {
      expectedPhase = "final-review";
    } else {
      return guardFailure("review-remaining-calls-invalid");
    }
  }
  if (call.phase !== expectedPhase)
    return guardFailure("unexpected-review-phase");

  if (call.phase === "initial-generation") {
    if (
      call.route !== "/api/generate" ||
      !call.authoringReviewEnabled ||
      !validId(call.clientRunId) ||
      !validId(call.projectId)
    )
      return guardFailure("initial-request-binding-invalid");
    return { allowed: true, code: null, expectedPhase };
  }

  const initialCall = previousCalls[0];
  if (
    !initialCall ||
    previousCalls.some(
      (prior) => prior.blocked || prior.status < 200 || prior.status >= 300,
    ) ||
    call.route !== "/api/generate/review" ||
    call.clientRunId !== initialCall.clientRunId ||
    call.projectId !== initialCall.projectId ||
    !validId(initialCall.authoringRunId) ||
    call.authoringRunId !== initialCall.authoringRunId ||
    call.requestedAuthoringRunId !== initialCall.authoringRunId ||
    !Number.isInteger(call.projectRevision) ||
    call.reviewScope !== "visual+structural" ||
    call.reviewImageProjectId !== call.projectId ||
    call.reviewImageRevision !== call.projectRevision ||
    call.structuralObservationProjectId !== call.projectId ||
    call.structuralObservationRevision !== call.projectRevision
  )
    return guardFailure("review-request-binding-invalid");

  if (
    call.ordinal === 2 &&
    (!Number.isInteger(expectedInitialRevision) ||
      call.projectRevision !== expectedInitialRevision)
  )
    return guardFailure("review-revision-binding-invalid");

  if (call.ordinal > 2) {
    const latestReview = [...previousCalls]
      .reverse()
      .find((prior) => prior.phase === "review");
    if (
      !latestReview ||
      call.projectRevision !== latestReview.responseBindingRevision
    )
      return guardFailure("review-revision-binding-invalid");
  }

  return { allowed: true, code: null, expectedPhase };
}

/**
 * @param {{
 *   phase: string;
 *   verdict: string;
 *   remainingCalls: number | null;
 *   previousReviewResponses?: Array<{ remainingCalls: number | null }>;
 * }} options
 */
export function validateReviewProgression({
  phase,
  verdict,
  remainingCalls,
  previousReviewResponses = [],
}) {
  if (
    !Number.isInteger(remainingCalls) ||
    remainingCalls < 0 ||
    remainingCalls > 2
  )
    return "review-remaining-calls-missing";
  if (verdict !== "accept" && verdict !== "revise")
    return "review-response-verdict-invalid";
  const previous = previousReviewResponses.at(-1)?.remainingCalls;
  if (previous !== undefined && remainingCalls >= previous)
    return "review-remaining-calls-nondecreasing";
  if (phase === "review") {
    if (verdict === "accept" && remainingCalls !== 0)
      return "review-remaining-calls-invalid";
    if (verdict === "revise" && remainingCalls < 1)
      return "review-remaining-calls-invalid";
  } else if (phase === "final-review") {
    if (remainingCalls !== 0) return "review-remaining-calls-invalid";
  } else {
    return "unexpected-review-phase";
  }
  return null;
}

/** A final verdict only inspects the last committed revision; review corrections advance it. */
export function validateReviewBindingRevision({
  phase,
  verdict,
  reviewedRevision,
  bindingRevision,
}) {
  if (!Number.isInteger(reviewedRevision) || !Number.isInteger(bindingRevision))
    return "review-response-binding-invalid";
  if (phase === "final-review")
    return bindingRevision === reviewedRevision
      ? null
      : "final-review-binding-mutated-scene";
  if (phase !== "review") return "unexpected-review-phase";
  if (verdict === "accept")
    return bindingRevision === reviewedRevision
      ? null
      : "accepted-review-binding-revision-mismatch";
  if (verdict === "revise")
    return bindingRevision > reviewedRevision
      ? null
      : "review-correction-binding-invalid";
  return "review-response-verdict-invalid";
}

function requireConfiguration(argv) {
  // This explicit opt-in check precedes every credential or prompt read.
  if (process.env.ORBSIE_LIVE_E2E !== "1")
    throw new AcceptanceError("configuration", "live-opt-in-required");
  if (argv.length !== 1)
    throw new AcceptanceError(
      "configuration",
      "usage-requires-evidence-directory",
    );
  if (process.env.ORBSIE_KEY_SCOPE !== "local-only")
    throw new AcceptanceError("configuration", "local-only-key-scope-required");
  if (process.env.ORBSIE_EXPECTED_MODEL !== MODEL)
    throw new AcceptanceError("configuration", "exact-luna-model-required");
  if (process.env.ORBSIE_OUTPUT_CAP_TOKENS !== String(OUTPUT_CAP))
    throw new AcceptanceError("configuration", "4096-output-cap-required");
  if (
    process.env.ORBSIE_SERVICE_TIER !== undefined &&
    process.env.ORBSIE_SERVICE_TIER !== "default"
  )
    throw new AcceptanceError("configuration", "default-service-tier-required");

  const liveCallLimit = configuredLiveCallLimit(process.env);

  const rawURL = process.env.ORBSIE_TEST_URL;
  if (!rawURL)
    throw new AcceptanceError("configuration", "loopback-app-url-required");
  let url;
  try {
    url = new URL(rawURL);
  } catch {
    throw new AcceptanceError("configuration", "invalid-loopback-app-url");
  }
  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new AcceptanceError(
      "configuration",
      "exact-http-loopback-origin-required",
    );

  const prompt = process.env.ORBSIE_AUTHORING_REVIEW_PROMPT;
  if (
    typeof prompt !== "string" ||
    prompt.trim().length === 0 ||
    prompt.length > 4000
  )
    throw new AcceptanceError(
      "configuration",
      "bounded-create-prompt-required",
    );

  return {
    baseOrigin: url.origin,
    evidenceDirectory: resolve(argv[0]),
    privateEvidenceDirectory: process.env.ORBSIE_PRIVATE_EVIDENCE_DIR,
    prompt,
    expectedModel: MODEL,
    outputCap: OUTPUT_CAP,
    serviceTier: "default",
    liveCallLimit,
  };
}

export async function preflightGenerationOrigin(baseOrigin, fetchImpl = fetch) {
  let origin;
  try {
    origin = new URL(baseOrigin);
  } catch {
    throw new AcceptanceError("server-preflight", "invalid-preflight-origin");
  }
  if (
    origin.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(origin.hostname) ||
    !origin.port ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.origin !== baseOrigin
  )
    throw new AcceptanceError(
      "server-preflight",
      "loopback-origin-required-for-preflight",
    );

  let response;
  try {
    response = await fetchImpl(`${origin.origin}/api/generate`, {
      method: "POST",
      headers: {
        Origin: origin.origin,
        "Content-Type": "application/json",
      },
      body: "{",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new AcceptanceError(
      "server-preflight",
      "generation-origin-preflight-unavailable",
    );
  }

  if (response.status === 403)
    throw new AcceptanceError(
      "server-preflight",
      "generation-origin-preflight-rejected",
      403,
    );
  if (response.status !== 400)
    throw new AcceptanceError(
      "server-preflight",
      "generation-origin-preflight-parser-status-mismatch",
      response.status,
    );
  return response.status;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validId(value) {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

function safeRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function emptyColorFamilyCounts() {
  return Object.fromEntries(COLOR_FAMILIES.map((family) => [family, 0]));
}

function emptyPartShapeCounts() {
  return Object.fromEntries(PART_SHAPE_CATEGORIES.map((shape) => [shape, 0]));
}

function emptyPartScaleFactorBinsByShape() {
  return Object.fromEntries(
    PART_SHAPE_CATEGORIES.map((shape) => [
      shape,
      Object.fromEntries(PART_SCALE_FACTOR_BINS.map((bin) => [bin, 0])),
    ]),
  );
}

function partShapeCategory(value) {
  if (value === null || value === undefined || value === "absent")
    return "absent";
  return PART_SHAPES.includes(value) ? value : "unknown";
}

function boundedScaleVector(value) {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (component) =>
        typeof component === "number" &&
        Number.isFinite(component) &&
        Math.abs(component) <= 100,
    )
  );
}

function partScaleFactorBin(entityScale, partScale) {
  if (!boundedScaleVector(entityScale) || !boundedScaleVector(partScale))
    return "unknown";

  // This upper-bounds the declared entity and part scale transforms. It is
  // not a physical dimension; primitive bounds and private lathe profiles vary.
  const scaleFactorUpperBound =
    Math.max(...entityScale.map(Math.abs)) *
    Math.max(...partScale.map(Math.abs));
  if (scaleFactorUpperBound < 0.5) return "belowHalf";
  if (scaleFactorUpperBound < 1) return "halfToOne";
  if (scaleFactorUpperBound < 2) return "oneToTwo";
  if (scaleFactorUpperBound < 4) return "twoToFour";
  return "fourPlus";
}

function colorFamily(value) {
  if (value === null || value === undefined || value === "") return "absent";
  if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value))
    return "other";

  const red = Number.parseInt(value.slice(1, 3), 16) / 255;
  const green = Number.parseInt(value.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(value.slice(5, 7), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const difference = maximum - minimum;
  const lightness = (maximum + minimum) / 2;

  if (difference < 0.1) {
    if (lightness < 0.16) return "black";
    if (lightness > 0.88) return "white";
    return "gray";
  }

  let hue;
  if (maximum === red) hue = 60 * (((green - blue) / difference) % 6);
  else if (maximum === green) hue = 60 * ((blue - red) / difference + 2);
  else hue = 60 * ((red - green) / difference + 4);
  if (hue < 0) hue += 360;

  if (hue < 12 || hue >= 345) return "red";
  if (hue < 38) return lightness < 0.48 ? "brown" : "orange";
  if (hue < 68) return "yellow";
  if (hue < 160) return "green";
  if (hue < 195) return "cyan";
  if (hue < 260) return "blue";
  if (hue < 300) return "purple";
  if (hue < 345) return "red";
  return "other";
}

export function summarizeProjectStructure(entityFacts) {
  if (!Array.isArray(entityFacts)) return null;

  const boundedEntities = entityFacts.slice(0, MAX_SCENE_ENTITIES);
  const stageCounts = { seed: 0, coarse: 0, ready: 0, unknown: 0 };
  const geometryKindCounts = Object.fromEntries([
    ...GEOMETRY_KINDS.map((kind) => [kind, 0]),
    ["absent", 0],
    ["other", 0],
  ]);
  const customPartShapeCounts = emptyPartShapeCounts();
  const customPartScaleFactorUpperBoundBinsByShape =
    emptyPartScaleFactorBinsByShape();
  const entityColorFamilyCounts = emptyColorFamilyCounts();
  const partColorFamilyCounts = emptyColorFamilyCounts();
  let customProceduralPartCount = 0;

  for (const fact of boundedEntities) {
    const entity = fact && typeof fact === "object" ? fact : {};
    const stage = SCENE_STAGES.includes(entity.stage)
      ? entity.stage
      : "unknown";
    stageCounts[stage] += 1;

    const geometryKind =
      entity.geometryKind === null || entity.geometryKind === undefined
        ? "absent"
        : GEOMETRY_KINDS.includes(entity.geometryKind)
          ? entity.geometryKind
          : "other";
    geometryKindCounts[geometryKind] += 1;
    entityColorFamilyCounts[colorFamily(entity.entityColor)] += 1;

    const partColors = Array.isArray(entity.partColors)
      ? entity.partColors.slice(0, MAX_PROCEDURAL_PARTS_PER_ENTITY)
      : [];
    for (const partColor of partColors)
      partColorFamilyCounts[colorFamily(partColor)] += 1;
    if (PROCEDURAL_GEOMETRY_KINDS.has(geometryKind)) {
      customProceduralPartCount += partColors.length;
      const partFacts = Array.isArray(entity.partFacts)
        ? entity.partFacts.slice(0, MAX_PROCEDURAL_PARTS_PER_ENTITY)
        : [];
      const partCount = Math.min(
        MAX_PROCEDURAL_PARTS_PER_ENTITY,
        Math.max(partFacts.length, partColors.length),
      );
      for (let index = 0; index < partCount; index += 1) {
        const part =
          partFacts[index] && typeof partFacts[index] === "object"
            ? partFacts[index]
            : {};
        const shape = partShapeCategory(part.shape);
        const scaleFactorBin = partScaleFactorBin(
          entity.entityScale,
          part.scale,
        );
        customPartShapeCounts[shape] += 1;
        customPartScaleFactorUpperBoundBinsByShape[shape][scaleFactorBin] += 1;
      }
    }
  }

  return {
    entityCount: boundedEntities.length,
    stageCounts,
    geometryKindCounts,
    customProceduralPartCount,
    customPartShapeCounts,
    customPartScaleFactorUpperBoundBinsByShape,
    entityColorFamilyCounts,
    partColorFamilyCounts,
  };
}

export function safeReviewResponse(body) {
  const review = body?.review;
  const binding = body?.binding;
  return {
    verdict:
      review?.verdict === "accept" || review?.verdict === "revise"
        ? review.verdict
        : null,
    scope:
      body?.scope === "visual+structural" || body?.scope === "structural-only"
        ? body.scope
        : null,
    reviewProjectId: validId(review?.projectId),
    reviewedRevision: safeRevision(review?.reviewedRevision),
    bindingRevision: safeRevision(binding?.revision),
    bindingDigest:
      typeof binding?.digest === "string" &&
      /^[a-f0-9]{64}$/.test(binding.digest)
        ? binding.digest
        : null,
    remainingCalls:
      Number.isInteger(body?.remainingCalls) &&
      body.remainingCalls >= 0 &&
      body.remainingCalls <= 2
        ? body.remainingCalls
        : null,
    issueCount: Array.isArray(review?.issues)
      ? Math.min(review.issues.length, MAX_REVIEW_ISSUES)
      : null,
  };
}

function safeReviewIssueSummaries(issues) {
  if (!Array.isArray(issues)) return [];
  const summaries = [];
  for (const issue of issues.slice(0, MAX_REVIEW_ISSUES)) {
    if (
      !issue ||
      typeof issue !== "object" ||
      Array.isArray(issue) ||
      Object.keys(issue).length !== 2 ||
      !Object.hasOwn(issue, "summary") ||
      !Object.hasOwn(issue, "entityIds") ||
      typeof issue.summary !== "string" ||
      !Array.isArray(issue.entityIds) ||
      issue.entityIds.length > 16 ||
      !issue.entityIds.every(
        (id) => typeof id === "string" && /^[\w-]{1,80}$/.test(id),
      )
    )
      continue;
    const summary = issue.summary
      .trim()
      .slice(0, MAX_REVIEW_ISSUE_SUMMARY_LENGTH);
    // A provider may echo credentials or links in free-form issue text. Keep
    // only diagnostic prose that does not resemble an address or bearer token.
    if (
      summary &&
      !/(?:https?:\/\/|www\.|\b\S+@\S+\.\S+\b|\b(?:bearer|authorization|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\b|\b(?:sk[-_]|vck_|vcp_)[A-Za-z0-9_-]{8,}\b|\b[A-Fa-f0-9]{32,}\b|\b[A-Za-z0-9+/_-]{40,}={0,2}\b)/i.test(
        summary,
      )
    )
      summaries.push(summary);
  }
  return summaries;
}

/** Return only bounded review findings suitable for the opt-in private file. */
export function safePrivateReviewFinding(body, phase, ordinal) {
  if (
    !["review", "final-review"].includes(phase) ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < 2 ||
    ordinal > 4
  )
    return null;
  const review = body?.review;
  return {
    phase,
    ordinal,
    verdict:
      review?.verdict === "accept" || review?.verdict === "revise"
        ? review.verdict
        : null,
    issues: safeReviewIssueSummaries(review?.issues),
  };
}

/** Persist a fixed-shape findings file beneath the already validated directory. */
export async function writePrivateReviewFindings(directory, findings) {
  const boundedFindings = (Array.isArray(findings) ? findings : [])
    .slice(0, MAX_REVIEW_FINDINGS)
    .flatMap((finding) => {
      if (!finding || typeof finding !== "object") return [];
      const safe = safePrivateReviewFinding(
        {
          review: {
            verdict: finding.verdict,
            issues: Array.isArray(finding.issues)
              ? finding.issues
                  .slice(0, MAX_REVIEW_ISSUES)
                  .map((summary) => ({ summary, entityIds: [] }))
              : [],
          },
        },
        finding.phase,
        finding.ordinal,
      );
      return safe ? [safe] : [];
    });
  const path = resolve(directory, "review-findings.json");
  await writeFile(path, `${JSON.stringify(boundedFindings, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await chmod(path, 0o600);
  if (((await stat(path)).mode & 0o777) !== 0o600)
    throw new Error("Private review findings permissions did not apply.");
}

/** Categorize an own-origin browser failure without retaining its URL or text. */
export function classifyOwnOriginRequestFailure(
  originValue,
  requestUrlValue,
  errorText,
) {
  let origin;
  let requestUrl;
  try {
    origin = new URL(originValue);
    requestUrl = new URL(requestUrlValue, origin);
  } catch {
    return null;
  }
  if (requestUrl.origin !== origin.origin) return null;

  const route =
    requestUrl.pathname === "/api/generate/review" ||
    requestUrl.pathname === "/api/chatgpt/review"
      ? "review"
      : requestUrl.pathname === "/api/generate" ||
          requestUrl.pathname.startsWith("/api/generate/") ||
          requestUrl.pathname === "/api/chatgpt/generate"
        ? "generation"
        : requestUrl.pathname === "/api/config"
          ? "configuration"
          : "other-app";
  const match =
    typeof errorText === "string"
      ? errorText.match(
          /^\s*(net::ERR_[A-Z0-9_]{1,64}|ERR_[A-Z0-9_]{1,64}|NS_ERROR_[A-Z0-9_]{1,64})\b/,
        )
      : null;
  return { route, code: match?.[1] ?? null };
}

function writeSafeReport(path, report) {
  return writeFile(path, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
}

function isWithinDirectory(directory, target) {
  const pathFromDirectory = relative(directory, target);
  return (
    pathFromDirectory === "" ||
    (pathFromDirectory !== ".." &&
      !pathFromDirectory.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromDirectory))
  );
}

async function preparePrivateEvidenceDirectory(value) {
  if (value === undefined || value === "") return null;
  if (!isAbsolute(value))
    throw new AcceptanceError(
      "configuration",
      "private-evidence-directory-must-be-absolute",
    );
  const target = resolve(value);
  let repository;
  let parent;
  try {
    repository = await realpath(fileURLToPath(new URL("../", import.meta.url)));
    parent = await realpath(dirname(target));
  } catch {
    throw new AcceptanceError(
      "configuration",
      "private-evidence-directory-parent-unavailable",
    );
  }
  if (
    isWithinDirectory(repository, target) ||
    isWithinDirectory(repository, resolve(parent, basename(target)))
  )
    throw new AcceptanceError(
      "configuration",
      "private-evidence-directory-inside-repository",
    );
  try {
    await lstat(target);
    throw new AcceptanceError(
      "configuration",
      "private-evidence-directory-already-exists",
    );
  } catch (error) {
    if (error instanceof AcceptanceError) throw error;
    if (error?.code !== "ENOENT")
      throw new AcceptanceError(
        "configuration",
        "private-evidence-directory-unavailable",
      );
  }
  try {
    await mkdir(target, { recursive: false, mode: 0o700 });
    await chmod(target, 0o700);
    if (((await stat(target)).mode & 0o777) !== 0o700)
      throw new Error("Private directory permissions did not apply.");
  } catch {
    throw new AcceptanceError(
      "configuration",
      "private-evidence-directory-creation-failed",
    );
  }
  return target;
}

async function writePrivateScreenshot(directory, filename, png) {
  const path = `${directory}/${filename}`;
  try {
    await writeFile(path, png, { mode: 0o600, flag: "wx" });
    await chmod(path, 0o600);
    if (((await stat(path)).mode & 0o777) !== 0o600)
      throw new Error("Private screenshot permissions did not apply.");
  } catch {
    throw new AcceptanceError(
      "private-evidence",
      "private-screenshot-write-failed",
    );
  }
}

async function readProjectSummary(page, includeStructure = false) {
  const snapshot = await page.evaluate(
    (captureStructure) =>
      new Promise((resolve) => {
        const request = indexedDB.open("keyval-store");
        request.onupgradeneeded = () => request.transaction.abort();
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("keyval")) {
            db.close();
            resolve(null);
            return;
          }
          const transaction = db.transaction("keyval", "readonly");
          const draftRequest = transaction
            .objectStore("keyval")
            .get("orbsie-draft");
          const libraryRequest = transaction
            .objectStore("keyval")
            .get("orbsie-library");
          transaction.oncomplete = () => {
            const draft = draftRequest.result;
            const project =
              draft && typeof draft === "object" ? draft.project : null;
            const library = libraryRequest.result;
            const saved =
              project && library && typeof library === "object"
                ? library[project.id]
                : null;
            const entityFacts =
              captureStructure && Array.isArray(project?.entities)
                ? project.entities.slice(0, 160).map((entity) => {
                    const geometry =
                      entity?.geometry && typeof entity.geometry === "object"
                        ? entity.geometry
                        : null;
                    const safeScale = (value) =>
                      Array.isArray(value) &&
                      value.length === 3 &&
                      value.every(
                        (component) =>
                          typeof component === "number" &&
                          Number.isFinite(component) &&
                          Math.abs(component) <= 100,
                      )
                        ? value
                        : null;
                    return {
                      stage:
                        entity?.stage === "seed" ||
                        entity?.stage === "coarse" ||
                        entity?.stage === "ready"
                          ? entity.stage
                          : null,
                      geometryKind:
                        typeof geometry?.kind === "string"
                          ? geometry.kind
                          : null,
                      entityColor:
                        typeof entity?.color === "string" &&
                        /^#[\da-f]{6}$/i.test(entity.color)
                          ? entity.color
                          : null,
                      entityScale: safeScale(entity?.scale),
                      partColors: Array.isArray(geometry?.parts)
                        ? geometry.parts
                            .slice(0, 32)
                            .map((part) =>
                              typeof part?.color === "string" &&
                              /^#[\da-f]{6}$/i.test(part.color)
                                ? part.color
                                : null,
                            )
                        : [],
                      partFacts: Array.isArray(geometry?.parts)
                        ? geometry.parts.slice(0, 32).map((part) => ({
                            shape:
                              part?.shape === "box" ||
                              part?.shape === "sphere" ||
                              part?.shape === "cylinder" ||
                              part?.shape === "cone" ||
                              part?.shape === "torus" ||
                              part?.shape === "lathe"
                                ? part.shape
                                : part?.shape === null ||
                                    part?.shape === undefined
                                  ? "absent"
                                  : "unknown",
                            scale: safeScale(part?.scale),
                          }))
                        : [],
                    };
                  })
                : null;
            db.close();
            resolve(
              project && typeof project.id === "string"
                ? {
                    projectId: project.id,
                    revision: Number.isSafeInteger(saved?.revision)
                      ? saved.revision
                      : Number.isSafeInteger(project.revision)
                        ? project.revision
                        : null,
                    entityFacts,
                  }
                : null,
            );
          };
          transaction.onerror = () => {
            db.close();
            resolve(null);
          };
        };
      }),
    includeStructure,
  );
  if (!snapshot) return null;
  return {
    projectId: snapshot.projectId,
    revision: snapshot.revision,
    structure: includeStructure
      ? summarizeProjectStructure(snapshot.entityFacts)
      : null,
  };
}

async function waitForSavedRevision(
  page,
  minimumRevision,
  timeout = 180000,
  shouldStop = () => false,
  includeStructure = false,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const summary = await readProjectSummary(page);
    if (summary && summary.revision >= minimumRevision) {
      if (!includeStructure) return summary;
      const detailed = await readProjectSummary(page, true);
      if (
        detailed &&
        detailed.projectId === summary.projectId &&
        detailed.revision >= minimumRevision
      )
        return detailed;
    }
    if (shouldStop()) return null;
    await page.waitForTimeout(250);
  }
  return null;
}

async function screenshotEvidence(page, label, privateDirectory) {
  // Pixels stay in memory. The report stores only a one-way digest and size.
  const png = await page.screenshot({ fullPage: true, animations: "disabled" });
  let privatePngWritten = false;
  let privatePng;
  if (privateDirectory && label === "connection-model-selection") {
    privatePng = png;
    await writePrivateScreenshot(
      privateDirectory,
      "connection-model-selection.png",
      privatePng,
    );
    privatePngWritten = true;
  } else if (
    privateDirectory &&
    (label === "review-complete" ||
      label === "revise-bounded-incomplete" ||
      label === "final-review-bounded-incomplete" ||
      label === "review-failed")
  ) {
    // The canvas fills the viewport, so an ordinary element screenshot also
    // captures composited chat/UI overlays. Hide them without changing layout
    // while recording the scene image, then restore the page immediately.
    const sceneOnlyStyle = await page.addStyleTag({
      content:
        "body * { visibility: hidden !important; } canvas { visibility: visible !important; }",
    });
    try {
      privatePng = await page.locator("canvas").screenshot();
    } finally {
      await sceneOnlyStyle.evaluate((element) => element.remove());
    }
    await writePrivateScreenshot(
      privateDirectory,
      label === "review-failed"
        ? "post-review-failed-scene.png"
        : "post-review-scene.png",
      privatePng,
    );
    privatePngWritten = true;
  }
  return {
    label,
    sha256: sha256(png),
    bytes: png.byteLength,
    persisted: false,
    persistedScope: "full-page-png",
    privatePngWritten,
    ...(privatePng
      ? {
          privateSha256: sha256(privatePng),
          privateBytes: privatePng.byteLength,
        }
      : {}),
  };
}

async function installActivityHistory(page) {
  await page.evaluate(() => {
    const partialReviewPrefix =
      "The correction was applied; the final review still found: ";
    const known = new Map([
      ["Reviewing the saved scene…", "reviewStarted"],
      ["Scene verified. Changes are applied.", "completed"],
      ["Applying a targeted correction to the scene…", "applyingCorrection"],
      ["Checking the corrected scene…", "checkingCorrection"],
      ["Scene saved, but review could not finish.", "reviewIncomplete"],
      [
        "Scene correction applied, but final review found a remaining issue.",
        "reviewPartial",
      ],
    ]);
    const state = {
      reviewStarted: false,
      completed: false,
      applyingCorrection: false,
      checkingCorrection: false,
      reviewIncomplete: false,
      reviewPartial: false,
      otherActivityPresent: false,
    };
    window.__orbsieLiveReviewActivity = state;
    const observe = () => {
      const text = document
        .querySelector(".authoring-activity-latest p")
        ?.textContent?.trim();
      if (!text) return;
      if (
        text.startsWith(partialReviewPrefix) &&
        text.length > partialReviewPrefix.length
      ) {
        state.reviewPartial = true;
        return;
      }
      const key = known.get(text);
      if (key) state[key] = true;
      else state.otherActivityPresent = true;
    };
    new MutationObserver(observe).observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    observe();
  });
}

async function readActivityHistory(page) {
  return page.evaluate(() => ({
    reviewStarted: Boolean(window.__orbsieLiveReviewActivity?.reviewStarted),
    completed: Boolean(window.__orbsieLiveReviewActivity?.completed),
    applyingCorrection: Boolean(
      window.__orbsieLiveReviewActivity?.applyingCorrection,
    ),
    checkingCorrection: Boolean(
      window.__orbsieLiveReviewActivity?.checkingCorrection,
    ),
    reviewIncomplete: Boolean(
      window.__orbsieLiveReviewActivity?.reviewIncomplete,
    ),
    reviewPartial: Boolean(window.__orbsieLiveReviewActivity?.reviewPartial),
    otherActivityPresent: Boolean(
      window.__orbsieLiveReviewActivity?.otherActivityPresent,
    ),
  }));
}

function isInferenceRoute(origin, url) {
  return (
    url.origin === origin &&
    (GENERATION_PATHS.has(url.pathname) ||
      url.pathname.startsWith("/api/generate/") ||
      url.pathname === "/api/chatgpt/generate" ||
      url.pathname === "/api/chatgpt/review")
  );
}

async function main() {
  const config = requireConfiguration(process.argv.slice(2));
  const privateEvidenceDirectory = await preparePrivateEvidenceDirectory(
    config.privateEvidenceDirectory,
  );
  const reportPath = `${config.evidenceDirectory}/report.json`;
  await mkdir(dirname(config.evidenceDirectory), { recursive: true });
  await mkdir(config.evidenceDirectory, { recursive: false });

  const report = {
    schemaVersion: 1,
    outcome: "running",
    provider: "openrouter",
    model: config.expectedModel,
    serviceTier: config.serviceTier,
    maxOutputTokens: config.outputCap,
    allowedLiveCalls: config.liveCallLimit,
    actualLiveCalls: 0,
    blockedCalls: 0,
    originPreflight: { status: null, inferenceCalls: 0 },
    phaseOrder: [],
    calls: [],
    reviewAttempts: [],
    review: null,
    secondReview: null,
    finalReview: null,
    evidence: [],
    storage: {},
    requestIds: {
      initial: null,
      review: null,
      secondReview: null,
      finalReview: null,
    },
    privateEvidence: {
      enabled: Boolean(privateEvidenceDirectory),
      directoryMode: privateEvidenceDirectory ? "0700" : null,
      fileMode: privateEvidenceDirectory ? "0600" : null,
      screenshotsWritten: 0,
      reviewFindingsStatus: privateEvidenceDirectory ? "pending" : "disabled",
      reviewFindingsCount: 0,
    },
    browserActivity: {
      consoleErrors: 0,
      pageErrors: 0,
      requestFailures: 0,
      requestFailureDetails: [],
    },
    blockedExternalRequests: 0,
    blockedExternalOrigins: [],
    failure: null,
  };

  let stage = "server-preflight";
  let browser;
  let page;
  let authoringRunId = null;
  const reviewResponses = [];
  const reviewResponsesByOrdinal = new Map();
  const privateReviewFindings = [];
  let finalReviewResponse = null;
  const requestRecords = new WeakMap();
  const inFlight = new Set();
  const blockedExternalOrigins = new Set();
  const appURL = new URL(config.baseOrigin);

  function isAllowedAppNetworkURL(url) {
    return (
      url.origin === config.baseOrigin ||
      (url.hostname === appURL.hostname &&
        url.port === appURL.port &&
        (url.protocol === "ws:" || url.protocol === "wss:"))
    );
  }

  try {
    report.originPreflight.status = await preflightGenerationOrigin(
      config.baseOrigin,
    );
    browser = await chromium.launch({
      headless: process.env.ORBSIE_HEADLESS !== "0",
      args: [
        "--no-sandbox",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
    });

    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        ["http:", "https:", "ws:", "wss:"].includes(url.protocol) &&
        !isAllowedAppNetworkURL(url)
      ) {
        report.blockedExternalRequests += 1;
        const origin = url.origin === "null" ? "opaque" : url.origin;
        blockedExternalOrigins.add(origin);
        report.blockedExternalOrigins = [...blockedExternalOrigins].sort();
        await route.abort("blockedbyclient");
        return;
      }
      if (!isInferenceRoute(config.baseOrigin, url)) {
        await route.continue();
        return;
      }

      let payload;
      try {
        payload = request.postDataJSON();
      } catch {
        payload = null;
      }
      const phase =
        url.pathname === "/api/generate"
          ? "initial-generation"
          : payload?.phase === "review"
            ? "review"
            : payload?.phase === "final-review"
              ? "final-review"
              : "unexpected-review-phase";
      const outputTokenValue =
        payload?.maxTokens ?? payload?.max_tokens ?? config.outputCap;
      const requestedTier = payload?.serviceTier ?? config.serviceTier;
      const retryValue =
        payload?.retryCount ??
        request.headers()["x-retry-count"] ??
        request.headers()["x-retry-attempt"] ??
        0;
      const normalizedRetryCount =
        typeof retryValue === "number" && Number.isSafeInteger(retryValue)
          ? retryValue
          : typeof retryValue === "string" && /^\d{1,3}$/.test(retryValue)
            ? Number(retryValue)
            : -1;
      const call = {
        ordinal: report.calls.length + 1,
        phase,
        route:
          url.pathname === "/api/generate"
            ? "/api/generate"
            : url.pathname === "/api/generate/review"
              ? "/api/generate/review"
              : "other-inference",
        method: request.method() === "POST" ? "POST" : "other",
        status: null,
        requestId: null,
        clientRunId: validId(request.headers()["x-orbsie-client-run-id"]),
        authoringRunId: validId(payload?.runId),
        requestedAuthoringRunId: validId(payload?.runId),
        projectId: validId(payload?.project?.id),
        projectRevision: safeRevision(payload?.project?.revision),
        modelMatched: payload?.model === MODEL,
        providerMatched: payload?.provider === "openrouter",
        requestedOutputTokens:
          typeof outputTokenValue === "number" &&
          Number.isSafeInteger(outputTokenValue)
            ? outputTokenValue
            : null,
        requestedServiceTier:
          requestedTier === "default" ? "default" : "non-default",
        retryCount: normalizedRetryCount,
        authoringReviewEnabled: payload?.authoringReview === true,
        reviewScope: null,
        reviewProjectId: null,
        reviewRevision: null,
        reviewImageProjectId: null,
        reviewImageRevision: null,
        structuralObservationProjectId: null,
        structuralObservationRevision: null,
        responseBindingRevision: null,
        responseBindingDigest: null,
        verdict: null,
        remainingCalls: null,
        blocked: false,
      };
      if (url.pathname === "/api/generate/review") {
        const hasImage =
          typeof payload?.reviewImage?.image === "string" &&
          payload.reviewImage.image.startsWith("data:image/png;base64,");
        const hasStructure = Boolean(payload?.structuralObservations);
        call.reviewScope =
          hasImage && hasStructure
            ? "visual+structural"
            : hasStructure
              ? "structural-only"
              : "missing-review-evidence";
        call.reviewProjectId = validId(payload?.project?.id);
        call.reviewRevision = safeRevision(payload?.project?.revision);
        call.reviewImageProjectId = validId(payload?.reviewImage?.projectId);
        call.reviewImageRevision = safeRevision(payload?.reviewImage?.revision);
        call.structuralObservationProjectId = validId(
          payload?.structuralObservations?.projectId,
        );
        call.structuralObservationRevision = safeRevision(
          payload?.structuralObservations?.revision,
        );
      }

      if (call.ordinal === 2) {
        const snapshotDeadline = Date.now() + 5000;
        while (
          (safeRevision(report.storage.afterGeneration?.revision) === null ||
            !validId(authoringRunId) ||
            !Number.isInteger(report.calls[0]?.status) ||
            report.calls[0].status < 200 ||
            report.calls[0].status >= 300) &&
          Date.now() < snapshotDeadline
        )
          await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (call.ordinal >= 3) {
        const responseDeadline = Date.now() + 5000;
        let latestReview = [...report.calls]
          .reverse()
          .find((prior) => prior.phase === "review");
        while (
          latestReview?.status >= 200 &&
          latestReview.status < 300 &&
          latestReview.remainingCalls === null &&
          Date.now() < responseDeadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          latestReview = [...report.calls]
            .reverse()
            .find((prior) => prior.phase === "review");
        }
      }

      const callGuard = authorizeAuthoringReviewCall({
        call,
        previousCalls: report.calls,
        liveCallLimit: config.liveCallLimit,
        outputCap: call.requestedOutputTokens,
        serviceTier: call.requestedServiceTier,
        retryCount: call.retryCount,
        expectedInitialRevision: safeRevision(
          report.storage.afterGeneration?.revision,
        ),
      });
      // Do not keep request payloads. `payload` is discarded after this hook.
      if (!callGuard.allowed) {
        call.blocked = true;
        call.guardCode = callGuard.code;
        report.blockedCalls += 1;
        report.phaseOrder.push(`${phase}-blocked-before-server`);
        report.calls.push(call);
        await route.abort("blockedbyclient");
        return;
      }

      report.actualLiveCalls += 1;
      report.phaseOrder.push(`${phase}-request-observed`);
      report.calls.push(call);
      requestRecords.set(request, call);
      const continuation = route.continue();
      inFlight.add(continuation);
      try {
        await continuation;
      } finally {
        inFlight.delete(continuation);
      }
    });
    await context.routeWebSocket(
      (url) => url.protocol === "ws:" || url.protocol === "wss:",
      async (webSocketRoute) => {
        const url = new URL(webSocketRoute.url());
        if (isAllowedAppNetworkURL(url)) {
          webSocketRoute.connectToServer();
          return;
        }
        report.blockedExternalRequests += 1;
        const origin = url.origin === "null" ? "opaque" : url.origin;
        blockedExternalOrigins.add(origin);
        report.blockedExternalOrigins = [...blockedExternalOrigins].sort();
        await webSocketRoute.close({
          code: 1008,
          reason: "External network blocked.",
        });
      },
    );

    page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") report.browserActivity.consoleErrors += 1;
    });
    page.on("pageerror", () => {
      report.browserActivity.pageErrors += 1;
    });
    page.on("requestfailed", (request) => {
      const url = new URL(request.url());
      if (url.origin === config.baseOrigin) {
        report.browserActivity.requestFailures += 1;
        if (
          report.browserActivity.requestFailureDetails.length <
          MAX_REQUEST_FAILURE_DETAILS
        ) {
          const failure = request.failure();
          report.browserActivity.requestFailureDetails.push(
            classifyOwnOriginRequestFailure(
              config.baseOrigin,
              request.url(),
              failure?.errorText,
            ),
          );
        }
      }
    });
    page.on("response", (response) => {
      const task = (async () => {
        const call = requestRecords.get(response.request());
        if (!call) return;
        call.status = response.status();
        const headers = response.headers();
        if (call.phase === "initial-generation") {
          call.requestId = validId(headers["x-orbsie-request-id"]);
          report.requestIds.initial = call.requestId;
          authoringRunId = validId(headers["x-orbsie-authoring-run-id"]);
          call.authoringRunId = authoringRunId;
          report.phaseOrder.push(`initial-generation-response-${call.status}`);
        } else if (call.phase === "review" || call.phase === "final-review") {
          call.requestId = validId(headers["x-orbsie-request-id"]);
          if (call.phase === "review") {
            const reviewOrdinal = report.reviewAttempts.length + 1;
            if (reviewOrdinal === 1) report.requestIds.review = call.requestId;
            else if (reviewOrdinal === 2)
              report.requestIds.secondReview = call.requestId;
          } else report.requestIds.finalReview = call.requestId;
          report.phaseOrder.push(`${call.phase}-response-${call.status}`);
          if (call.status >= 200 && call.status < 300) {
            try {
              const responseBody = await response.json();
              const parsed = safeReviewResponse(responseBody);
              if (privateEvidenceDirectory) {
                const finding = safePrivateReviewFinding(
                  responseBody,
                  call.phase,
                  call.ordinal,
                );
                if (finding) privateReviewFindings.push(finding);
              }
              call.verdict = parsed.verdict;
              call.remainingCalls = parsed.remainingCalls;
              call.responseBindingRevision = parsed.bindingRevision;
              call.responseBindingDigest = parsed.bindingDigest;
              if (call.phase === "review") {
                reviewResponses.push(parsed);
                reviewResponsesByOrdinal.set(call.ordinal, parsed);
                report.reviewAttempts.push({
                  ordinal: reviewResponses.length,
                  phase: "review",
                  requestId: call.requestId,
                  scope: parsed.scope,
                  projectId: parsed.reviewProjectId,
                  reviewedRevision: parsed.reviewedRevision,
                  bindingRevision: parsed.bindingRevision,
                  bindingDigest: parsed.bindingDigest,
                  verdict: parsed.verdict,
                  remainingCalls: parsed.remainingCalls,
                  issueCount: parsed.issueCount,
                });
              } else {
                finalReviewResponse = parsed;
              }
            } catch {
              call.remainingCalls = null;
              if (call.phase === "final-review") finalReviewResponse = null;
            }
          }
        }
      })().catch(() => {});
      inFlight.add(task);
      void task.finally(() => inFlight.delete(task));
    });

    stage = "server-preflight";
    await page.goto(config.baseOrigin, { waitUntil: "domcontentloaded" });
    await installActivityHistory(page);
    const configResponse = await page.request.get(
      `${config.baseOrigin}/api/config`,
      {
        headers: { Origin: config.baseOrigin },
        timeout: 30000,
      },
    );
    if (!configResponse.ok())
      throw new AcceptanceError(
        stage,
        "app-config-unavailable",
        configResponse.status(),
      );
    const appConfig = await configResponse.json().catch(() => null);
    if (
      appConfig?.authoringReview !== true ||
      appConfig?.accounts !== true ||
      appConfig?.generationMaxTokens !== OUTPUT_CAP
    )
      throw new AcceptanceError(
        stage,
        "review-auth-or-output-cap-not-configured",
      );
    report.server = {
      status: configResponse.status(),
      authoringReview: true,
      accounts: true,
      maxOutputTokens: OUTPUT_CAP,
    };

    stage = "provider-connection";
    const connectionButton = page
      .getByRole("button", { name: "Connections", exact: true })
      .first();
    await expect(connectionButton).toBeVisible({ timeout: 30000 });
    const catalogPromise = page.waitForResponse(
      (response) => {
        const url = new URL(response.url());
        return (
          url.origin === config.baseOrigin &&
          url.pathname === "/api/models" &&
          url.searchParams.get("provider") === "openrouter"
        );
      },
      { timeout: 30000 },
    );
    await connectionButton.click();
    await page
      .getByLabel("Provider", { exact: true })
      .selectOption("openrouter");
    const catalogResponse = await catalogPromise;
    if (!catalogResponse.ok())
      throw new AcceptanceError(
        stage,
        "openrouter-model-catalog-unavailable",
        catalogResponse.status(),
      );
    const catalog = await catalogResponse.json().catch(() => null);
    const expectedModel = Array.isArray(catalog?.models)
      ? catalog.models.find((item) => item?.id === MODEL)
      : null;
    if (!expectedModel)
      throw new AcceptanceError(stage, "exact-luna-model-absent-from-catalog");
    if (expectedModel.capabilities?.imageInput?.supported !== true)
      throw new AcceptanceError(
        stage,
        "luna-image-input-not-confirmed-by-catalog",
      );
    report.catalog = {
      exactModelPresent: true,
      imageInputSupported: true,
    };
    await page.locator("details.advanced-models summary").click();
    const modelRow = page.locator(
      `.model-catalog-row[data-model-id="${MODEL}"]`,
    );
    await expect(modelRow).toHaveCount(1, { timeout: 30000 });
    await modelRow.click();
    await expect(modelRow).toHaveAttribute("aria-pressed", "true");
    const connectionEvidence = await screenshotEvidence(
      page,
      "connection-model-selection",
      privateEvidenceDirectory,
    );
    report.evidence.push(connectionEvidence);
    if (connectionEvidence.privatePngWritten)
      report.privateEvidence.screenshotsWritten += 1;
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (typeof apiKey !== "string" || apiKey.length < 10)
      throw new AcceptanceError(stage, "openrouter-key-unavailable");
    await page.getByLabel("API key", { exact: true }).fill(apiKey);
    await page
      .getByRole("button", {
        name: "Continue with this connection",
        exact: true,
      })
      .click();
    await expect(page.locator(".mode-button")).toContainText("OpenRouter");
    const keyDigest = sha256(apiKey);
    const connectedStorage = await storageSnapshot(page, keyDigest);
    if (connectedStorage.sensitive)
      throw new AcceptanceError(stage, "provider-key-found-in-browser-storage");
    report.storage.connectionKeyPersisted = false;

    stage = "create-preflight";
    await expect(page.locator("main")).toHaveAttribute(
      "data-renderer-availability",
      "ready",
      { timeout: 30000 },
    );
    const promptInput = page.getByPlaceholder("What experience to build?");
    await expect(promptInput).toBeVisible({ timeout: 30000 });
    const reviewToggle = page.getByTestId("authoring-review-toggle");
    await expect(reviewToggle).toBeVisible();
    const enabled = await reviewToggle
      .locator("input[type=checkbox]")
      .isEnabled();
    const checked = await reviewToggle
      .locator("input[type=checkbox]")
      .isChecked();
    if (!enabled || !checked)
      throw new AcceptanceError(
        stage,
        "authoring-review-toggle-not-enabled-and-checked",
      );
    const before = await readProjectSummary(page);
    report.storage.before = before
      ? {
          projectId: validId(before.projectId),
          revision: safeRevision(before.revision),
        }
      : null;
    await promptInput.fill(config.prompt);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    report.phaseOrder.push("create-submitted-from-browser");

    stage = "initial-generation";
    await expect
      .poll(() => report.calls.length, { timeout: 30000 })
      .toBeGreaterThan(0);
    const initialCall = report.calls.find(
      (call) => call.phase === "initial-generation",
    );
    if (!initialCall)
      throw new AcceptanceError(
        stage,
        "initial-generation-request-not-observed",
      );
    if (initialCall.blocked)
      throw new AcceptanceError(
        stage,
        "initial-generation-request-blocked-by-live-safety-guard",
      );
    const generated = await waitForSavedRevision(
      page,
      (before?.revision ?? 0) + 1,
      180000,
      () =>
        report.calls.some(
          (call) =>
            call.phase === "initial-generation" &&
            call.status !== null &&
            call.status >= 400,
        ),
      true,
    );
    if (!generated) {
      const failedCall = report.calls.find(
        (call) => call.phase === "initial-generation",
      );
      if (failedCall?.status && failedCall.status >= 400)
        throw new AcceptanceError(
          stage,
          "initial-generation-http-failure",
          failedCall.status,
        );
      throw new AcceptanceError(
        stage,
        "no-committed-world-observed-within-timeout",
      );
    }
    report.storage.afterGeneration = {
      projectId: validId(generated.projectId),
      revision: safeRevision(generated.revision),
      structure: generated.structure,
    };
    if (!authoringRunId)
      throw new AcceptanceError(
        stage,
        "initial-generation-missing-authoring-run-id",
      );
    if (!initialCall.requestId)
      throw new AcceptanceError(stage, "initial-request-id-invalid-or-missing");

    const waitForAuthoringCall = async (
      ordinal,
      expectedPhase,
      timeout = 180000,
    ) => {
      await expect
        .poll(() => report.calls.some((call) => call.ordinal === ordinal), {
          timeout,
        })
        .toBe(true);
      const call = report.calls.find(
        (candidate) => candidate.ordinal === ordinal,
      );
      if (!call)
        throw new AcceptanceError(expectedPhase, "review-request-not-observed");
      if (call.blocked)
        throw new AcceptanceError(
          expectedPhase,
          call.guardCode ?? "live-safety-guard-blocked-request",
        );
      if (call.phase !== expectedPhase)
        throw new AcceptanceError(expectedPhase, "unexpected-review-phase");
      const deadline = Date.now() + timeout;
      while (call.status === null && Date.now() < deadline)
        await page.waitForTimeout(200);
      await Promise.allSettled([...inFlight]);
      if (call.status === null)
        throw new AcceptanceError(expectedPhase, "review-response-timeout");
      if (call.status < 200 || call.status >= 300)
        throw new AcceptanceError(
          expectedPhase,
          "review-http-failure",
          call.status,
        );
      if (!call.requestId)
        throw new AcceptanceError(
          expectedPhase,
          "request-id-invalid-or-missing",
        );
      if (
        report.calls
          .filter((candidate) => candidate.ordinal < ordinal)
          .some((candidate) => candidate.requestId === call.requestId)
      )
        throw new AcceptanceError(expectedPhase, "request-ids-not-distinct");
      return call;
    };
    const validatedResponse = (call, phase, previousResponses) => {
      const response =
        phase === "review"
          ? reviewResponsesByOrdinal.get(call.ordinal)
          : finalReviewResponse;
      if (
        !response?.verdict ||
        !response.scope ||
        response.bindingRevision === null ||
        !response.bindingDigest
      )
        throw new AcceptanceError(phase, "review-response-binding-invalid");
      const progressionError = validateReviewProgression({
        phase,
        verdict: response.verdict,
        remainingCalls: response.remainingCalls,
        previousReviewResponses: previousResponses,
      });
      if (progressionError) throw new AcceptanceError(phase, progressionError);
      const expectedRevision =
        previousResponses.length === 0
          ? generated.revision
          : previousResponses.at(-1).bindingRevision;
      if (
        call.projectId !== generated.projectId ||
        call.projectRevision !== expectedRevision ||
        response.reviewProjectId !== generated.projectId ||
        response.reviewedRevision !== call.projectRevision
      )
        throw new AcceptanceError(phase, "review-project-binding-mismatch");
      if (
        call.reviewScope !== "visual+structural" ||
        call.reviewImageProjectId !== call.projectId ||
        call.reviewImageRevision !== call.projectRevision ||
        call.structuralObservationProjectId !== call.projectId ||
        call.structuralObservationRevision !== call.projectRevision ||
        response.scope !== "visual+structural"
      )
        throw new AcceptanceError(phase, "review-evidence-binding-mismatch");
      const bindingError = validateReviewBindingRevision({
        phase,
        verdict: response.verdict,
        reviewedRevision: call.projectRevision,
        bindingRevision: response.bindingRevision,
      });
      if (bindingError) throw new AcceptanceError(phase, bindingError);
      return response;
    };
    const reviewSummary = (call, response) => ({
      phase: "review",
      ordinal: reviewResponsesByOrdinal.has(call.ordinal)
        ? reviewResponses.findIndex((candidate) => candidate === response) + 1
        : null,
      scope: response.scope,
      requestScope: call.reviewScope,
      imagePresent: call.reviewScope === "visual+structural",
      projectId: call.projectId,
      reviewedRevision: response.reviewedRevision,
      reviewImageRevision: call.reviewImageRevision,
      structuralObservationRevision: call.structuralObservationRevision,
      bindingRevision: response.bindingRevision,
      bindingDigest: response.bindingDigest,
      verdict: response.verdict,
      remainingCalls: response.remainingCalls,
      issueCount: response.issueCount,
    });

    stage = "review";
    const reviewCall = await waitForAuthoringCall(2, "review", 30000);
    const reviewResponse = validatedResponse(reviewCall, "review", []);
    report.review = reviewSummary(reviewCall, reviewResponse);
    report.phaseOrder.push(`review-verdict-${reviewResponse.verdict}`);

    let acceptedCall = reviewCall;
    let acceptedResponse = reviewResponse;
    let acceptedPhase = "review";
    let expectedLiveCalls = 2;
    let latestReviewCall = reviewCall;
    let latestReviewResponse = reviewResponse;
    const completedReviewResponses = [reviewResponse];

    if (reviewResponse.verdict === "revise") {
      if (reviewResponse.remainingCalls === 2) {
        if (config.liveCallLimit !== APPROVED_LIVE_BUDGET)
          throw new AcceptanceError(
            "review",
            "four-call-budget-approval-required",
          );
        const secondReviewCall = await waitForAuthoringCall(3, "review");
        const secondReviewResponse = validatedResponse(
          secondReviewCall,
          "review",
          completedReviewResponses,
        );
        report.secondReview = reviewSummary(
          secondReviewCall,
          secondReviewResponse,
        );
        report.phaseOrder.push(
          `review-verdict-${secondReviewResponse.verdict}`,
        );
        latestReviewCall = secondReviewCall;
        latestReviewResponse = secondReviewResponse;
        completedReviewResponses.push(secondReviewResponse);
        if (secondReviewResponse.verdict === "accept") {
          acceptedCall = secondReviewCall;
          acceptedResponse = secondReviewResponse;
          expectedLiveCalls = 3;
        }
      }

      if (latestReviewResponse.verdict === "revise") {
        if (
          latestReviewResponse.remainingCalls !== 1 ||
          config.liveCallLimit < latestReviewCall.ordinal + 1
        )
          throw new AcceptanceError(
            "review",
            "review-call-budget-or-slot-mismatch",
          );
        stage = "final-review";
        const finalReviewCall = await waitForAuthoringCall(
          latestReviewCall.ordinal + 1,
          "final-review",
        );
        const currentFinalResponse = validatedResponse(
          finalReviewCall,
          "final-review",
          completedReviewResponses,
        );
        finalReviewResponse = currentFinalResponse;
        report.finalReview = {
          phase: "final-review",
          ordinal: finalReviewCall.ordinal,
          scope: currentFinalResponse.scope,
          requestScope: finalReviewCall.reviewScope,
          imagePresent: finalReviewCall.reviewScope === "visual+structural",
          projectId: finalReviewCall.projectId,
          reviewedRevision: currentFinalResponse.reviewedRevision,
          reviewImageRevision: finalReviewCall.reviewImageRevision,
          structuralObservationRevision:
            finalReviewCall.structuralObservationRevision,
          bindingRevision: currentFinalResponse.bindingRevision,
          bindingDigest: currentFinalResponse.bindingDigest,
          verdict: currentFinalResponse.verdict,
          remainingCalls: currentFinalResponse.remainingCalls,
          issueCount: currentFinalResponse.issueCount,
        };
        report.phaseOrder.push(
          `final-review-verdict-${currentFinalResponse.verdict}`,
        );
        expectedLiveCalls = finalReviewCall.ordinal;

        if (currentFinalResponse.verdict === "revise") {
          await expect
            .poll(async () => (await readActivityHistory(page)).reviewPartial, {
              timeout: 30000,
            })
            .toBe(true);
          report.phaseOrder.push("final-review-revise-bounded-incomplete");
          const activity = await readActivityHistory(page);
          report.browserActivity.authoring = activity;
          const reviseEvidence = await screenshotEvidence(
            page,
            "final-review-bounded-incomplete",
            privateEvidenceDirectory,
          );
          report.evidence.push(reviseEvidence);
          if (reviseEvidence.privatePngWritten)
            report.privateEvidence.screenshotsWritten += 1;
          const afterFinalReview = await waitForSavedRevision(
            page,
            finalReviewCall.projectRevision,
            30000,
            undefined,
            true,
          );
          if (
            !afterFinalReview ||
            afterFinalReview.projectId !== generated.projectId ||
            afterFinalReview.revision !== finalReviewCall.projectRevision
          )
            throw new AcceptanceError(stage, "final-review-scene-not-saved");
          report.storage.afterFinalReview = {
            projectId: validId(afterFinalReview.projectId),
            revision: safeRevision(afterFinalReview.revision),
            structure: afterFinalReview.structure,
          };
          await page.reload({ waitUntil: "domcontentloaded" });
          await expect(page.locator("canvas")).toBeVisible({ timeout: 30000 });
          const recovered = await waitForSavedRevision(
            page,
            afterFinalReview.revision,
            30000,
          );
          if (
            !recovered ||
            recovered.projectId !== afterFinalReview.projectId ||
            recovered.revision !== afterFinalReview.revision
          )
            throw new AcceptanceError(
              "reload-recovery",
              "final-review-scene-changed-after-reload",
            );
          const reloadStorage = await storageSnapshot(page, keyDigest);
          if (reloadStorage.sensitive)
            throw new AcceptanceError(
              "reload-recovery",
              "provider-key-found-in-browser-storage",
            );
          report.storage.afterReload = {
            projectId: validId(recovered.projectId),
            revision: safeRevision(recovered.revision),
            keyPersisted: false,
            recovered: true,
          };
          report.outcome = "bounded-incomplete";
        } else {
          acceptedCall = finalReviewCall;
          acceptedResponse = currentFinalResponse;
          acceptedPhase = "final-review";
        }
      }
    }

    if (report.outcome !== "bounded-incomplete") {
      if (
        acceptedResponse.bindingRevision !== acceptedResponse.reviewedRevision
      )
        throw new AcceptanceError(
          stage,
          "accepted-review-binding-revision-mismatch",
        );
      if (acceptedPhase === "final-review") {
        if (
          acceptedResponse.bindingRevision !==
            latestReviewResponse.bindingRevision ||
          acceptedCall.projectRevision !== latestReviewResponse.bindingRevision
        )
          throw new AcceptanceError(
            "final-review",
            "accepted-final-review-corrected-revision-mismatch",
          );
      }
      const completed = await waitForSavedRevision(
        page,
        acceptedResponse.bindingRevision,
        30000,
        undefined,
        true,
      );
      if (
        !completed ||
        completed.projectId !== generated.projectId ||
        completed.revision !== acceptedResponse.bindingRevision
      )
        throw new AcceptanceError(stage, "accepted-scene-not-saved");
      await expect(page.locator(".authoring-activity-latest p")).toHaveText(
        "Scene verified. Changes are applied.",
        { timeout: 30000 },
      );
      report.storage.afterReview = {
        projectId: validId(completed.projectId),
        revision: safeRevision(completed.revision),
        phase: acceptedPhase,
        structure: completed.structure,
      };
      if (acceptedPhase === "final-review")
        report.storage.afterFinalReview = {
          projectId: validId(completed.projectId),
          revision: safeRevision(completed.revision),
          structure: completed.structure,
        };
      const activity = await readActivityHistory(page);
      report.browserActivity.authoring = activity;
      if (!activity.completed)
        throw new AcceptanceError(stage, "browser-completion-activity-missing");
      const reviewedEvidence = await screenshotEvidence(
        page,
        "review-complete",
        privateEvidenceDirectory,
      );
      report.evidence.push(reviewedEvidence);
      if (reviewedEvidence.privatePngWritten)
        report.privateEvidence.screenshotsWritten += 1;
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("canvas")).toBeVisible({ timeout: 30000 });
      const reloaded = await waitForSavedRevision(
        page,
        completed.revision,
        30000,
      );
      if (
        !reloaded ||
        reloaded.projectId !== completed.projectId ||
        reloaded.revision !== completed.revision
      )
        throw new AcceptanceError(
          "reload-recovery",
          "accepted-scene-changed-after-reload",
        );
      const reloadStorage = await storageSnapshot(page, keyDigest);
      if (reloadStorage.sensitive)
        throw new AcceptanceError(
          "reload-recovery",
          "provider-key-found-in-browser-storage",
        );
      report.storage.afterReload = {
        projectId: validId(reloaded.projectId),
        revision: safeRevision(reloaded.revision),
        keyPersisted: false,
        recovered: true,
      };
    }

    if (
      report.outcome === "running" ||
      report.outcome === "bounded-incomplete"
    ) {
      await page.waitForTimeout(500);
      if (
        report.actualLiveCalls !== expectedLiveCalls ||
        report.blockedCalls !== 0
      )
        throw new AcceptanceError("acceptance", "unexpected-live-call-count");
      if (report.blockedExternalRequests !== 0)
        throw new AcceptanceError("acceptance", "external-request-was-blocked");
      if (report.outcome === "running") report.outcome = "passed";
    }

    if (report.blockedCalls > 0 && report.outcome === "passed")
      throw new AcceptanceError("acceptance", "call-budget-guard-triggered");
  } catch (error) {
    const known = error instanceof AcceptanceError ? error : null;
    report.outcome = report.outcome === "running" ? "failed" : report.outcome;
    report.failure = {
      stage: known?.stage ?? stage,
      code: known?.code ?? "browser-acceptance-error",
      ...(known?.status ? { status: known.status } : {}),
      errorType: known
        ? "AcceptanceError"
        : (error?.constructor?.name ?? "Error"),
    };
    if (page && (stage === "review" || stage === "final-review")) {
      try {
        const summary = await readProjectSummary(page);
        report.storage.afterFailure = summary
          ? {
              projectId: validId(summary.projectId),
              revision: safeRevision(summary.revision),
            }
          : null;
        report.browserActivity.authoring = await readActivityHistory(page);
        const failureEvidence = await screenshotEvidence(
          page,
          "review-failed",
          privateEvidenceDirectory,
        );
        report.evidence.push(failureEvidence);
        if (failureEvidence.privatePngWritten)
          report.privateEvidence.screenshotsWritten += 1;
      } catch {
        report.failure.evidenceCapture = "unavailable";
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (privateEvidenceDirectory) {
      try {
        await writePrivateReviewFindings(
          privateEvidenceDirectory,
          privateReviewFindings,
        );
        report.privateEvidence.reviewFindingsStatus = "written";
        report.privateEvidence.reviewFindingsCount = Math.min(
          privateReviewFindings.length,
          MAX_REVIEW_FINDINGS,
        );
      } catch {
        report.privateEvidence.reviewFindingsStatus = "unavailable";
      }
    }
    try {
      await writeSafeReport(reportPath, report);
    } catch {
      process.stderr.write(
        "Could not write sanitized live acceptance report.\n",
      );
      process.exitCode = 1;
      return;
    }
  }

  process.stdout.write(
    `${report.outcome}: ${report.failure?.stage ?? "complete"}`,
  );
  if (report.failure?.status)
    process.stdout.write(` HTTP ${report.failure.status}`);
  process.stdout.write(`; report ${reportPath}\n`);
  if (report.outcome === "failed") process.exitCode = 1;
  else if (report.outcome === "bounded-incomplete") process.exitCode = 2;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch (error) {
    const code =
      error instanceof AcceptanceError
        ? error.code
        : "acceptance-configuration-error";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}
