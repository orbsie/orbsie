import { isDeepStrictEqual } from "node:util";

export const CHATGPT_GENERATION_CONFIG = Object.freeze({
  web_search: "disabled",
  "features.shell_tool": false,
  "features.unified_exec": false,
  "features.apps": false,
  "features.multi_agent": false,
  "features.remote_plugin": false,
  "tools.view_image": false,
});
export const CHATGPT_READ_POLICY = Object.freeze({
  type: "readOnly",
  access: {
    type: "restricted",
    readableRoots: [],
    includePlatformDefaults: false,
  },
});
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).every((k) => allowed.includes(k));
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9._:/-]{1,256}$/.test(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && Buffer.byteLength(v, "utf8") <= max;

/** Trusted lifecycle arguments are still checked at the process boundary. */
export function validChatGPTGenerationRequest(
  method: string,
  params: unknown,
  threads: Set<string>,
  turns: Map<string, Set<string>>,
) {
  if (!record(params)) return false;
  if (method === "thread/start")
    return (
      threads.size < 16 &&
      keys(params, [
        "model",
        "serviceTier",
        "ephemeral",
        "approvalPolicy",
        "sandbox",
        "baseInstructions",
        "config",
      ]) &&
      id(params.model) &&
      params.serviceTier === "default" &&
      params.ephemeral === true &&
      params.approvalPolicy === "never" &&
      params.sandbox === "read-only" &&
      text(params.baseInstructions, 64 * 1024) &&
      isDeepStrictEqual(params.config, CHATGPT_GENERATION_CONFIG)
    );
  if (!id(params.threadId) || !threads.has(params.threadId)) return false;
  if (method === "turn/interrupt")
    return (
      keys(params, ["threadId", "turnId"]) &&
      id(params.turnId) &&
      !!turns.get(params.threadId)?.has(params.turnId)
    );
  if (method !== "turn/start") return false;
  return (
    keys(params, [
      "threadId",
      "model",
      "effort",
      "serviceTier",
      "input",
      "sandboxPolicy",
      "approvalPolicy",
    ]) &&
    id(params.model) &&
    text(params.effort, 32) &&
    params.serviceTier === "default" &&
    params.approvalPolicy === "never" &&
    isDeepStrictEqual(params.sandboxPolicy, CHATGPT_READ_POLICY) &&
    Array.isArray(params.input) &&
    params.input.length === 1 &&
    record(params.input[0]) &&
    keys(params.input[0], ["type", "text"]) &&
    params.input[0].type === "text" &&
    text(params.input[0].text, 256 * 1024)
  );
}
