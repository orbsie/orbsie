import type {
  ChatGPTDeviceRpc,
  ChatGPTDeviceSession,
} from "./chatgpt-device-session";

export type ChatGPTModel = {
  id: string;
  model: string;
  displayName: string;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string;
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const label = (v: unknown, max: number): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= max &&
  v.trim() === v &&
  !/[\u0000-\u001f\u007f]/.test(v);
const identifier = (v: unknown): v is string =>
  label(v, 256) && /^[a-zA-Z0-9._:/-]+$/.test(v);
const invalid = () => Error("ChatGPT model access could not be checked.");

/** Allowlisted model metadata only; catalog presence is not a generation test. */
export function validateChatGPTModels(value: unknown): ChatGPTModel[] {
  if (!Array.isArray(value) || value.length > 100) throw invalid();
  const seen = new Set<string>();
  return value.map((item) => {
    if (
      !record(item) ||
      !identifier(item.id) ||
      !identifier(item.model) ||
      !label(item.displayName, 160) ||
      !Array.isArray(item.supportedReasoningEfforts) ||
      item.supportedReasoningEfforts.length > 16 ||
      !item.supportedReasoningEfforts.length ||
      !item.supportedReasoningEfforts.every((v) => label(v, 32)) ||
      !label(item.defaultReasoningEffort, 32) ||
      !item.supportedReasoningEfforts.includes(item.defaultReasoningEffort) ||
      seen.has(item.id)
    )
      throw invalid();
    seen.add(item.id);
    return {
      id: item.id,
      model: item.model,
      displayName: item.displayName,
      supportedReasoningEfforts: [
        ...new Set(item.supportedReasoningEfforts as string[]),
      ],
      defaultReasoningEffort: item.defaultReasoningEffort,
    };
  });
}

export async function listChatGPTModels(
  rpc: ChatGPTDeviceRpc,
  session: Pick<ChatGPTDeviceSession, "readAuthStatus" | "getSnapshot">,
) {
  if ((await session.readAuthStatus()).status !== "connected") throw invalid();
  const items: unknown[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const result = await rpc.request("model/list", {
      limit: 20,
      includeHidden: false,
      ...(cursor ? { cursor } : {}),
    });
    if (
      !record(result) ||
      !Array.isArray(result.data) ||
      result.data.length > 20
    )
      throw invalid();
    for (const item of result.data) {
      if (!record(item) || typeof item.hidden !== "boolean") throw invalid();
      if (item.hidden) continue;
      if (!Array.isArray(item.supportedReasoningEfforts)) throw invalid();
      items.push({
        ...item,
        supportedReasoningEfforts: item.supportedReasoningEfforts.map((e) =>
          record(e) ? e.reasoningEffort : undefined,
        ),
      });
    }
    if (result.nextCursor == null) {
      const models = validateChatGPTModels(items);
      // Logout/cancellation during discovery must not publish stale readiness.
      if (session.getSnapshot().authStatus !== "connected") throw invalid();
      return models;
    }
    if (!label(result.nextCursor, 4096) || seen.has(result.nextCursor))
      throw invalid();
    seen.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw invalid();
}
