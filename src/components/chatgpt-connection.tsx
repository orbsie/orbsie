"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  LoaderCircle,
  LogOut,
  Sparkles,
  X,
} from "lucide-react";

export const CHATGPT_DEVICE_URL = "https://auth.openai.com/codex/device";

export type ChatGPTChallenge = {
  userCode: string;
  verificationUrl: typeof CHATGPT_DEVICE_URL;
  expiresAt: number;
};

export type ChatGPTSnapshot = {
  lifecycle:
    "idle" | "pending" | "completed" | "failed" | "cancelled" | "expired";
  authStatus: "unknown" | "connected" | "disconnected";
  pending?: ChatGPTChallenge;
};

const lifecycleValues = new Set<ChatGPTSnapshot["lifecycle"]>([
  "idle",
  "pending",
  "completed",
  "failed",
  "cancelled",
  "expired",
]);
const authStatusValues = new Set<ChatGPTSnapshot["authStatus"]>([
  "unknown",
  "connected",
  "disconnected",
]);

function boundedText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function parseChatGPTChallenge(value: unknown): ChatGPTChallenge | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (
    !boundedText(source.userCode, 256) ||
    source.verificationUrl !== CHATGPT_DEVICE_URL ||
    !Number.isSafeInteger(source.expiresAt) ||
    (source.expiresAt as number) <= 0
  )
    return null;
  return {
    userCode: source.userCode,
    verificationUrl: CHATGPT_DEVICE_URL,
    expiresAt: source.expiresAt as number,
  };
}

export function parseChatGPTSnapshot(value: unknown): ChatGPTSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (
    !lifecycleValues.has(source.lifecycle as ChatGPTSnapshot["lifecycle"]) ||
    !authStatusValues.has(source.authStatus as ChatGPTSnapshot["authStatus"])
  )
    return null;
  if (source.pending !== undefined && source.lifecycle !== "pending")
    return null;
  const pending =
    source.pending === undefined
      ? undefined
      : parseChatGPTChallenge(source.pending);
  if (source.pending !== undefined && !pending) return null;
  return {
    lifecycle: source.lifecycle as ChatGPTSnapshot["lifecycle"],
    authStatus: source.authStatus as ChatGPTSnapshot["authStatus"],
    ...(pending ? { pending } : {}),
  };
}

type View =
  | { phase: "checking" }
  | { phase: "idle"; message?: string }
  | { phase: "pending"; challenge: ChatGPTChallenge; message?: string }
  | { phase: "connected"; message?: string }
  | { phase: "error"; message: string };

const initialView: View = { phase: "checking" };
const genericError = "ChatGPT connection could not be completed. Try again.";
const safeErrors = new Set([
  "ChatGPT connection could not be completed.",
  "ChatGPT host is unavailable.",
  "ChatGPT host returned an invalid response.",
  "ChatGPT request could not be completed.",
  "ChatGPT host cleanup could not be completed.",
  "ChatGPT sign-in could not be started.",
  "ChatGPT sign-in was canceled.",
  "ChatGPT sign-in code expired. Start again.",
  "ChatGPT account status could not be checked.",
  "ChatGPT sign-out could not be completed.",
  "Unauthorized.",
]);

function errorMessage(value: unknown): string {
  if (
    value &&
    typeof value === "object" &&
    "error" in value &&
    safeErrors.has((value as { error?: unknown }).error as string)
  )
    return (value as { error: string }).error;
  return genericError;
}

async function requestJSON(
  action: "start" | "status" | "cancel" | "logout",
  method: "GET" | "POST",
  signal: AbortSignal,
): Promise<unknown> {
  const timeoutController = new AbortController();
  const timeout = window.setTimeout(
    () => timeoutController.abort(),
    action === "start" ? 175_000 : 45_000,
  );
  try {
    const response = await fetch(`/api/chatgpt/${action}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([signal, timeoutController.signal]),
    });
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = undefined;
    }
    if (!response.ok) throw data;
    return data;
  } finally {
    window.clearTimeout(timeout);
  }
}

function viewFromSnapshot(snapshot: ChatGPTSnapshot, message?: string): View {
  if (snapshot.lifecycle === "pending" && snapshot.pending)
    return { phase: "pending", challenge: snapshot.pending, message };
  if (snapshot.authStatus === "connected")
    return { phase: "connected", message };
  if (snapshot.lifecycle === "expired")
    return {
      phase: "idle",
      message: "This sign-in code expired. Start again.",
    };
  if (snapshot.authStatus === "disconnected") return { phase: "idle", message };
  return {
    phase: "error",
    message: message ?? "ChatGPT account status is still unavailable.",
  };
}

export default function ChatGPTConnection({
  signedIn,
  onSignIn,
}: {
  signedIn: boolean;
  onSignIn: () => void;
}) {
  const [view, setView] = useState<View>(initialView);
  const generation = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const pollController = useRef<AbortController | null>(null);
  const pollTimer = useRef<number | null>(null);
  const pollExpiryTimer = useRef<number | null>(null);

  const clearPoll = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    if (pollExpiryTimer.current !== null) {
      window.clearTimeout(pollExpiryTimer.current);
      pollExpiryTimer.current = null;
    }
  }, []);

  const beginRequest = useCallback(() => {
    requestController.current?.abort();
    pollController.current?.abort();
    clearPoll();
    const controller = new AbortController();
    const current = ++generation.current;
    requestController.current = controller;
    return { controller, current };
  }, [clearPoll]);

  const currentRequest = (controller: AbortController, current: number) =>
    generation.current === current && !controller.signal.aborted;

  const refresh = useCallback(() => {
    if (!signedIn) return;
    const { controller, current } = beginRequest();
    setView({ phase: "checking" });
    void requestJSON("status", "GET", controller.signal)
      .then((data) => {
        if (!currentRequest(controller, current)) return;
        const snapshot = parseChatGPTSnapshot(data);
        if (!snapshot) {
          setView({ phase: "error", message: genericError });
          return;
        }
        setView(viewFromSnapshot(snapshot));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || !currentRequest(controller, current))
          return;
        setView({ phase: "error", message: errorMessage(error) });
      });
  }, [beginRequest, signedIn]);

  useEffect(() => {
    if (!signedIn) {
      beginRequest();
      setView({ phase: "idle" });
      return () => undefined;
    }
    refresh();
    return () => {
      requestController.current?.abort();
      requestController.current = null;
      clearPoll();
      generation.current++;
    };
  }, [beginRequest, clearPoll, refresh, signedIn]);

  const start = useCallback(() => {
    if (!signedIn) {
      onSignIn();
      return;
    }
    const { controller, current } = beginRequest();
    setView({ phase: "checking" });
    void requestJSON("start", "POST", controller.signal)
      .then((data) => {
        if (!currentRequest(controller, current)) return;
        const challenge = parseChatGPTChallenge(data);
        if (!challenge) {
          setView({ phase: "error", message: genericError });
          return;
        }
        setView({ phase: "pending", challenge });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || !currentRequest(controller, current))
          return;
        setView({ phase: "idle", message: errorMessage(error) });
      });
  }, [beginRequest, onSignIn, signedIn]);

  const cancel = useCallback(() => {
    if (!signedIn) return;
    const { controller, current } = beginRequest();
    setView({ phase: "checking" });
    void requestJSON("cancel", "POST", controller.signal)
      .then((data) => {
        if (!currentRequest(controller, current)) return;
        const snapshot = parseChatGPTSnapshot(data);
        setView(
          snapshot
            ? viewFromSnapshot(snapshot)
            : { phase: "error", message: genericError },
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || !currentRequest(controller, current))
          return;
        setView({
          phase: "error",
          message: errorMessage(error),
        });
      });
  }, [beginRequest, signedIn]);

  const logout = useCallback(() => {
    if (!signedIn) return;
    const { controller, current } = beginRequest();
    setView({ phase: "checking" });
    void requestJSON("logout", "POST", controller.signal)
      .then((data) => {
        if (!currentRequest(controller, current)) return;
        const snapshot = parseChatGPTSnapshot(data);
        setView(
          snapshot
            ? viewFromSnapshot(snapshot)
            : {
                phase: "error",
                message: genericError,
              },
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || !currentRequest(controller, current))
          return;
        setView({
          phase: "error",
          message: errorMessage(error),
        });
      });
  }, [beginRequest, signedIn]);

  const pendingExpiresAt =
    view.phase === "pending" ? view.challenge.expiresAt : null;
  useEffect(() => {
    if (!signedIn || view.phase !== "pending" || pendingExpiresAt === null)
      return;
    let active = true;
    let pollGeneration: number | null = null;
    const expiresAt = pendingExpiresAt;
    const poll = () => {
      if (!active) return;
      pollController.current?.abort();
      const controller = new AbortController();
      pollController.current = controller;
      const current = ++generation.current;
      pollGeneration = current;
      void requestJSON("status", "GET", controller.signal)
        .then((data) => {
          if (!active || !currentRequest(controller, current)) return;
          const snapshot = parseChatGPTSnapshot(data);
          if (!snapshot) {
            setView((existing) =>
              existing.phase === "pending"
                ? { ...existing, message: "Still waiting for ChatGPT…" }
                : existing,
            );
          } else setView(viewFromSnapshot(snapshot));
        })
        .catch(() => {
          if (!active || !currentRequest(controller, current)) return;
          setView((existing) =>
            existing.phase === "pending"
              ? { ...existing, message: "Still waiting for ChatGPT…" }
              : existing,
          );
        })
        .finally(() => {
          if (active && generation.current === current)
            pollTimer.current = window.setTimeout(poll, 3000);
        });
    };
    const remaining = Math.max(0, expiresAt - Date.now());
    pollExpiryTimer.current = window.setTimeout(
      () => {
        if (
          !active ||
          (pollGeneration !== null && generation.current !== pollGeneration)
        )
          return;
        generation.current++;
        pollController.current?.abort();
        clearPoll();
        setView({
          phase: "idle",
          message: "This sign-in code expired. Start again.",
        });
      },
      Math.min(remaining, 2_147_483_647),
    );
    pollTimer.current = window.setTimeout(poll, 3000);
    return () => {
      active = false;
      clearPoll();
      pollController.current?.abort();
      pollController.current = null;
      if (pollGeneration !== null && generation.current === pollGeneration)
        generation.current++;
    };
  }, [clearPoll, pendingExpiresAt, signedIn, view.phase]);

  return (
    <section className="publish-box" aria-labelledby="chatgpt-connection-title">
      <strong id="chatgpt-connection-title">
        <Sparkles size={14} aria-hidden="true" /> ChatGPT subscription
      </strong>
      <p>Connect your ChatGPT account without installing anything.</p>
      {!signedIn ? (
        <div className="setup-note">
          Sign in to Orbsie before connecting your ChatGPT account.
          <button className="primary full" onClick={onSignIn}>
            Sign in to Orbsie
          </button>
        </div>
      ) : view.phase === "checking" ? (
        <div className="setup-note" role="status">
          <LoaderCircle size={15} className="spin" aria-hidden="true" />
          Checking ChatGPT connection…
        </div>
      ) : view.phase === "connected" ? (
        <div className="setup-note" role="status">
          <p>
            <CheckCircle2 size={15} aria-hidden="true" /> Signed in to ChatGPT.
            Model access is being connected.
          </p>
          {view.message && <p className="fine-print">{view.message}</p>}
          <button className="text-button" onClick={logout}>
            <LogOut size={13} aria-hidden="true" /> Disconnect ChatGPT
          </button>
        </div>
      ) : view.phase === "pending" ? (
        <div className="setup-note" role="status" aria-live="polite">
          <strong>Finish connecting ChatGPT</strong>
          <p>Open the sign-in page and enter this one-time code:</p>
          <p>
            <code>{view.challenge.userCode}</code>
          </p>
          <a
            className="primary full"
            href={view.challenge.verificationUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open ChatGPT sign-in <ArrowUpRight size={15} aria-hidden="true" />
          </a>
          {view.message && <p className="fine-print">{view.message}</p>}
          <button className="text-button" onClick={cancel}>
            <X size={13} aria-hidden="true" /> Cancel sign-in
          </button>
        </div>
      ) : view.phase === "error" ? (
        <div className="setup-note" role="alert">
          {view.message}
          <button className="text-button" onClick={refresh}>
            Try again
          </button>
        </div>
      ) : (
        <div className="setup-note">
          {view.message ?? "ChatGPT is not connected."}
          <button className="primary full" onClick={start}>
            Connect ChatGPT
          </button>
        </div>
      )}
    </section>
  );
}
