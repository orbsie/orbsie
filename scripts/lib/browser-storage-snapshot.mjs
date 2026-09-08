export async function storageSnapshot(page, keyDigest) {
  return page.evaluate(async (digest) => {
    const textDigest = async (value) => {
      const bytes = new TextEncoder().encode(value);
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(hash)]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
    };
    const containsKey = async (value) => {
      if (typeof value === "string")
        return (await textDigest(value)) === digest;
      if (Array.isArray(value)) {
        for (const child of value) if (await containsKey(child)) return true;
        return false;
      }
      if (value && typeof value === "object") {
        for (const [name, child] of Object.entries(value)) {
          if ((await textDigest(name)) === digest) return true;
          if (await containsKey(child)) return true;
        }
      }
      return false;
    };
    const getValue = (key) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        // Inspection must not create an empty database before idb-keyval starts.
        request.onupgradeneeded = () => request.transaction.abort();
        request.onerror = () =>
          reject(request.error || Error("IndexedDB open failed"));
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("keyval")) {
            db.close();
            resolve(undefined);
            return;
          }
          const transaction = db.transaction("keyval", "readonly");
          const getRequest = transaction.objectStore("keyval").get(key);
          getRequest.onerror = () =>
            reject(getRequest.error || Error("IndexedDB read failed"));
          getRequest.onsuccess = () => {
            const value = getRequest.result;
            db.close();
            resolve(value);
          };
        };
      }).catch(() => undefined);
    const draft = await getValue("orbsie-draft");
    const library = await getValue("orbsie-library");
    const project =
      draft && typeof draft === "object" ? draft.project : undefined;
    const storedProject =
      project && library && typeof library === "object"
        ? library[project.id]
        : undefined;
    const sensitive =
      (await containsKey(draft)) ||
      (await containsKey(library)) ||
      (await containsKey(localStorage)) ||
      (await containsKey(sessionStorage));
    return {
      project: storedProject || project || null,
      revision: storedProject?.revision ?? project?.revision ?? null,
      sensitive,
      localStorageKeys: Object.keys(localStorage),
    };
  }, keyDigest || "__no-provider-key__");
}
