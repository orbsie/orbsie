import { request, chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import assert from "node:assert/strict";
const baseURL = process.env.ORBSIE_TEST_URL || "https://orbsie.com";
const stateFile = ".vercel/cloud-test-state.json";
const reportFile = ".superpowers/sdd/cloud-report.md";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
let state;
let browser;
const contexts = [];
async function record(text) {
  checks.push(text);
  console.log(text);
  await writeFile(
    reportFile,
    `# Cloud acceptance\n\nRun: ${new Date().toISOString()}\nTarget: ${baseURL}\n\n${checks.map((x) => `- ${x}`).join("\n")}\n`,
  );
}
async function call(ctx, method, path, data) {
  await pause(2100);
  const r = await ctx[method](path, { data, timeout: 65000 });
  let body;
  try {
    body = await r.json();
  } catch {
    body = { error: "Non-JSON response" };
  }
  if (r.status() === 403 || r.status() === 429)
    throw Error(`${method} ${path}: stopped on ${r.status()}`);
  return { status: r.status(), body };
}
async function persist() {
  await writeFile(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
}
async function ctx(storageState) {
  const c = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL },
    storageState,
  });
  contexts.push(c);
  return c;
}
try {
  await mkdir(".vercel", { recursive: true });
  await mkdir(".superpowers/sdd", { recursive: true });
  const anon = await ctx();
  const robots = await anon.get("/robots.txt");
  assert(robots.status() === 404 || robots.ok(), "robots access failed");
  await record(
    `Owned-site robots check: HTTP ${robots.status()}; bounded API acceptance run, two publications maximum.`,
  );
  let enabled = false;
  for (let i = 0; i < 30; i++) {
    const c = await call(anon, "get", "/api/config");
    if (c.body.accounts && c.body.publishing) {
      enabled = true;
      break;
    }
    console.log("Waiting 20 seconds for accounts and publishing configuration");
    await pause(20000);
  }
  assert(enabled, "Configuration not ready after 10 minutes");
  await record("Accounts and publishing configuration enabled.");
  try {
    state = JSON.parse(await readFile(stateFile, "utf8"));
  } catch {
    state = { baseURL, projectId: randomUUID(), users: [], deployments: [] };
  }
  assert.equal(state.baseURL, baseURL);
  const users = [];
  for (let i = 0; i < 2; i++) {
    if (state.users[i]) {
      users.push(await ctx(state.users[i].storageState));
      continue;
    }
    const c = await ctx();
    const email = `cloud-${randomUUID()}@example.invalid`;
    const password = randomBytes(30).toString("base64url");
    const r = await call(c, "post", "/api/auth/sign-up/email", {
      name: `Cloud acceptance ${i + 1}`,
      email,
      password,
    });
    assert.equal(
      r.status,
      200,
      `Signup ${i}: ${r.status} ${r.body.error?.message || r.body.message || ""}`,
    );
    state.users.push({ email, password, storageState: await c.storageState() });
    await persist();
    users.push(c);
  }
  await record(
    "Two synthetic Better Auth accounts authenticated; secrets stored only in ignored mode-0600 state.",
  );
  const project = JSON.parse(
    await readFile(
      process.env.ORBSIE_TEST_PROJECT || "/tmp/orbsie-flagship-edited.json",
      "utf8",
    ),
  );
  project.id = state.projectId;
  project.title = "Sunbeam Pond · Cloud Showcase";
  const existing = await call(
    users[0],
    "get",
    `/api/projects?id=${project.id}`,
  );
  const baseRevision =
    existing.status === 200 ? existing.body.project.revision : null;
  if (baseRevision !== null) project.revision = baseRevision;
  const saved = await call(users[0], "put", "/api/projects", {
    project,
    baseRevision,
    baseSnapshotToken:
      existing.status === 200 ? existing.body.project.snapshotToken : null,
  });
  assert.equal(
    saved.status,
    200,
    `Save: ${saved.status} ${JSON.stringify(saved.body)}`,
  );
  assert.equal(saved.body.archivePending, false, "GCS archive pending");
  await record(
    `Saved flagship project ${project.id}, revision ${project.revision}; GCS archive completed (archivePending=false).`,
  );
  const listed = await call(users[0], "get", "/api/projects");
  assert(listed.body.projects.some((p) => p.id === project.id));
  const reopened = await call(
    users[0],
    "get",
    `/api/projects?id=${project.id}`,
  );
  assert.deepEqual(reopened.body.project.snapshot.entities, project.entities);
  await record("Authenticated list and reopen preserve flagship entities.");
  assert.equal(
    (await call(users[1], "get", `/api/projects?id=${project.id}`)).status,
    404,
  );
  assert.equal(
    (
      await call(users[1], "put", "/api/projects", {
        project,
        baseRevision: project.revision,
        baseSnapshotToken: saved.body.snapshotToken,
      })
    ).status,
    404,
  );
  await record(
    "Second user cannot read or overwrite the first user’s project (404).",
  );
  assert.equal(
    (
      await call(users[0], "put", "/api/projects", {
        project,
        baseRevision: project.revision - 1,
        baseSnapshotToken: saved.body.snapshotToken,
      })
    ).status,
    409,
  );
  await record("Stale cloud compare-and-swap rejected (409).");
  let snapshotToken = saved.body.snapshotToken;
  for (let release = 0; release < 2; release++) {
    if (release) {
      project.revision++;
      const r = await call(users[0], "put", "/api/projects", {
        project,
        baseRevision: project.revision - 1,
        baseSnapshotToken: snapshotToken,
      });
      assert.equal(r.status, 200);
      snapshotToken = r.body.snapshotToken;
      assert.equal(r.body.archivePending, false);
    }
    assert(
      state.deployments.length < 2 ||
        state.deployments.some((d) => d.revision === project.revision),
      "Two-deployment budget exhausted",
    );
    const published = await call(users[0], "post", "/api/publish", {
      projectId: project.id,
      revision: project.revision,
    });
    assert.equal(
      published.status,
      200,
      `Publish: ${published.status} ${JSON.stringify(published.body)}`,
    );
    if (!state.deployments.some((d) => d.id === published.body.deploymentId)) {
      state.deployments.push({
        id: published.body.deploymentId,
        revision: project.revision,
        url: published.body.deploymentUrl,
      });
      await persist();
    }
    await record(
      `Publication accepted: revision ${project.revision}, deployment ${published.body.deploymentId}.`,
    );
    let ready;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const r = await call(
        users[0],
        "get",
        `/api/publish?projectId=${project.id}`,
      );
      assert.equal(
        r.status,
        200,
        `Publication poll: ${r.status} ${JSON.stringify(r.body)}`,
      );
      if (r.body.state === "READY") {
        ready = r.body;
        break;
      }
      assert(
        !["ERROR", "CANCELED", "PROTECTED"].includes(r.body.state),
        `Publication failed: ${JSON.stringify(r.body)}`,
      );
      await pause(10000);
    }
    assert(ready, "Publication not ready within 3 minutes");
    assert.equal(ready.url, `/o/${project.id}`);
    assert.equal(ready.servedRevision, project.revision);
    const publicResponse = await anon.get(ready.url);
    assert(publicResponse.ok());
    const deploymentResponse = await anon.get(ready.deploymentUrl);
    assert(deploymentResponse.ok());
    const snapshot = await (
      await anon.get(`${ready.deploymentUrl}/project.json`)
    ).json();
    assert.equal(snapshot.revision, project.revision);
    await record(
      `Public revision ${project.revision} READY: ${baseURL}${ready.url}; independent deployment ${ready.deploymentUrl}; both accessible signed out.`,
    );
    if (!browser)
      browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox"],
      });
    const page = await browser.newPage();
    await page.goto(`${baseURL}${ready.url}`);
    const iframe = page.frameLocator("iframe");
    await iframe.locator("canvas").waitFor({ timeout: 45000 });
    await page.screenshot({
      path: `.superpowers/sdd/cloud-public-${release + 1}.png`,
    });
    await page.close();
    await record(
      `Signed-out Chromium rendered public iframe canvas for revision ${project.revision}.`,
    );
  }
  await record(
    `Republished the same Orb using deterministic Vercel project name orb-${createHash("sha256").update(project.id).digest("hex").slice(0, 20)}; direct project-ID equality requires infrastructure-side verification.`,
  );
  await record(
    "PASS: cloud persistence, isolation, conflict handling, archival, publication, and republishing verified. Public sample preserved.",
  );
} catch (e) {
  await record(`FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const c of contexts) await c.dispose();
}
