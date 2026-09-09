import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ChatGPTDeviceRpc } from "./chatgpt-device-session";

const RPC_TIMEOUT_MS = 30_000;
const MAX_PENDING = 16;
const MAX_LINE_BYTES = 64 * 1024;
const SHUTDOWN_GRACE_MS = 2_000;
const ALLOWED_METHODS = new Set([
  "account/read",
  "account/login/start",
  "account/login/cancel",
  "account/logout",
]);
const INITIALIZE = "initialize";
const INITIALIZED = "initialized";
const COMPLETED = "account/login/completed";

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

type JsonRpc = {
  id?: unknown;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

const failure = (message: string) => Error(message);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function writeJson(stdin: NodeJS.WritableStream, value: unknown) {
  stdin.write(JSON.stringify(value) + "\n");
}

/**
 * Creates one empty-directory App Server runtime. The caller owns the
 * resulting RPC and must close it; no developer CODEX_HOME or credentials are
 * inherited by the child.
 */
export async function createIsolatedChatGPTRpc(): Promise<
  ChatGPTDeviceRpc & { close(): Promise<void> }
> {
  let root: string | undefined;
  let child: ChildProcess | undefined;
  let closePromise: Promise<void> | undefined;
  const pending = new Map<number, Pending>();
  const listeners = new Set<(notification: unknown) => void>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffered = new Uint8Array(0);
  let nextId = 1;
  let exited = false;
  let closed = false;

  const rejectPending = (error: Error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };

  const waitForExit = () =>
    new Promise<void>((resolve) => {
      if (exited || !child) return resolve();
      child.once("exit", () => resolve());
    });

  const close = async () => {
    if (closePromise) return closePromise;
    closed = true;
    rejectPending(failure("ChatGPT App Server was closed."));
    const current = child;
    closePromise = (async () => {
      if (current && !exited) {
        try {
          current.kill("SIGTERM");
        } catch {
          // The process may have exited between the state check and kill.
        }
        const timer = setTimeout(() => {
          if (!exited) {
            try {
              current.kill("SIGKILL");
            } catch {
              // The exit listener remains authoritative for cleanup.
            }
          }
        }, SHUTDOWN_GRACE_MS);
        await waitForExit();
        clearTimeout(timer);
      }
      listeners.clear();
      if (root) {
        const owned = root;
        root = undefined;
        await rm(owned, { recursive: true, force: true });
      }
    })();
    return closePromise;
  };

  const request = (method: string, params?: unknown): Promise<unknown> => {
    if (closed)
      return Promise.reject(failure("ChatGPT App Server was closed."));
    if (!ALLOWED_METHODS.has(method))
      return Promise.reject(
        failure("This ChatGPT operation is not supported."),
      );
    if (method === "account/login/start") {
      if (!isRecord(params) || params.type !== "chatgptDeviceCode")
        return Promise.reject(
          failure("This ChatGPT login mode is not supported."),
        );
    }
    if (!child || !child.stdin || pending.size >= MAX_PENDING)
      return Promise.reject(failure("ChatGPT App Server is busy."));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(failure("ChatGPT App Server request timed out."));
        void close();
      }, RPC_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      try {
        writeJson(child!.stdin!, {
          id,
          method,
          ...(params === undefined ? {} : { params }),
        });
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        reject(failure("ChatGPT App Server request failed."));
      }
    });
  };

  const subscribe = (listener: (notification: unknown) => void) => {
    if (closed) return () => undefined;
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  try {
    root = await mkdtemp(join(tmpdir(), "orbsie-chatgpt-runtime-"));
    const credentials = join(root, "codex-home");
    await mkdir(credentials, { mode: 0o700 });
    const processHandle = spawn("codex", ["app-server", "--stdio"], {
      cwd: root,
      env: {
        PATH: process.env.PATH ?? "",
        CODEX_HOME: credentials,
        NODE_ENV: "production",
      },
      stdio: ["pipe", "pipe", "ignore"],
    });
    child = processHandle;
    processHandle.once("exit", () => {
      exited = true;
      closed = true;
      rejectPending(failure("ChatGPT App Server disconnected."));
      void close();
    });
    processHandle.once("error", () => {
      if (processHandle.pid === undefined) exited = true;
      closed = true;
      rejectPending(failure("ChatGPT App Server could not start."));
      void close();
    });
    processHandle.stdin?.once("error", () => {
      closed = true;
      rejectPending(failure("ChatGPT App Server disconnected."));
      void close();
    });
    processHandle.stdout?.on("data", (chunk: Buffer | Uint8Array | string) => {
      if (closed) return;
      const bytes =
        typeof chunk === "string"
          ? new TextEncoder().encode(chunk)
          : new Uint8Array(chunk);
      const merged = new Uint8Array(buffered.length + bytes.length);
      merged.set(buffered);
      merged.set(bytes, buffered.length);
      buffered = merged;
      for (;;) {
        const newline = buffered.indexOf(10);
        if (newline === -1) {
          if (buffered.length > MAX_LINE_BYTES) {
            rejectPending(
              failure("ChatGPT App Server returned an oversized response."),
            );
            void close();
          }
          return;
        }
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (line.length > MAX_LINE_BYTES) {
          rejectPending(
            failure("ChatGPT App Server returned an oversized response."),
          );
          void close();
          return;
        }
        let message: JsonRpc;
        try {
          message = JSON.parse(decoder.decode(line));
        } catch {
          rejectPending(failure("ChatGPT App Server returned invalid data."));
          void close();
          return;
        }
        if (!isRecord(message)) {
          rejectPending(failure("ChatGPT App Server returned invalid data."));
          void close();
          return;
        }
        if (typeof message.method === "string") {
          if (message.id !== undefined) {
            try {
              writeJson(processHandle.stdin!, {
                id: message.id,
                error: {
                  code: -32601,
                  message: "Server requests are not supported.",
                },
              });
            } catch {
              void close();
            }
          } else if (message.method === COMPLETED) {
            for (const listener of listeners) {
              try {
                listener(message.params);
              } catch {
                // Observers cannot turn a notification into a provider error.
              }
            }
          }
        } else if (validId(message.id)) {
          if (message.error !== undefined) {
            const item = pending.get(message.id);
            if (item) {
              pending.delete(message.id);
              clearTimeout(item.timer);
              item.reject(failure("ChatGPT App Server request failed."));
            }
          } else {
            const item = pending.get(message.id);
            if (item) {
              pending.delete(message.id);
              clearTimeout(item.timer);
              item.resolve(message.result);
            }
          }
        }
      }
    });

    const initialized = requestInternal(
      {
        id: nextId++,
        method: INITIALIZE,
        params: { clientInfo: { name: "orbsie", version: "0.1.0" } },
      },
      pending,
      processHandle,
      close,
    );
    await initialized;
    writeJson(processHandle.stdin!, { method: INITIALIZED, params: {} });
    return { request, subscribe, close };
  } catch (error) {
    await close().catch(() => undefined);
    if (
      error instanceof Error &&
      error.message === "ChatGPT App Server was closed."
    )
      throw error;
    throw failure("ChatGPT App Server could not start.");
  }
}

function requestInternal(
  message: { id: number; method: string; params?: unknown },
  pending: Map<number, Pending>,
  child: ChildProcess,
  onTimeout: () => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(message.id);
      reject(failure("ChatGPT App Server request timed out."));
      onTimeout();
    }, RPC_TIMEOUT_MS);
    pending.set(message.id, { resolve, reject, timer });
    try {
      writeJson(child.stdin!, message);
    } catch {
      clearTimeout(timer);
      pending.delete(message.id);
      reject(failure("ChatGPT App Server request failed."));
    }
  });
}
