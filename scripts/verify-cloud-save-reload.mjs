/** Opt-in, zero-model-call browser check against a synthetic signed-in account. */
import { chromium, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const baseURL = process.env.ORBSIE_TEST_URL;
const statePath = process.env.ORBSIE_ACCOUNT_STORAGE_STATE;
const evidenceDirectory = process.env.ORBSIE_EVIDENCE_DIR;
if (!baseURL || !statePath || !evidenceDirectory)
  throw Error(
    "Set ORBSIE_TEST_URL, ORBSIE_ACCOUNT_STORAGE_STATE, and ORBSIE_EVIDENCE_DIR.",
  );
const origin = new URL(baseURL);
if (
  origin.origin !== baseURL ||
  !["127.0.0.1", "localhost"].includes(origin.hostname)
)
  throw Error(
    "This synthetic account fixture is restricted to a loopback origin.",
  );

const serializedState = JSON.parse(await readFile(statePath, "utf8"));
const storageState = serializedState.storageState ?? serializedState;
await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  storageState,
  viewport: { width: 1440, height: 960 },
});
const page = await context.newPage();
const pageErrors = [];
let generationRequests = 0;
let projectWrites = 0;
page.on("pageerror", (error) => pageErrors.push(error.message));
await context.route("**/api/generate**", async (route) => {
  generationRequests++;
  await route.abort();
});
page.on("request", (request) => {
  if (request.url().endsWith("/api/projects") && request.method() === "PUT")
    projectWrites++;
});

const report = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  status: "incomplete",
  scope: "synthetic-signed-in-reload-save-and-competing-cloud-update",
  targetOrigin: origin.origin,
  generationRequests: 0,
  firstSaveStatus: null,
  remoteRevisionAfterSave: null,
  transcriptPreserved: false,
  scenePreserved: false,
  competingUpdateBlockedBeforePut: false,
  localDraftPreserved: false,
  pageErrors: [],
};

async function putDraft(project, history) {
  await page.evaluate(
    async ({ project, history }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("keyval-store", 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("keyval");
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      const record = { project, history, future: [], savedAt: Date.now() };
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("keyval", "readwrite");
        const store = transaction.objectStore("keyval");
        store.put(record, "orbsie-draft");
        store.put({ [project.id]: project }, "orbsie-library");
        store.put({ [project.id]: record }, "orbsie-history");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      db.close();
    },
    { project, history },
  );
}

async function readDraft() {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const get = db
            .transaction("keyval")
            .objectStore("keyval")
            .get("orbsie-draft");
          get.onsuccess = () => {
            resolve(get.result?.project);
            db.close();
          };
          get.onerror = () => reject(get.error);
        };
      }),
  );
}

try {
  const session = await context.request.get(`${baseURL}/api/auth/get-session`);
  const account = await session.json();
  expect(session.status()).toBe(200);
  expect(typeof account?.user?.id).toBe("string");

  const id = randomUUID();
  const base = {
    version: 1,
    id,
    title: "Reload save acceptance",
    seed: 42,
    revision: 35,
    entities: [],
    environment: {
      sky: "#dceee9",
      ground: "#91b977",
      water: "#59bdbb",
    },
    messages: [
      { role: "user", text: "Create a quiet island" },
      { role: "assistant", text: "Island created" },
    ],
  };
  const remoteBase = {
    ...base,
    messages: [
      ...base.messages,
      { role: "assistant", text: "Cloud checkpoint saved" },
    ],
  };
  const local = {
    ...base,
    revision: 42,
    environment: { ...base.environment, ground: "#80aa66" },
  };
  const initialPut = await context.request.put(`${baseURL}/api/projects`, {
    headers: { Origin: baseURL },
    data: {
      project: remoteBase,
      baseRevision: null,
      baseSnapshotToken: null,
    },
  });
  expect(initialPut.status()).toBe(200);

  await page.goto(baseURL);
  await putDraft(local, [base]);
  await page.reload();
  await page.getByRole("button", { name: "Continue your saved world" }).click();
  await expect(page.getByRole("button", { name: "Share Orb" })).toBeVisible();
  await page
    .getByRole("button", {
      name: /^(Your worlds|Your account and cloud worlds)$/,
    })
    .click();
  const saveButton = page.getByRole("button", {
    name: "Save current world to cloud",
  });
  const saveResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/projects") &&
      response.request().method() === "PUT",
  );
  await saveButton.click();
  report.firstSaveStatus = (await saveResponse).status();
  expect(report.firstSaveStatus).toBe(200);
  await expect(saveButton).toBeEnabled();
  const savedResponse = await context.request.get(
    `${baseURL}/api/projects?id=${encodeURIComponent(id)}`,
  );
  expect(savedResponse.status()).toBe(200);
  const saved = (await savedResponse.json()).project;
  report.remoteRevisionAfterSave = saved.revision;
  report.transcriptPreserved =
    JSON.stringify(saved.snapshot.messages) ===
    JSON.stringify(remoteBase.messages);
  report.scenePreserved =
    saved.snapshot.environment.ground === local.environment.ground;
  expect(report.remoteRevisionAfterSave).toBe(42);
  expect(report.transcriptPreserved).toBe(true);
  expect(report.scenePreserved).toBe(true);

  const localBeforeConflict = await readDraft();
  const competing = {
    ...saved.snapshot,
    title: "Competing account save",
  };
  const competingPut = await context.request.put(`${baseURL}/api/projects`, {
    headers: { Origin: baseURL },
    data: {
      project: competing,
      baseRevision: saved.revision,
      baseSnapshotToken: saved.snapshotToken,
    },
  });
  expect(competingPut.status()).toBe(200);
  const writesBeforeConflict = projectWrites;
  await saveButton.click();
  await expect(
    page.getByRole("button", { name: "Open cloud copy" }),
  ).toBeVisible();
  report.competingUpdateBlockedBeforePut =
    projectWrites === writesBeforeConflict;
  report.localDraftPreserved =
    JSON.stringify(await readDraft()) === JSON.stringify(localBeforeConflict);
  expect(report.competingUpdateBlockedBeforePut).toBe(true);
  expect(report.localDraftPreserved).toBe(true);
  expect(generationRequests).toBe(0);
  expect(pageErrors).toEqual([]);
  report.status = "passed";
} finally {
  report.generationRequests = generationRequests;
  report.pageErrors = pageErrors;
  await writeFile(
    `${evidenceDirectory}/report.json`,
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  await browser.close();
}
console.log(JSON.stringify(report));
