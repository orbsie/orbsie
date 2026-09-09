/**
 * Browser acceptance fixture for preserving local authoring context across
 * successful and cancelled OpenRouter OAuth callbacks.
 *
 * The project and provider responses are synthetic local fixtures. This does
 * not exercise a live provider, account, or model request.
 */
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const base = process.env.TEST_URL ?? "http://localhost:3047";
const fakeKey = "sk-or-v1-" + "a".repeat(64);
const pendingKey = "orbsie-openrouter-oauth";
const draftKey = "orbsie-openrouter-draft";

const project = {
  version: 1,
  id: "oauth-draft-acceptance",
  title: "OAuth draft acceptance world",
  seed: 42,
  revision: 9,
  entities: [
    {
      id: "target-tree",
      label: "Target tree",
      position: [-2, 0, 0],
      scale: [1.2, 1.3, 1.2],
      color: "#6d9d58",
      geometry: { kind: "tree", detail: "refined" },
      behavior: { type: "static" },
      stage: "ready",
    },
    {
      id: "quiet-pond",
      label: "Quiet pond",
      position: [2, 0.04, 0],
      scale: [1.6, 1, 1.25],
      color: "#7bced0",
      geometry: { kind: "pond", detail: "refined" },
      behavior: { type: "static" },
      stage: "ready",
    },
  ],
  environment: { sky: "#dceee9", ground: "#91b977", water: "#59bdbb" },
  messages: [{ role: "assistant", text: "Your saved garden is ready." }],
};

const editPrompt = "Make the selected tree taller later";

function installRoutes(context, { cancelled }) {
  const stats = { auth: 0, exchange: 0 };
  context.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ contentType: "text/css", body: "" }),
  );
  context.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config")
      return route.fulfill({
        json: { accounts: false, publishing: false, google: false },
      });
    if (path === "/api/trial")
      return route.fulfill({ json: { enabled: false, remaining: 0 } });
    if (path === "/api/models")
      return route.fulfill({
        json: {
          models: [
            {
              id: "openai/gpt-6-astra",
              name: "Astra fixture",
              qualityRank: 1,
              inputPrice: 1,
              cachedInputPrice: 0,
              outputPrice: 1,
            },
          ],
        },
      });
    return route.abort();
  });
  context.route("https://openrouter.ai/auth?**", async (route) => {
    stats.auth++;
    const auth = new URL(route.request().url());
    const callback = new URL(auth.searchParams.get("callback_url"));
    if (cancelled) {
      callback.searchParams.set("error", "access_denied");
      callback.searchParams.set("error_description", "User cancelled");
    } else callback.searchParams.set("code", "fixture-authorization-code");
    await route.fulfill({
      status: 302,
      headers: { location: callback.href },
      body: "",
    });
  });
  context.route("https://openrouter.ai/api/v1/auth/keys", async (route) => {
    stats.exchange++;
    await route.fulfill({ json: { key: fakeKey } });
  });
  return stats;
}

async function seedLocalProject(page) {
  await page.evaluate(async (value) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("keyval-store", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("keyval"))
          request.result.createObjectStore("keyval");
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("keyval", "readwrite");
        const store = transaction.objectStore("keyval");
        store.put({ [value.id]: value }, "orbsie-library");
        store.put(
          { project: value, history: [], future: [], savedAt: Date.now() },
          "orbsie-draft",
        );
        store.put(
          { [value.id]: { project: value, history: [], future: [] } },
          "orbsie-history",
        );
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, project);
}

async function readLocalRecords(page) {
  return page.evaluate(
    async ({ draftKey: localDraftKey, pendingKey: localPendingKey, fake }) => {
      const records = await new Promise((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("keyval", "readonly");
          const store = transaction.objectStore("keyval");
          const values = {};
          for (const key of ["orbsie-draft", "orbsie-library"]) {
            const read = store.get(key);
            read.onsuccess = () => {
              values[key] = read.result;
              if (Object.keys(values).length === 2) {
                database.close();
                resolve(values);
              }
            };
            read.onerror = () => reject(read.error);
          }
        };
      });
      const serialized = JSON.stringify(records);
      const localStorageValues = Array.from(
        { length: localStorage.length },
        (_, index) => localStorage.getItem(localStorage.key(index) ?? ""),
      );
      return {
        draft: records["orbsie-draft"]?.project ?? null,
        library: records["orbsie-library"] ?? null,
        pending: sessionStorage.getItem(localPendingKey),
        oauthDraft: sessionStorage.getItem(localDraftKey),
        localStorage: localStorageValues,
        containsKey:
          serialized.includes(fake) ||
          JSON.stringify(localStorageValues).includes(fake) ||
          Object.values(sessionStorage).some((value) => value.includes(fake)),
      };
    },
    { draftKey, pendingKey, fake: fakeKey },
  );
}

async function selectAndDraft(page) {
  await page.getByRole("button", { name: "Show objects" }).click();
  await page.getByRole("button", { name: /Target tree\s*ready/i }).click();
  await expect(page.locator(".selection-chip")).toHaveText(/Target tree/);
  await page.locator("#prompt").fill(editPrompt);
}

async function startOAuth(page) {
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page
    .getByRole("button", { name: "Connect with OpenRouter", exact: true })
    .click();
}

async function resumeAndAssert(page, baseline) {
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("button", { name: "Continue your saved world" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue your saved world" }).click();
  await expect(page.locator(".app.is-workspace")).toBeVisible();
  await expect(page.locator(".selection-chip")).toHaveText(/Target tree/);
  await expect(page.locator("#prompt")).toHaveValue(editPrompt);
  const afterResume = await readLocalRecords(page);
  assert.deepEqual(afterResume.draft.entities, baseline.entities);
  assert.equal(afterResume.draft.revision, baseline.revision);
  assert.deepEqual(afterResume.library[project.id].entities, baseline.entities);
  assert.equal(afterResume.library[project.id].revision, baseline.revision);
  assert.equal(afterResume.pending, null);
  assert.equal(afterResume.oauthDraft, null);
  assert.equal(afterResume.containsKey, false);
  assert.equal(
    JSON.stringify(afterResume.localStorage).includes(fakeKey),
    false,
  );
  return afterResume;
}

async function runScenario(cancelled) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const stats = installRoutes(context, { cancelled });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await seedLocalProject(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Continue your saved world" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue your saved world" }).click();
  await expect(page.locator(".app.is-workspace")).toBeVisible();
  const baseline = (await readLocalRecords(page)).draft;
  await selectAndDraft(page);
  await startOAuth(page);
  await expect.poll(() => stats.auth).toBe(1);
  if (cancelled) {
    await expect(
      page.getByText(
        "OpenRouter sign-in expired or could not be completed. Try connecting again.",
        { exact: true },
      ),
    ).toBeVisible();
    assert.equal(stats.exchange, 0);
  } else {
    await expect(
      page.getByText("OpenRouter connected. Choose a model to continue.", {
        exact: true,
      }),
    ).toBeVisible();
    assert.equal(stats.exchange, 1);
  }
  assert.equal(new URL(page.url()).search, "");
  const after = await resumeAndAssert(page, baseline);
  assert.deepEqual(after.draft.entities, project.entities);
  assert.equal(errors.length, 0, errors.join("\n"));
  await context.close();
  return {
    outcome: cancelled ? "cancelled" : "successful",
    authRequests: stats.auth,
    exchangeRequests: stats.exchange,
    revision: after.draft.revision,
    entityIds: after.draft.entities.map((entity) => entity.id),
    selectedId: "target-tree",
    promptRetained: true,
    pendingDraftRemoved: true,
    providerKeyPersisted: false,
  };
}

const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const results = [await runScenario(false), await runScenario(true)];
  console.log(
    JSON.stringify({
      scope: "Synthetic local OAuth callback and saved-world draft recovery",
      appOrigin: new URL(base).origin,
      liveProviderCalls: 0,
      results,
    }),
  );
} finally {
  await browser.close();
}
