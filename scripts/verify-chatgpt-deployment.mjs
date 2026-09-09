// Uses an existing Orbsie acceptance account, never a developer ChatGPT login.
import { request } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const target = new URL(process.env.ORBSIE_TEST_URL || "");
assert(
  /^orbsie-[a-z0-9]+-grappeggias-projects\.vercel\.app$/.test(target.hostname),
);
assert.equal(target.protocol, "https:");
const state = JSON.parse(
  await readFile(".vercel/cloud-test-state.json", "utf8"),
);
assert.equal(state.baseURL, "https://orbsie.com");
const report = {
  target: target.origin,
  startedAt: new Date().toISOString(),
  passed: false,
  liveLogin: false,
  inference: false,
  checks: [],
};
const canonical = await request.newContext({
  baseURL: state.baseURL,
  extraHTTPHeaders: { Origin: state.baseURL },
  storageState: state.users[0].storageState,
});
let cookie,
  attempted = false;
const pause = () => new Promise((resolve) => setTimeout(resolve, 2100));
async function call(method, path) {
  await pause();
  const output = await new Promise((resolve, reject) => {
    const child = spawn(
      "vercel",
      [
        "curl",
        path,
        "--deployment",
        target.origin,
        "--",
        "--silent",
        "--show-error",
        "--max-time",
        "180",
        "--request",
        method.toUpperCase(),
        "--write-out",
        "\n%{http_code}",
        "--config",
        "-",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 128 * 1024) child.kill();
    });
    child.stderr.resume();
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(output) : reject(Error("Vercel request failed")),
    );
    const quote = (value) =>
      `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    assert(!/[\r\n]/.test(cookie));
    child.stdin.end(
      `header = ${quote(`Origin: ${state.baseURL}`)}\nheader = ${quote(`Cookie: ${cookie}`)}\n`,
    );
  });
  const split = output.lastIndexOf("\n");
  const response = {
    status: () => Number(output.slice(split + 1)),
    json: async () => JSON.parse(output.slice(0, split)),
  };
  report.checks.push({ method, path, status: response.status() });
  assert(
    ![403, 429].includes(response.status()),
    `Access/rate boundary: ${response.status()}`,
  );
  return response;
}
try {
  const session = await canonical.get("/api/auth/get-session");
  assert(
    session.ok() && (await session.json())?.user,
    "Existing acceptance session is unavailable",
  );
  const cookies = (await canonical.storageState()).cookies.filter(
    (c) => c.domain === "orbsie.com" || c.domain === ".orbsie.com",
  );
  assert(cookies.length > 0);
  // Same owned app and database, alternate deployment hostname; no credentials are logged.
  cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const config = await call("get", "/api/config");
  assert.equal(config.status(), 200);
  assert.equal((await config.json()).chatgptGeneration, true);
  const before = await call("get", "/api/chatgpt/status");
  assert.equal(before.status(), 200);
  assert.equal((await before.json()).authStatus, "disconnected");
  attempted = true;
  const start = await call("post", "/api/chatgpt/start");
  assert.equal(start.status(), 200, "Hosted device login start failed");
  const challenge = await start.json();
  assert.equal(
    challenge.verificationUrl,
    "https://auth.openai.com/codex/device",
  );
  assert.equal(typeof challenge.userCode, "string");
  assert(challenge.expiresAt > Date.now());
  report.deviceChallengeReceived = true;
  const pending = await call("get", "/api/chatgpt/status");
  assert.equal(pending.status(), 200);
  assert.equal((await pending.json()).lifecycle, "pending");
} catch (error) {
  report.failure =
    error instanceof assert.AssertionError
      ? error.message
      : "Deployment probe failed";
} finally {
  if (attempted) {
    try {
      const cancelled = await call("post", "/api/chatgpt/cancel");
      assert.equal(cancelled.status(), 200);
      assert.equal((await cancelled.json()).authStatus, "disconnected");
      report.cleanup = true;
    } catch {
      report.cleanup = false;
    }
  }
  report.passed = Boolean(
    report.deviceChallengeReceived && report.cleanup && !report.failure,
  );
  await writeFile(
    ".vercel/chatgpt-deployment-report.json",
    JSON.stringify(report, null, 2),
  );
  await canonical.dispose();
  console.log(JSON.stringify(report, null, 2));
}
if (!report.passed) process.exitCode = 1;
