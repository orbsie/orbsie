import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLIENT_GENERATION_DIAGNOSTIC_STORAGE_KEY,
  clearGenerationDiagnostics,
  beginClientGenerationDiagnostic,
  exportGenerationDiagnostics,
  readGenerationDiagnostics,
  recordStartupDiagnostic,
} from "../src/lib/generation-diagnostics-client";

const runId = "22222222-2222-4222-8222-222222222222";
const requestId = "11111111-1111-4111-8111-111111111111";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

beforeEach(() => {
  const storage = memoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
  clearGenerationDiagnostics();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser generation diagnostics", () => {
  it("records only bounded applied-scene metadata and one terminal", () => {
    let clock = 100;
    const diagnostic = beginClientGenerationDiagnostic({
      runId,
      provider: "chatgpt",
      quality: "Balanced",
      reasoningEffort: "medium",
      serviceTier: "default",
      renderer: "software",
      now: () => clock,
      wallClock: () => 1_757_800_000_000,
      capabilities: { touch: true, coarsePointer: true, online: true },
      initialRevision: 4,
    });
    diagnostic.phase("provider-start");
    diagnostic.requestId(requestId);
    diagnostic.noteInputBytes(12);
    clock += 25;
    diagnostic.noteOutputBytes(18);
    diagnostic.noteCommand("set_geometry");
    diagnostic.noteCommand("set_label");
    diagnostic.commit(7);
    clock += 30;
    diagnostic.terminal({ reason: "completed" });
    diagnostic.terminal({
      reason: "transport-error",
      failureCode: "transport",
    });

    const [entry] = readGenerationDiagnostics();
    expect(entry).toMatchObject({
      kind: "generation",
      runId,
      requestId,
      provider: "chatgpt",
      quality: "Balanced",
      reasoningEffort: "medium",
      serviceTier: "default",
      renderer: "software",
      inputBytes: 12,
      outputBytes: 18,
      commandCount: 2,
      commandCounts: { set_geometry: 1, set_label: 1 },
      initialRevision: 4,
      lastCommittedRevision: 7,
      terminal: { reason: "completed" },
    });
    expect(entry && "phases" in entry ? entry.phases : []).toEqual([
      { phase: "admission", elapsedMs: 0 },
      { phase: "provider-start", elapsedMs: 0 },
      { phase: "first-valid-command", elapsedMs: 25 },
      { phase: "commit", elapsedMs: 25 },
      { phase: "finalization", elapsedMs: 55 },
    ]);
    expect(JSON.stringify(entry)).not.toContain("private");
  });

  it("keeps interrupted runs explicitly incomplete and tolerates denied storage reads", () => {
    let getDenied = true;
    const storage = {
      getItem: () => {
        if (getDenied) throw Error("storage denied");
        return null;
      },
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("window", { localStorage: storage });
    clearGenerationDiagnostics();
    const diagnostic = beginClientGenerationDiagnostic({
      runId,
      provider: "free",
      initialRevision: 2,
    });
    expect(readGenerationDiagnostics()[0]).toMatchObject({
      kind: "generation",
      runId,
      inProgress: true,
    });
    getDenied = false;
    diagnostic.terminal({ reason: "client-abort", abortSource: "client" });
    const completed = readGenerationDiagnostics()[0];
    expect(
      completed && completed.kind === "generation"
        ? completed.terminal
        : undefined,
    ).toMatchObject({ reason: "client-abort" });
  });

  it("accepts completion-record failures as a terminal recovery cause", () => {
    const diagnostic = beginClientGenerationDiagnostic({
      runId,
      provider: "gateway",
    });
    diagnostic.requestId(requestId);
    diagnostic.terminal({
      reason: "completion-record-failure",
      failureCode: "host-unavailable",
    });
    expect(readGenerationDiagnostics()[0]).toMatchObject({
      runId,
      requestId,
      terminal: {
        reason: "completion-record-failure",
        failureCode: "host-unavailable",
      },
    });
  });

  it("projects persisted entries before exposing them", () => {
    const diagnostic = beginClientGenerationDiagnostic({
      runId,
      provider: "free",
      initialRevision: 0,
    });
    diagnostic.terminal({ reason: "completed" });
    const [entry] = readGenerationDiagnostics();
    clearGenerationDiagnostics();
    const terminal = entry?.kind === "generation" ? entry.terminal : undefined;
    const persisted = {
      schemaVersion: 1,
      entries: [
        {
          ...entry,
          model: "prompt-secret",
          terminal: { ...terminal, message: "private error" },
        },
      ],
    };
    // Use a new storage object to model a fresh document. A clear in the
    // current document must remain authoritative even when removeItem fails.
    const replacementStorage = memoryStorage();
    vi.stubGlobal("window", { localStorage: replacementStorage });
    replacementStorage.setItem(
      CLIENT_GENERATION_DIAGNOSTIC_STORAGE_KEY,
      JSON.stringify(persisted),
    );
    const [projected] = readGenerationDiagnostics();
    expect(JSON.stringify(projected)).not.toContain("prompt-secret");
    expect(JSON.stringify(projected)).not.toContain("private error");
  });

  it("keeps a denied storage removal cleared in the current session", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const diagnostic = beginClientGenerationDiagnostic({
      runId,
      provider: "free",
    });
    diagnostic.terminal({ reason: "completed" });
    const persistedBeforeClear = storage.getItem(
      CLIENT_GENERATION_DIAGNOSTIC_STORAGE_KEY,
    );
    storage.removeItem = () => {
      throw Error("storage denied");
    };

    clearGenerationDiagnostics();

    expect(readGenerationDiagnostics()).toEqual([]);
    expect(storage.getItem(CLIENT_GENERATION_DIAGNOSTIC_STORAGE_KEY)).toBe(
      persistedBeforeClear,
    );
  });

  it("ignores callbacks from a cleared or already terminal run", () => {
    const diagnostic = beginClientGenerationDiagnostic({
      runId,
      provider: "free",
    });
    diagnostic.terminal({ reason: "completed" });
    diagnostic.requestId(requestId);
    expect(readGenerationDiagnostics()[0]).toMatchObject({
      terminal: { reason: "completed" },
    });

    clearGenerationDiagnostics();
    diagnostic.requestId(requestId);
    diagnostic.phase("commit");
    diagnostic.commit(9);
    diagnostic.terminal({ reason: "transport-error" });
    expect(readGenerationDiagnostics()).toEqual([]);
  });

  it("calls browser crypto randomUUID with its receiver", () => {
    const browserCrypto = {
      randomUUID() {
        if (this !== browserCrypto) throw Error("Illegal invocation");
        return "33333333-3333-4333-8333-333333333333";
      },
    };
    vi.stubGlobal("crypto", browserCrypto);

    recordStartupDiagnostic({
      stage: "session",
      outcome: "transient",
      durationMs: 1,
    });

    expect(readGenerationDiagnostics()[0]).toMatchObject({
      kind: "startup",
      id: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("includes a validated Next public build identifier when configured", () => {
    const previous = process.env.NEXT_PUBLIC_ORBSIE_BUILD_ID;
    delete (globalThis as { __ORBSIE_BUILD_ID__?: unknown })
      .__ORBSIE_BUILD_ID__;
    process.env.NEXT_PUBLIC_ORBSIE_BUILD_ID = "abc1234";
    try {
      recordStartupDiagnostic({
        stage: "configuration",
        outcome: "ready",
        durationMs: 1,
      });
      expect(readGenerationDiagnostics()[0]).toMatchObject({
        kind: "startup",
        buildId: "abc1234",
      });
    } finally {
      if (previous === undefined)
        delete process.env.NEXT_PUBLIC_ORBSIE_BUILD_ID;
      else process.env.NEXT_PUBLIC_ORBSIE_BUILD_ID = previous;
    }
  });

  it("records startup stages, persists a bounded document, and clears on reset", () => {
    for (let index = 0; index < 24; index++)
      recordStartupDiagnostic({
        stage: index % 2 ? "session" : "catalog",
        outcome: index % 3 ? "ready" : "transient",
        tier: "Budget",
        durationMs: index * 5,
      });

    const entries = readGenerationDiagnostics();
    expect(entries).toHaveLength(20);
    expect(entries.every((entry) => entry.kind === "startup")).toBe(true);
    expect(JSON.stringify(entries).includes("prompt-and-secret")).toBe(false);
    const stored = window.localStorage.getItem(
      CLIENT_GENERATION_DIAGNOSTIC_STORAGE_KEY,
    );
    expect(stored).toBeTruthy();
    expect(new TextEncoder().encode(stored!).byteLength).toBeLessThanOrEqual(
      64 * 1024,
    );
    vi.stubGlobal("__ORBSIE_BUILD_ID__", "abc1234");
    const exported = exportGenerationDiagnostics();
    expect(new TextEncoder().encode(exported).byteLength).toBeLessThanOrEqual(
      64 * 1024,
    );
    expect(exported).toContain("cannot reconstruct a private scene");
    expect(JSON.parse(exported).buildId).toBe("abc1234");

    clearGenerationDiagnostics();
    expect(readGenerationDiagnostics()).toEqual([]);
    expect(
      window.localStorage.getItem(CLIENT_GENERATION_DIAGNOSTIC_STORAGE_KEY),
    ).toBeNull();
  });
});
