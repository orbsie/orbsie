import { APIError, Sandbox } from "@vercel/sandbox";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type Credentials = { token: string; teamId: string; projectId: string };
type Host = { sandboxName: string; capability: string; expiresAt: Date };
type Operation = "status" | "start" | "cancel" | "logout";
const routes = {
  status: ["GET", "/login/status"],
  start: ["POST", "/login/start"],
  cancel: ["POST", "/login/cancel"],
  logout: ["POST", "/logout"],
} as const;
const validName = (name: string) => /^orbsie-chatgpt-[a-f0-9-]{36}$/.test(name);

/** Credentials are injected by the trusted server, never taken from requests. */
export function createChatGPTSandboxBackend(options: {
  artifactDirectory: string;
  credentials?: Credentials;
}) {
  async function get(name: string) {
    if (!validName(name)) throw Error("Invalid ChatGPT host.");
    return Sandbox.get({
      ...options.credentials,
      name,
      resume: false,
      signal: AbortSignal.timeout(30_000),
    });
  }
  async function request(host: Host, operation: Operation) {
    if (host.expiresAt.getTime() <= Date.now())
      throw Error("ChatGPT host expired.");
    const sandbox = await get(host.sandboxName);
    if (sandbox.status !== "running")
      throw Error("ChatGPT host is unavailable.");
    const [method, path] = routes[operation];
    return fetch(sandbox.domain(3000) + path, {
      method,
      headers: { authorization: `Bearer ${host.capability}` },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(35_000),
    });
  }
  return {
    request,
    async provision(input: {
      name: string;
      capability: string;
      expiresAt: Date;
    }) {
      if (!validName(input.name)) throw Error("Invalid ChatGPT host.");
      const timeout = Math.min(600_000, input.expiresAt.getTime() - Date.now());
      if (timeout < 60_000) throw Error("ChatGPT host reservation expired.");
      // Read artifacts before creating a metered resource.
      const files = await Promise.all(
        ["server.mjs", "package.json"].map(async (path) => ({
          path,
          content: await readFile(join(options.artifactDirectory, path)),
        })),
      );
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
        env: { ORBSIE_CHATGPT_HOST_TOKEN: input.capability, PORT: "3000" },
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
              return;
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
    async destroy(name: string) {
      try {
        await (await get(name)).delete({ signal: AbortSignal.timeout(30_000) });
      } catch (error) {
        if (!(error instanceof APIError && error.response.status === 404))
          throw error;
      }
    },
  };
}
