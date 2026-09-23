import { describe, expect, it, vi } from "vitest";
import {
  clearChatGPTStartupPreference,
  CHATGPT_STARTUP_PREFERENCE_KEY,
  readChatGPTStartupPreference,
  writeChatGPTStartupPreference,
} from "../src/lib/chatgpt-startup-preference";
import { restoreChatGPTStartup } from "../src/lib/chatgpt-startup-restore";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values,
  };
}

const models = [
  {
    model: "gpt-6-astra",
    supportedReasoningEfforts: ["high", "low"],
    defaultReasoningEffort: "low",
  },
  {
    model: "gpt-6-luna",
    supportedReasoningEfforts: ["medium", "low"],
    defaultReasoningEffort: "medium",
  },
];

const preference = {
  version: 1 as const,
  provider: "chatgpt-hosted" as const,
  tier: "Budget" as const,
};

function response(value: unknown, init: ResponseInit = {}) {
  return Response.json(value, init);
}

function restore(
  fetcher: Parameters<typeof restoreChatGPTStartup>[0]["fetcher"],
  isCurrent = () => true,
) {
  return restoreChatGPTStartup({
    preference,
    fetcher,
    signal: new AbortController().signal,
    isCurrent,
    parseStatus: (value) =>
      value &&
      typeof value === "object" &&
      typeof (value as { authStatus?: unknown }).authStatus === "string"
        ? { authStatus: (value as { authStatus: string }).authStatus }
        : null,
    parseModels: (value) =>
      value &&
      typeof value === "object" &&
      Array.isArray((value as { models?: unknown }).models)
        ? (value as { models: typeof models }).models
        : null,
  });
}

describe("ChatGPT startup preference", () => {
  it("stores only the versioned provider and tier, and rejects malformed or failed storage", () => {
    const target = storage();
    expect(writeChatGPTStartupPreference("Budget", target)).toBe(true);
    expect(target.values.get(CHATGPT_STARTUP_PREFERENCE_KEY)).toBe(
      JSON.stringify({
        version: 1,
        provider: "chatgpt-hosted",
        tier: "Budget",
      }),
    );
    expect(readChatGPTStartupPreference(target)).toEqual(preference);
    target.values.set(
      CHATGPT_STARTUP_PREFERENCE_KEY,
      JSON.stringify({ ...preference, cache: "secret" }),
    );
    expect(readChatGPTStartupPreference(target)).toBeNull();
    const broken = storage();
    broken.getItem = () => {
      throw Error("storage unavailable");
    };
    expect(readChatGPTStartupPreference(broken)).toBeNull();
    const failed = storage();
    failed.setItem = () => {
      throw Error("storage unavailable");
    };
    expect(writeChatGPTStartupPreference("Balanced", failed)).toBe(false);
    clearChatGPTStartupPreference(target);
    expect(readChatGPTStartupPreference(target)).toBeNull();
  });

  it("checks status before catalog and restores the saved tier from real catalog IDs", async () => {
    const calls: string[] = [];
    const result = await restore((url) => {
      calls.push(url);
      return Promise.resolve(
        url.endsWith("status")
          ? response({ lifecycle: "idle", authStatus: "connected" })
          : response({ models }),
      );
    });
    expect(calls).toEqual(["/api/chatgpt/status", "/api/chatgpt/models"]);
    expect(result).toMatchObject({
      kind: "restored",
      tier: "Budget",
      model: "gpt-6-luna",
      effort: "low",
    });
  });

  it("preserves the tier when it is unavailable instead of silently upgrading", async () => {
    const result = await restore((url) =>
      Promise.resolve(
        url.endsWith("status")
          ? response({ lifecycle: "idle", authStatus: "connected" })
          : response({ models: [models[0]] }),
      ),
    );
    expect(result).toMatchObject({
      kind: "selection-required",
      tier: "Budget",
    });
  });

  it("distinguishes revoked connections, transient failures, and stale manual changes", async () => {
    const revoked = await restore(() =>
      Promise.resolve(
        response(
          { code: "CHATGPT_CONNECTION_REQUIRED", error: "Connect ChatGPT." },
          { status: 409 },
        ),
      ),
    );
    expect(revoked).toEqual({
      kind: "reconnect",
      tier: "Budget",
      stage: "status",
    });
    const disconnected = await restore(() =>
      Promise.resolve(
        response({ lifecycle: "idle", authStatus: "disconnected" }),
      ),
    );
    expect(disconnected).toEqual({
      kind: "reconnect",
      tier: "Budget",
      stage: "status",
    });
    const unknown = await restore(() =>
      Promise.resolve(response({ lifecycle: "idle", authStatus: "unknown" })),
    );
    expect(unknown).toEqual({
      kind: "transient",
      tier: "Budget",
      stage: "status",
    });
    const transient = await restore(() => Promise.reject(Error("offline")));
    expect(transient).toEqual({
      kind: "transient",
      tier: "Budget",
      stage: "status",
    });
    const stale = await restore(
      () =>
        Promise.resolve(
          response({ lifecycle: "idle", authStatus: "connected" }),
        ),
      () => false,
    );
    expect(stale).toEqual({ kind: "stale" });
  });

  it("stops before catalog when status transport fails", async () => {
    const catalog = vi.fn();
    const result = await restore((url) => {
      if (url.endsWith("models")) catalog();
      return Promise.reject(Error("temporary"));
    });
    expect(result).toEqual({
      kind: "transient",
      tier: "Budget",
      stage: "status",
    });
    expect(catalog).not.toHaveBeenCalled();
  });

  it("labels a catalog reconnect at the catalog stage", async () => {
    const result = await restore((url) =>
      Promise.resolve(
        url.endsWith("status")
          ? response({ lifecycle: "idle", authStatus: "connected" })
          : response({ code: "CHATGPT_CONNECTION_REQUIRED" }, { status: 401 }),
      ),
    );
    expect(result).toEqual({
      kind: "reconnect",
      tier: "Budget",
      stage: "models",
    });
  });

  it("discards a delayed response after a manual provider change", async () => {
    let releaseStatus!: (value: Response) => void;
    let current = true;
    const status = new Promise<Response>((resolve) => {
      releaseStatus = resolve;
    });
    const catalog = vi.fn();
    const pending = restore(
      (url) => {
        if (url.endsWith("models")) catalog();
        return status;
      },
      () => current,
    );
    current = false;
    releaseStatus(response({ lifecycle: "idle", authStatus: "connected" }));
    expect(await pending).toEqual({ kind: "stale" });
    expect(catalog).not.toHaveBeenCalled();
  });
});
