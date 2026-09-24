import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  authorizeAuthoringReviewCall,
  classifyOwnOriginRequestFailure,
  configuredLiveCallLimit,
  preflightGenerationOrigin,
  safePrivateReviewFinding,
  safeReviewResponse,
  summarizeProjectStructure,
  validateReviewBindingRevision,
  validateReviewProgression,
  writePrivateReviewFindings,
} from "../scripts/verify-live-authoring-review.mjs";

const PROJECT_ID = "123e4567-e89b-42d3-a456-426614174000";
const RUN_ID = "223e4567-e89b-42d3-a456-426614174001";
const CLIENT_RUN_ID = "323e4567-e89b-42d3-a456-426614174002";
const REQUEST_ID = "423e4567-e89b-42d3-a456-426614174003";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
type CallFixture = Record<string, unknown>;
type GuardOptions = {
  liveCallLimit?: number;
  outputCap?: number;
  serviceTier?: string;
  retryCount?: number;
  expectedInitialRevision?: number | null;
};

function initialCall(): CallFixture {
  return {
    ordinal: 1,
    phase: "initial-generation",
    route: "/api/generate",
    method: "POST",
    status: 200,
    requestId: REQUEST_ID,
    clientRunId: CLIENT_RUN_ID,
    authoringRunId: RUN_ID,
    projectId: PROJECT_ID,
    modelMatched: true,
    providerMatched: true,
    authoringReviewEnabled: true,
    blocked: false,
  };
}

function reviewCall({
  ordinal,
  phase = "review",
  projectRevision,
  bindingRevision,
  remainingCalls,
  verdict = "revise",
  digest = DIGEST_A,
}: {
  ordinal: number;
  phase?: string;
  projectRevision: number;
  bindingRevision: number | null;
  remainingCalls: number | null;
  verdict?: string;
  digest?: string;
}): CallFixture {
  return {
    ordinal,
    phase,
    route: "/api/generate/review",
    method: "POST",
    status: 200,
    requestId: `523e4567-e89b-42d3-a456-${String(ordinal).padStart(12, "0")}`,
    clientRunId: CLIENT_RUN_ID,
    authoringRunId: RUN_ID,
    requestedAuthoringRunId: RUN_ID,
    projectId: PROJECT_ID,
    projectRevision,
    modelMatched: true,
    providerMatched: true,
    reviewScope: "visual+structural",
    reviewImageProjectId: PROJECT_ID,
    reviewImageRevision: projectRevision,
    structuralObservationProjectId: PROJECT_ID,
    structuralObservationRevision: projectRevision,
    responseBindingRevision: bindingRevision,
    responseBindingDigest: digest,
    remainingCalls,
    verdict,
    blocked: false,
  };
}

function authorize(
  call: CallFixture,
  previousCalls: CallFixture[],
  options: GuardOptions = {},
) {
  return authorizeAuthoringReviewCall({
    call,
    previousCalls,
    liveCallLimit: options.liveCallLimit ?? 3,
    outputCap: options.outputCap ?? 4096,
    serviceTier: options.serviceTier ?? "default",
    retryCount: options.retryCount ?? 0,
    expectedInitialRevision: options.expectedInitialRevision ?? 1,
  });
}

function nextReviewRequest({
  ordinal,
  phase,
  projectRevision,
}: {
  ordinal: number;
  phase: string;
  projectRevision: number;
}): CallFixture {
  return {
    ...reviewCall({
      ordinal,
      phase,
      projectRevision,
      bindingRevision: null,
      remainingCalls: null,
    }),
    responseBindingRevision: null,
    responseBindingDigest: null,
    verdict: null,
    remainingCalls: null,
  };
}

describe("live authoring structural summary", () => {
  it("counts bounded geometry, part shape, scale, and color facts without retaining source data", () => {
    const summary = summarizeProjectStructure([
      {
        stage: "ready",
        geometryKind: "custom",
        entityScale: [2, 2, 2],
        entityColor: "#2244ff",
        partColors: ["#1555ee", null],
        partFacts: [
          {
            shape: "sphere",
            scale: [2, 2, 1],
            id: "private-part-id",
            profile: [[6.2718, 9.8341]],
          },
          {
            shape: "lathe",
            scale: [0.3, 0.3, 0.3],
            profile: [[8.1264, 4.5673]],
          },
        ],
        label: "private entity label",
        prompt: "private prompt",
        messages: ["private model text"],
        credential: "private-provider-token",
        image: "private-image-bytes",
        id: "private-entity-id",
        position: [99, 99, 99],
      },
      {
        stage: "seed",
        geometryKind: "tree",
        entityScale: [1, 1, 1],
        entityColor: "#52aa43",
        partColors: ["#315ede", "#8a4c2c"],
        partFacts: [
          {
            shape: "private shape value",
            scale: [1000, 1, 1],
            recipe: "private recipe text",
          },
          { shape: null, scale: [0.2, 0.2, 0.2] },
        ],
      },
    ]);

    expect(summary).toMatchObject({
      entityCount: 2,
      stageCounts: { seed: 1, coarse: 0, ready: 1, unknown: 0 },
      geometryKindCounts: { custom: 1, tree: 1, absent: 0, other: 0 },
      customProceduralPartCount: 4,
      customPartShapeCounts: {
        sphere: 1,
        lathe: 1,
        absent: 1,
        unknown: 1,
      },
      customPartScaleFactorUpperBoundBinsByShape: {
        sphere: { fourPlus: 1 },
        lathe: { halfToOne: 1 },
        absent: { belowHalf: 1 },
        unknown: { unknown: 1 },
      },
      entityColorFamilyCounts: { blue: 1, green: 1, absent: 0 },
      partColorFamilyCounts: { blue: 2, brown: 1, absent: 1 },
    });
    expect(Object.keys(summary!)).toEqual([
      "entityCount",
      "stageCounts",
      "geometryKindCounts",
      "customProceduralPartCount",
      "customPartShapeCounts",
      "customPartScaleFactorUpperBoundBinsByShape",
      "entityColorFamilyCounts",
      "partColorFamilyCounts",
    ]);
    const serialized = JSON.stringify(summary);
    for (const privateValue of [
      "#2244ff",
      "#1555ee",
      "private entity label",
      "private prompt",
      "private model text",
      "private-provider-token",
      "private-image-bytes",
      "private-entity-id",
      "private-part-id",
      "private shape value",
      "private recipe text",
      "6.2718",
      "9.8341",
      "8.1264",
      "4.5673",
      "1000",
      "99",
    ])
      expect(serialized).not.toContain(privateValue);
  });

  it("caps counted entities and parts at the scene schema bounds", () => {
    const summary = summarizeProjectStructure(
      Array.from({ length: 170 }, () => ({
        stage: "ready",
        geometryKind: "custom",
        entityScale: [1, 1, 1],
        entityColor: "#0000ff",
        partColors: Array.from({ length: 40 }, () => "#0000ff"),
        partFacts: Array.from({ length: 40 }, () => ({
          shape: "sphere",
          scale: [5, 5, 5],
        })),
      })),
    );

    expect(summary?.entityCount).toBe(160);
    expect(summary?.customProceduralPartCount).toBe(160 * 32);
    expect(summary?.stageCounts.ready).toBe(160);
    expect(summary?.geometryKindCounts.custom).toBe(160);
    expect(summary?.customPartShapeCounts.sphere).toBe(160 * 32);
    expect(
      summary?.customPartScaleFactorUpperBoundBinsByShape.sphere.fourPlus,
    ).toBe(160 * 32);
    expect(summary?.entityColorFamilyCounts.blue).toBe(160);
    expect(summary?.partColorFamilyCounts.blue).toBe(160 * 32);
  });

  it("returns no summary for a missing or malformed snapshot", () => {
    expect(summarizeProjectStructure(null)).toBeNull();
  });
});

describe("live authoring review call budget guard", () => {
  it("keeps three calls as the default and requires explicit approval for four", () => {
    expect(configuredLiveCallLimit({})).toBe(3);
    expect(
      configuredLiveCallLimit({
        ORBSIE_LIVE_AUTHORING_REVIEW_CALL_LIMIT: "3",
      }),
    ).toBe(3);
    expect(
      configuredLiveCallLimit({
        ORBSIE_LIVE_AUTHORING_REVIEW_CALL_LIMIT: "4",
        ORBSIE_LIVE_AUTHORING_REVIEW_FOUR_CALLS_APPROVED: "1",
      }),
    ).toBe(4);
    expect(() =>
      configuredLiveCallLimit({
        ORBSIE_LIVE_AUTHORING_REVIEW_CALL_LIMIT: "4",
      }),
    ).toThrow("four-call-budget-approval-required");
    expect(() =>
      configuredLiveCallLimit({
        ORBSIE_LIVE_AUTHORING_REVIEW_FOUR_CALLS_APPROVED: "1",
      }),
    ).toThrow("four-call-budget-approval-required");
    expect(() =>
      configuredLiveCallLimit({
        ORBSIE_LIVE_AUTHORING_REVIEW_CALL_LIMIT: "5",
      }),
    ).toThrow("invalid-live-call-limit");
  });

  it("admits legacy one-review then final-review runs", () => {
    const initial = initialCall();
    const first = reviewCall({
      ordinal: 2,
      projectRevision: 1,
      bindingRevision: 3,
      remainingCalls: 1,
      digest: DIGEST_A,
    });
    expect(
      authorize(
        nextReviewRequest({ ordinal: 2, phase: "review", projectRevision: 1 }),
        [initial],
      ),
    ).toMatchObject({ allowed: true, expectedPhase: "review" });
    expect(
      authorize(
        nextReviewRequest({
          ordinal: 3,
          phase: "final-review",
          projectRevision: 3,
        }),
        [initial, first],
      ),
    ).toMatchObject({ allowed: true, expectedPhase: "final-review" });
  });

  it("admits the approved review, review, final-review sequence on decreasing slots", () => {
    const initial = initialCall();
    const first = reviewCall({
      ordinal: 2,
      projectRevision: 1,
      bindingRevision: 3,
      remainingCalls: 2,
      digest: DIGEST_A,
    });
    const second = reviewCall({
      ordinal: 3,
      projectRevision: 3,
      bindingRevision: 5,
      remainingCalls: 1,
      digest: DIGEST_B,
    });
    expect(
      authorize(
        nextReviewRequest({ ordinal: 3, phase: "review", projectRevision: 3 }),
        [initial, first],
        { liveCallLimit: 4 },
      ),
    ).toMatchObject({ allowed: true, expectedPhase: "review" });
    expect(
      authorize(
        nextReviewRequest({
          ordinal: 4,
          phase: "final-review",
          projectRevision: 5,
        }),
        [initial, first, second],
        { liveCallLimit: 4 },
      ),
    ).toMatchObject({ allowed: true, expectedPhase: "final-review" });
  });

  it("accepts review verdicts at either review ordinal and permits a partial final verdict", () => {
    expect(
      validateReviewProgression({
        phase: "review",
        verdict: "accept",
        remainingCalls: 0,
      }),
    ).toBeNull();
    expect(
      validateReviewProgression({
        phase: "review",
        verdict: "accept",
        remainingCalls: 0,
        previousReviewResponses: [{ remainingCalls: 2 }],
      }),
    ).toBeNull();
    expect(
      validateReviewProgression({
        phase: "final-review",
        verdict: "revise",
        remainingCalls: 0,
        previousReviewResponses: [{ remainingCalls: 2 }, { remainingCalls: 1 }],
      }),
    ).toBeNull();
    expect(
      validateReviewBindingRevision({
        phase: "final-review",
        verdict: "revise",
        reviewedRevision: 8,
        bindingRevision: 8,
      }),
    ).toBeNull();
    expect(
      validateReviewBindingRevision({
        phase: "review",
        verdict: "revise",
        reviewedRevision: 5,
        bindingRevision: 8,
      }),
    ).toBeNull();
    expect(
      validateReviewBindingRevision({
        phase: "review",
        verdict: "revise",
        reviewedRevision: 5,
        bindingRevision: 5,
      }),
    ).toBe("review-correction-binding-invalid");
  });

  it("fails closed on missing/nondecreasing slots, unexpected phases, replays, or extra calls", () => {
    const initial = initialCall();
    const missingSlots = reviewCall({
      ordinal: 2,
      projectRevision: 1,
      bindingRevision: 3,
      remainingCalls: null,
    });
    const nondecreasingSlots = reviewCall({
      ordinal: 3,
      projectRevision: 3,
      bindingRevision: 5,
      remainingCalls: 2,
    });
    const first = reviewCall({
      ordinal: 2,
      projectRevision: 1,
      bindingRevision: 3,
      remainingCalls: 2,
    });
    expect(
      authorize(
        nextReviewRequest({
          ordinal: 3,
          phase: "review",
          projectRevision: 3,
        }),
        [initial, missingSlots],
        { liveCallLimit: 4 },
      ).code,
    ).toBe("review-remaining-calls-missing");
    expect(
      validateReviewProgression({
        phase: "review",
        verdict: "revise",
        remainingCalls: 2,
        previousReviewResponses: [{ remainingCalls: 2 }],
      }),
    ).toBe("review-remaining-calls-nondecreasing");
    expect(
      authorize(
        nextReviewRequest({
          ordinal: 3,
          phase: "review",
          projectRevision: 3,
        }),
        [initial, first],
      ).code,
    ).toBe("four-call-budget-approval-required");
    expect(
      authorize(
        nextReviewRequest({
          ordinal: 3,
          phase: "final-review",
          projectRevision: 3,
        }),
        [initial, first],
        { liveCallLimit: 4 },
      ).code,
    ).toBe("unexpected-review-phase");
    expect(
      authorize(
        nextReviewRequest({
          ordinal: 4,
          phase: "review",
          projectRevision: 5,
        }),
        [initial, first, nondecreasingSlots],
        { liveCallLimit: 4 },
      ).code,
    ).toBe("review-remaining-calls-nondecreasing");
    expect(
      authorize(
        nextReviewRequest({
          ordinal: 3,
          phase: "final-review",
          projectRevision: 1,
        }),
        [
          initial,
          reviewCall({
            ordinal: 2,
            projectRevision: 1,
            bindingRevision: 1,
            remainingCalls: 0,
            verdict: "accept",
          }),
        ],
        { liveCallLimit: 4 },
      ).code,
    ).toBe("review-sequence-invalid");
    expect(
      authorize(
        {
          ...nextReviewRequest({
            ordinal: 5,
            phase: "final-review",
            projectRevision: 5,
          }),
        },
        [initial, first, nondecreasingSlots, nondecreasingSlots],
        { liveCallLimit: 4 },
      ).code,
    ).toBe("live-call-budget-exceeded");
    expect(
      authorize(
        {
          ...nextReviewRequest({
            ordinal: 2,
            phase: "private-phase",
            projectRevision: 1,
          }),
        },
        [initial],
      ).code,
    ).toBe("unexpected-review-phase");
  });

  it("rejects wrong binding, non-Luna, larger-output, non-default-tier, and retry requests", () => {
    const initial = initialCall();
    const valid = nextReviewRequest({
      ordinal: 2,
      phase: "review",
      projectRevision: 1,
    });
    const invalidRequests: Array<[Record<string, unknown>, string]> = [
      [{ authoringRunId: PROJECT_ID }, "review-request-binding-invalid"],
      [
        { requestedAuthoringRunId: PROJECT_ID },
        "review-request-binding-invalid",
      ],
      [{ clientRunId: RUN_ID }, "review-request-binding-invalid"],
      [{ projectId: RUN_ID }, "review-request-binding-invalid"],
      [{ projectRevision: 2 }, "review-request-binding-invalid"],
      [{ reviewImageRevision: 2 }, "review-request-binding-invalid"],
      [{ structuralObservationRevision: 2 }, "review-request-binding-invalid"],
      [{ reviewScope: "structural-only" }, "review-request-binding-invalid"],
      [{ modelMatched: false }, "exact-luna-model-required"],
      [{ phase: "other" }, "unexpected-review-phase"],
      [{ method: "GET" }, "post-required"],
    ];
    for (const [change, code] of invalidRequests) {
      expect(authorize({ ...valid, ...change }, [initial]).code).toBe(code);
    }
    expect(authorize(valid, [initial], { outputCap: 8192 }).code).toBe(
      "4096-output-cap-required",
    );
    expect(authorize(valid, [initial], { serviceTier: "priority" }).code).toBe(
      "default-service-tier-required",
    );
    expect(authorize(valid, [initial], { retryCount: 1 }).code).toBe(
      "automatic-retry-detected",
    );
    expect(
      authorize(valid, [initial], { expectedInitialRevision: 2 }).code,
    ).toBe("review-revision-binding-invalid");
  });

  it("keeps untrusted response errors and identifiers out of the parsed report", () => {
    const parsed = safeReviewResponse({
      review: {
        verdict: "revise",
        projectId: PROJECT_ID,
        reviewedRevision: 2,
        error: "raw provider secret",
      },
      binding: { revision: 3, digest: DIGEST_A, token: "private-token" },
      scope: "visual+structural",
      remainingCalls: 2,
      error: "credential-like-body-text",
      prompt: "private user request",
    });
    expect(parsed).toEqual({
      verdict: "revise",
      scope: "visual+structural",
      reviewProjectId: PROJECT_ID,
      reviewedRevision: 2,
      bindingRevision: 3,
      bindingDigest: DIGEST_A,
      remainingCalls: 2,
      issueCount: null,
    });
    const safe = JSON.stringify(parsed);
    for (const privateValue of [
      "raw provider secret",
      "private-token",
      "credential-like-body-text",
      "private user request",
    ])
      expect(safe).not.toContain(privateValue);
  });

  it("keeps bounded issue counts public and clips private findings to review schema fields", () => {
    const body = {
      review: {
        verdict: "revise",
        issues: [
          {
            summary: ` ${"Shape remains round. ".repeat(20)} `,
            entityIds: ["private-entity-id"],
          },
          {
            summary: "Skip extra fields",
            entityIds: [],
            credential: "private-token",
          },
          { summary: "Skip malformed identifiers", entityIds: ["secret/id"] },
          {
            summary: "Credential sk-123456789012345678901234 must not persist",
            entityIds: [],
          },
          {
            summary: "See https://private.example/?token=secret",
            entityIds: [],
          },
          { summary: "A useful finding", entityIds: [] },
        ],
        summary: "Do not retain review-wide text",
        projectId: PROJECT_ID,
        arbitrary: "do not retain",
      },
      requestBody: "private prompt",
      image: "data:image/png;base64,private-image",
      credential: "private-key",
    };

    expect(safeReviewResponse(body).issueCount).toBe(6);
    const finding = safePrivateReviewFinding(body, "review", 2);
    expect(finding).toEqual({
      phase: "review",
      ordinal: 2,
      verdict: "revise",
      issues: [
        "Shape remains round. ".repeat(20).trim().slice(0, 300),
        "A useful finding",
      ],
    });
    expect(Object.keys(finding!)).toEqual([
      "phase",
      "ordinal",
      "verdict",
      "issues",
    ]);
    const serialized = JSON.stringify(finding);
    for (const privateValue of [
      "private-entity-id",
      "private-token",
      "secret/id",
      "Do not retain review-wide text",
      "private prompt",
      "private-image",
      "private-key",
      "arbitrary",
      "sk-123456789012345678901234",
      "private.example",
    ])
      expect(serialized).not.toContain(privateValue);
    expect(safePrivateReviewFinding(body, "other", 2)).toBeNull();
    expect(safePrivateReviewFinding(body, "review", 5)).toBeNull();

    const tooMany = safePrivateReviewFinding(
      {
        review: {
          verdict: "accept",
          issues: Array.from({ length: 20 }, (_, index) => ({
            summary: `issue-${index}`,
            entityIds: [],
          })),
        },
      },
      "final-review",
      4,
    );
    expect(tooMany?.issues).toEqual(
      Array.from({ length: 8 }, (_, index) => `issue-${index}`),
    );
  });

  it("writes only strict bounded findings with private file permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orbsie-review-private-"));
    try {
      await writePrivateReviewFindings(directory, [
        {
          phase: "review",
          ordinal: 2,
          verdict: "revise",
          issues: ["Visible root shape"],
          requestBody: "must not persist",
          image: "must not persist",
        },
      ]);
      const path = join(directory, "review-findings.json");
      const saved = await readFile(path, "utf8");
      expect(JSON.parse(saved)).toEqual([
        {
          phase: "review",
          ordinal: 2,
          verdict: "revise",
          issues: ["Visible root shape"],
        },
      ]);
      expect(saved).not.toContain("must not persist");
      expect(((await stat(path)).mode & 0o777).toString(8)).toBe("600");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("live authoring request failure diagnostics", () => {
  it("records only a safe route category and recognized browser error code", () => {
    expect(
      classifyOwnOriginRequestFailure(
        "http://127.0.0.1:3100",
        "http://127.0.0.1:3100/api/generate/review?token=private",
        "net::ERR_CONNECTION_REFUSED https://secret.example/?key=private",
      ),
    ).toEqual({ route: "review", code: "net::ERR_CONNECTION_REFUSED" });
    expect(
      classifyOwnOriginRequestFailure(
        "http://127.0.0.1:3100",
        "http://127.0.0.1:3100/api/config",
        "private browser text with no recognized code",
      ),
    ).toEqual({ route: "configuration", code: null });
    expect(
      classifyOwnOriginRequestFailure(
        "http://127.0.0.1:3100",
        "https://secret.example/path?token=private",
        "net::ERR_FAILED",
      ),
    ).toBeNull();
  });
});

describe("live authoring origin preflight", () => {
  it("posts malformed JSON only to the configured loopback origin and accepts the parser 400", async () => {
    const response = new Response(null, { status: 400 });
    const readText = vi.spyOn(response, "text");
    const readJSON = vi.spyOn(response, "json");
    const fetchImpl = vi.fn(async (url, options) => {
      expect(url).toBe("http://127.0.0.1:3100/api/generate");
      expect(options).toMatchObject({
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1:3100",
          "Content-Type": "application/json",
        },
        body: "{",
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      });
      expect(options.signal).toBeInstanceOf(AbortSignal);
      return response;
    });

    await expect(
      preflightGenerationOrigin("http://127.0.0.1:3100", fetchImpl),
    ).resolves.toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readText).not.toHaveBeenCalled();
    expect(readJSON).not.toHaveBeenCalled();
  });

  it("reports an origin rejection explicitly without reading the response", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 403 }));

    await expect(
      preflightGenerationOrigin("http://localhost:3100", fetchImpl),
    ).rejects.toMatchObject({
      code: "generation-origin-preflight-rejected",
      status: 403,
    });
  });

  it("refuses non-loopback targets before making a request", async () => {
    const fetchImpl = vi.fn();

    await expect(
      preflightGenerationOrigin("https://example.com", fetchImpl),
    ).rejects.toMatchObject({
      code: "loopback-origin-required-for-preflight",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
