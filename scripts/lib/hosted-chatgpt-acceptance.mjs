export const HOSTED_PROVIDER = "chatgpt-hosted";
export const HOSTED_MODEL = "gpt-5.6-luna";
export const HOSTED_EFFORT = "low";

const HOSTED_LIFECYCLES = new Set([
  "idle",
  "pending",
  "completed",
  "failed",
  "cancelled",
  "expired",
]);
const HOSTED_AUTH_STATUSES = new Set(["unknown", "connected", "disconnected"]);
const HOSTED_MODEL_KEYS = new Set([
  "id",
  "model",
  "displayName",
  "supportedReasoningEfforts",
  "defaultReasoningEffort",
]);
const HOSTED_REQUEST_KEYS = new Set([
  "model",
  "effort",
  "prompt",
  "project",
  "selected",
  "browserModeling",
  "localModeling",
]);
const HOSTED_COMMAND_TYPES = new Set([
  "set_game",
  "reserve_entity",
  "set_geometry",
  "set_material",
  "set_transform",
  "create_group",
  "remove_group",
  "set_group_transform",
  "set_parent",
  "set_behavior",
  "remove_entity",
  "set_environment",
  "commit_revision",
]);

export class HostedAcceptanceBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "HostedAcceptanceBlockedError";
  }
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value, max) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function boundedIdentifier(value, max) {
  return boundedText(value, max) && /^[A-Za-z0-9._:/-]+$/.test(value);
}

export function assertHostedPreflight({
  liveE2E,
  baseOrigin,
  expectedModel,
  serviceTier = "default",
  accountStorageStatePath,
  interruptedRecovery = false,
  interruptionMethod = undefined,
  companionConfigured = false,
}) {
  if (liveE2E !== "1")
    throw new HostedAcceptanceBlockedError(
      "Refusing live hosted ChatGPT acceptance: set ORBSIE_LIVE_E2E=1 explicitly.",
    );
  let target;
  try {
    target = new URL(baseOrigin);
  } catch {
    throw new HostedAcceptanceBlockedError(
      "The hosted ChatGPT target must be an exact HTTPS origin.",
    );
  }
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
  )
    throw new HostedAcceptanceBlockedError(
      "Hosted ChatGPT acceptance requires the exact deployed HTTPS origin.",
    );
  if (!boundedIdentifier(expectedModel, 150) || expectedModel !== HOSTED_MODEL)
    throw new HostedAcceptanceBlockedError(
      `Hosted ChatGPT acceptance is authorized only for ${HOSTED_MODEL}.`,
    );
  if (serviceTier !== "default")
    throw new HostedAcceptanceBlockedError(
      "Hosted ChatGPT acceptance requires service tier default.",
    );
  if (typeof accountStorageStatePath !== "string" || !accountStorageStatePath)
    throw new HostedAcceptanceBlockedError(
      "Set ORBSIE_ACCOUNT_STORAGE_STATE to the private Orbsie account storage-state path; no generation was attempted.",
    );
  if (interruptedRecovery || interruptionMethod)
    throw new HostedAcceptanceBlockedError(
      "Hosted ChatGPT acceptance does not support local companion interruption recovery; remove the recovery flags before the browser starts.",
    );
  if (companionConfigured)
    throw new HostedAcceptanceBlockedError(
      "Hosted ChatGPT acceptance cannot use a local companion; remove companion configuration before the browser starts.",
    );
  return {
    baseOrigin: target.origin,
    expectedModel,
    effort: HOSTED_EFFORT,
    serviceTier,
    accountStorageStatePath,
  };
}

function cookieDomainMatches(cookieDomain, hostname) {
  // A leading-dot domain also grants a cookie to sibling subdomains. Hosted
  // acceptance deliberately accepts only a host-only cookie for the target.
  return cookieDomain === hostname;
}

export function filterHostedStorageState(value, baseOrigin) {
  let target;
  try {
    target = new URL(baseOrigin);
  } catch {
    throw new HostedAcceptanceBlockedError(
      "The hosted ChatGPT target must be an exact HTTPS origin.",
    );
  }
  if (target.protocol !== "https:" || target.pathname !== "/")
    throw new HostedAcceptanceBlockedError(
      "Hosted account storage state requires an exact HTTPS origin.",
    );
  if (!record(value))
    throw new HostedAcceptanceBlockedError(
      "ORBSIE_ACCOUNT_STORAGE_STATE is not a valid storage-state object.",
    );
  if (value.origins !== undefined && !Array.isArray(value.origins))
    throw new HostedAcceptanceBlockedError(
      "ORBSIE_ACCOUNT_STORAGE_STATE must not contain localStorage origins.",
    );
  if (Array.isArray(value.origins) && value.origins.length > 0)
    throw new HostedAcceptanceBlockedError(
      "ORBSIE_ACCOUNT_STORAGE_STATE must contain cookies only; localStorage is not accepted.",
    );
  if (!Array.isArray(value.cookies) || value.cookies.length === 0)
    throw new HostedAcceptanceBlockedError(
      "ORBSIE_ACCOUNT_STORAGE_STATE must contain an authenticated Orbsie session cookie.",
    );

  const cookies = value.cookies.map((cookie) => {
    if (!record(cookie))
      throw new HostedAcceptanceBlockedError(
        "ORBSIE_ACCOUNT_STORAGE_STATE contains an invalid cookie.",
      );
    if (
      !boundedText(cookie.name, 512) ||
      typeof cookie.value !== "string" ||
      !cookieDomainMatches(cookie.domain, target.hostname) ||
      typeof cookie.path !== "string" ||
      !cookie.path.startsWith("/") ||
      cookie.secure !== true ||
      (cookie.sameSite !== undefined &&
        !["Strict", "Lax", "None"].includes(cookie.sameSite))
    )
      throw new HostedAcceptanceBlockedError(
        "ORBSIE_ACCOUNT_STORAGE_STATE contains a cookie outside the exact HTTPS Orbsie target.",
      );
    if (
      cookie.expires !== undefined &&
      (typeof cookie.expires !== "number" || !Number.isFinite(cookie.expires))
    )
      throw new HostedAcceptanceBlockedError(
        "ORBSIE_ACCOUNT_STORAGE_STATE contains an invalid cookie expiry.",
      );
    return {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      ...(cookie.expires !== undefined ? { expires: cookie.expires } : {}),
      ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : {}),
      secure: true,
      ...(cookie.sameSite !== undefined ? { sameSite: cookie.sameSite } : {}),
    };
  });
  return { cookies, origins: [] };
}

export function assertHostedStatusConnected(value) {
  if (
    !record(value) ||
    !HOSTED_LIFECYCLES.has(value.lifecycle) ||
    !HOSTED_AUTH_STATUSES.has(value.authStatus)
  )
    throw new HostedAcceptanceBlockedError(
      "The hosted ChatGPT account status was invalid; no generation was attempted.",
    );
  if (value.authStatus !== "connected")
    throw new HostedAcceptanceBlockedError(
      "Hosted ChatGPT is not already connected for this Orbsie account. Ask the user to complete ChatGPT device consent, then rerun; no generation was attempted.",
    );
  return { lifecycle: value.lifecycle, authStatus: value.authStatus };
}

export function assertHostedAccountSession(value) {
  if (
    !record(value) ||
    !record(value.user) ||
    !boundedText(value.user.id, 256) ||
    !record(value.session) ||
    !boundedText(value.session.id, 256)
  )
    throw new HostedAcceptanceBlockedError(
      "No authenticated Orbsie session was found in the supplied account state; sign in to Orbsie and rerun. No generation was attempted.",
    );
  return { authenticated: true };
}

export function assertHostedModelCatalog(value) {
  if (
    !record(value) ||
    !Array.isArray(value.models) ||
    value.models.length > 100
  )
    throw new HostedAcceptanceBlockedError(
      "The hosted ChatGPT model catalog was invalid; no fallback was selected.",
    );
  const matches = value.models.filter(
    (model) => record(model) && model.model === HOSTED_MODEL,
  );
  if (matches.length !== 1)
    throw new HostedAcceptanceBlockedError(
      `The hosted ChatGPT catalog must contain exactly one ${HOSTED_MODEL} entry; no fallback was selected.`,
    );
  const model = matches[0];
  if (
    ![...HOSTED_MODEL_KEYS].every((key) => Object.hasOwn(model, key)) ||
    !boundedIdentifier(model.id, 256) ||
    !boundedIdentifier(model.model, 256) ||
    !boundedText(model.displayName, 160) ||
    !Array.isArray(model.supportedReasoningEfforts) ||
    !model.supportedReasoningEfforts.includes(HOSTED_EFFORT) ||
    !boundedText(model.defaultReasoningEffort, 32)
  )
    throw new HostedAcceptanceBlockedError(
      `The hosted ChatGPT catalog does not advertise ${HOSTED_MODEL} with low reasoning; no fallback was selected.`,
    );
  return {
    model: HOSTED_MODEL,
    effort: HOSTED_EFFORT,
    catalogId: model.id,
  };
}

export function assertHostedGenerationPayload(
  value,
  { browserModeling = true } = {},
) {
  if (!record(value))
    throw new HostedAcceptanceBlockedError(
      "Hosted ChatGPT generation payload was not an object.",
    );
  for (const key of Object.keys(value))
    if (!HOSTED_REQUEST_KEYS.has(key))
      throw new HostedAcceptanceBlockedError(
        "Hosted ChatGPT generation payload contained an unsupported credential or provider field.",
      );
  if (
    value.model !== HOSTED_MODEL ||
    value.effort !== HOSTED_EFFORT ||
    typeof value.prompt !== "string" ||
    value.prompt.trim().length === 0 ||
    value.prompt.trim().length > 4000 ||
    !record(value.project) ||
    value.browserModeling !== browserModeling ||
    value.localModeling !== false ||
    (value.selected !== undefined &&
      (typeof value.selected !== "string" ||
        !/^[\w-]{1,80}$/.test(value.selected) ||
        !Array.isArray(value.project.entities) ||
        !value.project.entities.some(
          (entity) => record(entity) && entity.id === value.selected,
        )))
  )
    throw new HostedAcceptanceBlockedError(
      "Hosted ChatGPT generation payload did not match the exact Luna low/browser-only contract.",
    );
  return {
    model: value.model,
    effort: value.effort,
    browserModeling: value.browserModeling,
    localModeling: value.localModeling,
    selected: typeof value.selected === "string",
  };
}

export function validateHostedNDJSON(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1_000_000
  )
    return { valid: false, recordCount: 0 };
  const records = [];
  for (const line of value.split("\n")) {
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { valid: false, recordCount: records.length };
    }
    if (
      !record(parsed) ||
      typeof parsed.type !== "string" ||
      !HOSTED_COMMAND_TYPES.has(parsed.type) ||
      Object.hasOwn(parsed, "error")
    )
      return { valid: false, recordCount: records.length };
    records.push(parsed);
  }
  return {
    valid: records.length > 0 && records.at(-1)?.type === "commit_revision",
    recordCount: records.length,
  };
}

export async function statusFirstHostedGate({
  readOrbsieSession,
  readHostedStatus,
  afterConnected = (value) => value,
}) {
  let status;
  try {
    status = await readHostedStatus();
    assertHostedStatusConnected(status);
  } catch (error) {
    if (error instanceof HostedAcceptanceBlockedError) throw error;
    throw new HostedAcceptanceBlockedError(
      "The hosted ChatGPT account status could not be checked; no generation was attempted.",
    );
  }
  try {
    const session = await readOrbsieSession();
    assertHostedAccountSession(session);
  } catch (error) {
    if (error instanceof HostedAcceptanceBlockedError) throw error;
    throw new HostedAcceptanceBlockedError(
      "The Orbsie account session could not be checked; sign in to Orbsie and rerun. No generation was attempted.",
    );
  }
  const result = {
    lifecycle: status.lifecycle,
    authStatus: status.authStatus,
    reusedConsent: true,
  };
  return afterConnected(result);
}

function isLoopbackHostname(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

/**
 * Decide whether a hosted browser request may reach the configured origin.
 * This function intentionally returns only bounded reason codes: request
 * payloads and credential-bearing URLs never enter evidence or error text.
 */
export function hostedRouteDecision({
  url,
  method,
  generationCount = 0,
  consentReady = false,
  catalogReady = false,
  payload = {},
}) {
  let requestURL;
  try {
    requestURL = new URL(url);
  } catch {
    return { action: "abort", reason: "invalid-url" };
  }
  const pathname = requestURL.pathname;
  if (pathname === "/api/generate")
    return { action: "abort", reason: "api-key-generation-forbidden" };
  if (pathname === "/generate")
    return {
      action: "abort",
      reason: isLoopbackHostname(requestURL.hostname)
        ? "loopback-companion-forbidden"
        : "companion-transport-forbidden",
    };
  if (
    [
      "/api/chatgpt/start",
      "/api/chatgpt/cancel",
      "/api/chatgpt/logout",
    ].includes(pathname)
  )
    return { action: "abort", reason: "host-lifecycle-mutation-forbidden" };
  if (pathname !== "/api/chatgpt/generate" || method !== "POST")
    return { action: "continue" };
  if (!consentReady)
    return { action: "abort", reason: "generation-before-consent" };
  if (!catalogReady)
    return { action: "abort", reason: "generation-before-catalog" };
  if (generationCount >= 2)
    return { action: "abort", reason: "third-generation-forbidden" };
  try {
    assertHostedGenerationPayload(payload, { browserModeling: true });
  } catch {
    return { action: "abort", reason: "invalid-hosted-payload" };
  }
  return { action: "continue", reason: "hosted-generation" };
}
