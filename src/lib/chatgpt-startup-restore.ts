import {
  resolveChatGPTPresetOptions,
  type ChatGPTPresetLabel,
  type ChatGPTPresetModel,
} from "./chatgpt-model-presets";
import type { ChatGPTStartupPreference } from "./chatgpt-startup-preference";

export type ChatGPTStartupRestoreResult =
  | {
      kind: "restored";
      tier: ChatGPTPresetLabel;
      model: string;
      effort: string;
      models: ChatGPTPresetModel[];
    }
  | {
      kind: "selection-required";
      tier: ChatGPTPresetLabel;
      models: ChatGPTPresetModel[];
    }
  | { kind: "reconnect"; tier: ChatGPTPresetLabel }
  | {
      kind: "transient";
      tier: ChatGPTPresetLabel;
      stage: "status" | "models";
    }
  | { kind: "stale" };

type RestoreResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

type RestoreFetcher = (
  input: string,
  init: RequestInit,
) => Promise<RestoreResponse>;

type RestoreOptions = {
  preference: ChatGPTStartupPreference;
  fetcher: RestoreFetcher;
  signal: AbortSignal;
  isCurrent: () => boolean;
  parseStatus: (value: unknown) => { authStatus: string } | null;
  parseModels: (value: unknown) => ChatGPTPresetModel[] | null;
};

function isConnectionRequired(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return (
    source.code === "CHATGPT_CONNECTION_REQUIRED" ||
    source.code === "CHATGPT_CONNECTION_STALE"
  );
}

async function responseValue(response: RestoreResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Verify an existing app session's ChatGPT connection, then resolve the
 * remembered tier against the current catalog. This helper never provisions a
 * session and never returns a selection from outside that catalog.
 */
export async function restoreChatGPTStartup(
  options: RestoreOptions,
): Promise<ChatGPTStartupRestoreResult> {
  const { preference, fetcher, signal, isCurrent } = options;
  const transient = (stage: "status" | "models") => ({
    kind: "transient" as const,
    tier: preference.tier,
    stage,
  });
  if (signal.aborted || !isCurrent()) return { kind: "stale" };

  let statusResponse: RestoreResponse;
  let statusValue: unknown;
  try {
    statusResponse = await fetcher("/api/chatgpt/status", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal,
    });
    statusValue = await responseValue(statusResponse);
  } catch {
    return signal.aborted || !isCurrent()
      ? { kind: "stale" }
      : transient("status");
  }
  if (signal.aborted || !isCurrent()) return { kind: "stale" };
  if (!statusResponse.ok) {
    return isConnectionRequired(statusValue) || statusResponse.status === 401
      ? { kind: "reconnect", tier: preference.tier }
      : transient("status");
  }
  const status = options.parseStatus(statusValue);
  if (!status) return transient("status");
  if (status.authStatus === "disconnected")
    return { kind: "reconnect", tier: preference.tier };
  if (status.authStatus !== "connected") return transient("status");

  let modelsResponse: RestoreResponse;
  let modelsValue: unknown;
  try {
    modelsResponse = await fetcher("/api/chatgpt/models", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal,
    });
    modelsValue = await responseValue(modelsResponse);
  } catch {
    return signal.aborted || !isCurrent()
      ? { kind: "stale" }
      : transient("models");
  }
  if (signal.aborted || !isCurrent()) return { kind: "stale" };
  if (!modelsResponse.ok) {
    return isConnectionRequired(modelsValue) || modelsResponse.status === 401
      ? { kind: "reconnect", tier: preference.tier }
      : transient("models");
  }
  const models = options.parseModels(modelsValue);
  if (!models) return transient("models");
  const selected = resolveChatGPTPresetOptions(models).find(
    (option) => option.label === preference.tier && option.available,
  );
  if (!selected?.model || !selected.effort)
    return { kind: "selection-required", tier: preference.tier, models };
  return {
    kind: "restored",
    tier: preference.tier,
    model: selected.model,
    effort: selected.effort,
    models,
  };
}
