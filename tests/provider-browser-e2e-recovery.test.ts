import { afterEach, describe, expect, it } from "vitest";
import {
  buildFreeTrialFailureEvidence,
  classifyFailureCheckpoint,
  emptyReport,
  installTrafficGuard,
  providerReloadStrategy,
  recordGenerationResponseEvidence,
  readConfiguration,
  trialRemainingFromHeaders,
} from "../scripts/provider-browser-e2e.mjs";
import { blankProject } from "../src/lib/protocol";
import {
  HOSTED_FLAGSHIP_TEST_LIMITS,
  HOSTED_TEST_LIMITS,
} from "../scripts/lib/hosted-chatgpt-acceptance.mjs";

const ENV_NAMES = [
  "ORBSIE_LIVE_E2E",
  "ORBSIE_APP_SOURCE_COMMIT",
  "ORBSIE_TEST_URL",
  "ORBSIE_EXPECTED_MODEL",
  "ORBSIE_SERVICE_TIER",
  "ORBSIE_ACCOUNT_STORAGE_STATE",
  "ORBSIE_CHATGPT_TEST_LIMITS",
  "ORBSIE_VERIFY_CLOUD_RECOVERY",
  "ORBSIE_VERIFY_INTERRUPTED_RECOVERY",
  "ORBSIE_INTERRUPTION_METHOD",
  "ORBSIE_INTERRUPTED_GENERATION_BUDGET",
  "ORBSIE_CLOUD_TEST_STATE",
  "OPENROUTER_API_KEY",
  "AI_GATEWAY_TEST_KEY",
  "AI_GATEWAY_API_KEY",
];

const savedEnvironment = new Map(
  ENV_NAMES.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  for (const name of ENV_NAMES) {
    const value = savedEnvironment.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function setHostedEnvironment(overrides: Record<string, string> = {}) {
  for (const name of ENV_NAMES) delete process.env[name];
  Object.assign(process.env, {
    ORBSIE_LIVE_E2E: "1",
    ORBSIE_APP_SOURCE_COMMIT: "a".repeat(40),
    ORBSIE_TEST_URL: "https://orbsie.example.test",
    ORBSIE_EXPECTED_MODEL: "gpt-5.6-luna",
    ORBSIE_SERVICE_TIER: "default",
    ORBSIE_ACCOUNT_STORAGE_STATE: "/private/account-storage.json",
    ORBSIE_CHATGPT_TEST_LIMITS: HOSTED_FLAGSHIP_TEST_LIMITS,
    ORBSIE_VERIFY_CLOUD_RECOVERY: "1",
    ORBSIE_VERIFY_INTERRUPTED_RECOVERY: "1",
    ...overrides,
  });
}

describe("provider browser interrupted recovery contract", () => {
  it("records a bounded free-trial response allowance", () => {
    const info = {
      generationStatuses: [],
      generationTrialRemaining: [],
    };
    recordGenerationResponseEvidence(
      {
        status: () => 200,
        headers: () => ({ "x-orbsie-trial-remaining": "2" }),
      },
      { provider: "free" },
      info,
    );
    expect(info.generationStatuses).toEqual([200]);
    expect(info.generationTrialRemaining).toEqual([2]);
    expect(
      trialRemainingFromHeaders(
        new Headers({ "X-Orbsie-Trial-Remaining": "not-a-count" }),
      ),
    ).toBeNull();
  });

  it("distinguishes unchanged and unverified partial failure checkpoints", () => {
    const before = blankProject();
    expect(
      classifyFailureCheckpoint(before, structuredClone(before)),
    ).toMatchObject({
      status: "unchanged",
      reason: "same-committed-scene",
    });

    const metadataOnly = structuredClone(before);
    metadataOnly.messages.push({ role: "assistant", text: "Finished" });
    expect(classifyFailureCheckpoint(before, metadataOnly)).toMatchObject({
      status: "unchanged",
      reason: "same-committed-scene",
    });

    const partial = structuredClone(before);
    partial.revision = 1;
    partial.entities.push({
      id: "new-object",
      label: "New object",
      position: [0, 0, 0],
      scale: [1, 1, 1],
      color: "#6ead60",
      stage: "ready",
    });
    expect(classifyFailureCheckpoint(before, partial)).toMatchObject({
      status: "partial-unverified",
      reason: "structural-check-only",
      before: { revision: 0, entityIds: [] },
      after: { revision: 1, entityIds: ["new-object"] },
    });
  });

  it("does not classify an invalid geometry shape as a partial checkpoint", () => {
    const before = blankProject();
    const invalid = structuredClone(before);
    invalid.revision = 1;
    invalid.entities.push({
      id: "broken-object",
      label: "Broken object",
      position: [0, 0, 0],
      scale: [1, 1, 1],
      color: "#6ead60",
      stage: "ready",
      geometry: {
        kind: "not-a-supported-geometry",
        detail: "refined",
      } as never,
    });
    expect(classifyFailureCheckpoint(before, invalid)).toMatchObject({
      status: "corrupt",
      reason: "after-invalid",
    });
  });

  it("marks a corrupted post-failure project without replacing the original failure", () => {
    const before = blankProject();
    const corrupted = structuredClone(before);
    corrupted.id = "other-project";
    const evidence = buildFreeTrialFailureEvidence({
      responseRemaining: 2,
      trialStatus: 200,
      trialBody: { enabled: true, remaining: 2, limit: 3 },
      beforeProject: before,
      afterProject: corrupted,
    });
    expect(evidence).toMatchObject({
      status: "observed",
      responseRemaining: 2,
      refreshedTrial: { status: 200, enabled: true, remaining: 2, limit: 3 },
      checkpoint: { status: "corrupt", reason: "project-id-changed" },
    });
    expect(Object.keys(evidence.checkpoint.after ?? {})).toEqual([
      "id",
      "revision",
      "entityIds",
    ]);
  });

  it("requires an explicit three-generation budget", () => {
    setHostedEnvironment();
    expect(() => readConfiguration(["--provider", "chatgpt-hosted"])).toThrow(
      /ORBSIE_INTERRUPTED_GENERATION_BUDGET=3 is required/,
    );

    setHostedEnvironment({ ORBSIE_INTERRUPTED_GENERATION_BUDGET: "2" });
    expect(() => readConfiguration(["--provider", "chatgpt-hosted"])).toThrow(
      /ORBSIE_INTERRUPTED_GENERATION_BUDGET must be exactly 3/,
    );
  });

  it("accepts only the explicitly configured three-call interrupted run", () => {
    setHostedEnvironment({ ORBSIE_INTERRUPTED_GENERATION_BUDGET: "3" });
    expect(readConfiguration(["--provider", "chatgpt-hosted"])).toMatchObject({
      provider: "chatgpt-hosted",
      generationBudget: 3,
      interruptedRecovery: true,
      hostedTestLimits: HOSTED_FLAGSHIP_TEST_LIMITS,
      hostedActualBounds: { generationCalls: 3 },
    });

    setHostedEnvironment({
      ORBSIE_VERIFY_CLOUD_RECOVERY: "0",
      ORBSIE_VERIFY_INTERRUPTED_RECOVERY: "0",
      ORBSIE_CHATGPT_TEST_LIMITS: HOSTED_TEST_LIMITS,
    });
    expect(readConfiguration(["--provider", "chatgpt-hosted"])).toMatchObject({
      generationBudget: 2,
    });
  });

  it("selects a provider-specific reload path and rejects free recovery", () => {
    expect(providerReloadStrategy("chatgpt-local")).toBe("companion");
    expect(providerReloadStrategy("openrouter")).toBe("api");
    expect(providerReloadStrategy("gateway")).toBe("api");
    expect(providerReloadStrategy("chatgpt-hosted")).toBe("hosted");
    expect(() => providerReloadStrategy("free")).toThrow(/unsupported/);
  });

  it("does not place a provider credential in the sanitized report", () => {
    const report = emptyReport({
      provider: "gateway",
      baseOrigin: "http://127.0.0.1:3018",
      expectedModel: "openai/gpt-5.6-luna",
      keyScope: "local-only",
      outputCap: 4096,
      generationBudget: 2,
      cloudRecovery: false,
      interruptedRecovery: false,
      interruptionMethod: "stop",
      key: "gateway-secret-must-not-appear",
    });
    expect(JSON.stringify(report)).not.toContain(
      "gateway-secret-must-not-appear",
    );
  });

  it("enforces default2 and explicit3 API budgets before route continuation", async () => {
    const dispatch = async (generationBudget: number, attempts: number) => {
      const handlers: Array<(route: any) => Promise<void>> = [];
      const context = {
        route: async (
          _pattern: string,
          handler: (route: any) => Promise<void>,
        ) => {
          handlers.push(handler);
        },
      };
      const config = {
        provider: "gateway",
        baseOrigin: "http://127.0.0.1:3018",
        generationBudget,
      };
      const info: Record<string, any> = { apiGenerationAttempts: attempts };
      await installTrafficGuard(
        context as any,
        config as any,
        new Set([config.baseOrigin]),
        info,
      );
      let aborted: string | undefined;
      let continued = false;
      const request = {
        url: () => `${config.baseOrigin}/api/generate`,
        method: () => "POST",
      };
      await handlers[0]({
        request: () => request,
        abort: async (reason: string) => {
          aborted = reason;
        },
        continue: async () => {
          continued = true;
        },
      });
      return { aborted, continued, info };
    };

    await expect(dispatch(2, 1)).resolves.toMatchObject({
      aborted: undefined,
      continued: true,
    });
    await expect(dispatch(2, 2)).resolves.toMatchObject({
      aborted: "blockedbyclient",
      continued: false,
    });
    await expect(dispatch(3, 2)).resolves.toMatchObject({
      aborted: undefined,
      continued: true,
    });
    const exhausted = await dispatch(3, 3);
    expect(exhausted).toMatchObject({
      aborted: "blockedbyclient",
      continued: false,
    });
    expect(exhausted.info.generationBudgetViolations).toEqual([
      "api-generation-budget-exhausted",
    ]);
  });

  it("blocks an API generation when the configured budget is invalid", async () => {
    const handlers: Array<(route: any) => Promise<void>> = [];
    const context = {
      route: async (
        _pattern: string,
        handler: (route: any) => Promise<void>,
      ) => {
        handlers.push(handler);
      },
    };
    const config = {
      provider: "gateway",
      baseOrigin: "http://127.0.0.1:3018",
      generationBudget: undefined,
    };
    const info: Record<string, any> = { apiGenerationAttempts: 0 };
    await installTrafficGuard(
      context as any,
      config as any,
      new Set([config.baseOrigin]),
      info,
    );
    let aborted: string | undefined;
    let continued = false;
    const request = {
      url: () => `${config.baseOrigin}/api/generate`,
      method: () => "POST",
    };
    await handlers[0]({
      request: () => request,
      abort: async (reason: string) => {
        aborted = reason;
      },
      continue: async () => {
        continued = true;
      },
    });
    expect(aborted).toBe("blockedbyclient");
    expect(continued).toBe(false);
    expect(info.generationBudgetViolations).toEqual([
      "invalid-generation-budget",
    ]);
  });
});
