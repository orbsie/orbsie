import type { ChatGPTPresetLabel } from "./chatgpt-model-presets";

export const CHATGPT_STARTUP_PREFERENCE_KEY = "orbsie-chatgpt-startup-v1";
export const CHATGPT_STARTUP_PREFERENCE_VERSION = 1 as const;

export type ChatGPTStartupPreference = {
  version: typeof CHATGPT_STARTUP_PREFERENCE_VERSION;
  provider: "chatgpt-hosted";
  tier: ChatGPTPresetLabel;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const tiers = new Set<ChatGPTPresetLabel>(["Quality", "Balanced", "Budget"]);

function browserStorage(): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function validPreference(value: unknown): ChatGPTStartupPreference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    source.version !== CHATGPT_STARTUP_PREFERENCE_VERSION ||
    source.provider !== "chatgpt-hosted" ||
    !tiers.has(source.tier as ChatGPTPresetLabel) ||
    Object.keys(source).some(
      (key) => !["version", "provider", "tier"].includes(key),
    )
  )
    return null;
  return {
    version: CHATGPT_STARTUP_PREFERENCE_VERSION,
    provider: "chatgpt-hosted",
    tier: source.tier as ChatGPTPresetLabel,
  };
}

/** Read only the allowlisted nonsecret provider/tier preference. */
export function readChatGPTStartupPreference(
  storage: StorageLike | undefined = browserStorage(),
): ChatGPTStartupPreference | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CHATGPT_STARTUP_PREFERENCE_KEY);
    if (!raw || raw.length > 256) return null;
    return validPreference(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Persist no connection material: provider and visible quality tier only. */
export function writeChatGPTStartupPreference(
  tier: ChatGPTPresetLabel,
  storage: StorageLike | undefined = browserStorage(),
): boolean {
  if (!storage || !tiers.has(tier)) return false;
  try {
    storage.setItem(
      CHATGPT_STARTUP_PREFERENCE_KEY,
      JSON.stringify({
        version: CHATGPT_STARTUP_PREFERENCE_VERSION,
        provider: "chatgpt-hosted",
        tier,
      } satisfies ChatGPTStartupPreference),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearChatGPTStartupPreference(
  storage: StorageLike | undefined = browserStorage(),
): void {
  try {
    storage?.removeItem(CHATGPT_STARTUP_PREFERENCE_KEY);
  } catch {
    // Storage may be unavailable or revoked; clearing is best effort.
  }
}
