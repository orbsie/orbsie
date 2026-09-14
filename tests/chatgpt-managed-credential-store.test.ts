import {
  chmod,
  mkdtemp,
  mkdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CHATGPT_MANAGED_CREDENTIAL_CACHE_MAX_BYTES,
  ChatGPTManagedCredentialStoreError,
  createChatGPTManagedCredentialStore,
} from "../src/lib/server/chatgpt-managed-credential-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "orbsie-chatgpt-credential-test-"));
  await chmod(root, 0o700);
  roots.push(root);
  return root;
}

describe("isolated ChatGPT managed credential store", () => {
  it("writes and snapshots only the fixed auth.json with restrictive modes", async () => {
    const root = await makeRoot();
    const store = createChatGPTManagedCredentialStore(root);
    const initial = new TextEncoder().encode("initial-managed-cache");
    await store.initialize(initial);
    expect(store.path).toBe(join(root, "auth.json"));
    expect((await stat(store.path)).mode & 0o777).toBe(0o600);
    expect(await store.snapshot()).toEqual(initial);
  });

  it("returns no cache before login and rejects invalid or oversized input", async () => {
    const root = await makeRoot();
    const store = createChatGPTManagedCredentialStore(root);
    await store.initialize();
    await expect(store.snapshot()).resolves.toBeNull();
    await expect(store.initialize(new Uint8Array())).rejects.toMatchObject({
      code: "invalid-cache",
    });
    await expect(
      store.initialize(
        new Uint8Array(CHATGPT_MANAGED_CREDENTIAL_CACHE_MAX_BYTES + 1),
      ),
    ).rejects.toMatchObject({ code: "oversized-cache" });
  });

  it("rejects symlink, nonregular, permissive, and oversized auth files", async () => {
    const root = await makeRoot();
    const store = createChatGPTManagedCredentialStore(root);
    await store.initialize();
    await symlink("/tmp", store.path);
    await expect(store.snapshot()).rejects.toMatchObject({
      code: "symlink-file",
    });

    await rm(store.path);
    await mkdir(store.path);
    await expect(store.snapshot()).rejects.toMatchObject({
      code: "invalid-file",
    });
    await rm(store.path, { recursive: true });

    await writeFile(store.path, "private-cache", { mode: 0o644 });
    await expect(store.snapshot()).rejects.toMatchObject({
      code: "permissions",
    });
    await rm(store.path);

    await writeFile(
      store.path,
      new Uint8Array(CHATGPT_MANAGED_CREDENTIAL_CACHE_MAX_BYTES + 1),
      { mode: 0o600 },
    );
    await expect(store.snapshot()).rejects.toMatchObject({
      code: "oversized-cache",
    });
    await expect(store.snapshot()).rejects.toBeInstanceOf(
      ChatGPTManagedCredentialStoreError,
    );
  });
});
