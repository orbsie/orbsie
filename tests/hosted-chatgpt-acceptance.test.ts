import { describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  HOSTED_EFFORT,
  HOSTED_MODEL,
  assertHostedGenerationPayload,
  assertHostedPreflight,
  assertHostedStatusConnected,
  filterHostedStorageState,
  hostedRouteDecision,
  statusFirstHostedGate,
  assertHostedModelCatalog,
  validateHostedNDJSON,
} from "../scripts/lib/hosted-chatgpt-acceptance.mjs";

const execFileAsync = promisify(execFile);

const target = "https://orbsie.example.test";

describe("hosted ChatGPT acceptance boundaries", () => {
  it("fails the live gate before inspecting the account-state path", () => {
    expect(() =>
      assertHostedPreflight({
        liveE2E: "0",
        baseOrigin: "http://127.0.0.1:3001",
        expectedModel: HOSTED_MODEL,
        accountStorageStatePath: "/path/that/must/not/be/read",
      }),
    ).toThrow(/ORBSIE_LIVE_E2E=1/);
    expect(() =>
      assertHostedPreflight({
        liveE2E: "1",
        baseOrigin: "http://127.0.0.1:3001",
        expectedModel: HOSTED_MODEL,
        accountStorageStatePath: "/private/state.json",
      }),
    ).toThrow(/HTTPS origin/);
  });

  it("keeps only exact-target HTTPS cookies and rejects localStorage or foreign domains", () => {
    const state = filterHostedStorageState(
      {
        cookies: [
          {
            name: "__Secure-session",
            value: "opaque",
            domain: "orbsie.example.test",
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "Lax",
          },
        ],
        origins: [],
      },
      target,
    );
    expect(state.origins).toEqual([]);
    expect(state.cookies).toHaveLength(1);
    expect(state.cookies[0].domain).toBe("orbsie.example.test");

    expect(() =>
      filterHostedStorageState(
        {
          cookies: [
            {
              name: "chatgpt-auth",
              value: "opaque",
              domain: "auth.openai.com",
              path: "/",
              secure: true,
            },
          ],
          origins: [],
        },
        target,
      ),
    ).toThrow(/exact HTTPS Orbsie target/);
    expect(() =>
      filterHostedStorageState(
        {
          cookies: [
            {
              name: "session",
              value: "opaque",
              domain: "orbsie.example.test",
              path: "/",
              secure: true,
            },
          ],
          origins: [{ origin: target, localStorage: [{ name: "secret" }] }],
        },
        target,
      ),
    ).toThrow(/localStorage/);
  });

  it("requires the exact Luna low catalog entry and browser-only request shape", () => {
    const catalog = assertHostedModelCatalog({
      models: [
        {
          id: "luna-catalog-id",
          model: HOSTED_MODEL,
          displayName: "Luna",
          supportedReasoningEfforts: ["low", "high"],
          defaultReasoningEffort: "low",
        },
      ],
    });
    expect(catalog).toMatchObject({
      model: HOSTED_MODEL,
      effort: HOSTED_EFFORT,
    });
    expect(() =>
      assertHostedModelCatalog({
        models: [
          {
            id: "luna-catalog-id",
            model: HOSTED_MODEL,
            displayName: "Luna",
            supportedReasoningEfforts: ["high"],
            defaultReasoningEffort: "high",
          },
        ],
      }),
    ).toThrow(/low reasoning/);

    expect(
      assertHostedGenerationPayload({
        model: HOSTED_MODEL,
        effort: HOSTED_EFFORT,
        prompt: "Create a small island.",
        project: { id: "project", revision: 0 },
        selected: "entity-1",
        browserModeling: true,
        localModeling: false,
      }),
    ).toMatchObject({
      model: HOSTED_MODEL,
      effort: HOSTED_EFFORT,
      browserModeling: true,
      localModeling: false,
    });
    expect(() =>
      assertHostedGenerationPayload({
        model: HOSTED_MODEL,
        effort: HOSTED_EFFORT,
        prompt: "Create a small island.",
        project: { id: "project", revision: 0 },
        browserModeling: true,
        localModeling: false,
        provider: "chatgpt-hosted",
      }),
    ).toThrow(/credential or provider field/);
    expect(validateHostedNDJSON('{"type":"commit_revision"}\n')).toEqual({
      valid: true,
      recordCount: 1,
    });
    expect(
      validateHostedNDJSON('{"type":"commit_revision"}\nnot-json'),
    ).toEqual({
      valid: false,
      recordCount: 1,
    });
    expect(validateHostedNDJSON('{"type":"error"}\n').valid).toBe(false);
  });

  it("blocks missing hosted consent before any generation path", async () => {
    const readSession = vi.fn();
    const generate = vi.fn();
    await expect(
      statusFirstHostedGate({
        readHostedStatus: async () => ({
          lifecycle: "idle",
          authStatus: "disconnected",
        }),
        readOrbsieSession: readSession,
        afterConnected: generate,
      }),
    ).rejects.toThrow(/not already connected/);
    expect(generate).not.toHaveBeenCalled();
    expect(readSession).not.toHaveBeenCalled();
    expect(() =>
      assertHostedStatusConnected({ lifecycle: "idle", authStatus: "unknown" }),
    ).toThrow(/not already connected/);
  });

  it("fails closed before dispatching forbidden hosted routes", () => {
    const request = {
      model: HOSTED_MODEL,
      effort: HOSTED_EFFORT,
      prompt: "Create a small island.",
      project: { id: "project", revision: 0 },
      browserModeling: true,
      localModeling: false,
    };
    const ready = {
      url: `${target}/api/chatgpt/generate`,
      method: "POST",
      consentReady: true,
      catalogReady: true,
      payload: request,
    };
    expect(hostedRouteDecision(ready)).toMatchObject({ action: "continue" });
    expect(hostedRouteDecision({ ...ready, catalogReady: false })).toMatchObject({
      action: "abort",
      reason: "generation-before-catalog",
    });
    expect(hostedRouteDecision({ ...ready, payload: { ...request, model: "unauthorized" } })).toMatchObject({
      action: "abort",
      reason: "invalid-hosted-payload",
    });
    expect(
      hostedRouteDecision({
        url: `${target}/api/generate`,
        method: "POST",
        consentReady: true,
        catalogReady: true,
        payload: request,
      }),
    ).toMatchObject({
      action: "abort",
      reason: "api-key-generation-forbidden",
    });
    expect(
      hostedRouteDecision({
        url: "http://127.0.0.1:43123/generate",
        method: "POST",
        consentReady: true,
        catalogReady: true,
        payload: request,
      }),
    ).toMatchObject({
      action: "abort",
      reason: "loopback-companion-forbidden",
    });
    expect(
      hostedRouteDecision({
        url: `${target}/api/chatgpt/logout`,
        method: "POST",
        consentReady: true,
        catalogReady: true,
      }),
    ).toMatchObject({
      action: "abort",
      reason: "host-lifecycle-mutation-forbidden",
    });
    expect(
      hostedRouteDecision({
        url: `${target}/api/chatgpt/generate`,
        method: "POST",
        consentReady: false,
        catalogReady: false,
        payload: request,
      }),
    ).toMatchObject({
      action: "abort",
      reason: "generation-before-consent",
    });
    expect(
      hostedRouteDecision({
        url: `${target}/api/chatgpt/generate`,
        method: "POST",
        consentReady: true,
        catalogReady: true,
        generationCount: 2,
        payload: request,
      }),
    ).toMatchObject({
      action: "abort",
      reason: "third-generation-forbidden",
    });
  });

  it("requires a final commit and rejects stream errors even after valid commands", () => {
    for (const body of [
      '{"type":"reserve_entity"}\n',
      '{"type":"commit_revision"}\n{"error":"failed"}\n',
      '{"type":"commit_revision","error":"failed"}\n',
      '{"type":"unknown"}\n{"type":"commit_revision"}\n',
    ]) expect(validateHostedNDJSON(body).valid).toBe(false);
    expect(validateHostedNDJSON('{"type":"reserve_entity"}\n{"type":"commit_revision"}\n').valid).toBe(true);
  });

  it("writes a blocked report when hosted account state is missing, before Chromium or inference", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "orbsie-hosted-acceptance-"),
    );
    const evidence = join(directory, "evidence");
    const missingState = join(directory, "missing-storage-state.json");
    const environment = { ...process.env };
    for (const name of [
      "ORBSIE_KEY_SCOPE",
      "OPENROUTER_API_KEY",
      "AI_GATEWAY_TEST_KEY",
      "AI_GATEWAY_API_KEY",
      "ORBSIE_CHATGPT_COMPANION_URL",
      "ORBSIE_CHATGPT_COMPANION_TOKEN",
    ])
      delete environment[name];
    Object.assign(environment, {
      ORBSIE_LIVE_E2E: "1",
      ORBSIE_TEST_URL: target,
      ORBSIE_EXPECTED_MODEL: HOSTED_MODEL,
      ORBSIE_ACCOUNT_STORAGE_STATE: missingState,
      ORBSIE_EVIDENCE_DIR: evidence,
    });
    try {
      await expect(
        execFileAsync(
          process.execPath,
          ["scripts/provider-browser-e2e.mjs", "--provider", "chatgpt-hosted"],
          { cwd: process.cwd(), env: environment },
        ),
      ).rejects.toMatchObject({ stderr: expect.stringContaining("blocked") });
      const report = JSON.parse(
        await readFile(join(evidence, "chatgpt-hosted.json"), "utf8"),
      );
      expect(report.liveInference).toBe(false);
      expect(report.reusedConsent).toBe(false);
      expect(report.traffic.hostedGenerationRequests).toBe(0);
      expect(report.traffic.apiGenerationRequests).toBe(0);
      expect(report.traffic.loopbackGenerationRequests).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
