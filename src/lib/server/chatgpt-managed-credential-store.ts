import { constants } from "node:fs";
import { lstat, mkdir, open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

export const CHATGPT_MANAGED_CREDENTIAL_CACHE_MAX_BYTES = 64 * 1024;
const AUTH_FILE_NAME = "auth.json";
const SECURE_DIRECTORY_MODE = 0o700;
const SECURE_FILE_MODE = 0o600;

export type ChatGPTManagedCredentialStore = {
  readonly path: string;
  initialize(initialCache?: Uint8Array): Promise<void>;
  snapshot(): Promise<Uint8Array | null>;
};

export class ChatGPTManagedCredentialStoreError extends Error {
  constructor(
    public readonly code:
      | "invalid-cache"
      | "oversized-cache"
      | "invalid-file"
      | "symlink-file"
      | "permissions"
      | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "ChatGPTManagedCredentialStoreError";
  }
}

const invalidCache = () =>
  new ChatGPTManagedCredentialStoreError(
    "invalid-cache",
    "The managed ChatGPT credential cache is invalid.",
  );

function checkedCache(value: Uint8Array): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength === 0)
    throw invalidCache();
  if (value.byteLength > CHATGPT_MANAGED_CREDENTIAL_CACHE_MAX_BYTES)
    throw new ChatGPTManagedCredentialStoreError(
      "oversized-cache",
      "The managed ChatGPT credential cache exceeds its size limit.",
    );
  return Buffer.from(value);
}

function secureDirectoryInfo(info: { isDirectory(): boolean; mode: number }) {
  if (!info.isDirectory())
    throw new ChatGPTManagedCredentialStoreError(
      "invalid-file",
      "The managed ChatGPT credential directory is invalid.",
    );
  if ((info.mode & 0o777) !== SECURE_DIRECTORY_MODE)
    throw new ChatGPTManagedCredentialStoreError(
      "permissions",
      "The managed ChatGPT credential directory permissions are invalid.",
    );
}

function secureFileInfo(
  info: { isFile(): boolean; mode: number },
  code: "invalid-file" | "symlink-file" = "invalid-file",
) {
  if (!info.isFile())
    throw new ChatGPTManagedCredentialStoreError(
      code,
      "The managed ChatGPT credential file is not a regular file.",
    );
  if ((info.mode & 0o077) !== 0 || (info.mode & 0o400) === 0)
    throw new ChatGPTManagedCredentialStoreError(
      "permissions",
      "The managed ChatGPT credential file permissions are invalid.",
    );
}

async function readSnapshot(path: string): Promise<Uint8Array | null> {
  let handle: FileHandle | undefined;
  try {
    const directory = await lstat(join(path, ".."));
    secureDirectoryInfo(directory);
    const linkInfo = await lstat(path).catch((error: unknown) => {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return null;
      throw error;
    });
    if (!linkInfo) return null;
    if (linkInfo.isSymbolicLink())
      throw new ChatGPTManagedCredentialStoreError(
        "symlink-file",
        "The managed ChatGPT credential file cannot be a symlink.",
      );
    secureFileInfo(linkInfo);
    if (linkInfo.size > CHATGPT_MANAGED_CREDENTIAL_CACHE_MAX_BYTES)
      throw new ChatGPTManagedCredentialStoreError(
        "oversized-cache",
        "The managed ChatGPT credential cache exceeds its size limit.",
      );
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const openedInfo = await handle.stat();
    secureFileInfo(openedInfo);
    if (
      openedInfo.dev !== linkInfo.dev ||
      openedInfo.ino !== linkInfo.ino ||
      openedInfo.size > CHATGPT_MANAGED_CREDENTIAL_CACHE_MAX_BYTES
    )
      throw new ChatGPTManagedCredentialStoreError(
        "invalid-file",
        "The managed ChatGPT credential file changed during capture.",
      );
    const buffer = Buffer.alloc(CHATGPT_MANAGED_CREDENTIAL_CACHE_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const finalInfo = await handle.stat();
    if (
      finalInfo.dev !== openedInfo.dev ||
      finalInfo.ino !== openedInfo.ino ||
      finalInfo.size !== bytesRead ||
      finalInfo.size > CHATGPT_MANAGED_CREDENTIAL_CACHE_MAX_BYTES
    )
      throw new ChatGPTManagedCredentialStoreError(
        "invalid-file",
        "The managed ChatGPT credential file changed during capture.",
      );
    if (bytesRead === 0) throw invalidCache();
    return Uint8Array.from(buffer.subarray(0, bytesRead));
  } catch (error) {
    if (error instanceof ChatGPTManagedCredentialStoreError) throw error;
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw new ChatGPTManagedCredentialStoreError(
      "unavailable",
      "The managed ChatGPT credential cache could not be read.",
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writeInitialCache(path: string, value: Uint8Array) {
  const cache = checkedCache(value);
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      SECURE_FILE_MODE,
    );
    await handle.writeFile(cache);
    await handle.chmod(SECURE_FILE_MODE);
    const info = await handle.stat();
    secureFileInfo(info);
    if (info.size !== cache.byteLength)
      throw new ChatGPTManagedCredentialStoreError(
        "invalid-file",
        "The managed ChatGPT credential file was not written completely.",
      );
  } catch (error) {
    if (error instanceof ChatGPTManagedCredentialStoreError) throw error;
    throw new ChatGPTManagedCredentialStoreError(
      "unavailable",
      "The managed ChatGPT credential cache could not be initialized.",
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Provides the one fixed auth.json path inside a runtime-owned CODEX_HOME.
 * Callers must not pass browser, developer-home, or arbitrary provider paths.
 */
export function createChatGPTManagedCredentialStore(
  directory: string,
): ChatGPTManagedCredentialStore {
  if (
    typeof directory !== "string" ||
    directory.length === 0 ||
    directory.length > 4_096
  )
    throw invalidCache();
  const path = join(directory, AUTH_FILE_NAME);
  return {
    path,
    async initialize(initialCache) {
      const directoryInfo = await lstat(directory).catch(() => null);
      if (!directoryInfo)
        await mkdir(directory, { mode: SECURE_DIRECTORY_MODE });
      secureDirectoryInfo(await lstat(directory));
      if (initialCache !== undefined)
        await writeInitialCache(path, initialCache);
    },
    snapshot: () => readSnapshot(path),
  };
}
