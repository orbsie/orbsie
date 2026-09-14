import { APIError, Sandbox } from "@vercel/sandbox";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { GenerationObservationCorrelation } from "./generation-observability";

type Credentials = { token: string; teamId: string; projectId: string };
type Host = { sandboxName: string; capability: string; expiresAt: Date };
type Operation =
  "generate" | "models" | "status" | "start" | "cancel" | "logout";
export type ChatGPTPrivateOperation =
  | "initialize"
  | "status"
  | "models"
  | "generate"
  | "seal"
  | "clear"
  | "loginSeal";
const routes = {
  generate: ["POST", "/generate"],
  models: ["GET", "/models"],
  status: ["GET", "/login/status"],
  start: ["POST", "/login/start"],
  cancel: ["POST", "/login/cancel"],
  logout: ["POST", "/logout"],
} as const;
const privateRoutes = {
  initialize: ["POST", "/private/operation/initialize"],
  status: ["POST", "/private/operation/status"],
  models: ["POST", "/private/operation/models"],
  generate: ["POST", "/private/operation/generate"],
  seal: ["POST", "/private/operation/seal"],
  clear: ["POST", "/private/operation/clear"],
  loginSeal: ["POST", "/private/login/seal"],
} as const;
const validName = (name: string) => /^orbsie-chatgpt-[a-f0-9-]{36}$/.test(name);
export const CHATGPT_GENERATION_TIMEOUT_MS = 175_000;
export const CHATGPT_TRANSPORT_CLEANUP_MS = 5_000;
export const CHATGPT_GENERATION_HEADROOM_MS =
  CHATGPT_GENERATION_TIMEOUT_MS + CHATGPT_TRANSPORT_CLEANUP_MS;
const HOST_LOOKUP_TIMEOUT_MS = 30_000;
const HOST_RENEWAL_TIMEOUT_MS = 30_000;

function signalFor(signal: AbortSignal | undefined, timeoutMs: number) {
  return AbortSignal.any([
    AbortSignal.timeout(timeoutMs),
    ...(signal ? [signal] : []),
  ]);
}

export function computeChatGPTArtifactDigest(
  files: readonly { path: string; content: Uint8Array }[],
) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.path).update("\0").update(file.content).update("\0");
  }
  return hash.digest("hex");
}

/** Credentials are injected by the trusted server, never taken from requests. */
export function createChatGPTSandboxBackend(options: {
  artifactDirectory: string;
  credentials?: Credentials;
}) {
  async function get(name: string, signal?: AbortSignal) {
    if (!validName(name)) throw Error("Invalid ChatGPT host.");
    return Sandbox.get({
      ...options.credentials,
      name,
      resume: false,
      signal: signalFor(signal, HOST_LOOKUP_TIMEOUT_MS),
    });
  }
  async function request(
    host: Host,
    operation: Operation,
    options: { input?: unknown; signal?: AbortSignal } = {},
  ) {
    let body: string | undefined;
    if (operation === "generate") {
      body = JSON.stringify(options.input);
      if (!body || Buffer.byteLength(body) > 512 * 1024)
        throw Error("Invalid generation request.");
    } else if (options.input !== undefined)
      throw Error("Unexpected request body.");
    if (host.expiresAt.getTime() <= Date.now())
      throw Error("ChatGPT host expired.");
    const sandbox = await get(host.sandboxName, options.signal);
    if (sandbox.status !== "running")
      throw Error("ChatGPT host is unavailable.");
    const [method, path] = routes[operation];
    return fetch(sandbox.domain(3000) + path, {
      method,
      headers: {
        authorization: `Bearer ${host.capability}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body,
      redirect: "error",
      cache: "no-store",
      signal: signalFor(
        options.signal,
        operation === "generate" ? CHATGPT_GENERATION_TIMEOUT_MS : 35_000,
      ),
    });
  }

  async function privateOperation(
    host: Host,
    operation: ChatGPTPrivateOperation,
    input: unknown,
    signal?: AbortSignal,
    correlation?: GenerationObservationCorrelation,
  ) {
    if (host.expiresAt.getTime() <= Date.now())
      throw Error("ChatGPT host expired.");
    const body = JSON.stringify(input);
    if (typeof body !== "string")
      throw Error("Invalid private operation request.");
    if (
      Buffer.byteLength(body) >
      (operation === "generate" ? 512 * 1024 : 128 * 1024)
    )
      throw Error("Private ChatGPT operation request is too large.");
    const sandbox = await get(host.sandboxName, signal);
    if (sandbox.status !== "running")
      throw Error("ChatGPT host is unavailable.");
    const [, path] = privateRoutes[operation];
    return fetch(sandbox.domain(3000) + path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${host.capability}`,
        "content-type": "application/json",
        ...(operation === "generate" && correlation
          ? {
              "x-orbsie-request-id": correlation.requestId,
              ...(correlation.clientRunId
                ? { "x-orbsie-client-run-id": correlation.clientRunId }
                : {}),
            }
          : {}),
      },
      body,
      redirect: "error",
      cache: "no-store",
      signal: signalFor(
        signal,
        operation === "generate" ? CHATGPT_GENERATION_TIMEOUT_MS : 35_000,
      ),
    });
  }

  async function renew(
    host: Host,
    targetExpiresAt: Date,
    signal?: AbortSignal,
  ): Promise<Date> {
    const renewalSignal = signalFor(signal, HOST_RENEWAL_TIMEOUT_MS);
    renewalSignal.throwIfAborted();
    if (
      !(targetExpiresAt instanceof Date) ||
      !Number.isFinite(targetExpiresAt.getTime())
    )
      throw Error("ChatGPT host renewal deadline is invalid.");
    const now = Date.now();
    if (targetExpiresAt.getTime() <= now)
      throw Error("ChatGPT host renewal deadline has expired.");
    const sandbox = await get(host.sandboxName, renewalSignal);
    if (sandbox.status !== "running")
      throw Error("ChatGPT host is unavailable.");
    const actual = sandbox.expiresAt;
    if (!(actual instanceof Date) || !Number.isFinite(actual.getTime()))
      throw Error("ChatGPT host expiry could not be verified.");
    if (actual.getTime() <= Date.now()) throw Error("ChatGPT host expired.");
    if (targetExpiresAt.getTime() <= Date.now())
      throw Error("ChatGPT host renewal deadline has expired.");
    if (actual.getTime() < targetExpiresAt.getTime()) {
      const delta = targetExpiresAt.getTime() - actual.getTime();
      if (delta <= 0) throw Error("ChatGPT host renewal delta is invalid.");
      // Call the current running Session directly. Sandbox.extendTimeout uses
      // its resume wrapper, which could restart a host after a stop race.
      await sandbox.currentSession().extendTimeout(delta, {
        signal: renewalSignal,
      });
    }
    renewalSignal.throwIfAborted();
    const verified = sandbox.expiresAt;
    if (
      !(verified instanceof Date) ||
      !Number.isFinite(verified.getTime()) ||
      verified.getTime() < targetExpiresAt.getTime()
    )
      throw Error("ChatGPT host expiry could not be verified.");
    return verified;
  }

  async function readArtifacts() {
    const files = await Promise.all(
      ["server.mjs", "package.json"].map(async (path) => ({
        path,
        // Deployment files are explicitly traced in next.config.ts.
        content: await readFile(
          /* turbopackIgnore: true */ join(
            /* turbopackIgnore: true */ options.artifactDirectory,
            path,
          ),
        ),
      })),
    );
    return { files, digest: computeChatGPTArtifactDigest(files) };
  }

  return {
    request,
    privateOperation,
    renew,
    async artifactDigest() {
      return (await readArtifacts()).digest;
    },
    async provision(input: {
      name: string;
      capability: string;
      expiresAt: Date;
    }): Promise<string> {
      if (!validName(input.name)) throw Error("Invalid ChatGPT host.");
      const timeout = Math.min(600_000, input.expiresAt.getTime() - Date.now());
      if (timeout < 60_000) throw Error("ChatGPT host reservation expired.");
      // Read artifacts before creating a metered resource.
      const { files, digest } = await readArtifacts();
      const sandbox = await Sandbox.create({
        ...options.credentials,
        name: input.name,
        image: "vercel/sandbox/node:22",
        resources: { vcpus: 1 },
        persistent: false,
        timeout,
        ports: [3000],
        region: "iad1",
        signal: AbortSignal.timeout(30_000),
      });
      await sandbox.writeFiles(files);
      const installed = await sandbox.runCommand({
        cmd: "npm",
        args: ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
        signal: AbortSignal.timeout(60_000),
      });
      if (installed.exitCode !== 0)
        throw Error("ChatGPT host installation failed.");
      await sandbox.update({
        networkPolicy: {
          allow: ["auth.openai.com", "chatgpt.com", "api.openai.com"],
        },
      });
      await sandbox.runCommand({
        cmd: "npm",
        args: ["start"],
        env: {
          ORBSIE_CHATGPT_HOST_TOKEN: input.capability,
          PORT: "3000",
          ORBSIE_CHATGPT_GENERATION:
            process.env.ORBSIE_CHATGPT_GENERATION === "1" ? "1" : "0",
        },
        detached: true,
      });
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const response = await fetch(sandbox.domain(3000) + "/login/status", {
            headers: { authorization: `Bearer ${input.capability}` },
            redirect: "error",
            signal: AbortSignal.timeout(5_000),
          });
          if (response.ok) {
            const value = await response.json();
            if (
              value.authStatus === "disconnected" &&
              value.lifecycle === "idle"
            )
              return digest;
            throw Error("Fresh ChatGPT host has unexpected account state.");
          }
          await response.body?.cancel();
        } catch {
          /* Bounded startup readiness retries; cleanup belongs to service. */
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      throw Error("ChatGPT host did not become ready.");
    },
    async destroy(name: string, signal?: AbortSignal) {
      try {
        await (
          await get(name, signal)
        ).delete({ signal: signalFor(signal, 30_000) });
      } catch (error) {
        if (!(error instanceof APIError && error.response.status === 404))
          throw error;
      }
    },
  };
}
