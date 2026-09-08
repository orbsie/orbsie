/** Browser regression: inspection must not create or modify app storage. */
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { storageSnapshot } from "./lib/browser-storage-snapshot.mjs";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.route("http://127.0.0.1:3999/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Storage regression</title>",
    }),
  );
  await page.goto("http://127.0.0.1:3999/");
  assert.equal((await storageSnapshot(page)).project, null);
  assert.deepEqual(
    await page.evaluate(() => indexedDB.databases()),
    [],
    "Inspection created a database before app initialization",
  );
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("keyval-store", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("keyval");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("keyval", "readwrite");
          tx.objectStore("keyval").put(
            { project: { id: "regression", revision: 7 } },
            "orbsie-draft",
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  assert.deepEqual((await storageSnapshot(page)).project, {
    id: "regression",
    revision: 7,
  });
  console.log(
    "PASS: pristine inspection leaves IndexedDB absent; initialized draft remains readable.",
  );
} finally {
  await browser.close();
}
