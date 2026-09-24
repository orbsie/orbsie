import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";

const state = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock("../src/lib/server/auth", async (original) => ({
  ...(await original<typeof import("../src/lib/server/auth")>()),
  database: state.database,
  getAuth: vi.fn(() => null),
}));

import { blankProject } from "../src/lib/protocol";
import { createSceneBinding } from "../src/lib/scene-binding";
import { trialIdentity, type TrialIdentity } from "../src/lib/server/trial";
import {
  admitAuthoringReviewPhase,
  admitInitialAuthoringRun,
} from "../src/lib/server/authoring-run-admission";
import type { AuthoringProvider } from "../src/lib/server/authoring-run-ledger";
import { readAuthoringRun } from "../src/lib/server/authoring-run-ledger";
import { POST } from "../src/app/api/generate/review/route";

const databaseUrl = process.env.ORBSIE_LEDGER_TEST_DATABASE_URL;
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, max: 5 })
  : null;
const model = "openai/gpt-6-luna";
const nonRecommendedModel = "provider/non-recommended";

async function seedCompletedRun(
  project: ReturnType<typeof blankProject>,
  cookie: string,
  seedModel = model,
  provider: AuthoringProvider = "gateway",
  seedTrialIdentity?: TrialIdentity,
) {
  const initialRequest = new Request("https://orbsie.test/api/generate", {
    headers: { cookie },
  });
  const initial = await admitInitialAuthoringRun({
    request: initialRequest,
    project,
    prompt: "  Make   a garden ",
    provider,
    model: seedModel,
    localModeling: false,
    browserModeling: false,
    signal: new AbortController().signal,
    ...(provider === "free" ? { trialIdentity: seedTrialIdentity } : {}),
  });
  await initial.complete(
    await createSceneBinding(project),
    new AbortController().signal,
  );
  return initial;
}

function reviewRequest(cookie: string, body: Record<string, unknown>) {
  return new Request("https://orbsie.test/api/generate/review", {
    method: "POST",
    headers: {
      origin: "https://orbsie.test",
      cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-public-review-secret");
  vi.stubEnv("BETTER_AUTH_URL", "https://orbsie.test");
  vi.stubEnv("ORBSIE_AUTHORING_REVIEW", "1");
  vi.stubEnv("AI_GATEWAY_API_KEY_FREE", "synthetic-free-key");
  vi.stubEnv("DATABASE_URL", databaseUrl ?? "synthetic");
  if (!pool) return;
  state.database.mockReturnValue({
    query: pool.query.bind(pool),
    connect: pool.connect.bind(pool),
  });
  await pool.query(await readFile("scripts/trial-schema.sql", "utf8"));
  await pool.query(await readFile("scripts/authoring-run-schema.sql", "utf8"));
});

afterAll(async () => {
  await pool?.end();
  vi.unstubAllEnvs();
});

it.runIf(process.env.RUN_AUTHORING_LEDGER_DATABASE_TEST === "1")(
  "admits two correction reviews and one final verdict through PostgreSQL",
  async () => {
    if (!pool) throw Error("Synthetic PostgreSQL URL required");
    const project = blankProject();
    const seedIdentity = trialIdentity(
      new Request("https://orbsie.test/api/generate"),
    );
    const cookie = seedIdentity.cookie.split(";", 1)[0];
    const initial = await seedCompletedRun(
      project,
      cookie,
      model,
      "free",
      seedIdentity,
    );
    const signal = new AbortController().signal;
    const firstCorrection = {
      ...project,
      revision: project.revision + 1,
      environment: { ...project.environment, sky: "#aabbff" },
    };
    const secondCorrection = {
      ...firstCorrection,
      revision: firstCorrection.revision + 1,
      environment: { ...firstCorrection.environment, sky: "#88ccff" },
    };
    const admit = (
      scene: typeof project,
      reviewPhase: "review" | "final-review",
    ) =>
      admitAuthoringReviewPhase({
        request: reviewRequest(cookie, {}),
        project: scene,
        prompt: "Make a garden",
        provider: "free",
        model,
        localModeling: false,
        browserModeling: false,
        runId: initial.runId,
        reviewPhase,
        signal,
        trialIdentity: seedIdentity,
      });
    try {
      const first = await admit(project, "review");
      expect(first.remainingReviewSlots).toBe(2);
      await first.complete(
        await createSceneBinding(firstCorrection),
        false,
        signal,
      );

      const second = await admit(firstCorrection, "review");
      expect(second.remainingReviewSlots).toBe(1);
      await second.complete(
        await createSceneBinding(secondCorrection),
        false,
        signal,
      );

      const final = await admit(secondCorrection, "final-review");
      expect(final.remainingReviewSlots).toBe(0);
      await final.complete(
        await createSceneBinding(secondCorrection),
        true,
        signal,
      );
      expect(await readAuthoringRun(initial.runId)).toMatchObject({
        phase: "finalized",
        remainingReviewSlots: 0,
        completedRevision: secondCorrection.revision,
      });
      await expect(admit(secondCorrection, "final-review")).rejects.toThrow();
    } finally {
      await pool.query("DELETE FROM orbsie_authoring_runs WHERE run_id=$1", [
        initial.runId,
      ]);
    }
  },
  15000,
);

it.runIf(process.env.RUN_AUTHORING_LEDGER_DATABASE_TEST === "1")(
  "runs one real public review route through coordinator, provider adapter, and PostgreSQL",
  async () => {
    if (!pool) throw Error("Synthetic PostgreSQL URL required");
    const project = blankProject();
    const seedIdentity = trialIdentity(
      new Request("https://orbsie.test/api/generate"),
    );
    const cookie = seedIdentity.cookie.split(";", 1)[0];
    const initial = await seedCompletedRun(
      project,
      cookie,
      model,
      "free",
      seedIdentity,
    );

    const providerCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://ai-gateway.vercel.sh/v1/models")
          return Response.json({
            data: [
              {
                id: model,
                type: "language",
                architecture: { output_modalities: ["text"] },
                modalities: { input: ["text"] },
              },
            ],
          });
        if (url === "https://ai-gateway.vercel.sh/v1/chat/completions") {
          providerCalls.push(String(init?.body));
          return Response.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    version: 1,
                    projectId: project.id,
                    reviewedRevision: project.revision,
                    scope: "structural-only",
                    verdict: "accept",
                    summary: "The scene is coherent.",
                    issues: [],
                    corrections: [],
                  }),
                },
                finish_reason: "stop",
              },
            ],
          });
        }
        throw Error(`Unexpected synthetic fetch: ${url}`);
      }),
    );

    const response = await POST(
      reviewRequest(cookie, {
        runId: initial.runId,
        phase: "review",
        provider: "free",
        prompt: "Make a garden",
        project,
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.review.verdict).toBe("accept");
    expect(body.remainingCalls).toBe(0);
    expect(body).not.toHaveProperty("phaseToken");
    expect(response.headers.get("X-Orbsie-Request-Id")).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(providerCalls).toHaveLength(1);
    expect(JSON.parse(providerCalls[0])).toMatchObject({
      model,
      reasoning: { effort: "low" },
    });
    expect(await readAuthoringRun(initial.runId)).toMatchObject({
      phase: "finalized",
      remainingReviewSlots: 0,
      completedRevision: project.revision,
    });

    await pool.query("DELETE FROM orbsie_authoring_runs WHERE run_id=$1", [
      initial.runId,
    ]);
  },
  15000,
);

it.runIf(process.env.RUN_AUTHORING_LEDGER_DATABASE_TEST === "1")(
  "fails and fences a review after provider rejection through PostgreSQL",
  async () => {
    if (!pool) throw Error("Synthetic PostgreSQL URL required");
    const project = blankProject();
    const seedIdentity = trialIdentity(
      new Request("https://orbsie.test/api/generate"),
    );
    const cookie = seedIdentity.cookie.split(";", 1)[0];
    const initial = await seedCompletedRun(
      project,
      cookie,
      nonRecommendedModel,
    );
    const providerCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://ai-gateway.vercel.sh/v1/models")
          return Response.json({
            data: [
              {
                id: nonRecommendedModel,
                type: "language",
                architecture: { output_modalities: ["text"] },
                modalities: { input: ["text"] },
              },
            ],
          });
        if (url === "https://ai-gateway.vercel.sh/v1/chat/completions") {
          providerCalls.push(String(init?.body));
          return Response.json(
            {
              error: {
                message: "raw-provider-secret-must-not-cross-the-route",
              },
            },
            { status: 429 },
          );
        }
        throw Error(`Unexpected synthetic fetch: ${url}`);
      }),
    );

    const body = {
      runId: initial.runId,
      phase: "review",
      provider: "gateway",
      model: nonRecommendedModel,
      key: "synthetic-provider-key",
      prompt: "Make a garden",
      project,
    };
    try {
      const response = await POST(reviewRequest(cookie, body));
      expect(response.status).toBe(502);
      const responseText = await response.text();
      expect(responseText).toContain(
        "The scene review provider rejected the request.",
      );
      expect(responseText).not.toContain(
        "raw-provider-secret-must-not-cross-the-route",
      );
      expect(responseText).not.toContain("synthetic-provider-key");
      expect(responseText).not.toContain("phaseToken");
      expect(providerCalls).toHaveLength(1);
      expect(JSON.parse(providerCalls[0]).reasoning).toBeUndefined();
      expect(await readAuthoringRun(initial.runId)).toMatchObject({
        phase: "failed",
      });

      const replay = await POST(reviewRequest(cookie, body));
      expect(replay.status).toBe(409);
      const replayText = await replay.text();
      expect(replayText).not.toContain(
        "raw-provider-secret-must-not-cross-the-route",
      );
      expect(replayText).not.toContain("synthetic-provider-key");
      expect(replayText).not.toContain("phaseToken");
      expect(providerCalls).toHaveLength(1);
      expect(await readAuthoringRun(initial.runId)).toMatchObject({
        phase: "failed",
      });
    } finally {
      await pool.query("DELETE FROM orbsie_authoring_runs WHERE run_id=$1", [
        initial.runId,
      ]);
    }
  },
  15000,
);
