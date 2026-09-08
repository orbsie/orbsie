import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// Deterministic publication polling regression. Every account, project, and
// publication response is synthetic; no provider, model, or external write is
// reachable from this check.
const base = process.env.TEST_URL || "http://localhost:3014";
const evidenceDir =
  process.env.POLL_EVIDENCE_DIR || "/tmp/orbsie-publication-poll";
const firstProjectId = "publication-poll-regression";
const secondProjectId = "publication-poll-other-world";
const firstRevision = 7;
const servedRevision = 7;
const firstProject = {
  version: 1,
  id: firstProjectId,
  title: "Publication polling world",
  seed: 42,
  revision: firstRevision,
  entities: [],
  environment: { sky: "#dceee9", ground: "#91b977", water: "#59bdbb" },
  messages: [],
};
const secondProject = {
  ...firstProject,
  id: secondProjectId,
  title: "Another fixture world",
};
const cloudProjects = [
  {
    id: firstProject.id,
    title: firstProject.title,
    revision: firstProject.revision,
    snapshot: firstProject,
  },
  {
    id: secondProject.id,
    title: secondProject.title,
    revision: secondProject.revision,
    snapshot: secondProject,
  },
];

await mkdir(evidenceDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const unexpectedApi = [];
const publicationGets = [];
const publicationPosts = [];
const inferenceRequests = [];
let publicationByProject = new Map([[firstProjectId, null]]);
let shareClosed = false;
let holdNextPublicationGet = false;
let delayedPublicationGetStarted = false;
let releaseDelayedPublicationGet;
let failNextPublicationGet = false;

page.on("request", (request) => {
  if (request.url().includes("/api/generate"))
    inferenceRequests.push(request.url());
});

await context.route("**/api/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  const method = request.method();
  let status = 200;
  let body;

  if (path === "/api/config" && method === "GET") {
    body = { accounts: true, publishing: true, google: false };
  } else if (path === "/api/auth/get-session" && method === "GET") {
    body = { user: { name: "Fixture publisher" } };
  } else if (path === "/api/projects" && method === "GET") {
    body = { projects: cloudProjects };
  } else if (path === "/api/publish" && method === "POST") {
    const projectId = JSON.parse(request.postData() || "{}").projectId;
    publicationPosts.push(projectId);
    publicationByProject.set(projectId, {
      state: "QUEUED",
      servedRevision: firstRevision - 1,
      url: `/o/${projectId}`,
      deploymentUrl: "https://fixture-deployment.example.test/queued",
    });
    body = publicationByProject.get(projectId);
  } else if (path === "/api/publish" && method === "GET") {
    const projectId = url.searchParams.get("projectId");
    if (holdNextPublicationGet && projectId === firstProjectId) {
      holdNextPublicationGet = false;
      delayedPublicationGetStarted = true;
      await new Promise((resolve) => {
        releaseDelayedPublicationGet = resolve;
      });
    }
    const publication = publicationByProject.get(projectId);
    if (failNextPublicationGet && projectId === firstProjectId) {
      failNextPublicationGet = false;
      publicationGets.push({
        projectId,
        state: "NETWORK_ERROR",
        servedRevision: null,
        afterShareClosed: shareClosed,
      });
      await route.abort("failed");
      return;
    }
    publicationGets.push({
      projectId,
      state: publication?.state ?? "404",
      servedRevision: publication?.servedRevision ?? null,
      afterShareClosed: shareClosed,
    });
    if (!publication) {
      status = 404;
      body = { error: "Publication not found" };
    } else {
      body = publication;
    }
  } else {
    unexpectedApi.push(`${method} ${path}`);
    status = 500;
    body = { error: `Unexpected fixture request: ${method} ${path}` };
  }

  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
});

const report = {
  base,
  checks: [],
  publicationGets,
  publicationPosts,
  unexpectedApi,
  inferenceRequests,
};

try {
  await page.goto(base);
  await page.getByRole("button", { name: "Your worlds", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: /Publication polling world.*Revision 7 · Cloud/,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: /Publication polling world.*Revision 7 · Cloud/,
    })
    .click();
  await expect(page.locator(".workspace-heading h2")).toHaveText(
    "Publication polling world",
  );
  report.checks.push("opened saved fixture world");

  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Publish Orb", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish Orb", exact: true }).click();
  await expect(page.getByText(/Publication: queued/)).toBeVisible();
  expect(publicationPosts).toEqual([firstProjectId]);
  report.checks.push("queued publication through intercepted POST");

  // The deployment becomes ready after the user leaves Share. The only way
  // to learn this before reopening Share is the background GET below.
  publicationByProject.set(firstProjectId, {
    state: "READY",
    servedRevision,
    url: `/o/${firstProjectId}`,
    deploymentUrl: "https://fixture-deployment.example.test/ready",
  });
  shareClosed = true;
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect
    .poll(
      () =>
        publicationGets.filter(
          (entry) =>
            entry.projectId === firstProjectId &&
            entry.afterShareClosed &&
            entry.state === "READY",
        ).length,
      { timeout: 8000, intervals: [250, 500, 1000] },
    )
    .toBeGreaterThan(0);
  report.checks.push("background polling retrieved READY after Share closed");

  const getsBeforeReopen = publicationGets.length;
  shareClosed = false;
  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  await expect
    .poll(() => publicationGets.length, { timeout: 4000 })
    .toBeGreaterThan(getsBeforeReopen);
  expect(
    publicationGets
      .slice(getsBeforeReopen)
      .some(
        (entry) =>
          entry.projectId === firstProjectId &&
          entry.state === "READY" &&
          entry.servedRevision === servedRevision,
      ),
  ).toBe(true);
  const publishedLink = page.getByRole("link", {
    name: "Open published Orb",
  });
  await expect(publishedLink).toBeVisible();
  await expect(publishedLink).toHaveAttribute("href", `/o/${firstProjectId}`);
  report.checks.push("reopened Share with served revision and stable link");
  await page.screenshot({ path: `${evidenceDir}/ready-share.png` });

  // Hold a status response while switching projects. The stale first-world
  // response must not populate the second world's Share dialog.
  shareClosed = true;
  await page.getByRole("button", { name: "Close dialog" }).click();
  publicationByProject.set(firstProjectId, {
    state: "QUEUED",
    servedRevision: firstRevision - 1,
    url: `/o/${firstProjectId}`,
    deploymentUrl: "https://fixture-deployment.example.test/queued-again",
  });
  holdNextPublicationGet = true;
  shareClosed = false;
  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  await expect
    .poll(() => delayedPublicationGetStarted, { timeout: 4000 })
    .toBe(true);
  shareClosed = true;
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Your account and cloud worlds" })
    .click();
  await page
    .getByRole("button", { name: /Another fixture world.*Revision 7 · Cloud/ })
    .click();
  await expect(page.locator(".workspace-heading h2")).toHaveText(
    "Another fixture world",
  );
  releaseDelayedPublicationGet?.();
  await page.waitForTimeout(300);
  shareClosed = false;
  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Publish Orb", exact: true }),
  ).toBeVisible();
  await expect(publishedLink).not.toBeVisible();
  report.checks.push("project switch discarded delayed stale publication");

  // A transient background failure must remain local to the polling task. It
  // must not place a Share-specific error into the account dialog.
  shareClosed = true;
  await page.getByRole("button", { name: "Close dialog" }).click();
  publicationByProject.set(firstProjectId, {
    state: "QUEUED",
    servedRevision: firstRevision - 1,
    url: `/o/${firstProjectId}`,
    deploymentUrl: "https://fixture-deployment.example.test/queued-error-case",
  });
  await page
    .getByRole("button", { name: "Your account and cloud worlds" })
    .click();
  await page
    .getByRole("button", {
      name: /Publication polling world.*Revision 7 · Cloud/,
    })
    .click();
  await expect(page.locator(".workspace-heading h2")).toHaveText(
    "Publication polling world",
  );
  shareClosed = false;
  await page.getByRole("button", { name: "Share Orb", exact: true }).click();
  await expect(page.getByText(/Publication: queued/)).toBeVisible();
  shareClosed = true;
  await page.getByRole("button", { name: "Close dialog" }).click();
  failNextPublicationGet = true;
  await page
    .getByRole("button", { name: "Your account and cloud worlds" })
    .click();
  await expect
    .poll(
      () =>
        publicationGets.filter(
          (entry) =>
            entry.projectId === firstProjectId &&
            entry.state === "NETWORK_ERROR",
        ).length,
      { timeout: 5000 },
    )
    .toBeGreaterThan(0);
  await expect(
    page.getByText("Publication status could not be loaded.", { exact: true }),
  ).not.toBeVisible();
  const queuedBeforeRetry = publicationGets.filter(
    (entry) => entry.projectId === firstProjectId && entry.state === "QUEUED",
  ).length;
  await expect
    .poll(
      () =>
        publicationGets.filter(
          (entry) =>
            entry.projectId === firstProjectId && entry.state === "QUEUED",
        ).length,
      { timeout: 6000, intervals: [500, 1000, 2000] },
    )
    .toBeGreaterThan(queuedBeforeRetry);
  report.checks.push(
    "background status failure did not spill into account dialog and retried",
  );

  expect(unexpectedApi).toEqual([]);
  expect(inferenceRequests).toEqual([]);
  report.checks.push("fixture run made no unexpected API or model requests");
  console.log(JSON.stringify(report));
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await writeFile(
    `${evidenceDir}/report.json`,
    JSON.stringify(report, null, 2),
  );
  await context.close();
  await browser.close();
}
