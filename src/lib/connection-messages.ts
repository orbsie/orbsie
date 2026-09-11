export type ConnectionNotice =
  | "free-exhausted"
  | "free-unavailable"
  | "offline"
  | "provider-key-rejected"
  | "provider-access-denied"
  | "provider-payment"
  | "provider-rate-limited";

const copy = {
  "free-exhausted": {
    signedOut:
      "You've used today's free prompts. Sign in or connect a provider to keep creating — your draft stays safe on this device.",
    signedIn:
      "You've used today's free prompts. Connect a provider to keep creating.",
  },
  "free-unavailable":
    "Free prompts are temporarily unavailable. Connect a provider to continue.",
  offline:
    "You're offline. Your draft is saved on this device — try again when you reconnect.",
  "provider-key-rejected":
    "Your provider rejected your API key. Check the key in your connection settings and try again.",
  "provider-access-denied":
    "Your provider denied access to this model. Check the key permissions and provider settings.",
  "provider-payment":
    "Your provider could not authorize payment. Check its credits and spending limits.",
  "provider-rate-limited":
    "Your provider is busy. Wait a moment and retry.",
} as const;

export function connectionNoticeCopy(
  notice: ConnectionNotice,
  options: { signedIn: boolean } = { signedIn: false },
): string {
  const entry = copy[notice];
  if (typeof entry === "string") return entry;
  return options.signedIn ? entry.signedIn : entry.signedOut;
}

export function noticeForGenerationCode(
  code: string | undefined,
): ConnectionNotice | undefined {
  switch (code) {
    case "FREE_LIMIT_REACHED":
      return "free-exhausted";
    case "PROVIDER_AUTH_REJECTED":
      return "provider-key-rejected";
    case "PROVIDER_ACCESS_DENIED":
      return "provider-access-denied";
    default:
      return undefined;
  }
}
