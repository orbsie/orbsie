import { Sandbox } from "@vercel/sandbox";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
if (process.env.ORBSIE_SANDBOX_PROBE !== "1")
  throw Error(
    "Set ORBSIE_SANDBOX_PROBE=1 to create a short-lived Vercel resource",
  );
const project = JSON.parse(await readFile(".vercel/project.json", "utf8"));
let token;
for (const p of [
  ".local/share/com.vercel.cli/auth.json",
  ".config/com.vercel.cli/auth.json",
]) {
  try {
    token = JSON.parse(await readFile(join(homedir(), p), "utf8")).token;
    if (token) break;
  } catch {}
}
if (!token) throw Error("Existing CLI authorization unavailable");
const name = "orbsie-auth-probe-" + Date.now();
const report = {
  name,
  startedAt: new Date().toISOString(),
  timeoutMs: 300000,
  persistent: false,
  vcpus: 1,
  loginStarted: false,
  inferencePerformed: false,
  created: false,
  deleted: false,
};
const save = () =>
  writeFile(
    ".vercel/chatgpt-sandbox-probe-report.json",
    JSON.stringify(report, null, 2),
  );
let sandbox;
await save();
try {
  sandbox = await Sandbox.create({
    name,
    token,
    teamId: project.orgId,
    projectId: project.projectId,
    image: "vercel/sandbox/node:22",
    resources: { vcpus: 1 },
    persistent: false,
    timeout: 300000,
    ports: [3000],
    region: "iad1",
  });
  report.created = true;
  await save();
  console.log("Sandbox created");
  await sandbox.writeFiles(
    await Promise.all(
      ["server.mjs", "package.json"].map(async (file) => ({
        path: file,
        content: await readFile(".vercel/chatgpt-host-build/" + file),
      })),
    ),
  );
  const install = await sandbox.runCommand({
    cmd: "npm",
    args: ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
  });
  report.installExitCode = install.exitCode;
  if (install.exitCode !== 0)
    throw Error("Host dependency installation failed");
  await sandbox.update({ networkPolicy: "deny-all" });
  const capability = randomBytes(32).toString("hex");
  await sandbox.runCommand({
    cmd: "npm",
    args: ["start"],
    env: { ORBSIE_CHATGPT_HOST_TOKEN: capability, PORT: "3000" },
    detached: true,
  });
  const url = sandbox.domain(3000) + "/login/status";
  report.statusUrl = url;
  let response;
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      response = await fetch(url, {
        headers: { authorization: "Bearer " + capability },
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 200) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  report.status = response?.status ?? null;
  if (!response || response.status !== 200)
    throw Error("Host readiness failed");
  const status = await response.json();
  report.authStatus = status.authStatus;
  report.lifecycle = status.lifecycle;
  if (status.authStatus !== "disconnected" || status.lifecycle !== "idle")
    throw Error("Fresh host was not signed out");
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const unauthorized = await fetch(url, { signal: AbortSignal.timeout(5000) });
  report.unauthenticatedStatus = unauthorized.status;
  if (unauthorized.status !== 401)
    throw Error("Unauthenticated host request was not rejected");
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error =
    error instanceof Error &&
    [
      "Host dependency installation failed",
      "Host readiness failed",
      "Fresh host was not signed out",
      "Unauthenticated host request was not rejected",
    ].includes(error.message)
      ? error.message
      : "Sandbox probe failed";
  report.errorType = error?.constructor?.name;
  report.httpStatus = error?.status ?? error?.statusCode ?? null;
} finally {
  if (sandbox) {
    try {
      await sandbox.delete();
      report.deleted = true;
    } catch {
      report.cleanupFailed = true;
    }
  }
  report.finishedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify(report));
  if (!report.passed || !report.deleted) process.exitCode = 1;
}
