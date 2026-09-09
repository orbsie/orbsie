import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const port = process.env.CHATGPT_VERIFY_PORT || "3058";
const base = `http://localhost:${port}`;
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", port],
  {
    env: { ...process.env, ORBSIE_CHATGPT_HOSTED: "1" },
    stdio: "ignore",
  },
);
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw Error("Verification server exited");
    try {
      const r = await fetch(base + "/api/config");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  assert(ready, "Server did not become ready");
  const url = base + "/api/chatgpt/";
  const status = await fetch(url + "status");
  assert.equal(status.status, 401);
  assert.equal(status.headers.get("cache-control"), "private, no-store");
  const emptyPost = await fetch(url + "start", {
    method: "POST",
    headers: { origin: process.env.BETTER_AUTH_URL || base },
  });
  assert.equal(emptyPost.status, 401, "Empty POST must reach authentication");
  const cross = await fetch(url + "start", {
    method: "POST",
    headers: { origin: "https://untrusted.example" },
  });
  assert.equal(cross.status, 403);
  const query = await fetch(url + "status?ownerId=other");
  assert.equal(query.status, 400);
  const method = await fetch(url + "start");
  assert.equal(method.status, 405);
  console.log(
    JSON.stringify({
      passed: true,
      productionHttp: true,
      signedOutRejected: true,
      crossOriginRejected: true,
      identityQueryRejected: true,
      wrongMethodRejected: true,
      noLoginOrProvisioning: true,
    }),
  );
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
  }
}
