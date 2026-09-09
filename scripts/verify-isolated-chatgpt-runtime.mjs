// Read-only runtime isolation probe. Never starts login or model inference.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const directory = await mkdtemp(join(tmpdir(), "orbsie-isolated-chatgpt-"));
const credentialDirectory = join(directory, "credentials");
await mkdir(credentialDirectory, { mode: 0o700 });
const child = spawn("codex", ["app-server", "--stdio"], {
  cwd: directory,
  // CODEX_HOME is the runtime's documented configuration boundary. Do not
  // inherit API keys, developer config, or the existing managed login.
  env: { PATH: process.env.PATH, CODEX_HOME: credentialDirectory },
  stdio: ["pipe", "pipe", "ignore"],
});
const pending = new Map();
let sequence = 0;
let ended = false;
const exited = new Promise((resolve) => {
  const finish = () => {
    ended = true;
    for (const entry of pending.values())
      entry.reject(Error("Isolated runtime ended."));
    pending.clear();
    resolve();
  };
  child.once("exit", finish);
  child.once("error", finish);
});
const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    child.kill();
    return;
  }
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error)
    entry.reject(Error("Isolated runtime rejected inspection."));
  else entry.resolve(message.result);
});
async function request(method, params) {
  if (ended) throw Error("Isolated runtime is unavailable.");
  const id = ++sequence;
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(Error("Isolated runtime inspection timed out.")),
        15000,
      );
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  } finally {
    clearTimeout(timer);
    pending.delete(id);
  }
}
try {
  await request("initialize", {
    clientInfo: { name: "orbsie_isolation_probe", version: "0.1.0" },
  });
  child.stdin.write(
    JSON.stringify({ method: "initialized", params: {} }) + "\n",
  );
  const result = await request("account/read", { refreshToken: false });
  if (result?.account !== null)
    throw Error("Fresh runtime unexpectedly has an account; isolation failed.");
  console.log(
    JSON.stringify(
      {
        isolatedRuntimeStarted: true,
        accountAbsent: true,
        inheritedDeveloperEnvironment: false,
        loginStarted: false,
        inferencePerformed: false,
        hostedDeploymentVerified: false,
      },
      null,
      2,
    ),
  );
} finally {
  lines.close();
  if (!ended) child.kill("SIGTERM");
  const killTimer = setTimeout(() => {
    if (!ended) child.kill("SIGKILL");
  }, 2000);
  await exited;
  clearTimeout(killTimer);
  await rm(directory, { recursive: true, force: true });
}
