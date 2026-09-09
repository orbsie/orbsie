/**
 * A bounded, transport-agnostic lifecycle for App Server device login.
 *
 * The RPC supplied to this class must already be isolated to one owner/session.
 * This module deliberately does not create processes, read credentials, or keep
 * any account state outside of the instance that owns the RPC.
 */

export const CHATGPT_DEVICE_VERIFICATION_URL =
  "https://auth.openai.com/codex/device" as const;
export const CHATGPT_DEVICE_LOGIN_TTL_MS = 10 * 60 * 1000;

const START_METHOD = "account/login/start";
const CANCEL_METHOD = "account/login/cancel";
const LOGOUT_METHOD = "account/logout";
const ACCOUNT_READ_METHOD = "account/read";
const COMPLETED_METHOD = "account/login/completed";
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_USER_CODE_LENGTH = 256;
const DEFAULT_RPC_TIMEOUT_MS = 30_000;

export type ChatGPTDeviceRpc = {
  request(method: string, params?: unknown): Promise<unknown>;
  /**
   * Optional notification subscription. Adapters without a subscription API
   * can forward notifications to `handleNotification` directly.
   */
  subscribe?: (
    listener: (notification: unknown) => void,
  ) => (() => void) | void;
};

export type ChatGPTDeviceSessionClock = () => number;

export type ChatGPTDeviceLoginChallenge = {
  loginId: string;
  userCode: string;
  verificationUrl: typeof CHATGPT_DEVICE_VERIFICATION_URL;
  expiresAt: number;
};

export type ChatGPTAuthStatus = "unknown" | "connected" | "disconnected";
export type ChatGPTDeviceLifecycle =
  "idle" | "pending" | "completed" | "failed" | "cancelled" | "expired";

export type ChatGPTDeviceCompletion = {
  status: "completed" | "failed";
  error?: string;
};

export type ChatGPTDeviceSessionSnapshot = {
  lifecycle: ChatGPTDeviceLifecycle;
  authStatus: ChatGPTAuthStatus;
  pending?: ChatGPTDeviceLoginChallenge;
  error?: string;
};

export type ChatGPTDeviceSessionOptions = {
  ownerId: string;
  sessionId: string;
  rpc: ChatGPTDeviceRpc;
  now?: ChatGPTDeviceSessionClock;
  ttlMs?: number;
  rpcTimeoutMs?: number;
  onCompletion?: (completion: ChatGPTDeviceCompletion) => void;
};

export class ChatGPTDeviceSessionError extends Error {
  constructor(
    public readonly code:
      | "already-pending"
      | "cancelled"
      | "expired"
      | "invalid-response"
      | "start-failed"
      | "status-failed"
      | "logout-failed"
      | "closed",
    message: string,
  ) {
    super(message);
    this.name = "ChatGPTDeviceSessionError";
  }
}

type Attempt = {
  expiresAt: number;
  loginId?: string;
  challenge?: ChatGPTDeviceLoginChallenge;
  ended?: "cancelled" | "expired";
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validClockValue(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validOpaqueText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function publicError(
  code: ChatGPTDeviceSessionError["code"],
): ChatGPTDeviceSessionError {
  switch (code) {
    case "already-pending":
      return new ChatGPTDeviceSessionError(
        code,
        "A ChatGPT sign-in attempt is already in progress.",
      );
    case "cancelled":
      return new ChatGPTDeviceSessionError(
        code,
        "ChatGPT sign-in was canceled.",
      );
    case "expired":
      return new ChatGPTDeviceSessionError(
        code,
        "The ChatGPT sign-in code expired. Start again.",
      );
    case "invalid-response":
      return new ChatGPTDeviceSessionError(
        code,
        "ChatGPT returned an invalid sign-in response.",
      );
    case "start-failed":
      return new ChatGPTDeviceSessionError(
        code,
        "ChatGPT sign-in could not be started.",
      );
    case "status-failed":
      return new ChatGPTDeviceSessionError(
        code,
        "ChatGPT account status could not be checked.",
      );
    case "logout-failed":
      return new ChatGPTDeviceSessionError(
        code,
        "ChatGPT sign-out could not be completed.",
      );
    case "closed":
      return new ChatGPTDeviceSessionError(
        code,
        "This ChatGPT sign-in session is closed.",
      );
  }
}

function readCompletion(notification: unknown): {
  loginId?: string;
  success?: boolean;
} | null {
  const envelope = record(notification);
  const value =
    envelope?.method === COMPLETED_METHOD ? envelope.params : notification;
  const params = record(value);
  if (!params) return null;
  return {
    loginId: validOpaqueText(params.loginId, MAX_IDENTIFIER_LENGTH)
      ? params.loginId
      : undefined,
    success: typeof params.success === "boolean" ? params.success : undefined,
  };
}

function accountIsChatGPT(response: unknown): boolean {
  const payload = record(response);
  const account = record(payload?.account);
  return account?.type === "chatgpt";
}

export class ChatGPTDeviceSession {
  readonly ownerId: string;
  readonly sessionId: string;

  #rpc: ChatGPTDeviceRpc;
  #now: ChatGPTDeviceSessionClock;
  #ttlMs: number;
  #rpcTimeoutMs: number;
  #onCompletion?: (completion: ChatGPTDeviceCompletion) => void;
  #unsubscribe?: () => void;
  #attempt?: Attempt;
  #generation = 0;
  #statusReadGeneration = 0;
  #closed = false;
  #logoutInFlight = false;
  #lifecycle: ChatGPTDeviceLifecycle = "idle";
  #authStatus: ChatGPTAuthStatus = "unknown";
  #lastError?: string;

  constructor(options: ChatGPTDeviceSessionOptions) {
    if (!validOpaqueText(options.ownerId, MAX_IDENTIFIER_LENGTH))
      throw Error("A ChatGPT session owner is required.");
    if (!validOpaqueText(options.sessionId, MAX_IDENTIFIER_LENGTH))
      throw Error("A ChatGPT session identity is required.");
    if (!options.rpc || typeof options.rpc.request !== "function")
      throw Error("A ChatGPT RPC transport is required.");
    const ttlMs = options.ttlMs ?? CHATGPT_DEVICE_LOGIN_TTL_MS;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 60 * 60 * 1000)
      throw Error("The ChatGPT sign-in expiry is invalid.");
    const rpcTimeoutMs = options.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(rpcTimeoutMs) ||
      rpcTimeoutMs < 1 ||
      rpcTimeoutMs > 60 * 60 * 1000
    )
      throw Error("The ChatGPT RPC timeout is invalid.");
    const now = options.now ?? Date.now;
    const initialNow = now();
    if (!validClockValue(initialNow))
      throw Error("The ChatGPT clock is invalid.");

    this.ownerId = options.ownerId;
    this.sessionId = options.sessionId;
    this.#rpc = options.rpc;
    this.#now = now;
    this.#ttlMs = ttlMs;
    this.#rpcTimeoutMs = rpcTimeoutMs;
    this.#onCompletion = options.onCompletion;
    const subscribe = options.rpc.subscribe;
    if (subscribe) {
      const cleanup = subscribe.call(options.rpc, (notification) => {
        this.handleNotification(notification);
      });
      if (typeof cleanup === "function") this.#unsubscribe = cleanup;
    }
  }

  /** Start exactly one device-code login for this owner/session instance. */
  async start(): Promise<ChatGPTDeviceLoginChallenge> {
    if (this.#closed) throw publicError("closed");
    this.#expireIfNeeded();
    if (this.#attempt || this.#logoutInFlight)
      throw publicError("already-pending");
    const startedAt = this.#clock();
    const attempt: Attempt = {
      expiresAt: startedAt + this.#ttlMs,
    };
    this.#generation++;
    this.#attempt = attempt;
    this.#lifecycle = "pending";
    this.#authStatus = "unknown";
    this.#lastError = undefined;

    let response: unknown;
    try {
      response = await this.#request(
        START_METHOD,
        {
          type: "chatgptDeviceCode",
        },
        (lateResponse) => {
          if (this.#attempt !== attempt || attempt.ended) {
            const loginId = this.#responseLoginId(lateResponse);
            if (loginId) this.#cancelRemote(loginId);
          }
        },
      );
    } catch {
      if (this.#attempt !== attempt) {
        throw attempt.ended === "expired"
          ? publicError("expired")
          : publicError("cancelled");
      }
      attempt.ended = "cancelled";
      this.#attempt = undefined;
      this.#lifecycle = "failed";
      this.#lastError = publicError("start-failed").message;
      throw publicError("start-failed");
    }

    if (this.#attempt !== attempt) {
      const loginId = this.#responseLoginId(response);
      if (loginId) this.#cancelRemote(loginId);
      throw attempt.ended === "expired"
        ? publicError("expired")
        : publicError("cancelled");
    }
    if (this.#clock() >= attempt.expiresAt) {
      attempt.ended = "expired";
      this.#attempt = undefined;
      this.#lifecycle = "expired";
      this.#lastError = publicError("expired").message;
      const loginId = this.#responseLoginId(response);
      if (loginId) this.#cancelRemote(loginId);
      throw publicError("expired");
    }

    let challenge: ChatGPTDeviceLoginChallenge;
    try {
      challenge = this.#parseChallenge(response, attempt.expiresAt);
    } catch {
      this.#attempt = undefined;
      this.#lifecycle = "failed";
      this.#lastError = publicError("invalid-response").message;
      const loginId = this.#responseLoginId(response);
      if (loginId) this.#cancelRemote(loginId);
      throw publicError("invalid-response");
    }
    attempt.loginId = challenge.loginId;
    attempt.challenge = { ...challenge };
    return { ...attempt.challenge };
  }

  /**
   * Forward an App Server notification. Unknown, malformed, and stale
   * notifications are ignored deliberately.
   */
  handleNotification(notification: unknown): ChatGPTDeviceCompletion | null {
    if (this.#closed) return null;
    this.#expireIfNeeded();
    const completion = readCompletion(notification);
    if (
      !completion ||
      !completion.loginId ||
      completion.success === undefined ||
      !this.#attempt ||
      this.#attempt.loginId !== completion.loginId
    )
      return null;
    this.#attempt = undefined;
    this.#generation++;
    this.#statusReadGeneration++;
    const result: ChatGPTDeviceCompletion = completion.success
      ? { status: "completed" }
      : { status: "failed", error: "ChatGPT sign-in could not be completed." };
    this.#lifecycle = result.status;
    this.#lastError = result.error;
    // A successful login notification is not an account/read result. Keep the
    // auth status unknown until the caller explicitly checks connected auth.
    this.#authStatus = "unknown";
    try {
      this.#onCompletion?.(result);
    } catch {
      // A UI observer cannot turn a provider notification into an RPC failure.
    }
    return result;
  }

  /** Cancel local state immediately; remote cleanup is best effort. */
  async cancel(): Promise<void> {
    if (this.#closed) return;
    this.#expireIfNeeded();
    const attempt = this.#attempt;
    if (!attempt) {
      this.#generation++;
      this.#lifecycle = "cancelled";
      this.#lastError = undefined;
      return;
    }
    attempt.ended = "cancelled";
    this.#attempt = undefined;
    this.#generation++;
    this.#lifecycle = "cancelled";
    this.#lastError = undefined;
    if (attempt.loginId) this.#cancelRemote(attempt.loginId);
  }

  /**
   * Read connected auth explicitly. Device-login completion never changes this
   * status by itself, and the raw account response is never returned.
   */
  async readAuthStatus(): Promise<{ status: ChatGPTAuthStatus }> {
    if (this.#closed) throw publicError("closed");
    if (this.#logoutInFlight) throw publicError("already-pending");
    const generation = this.#generation;
    const readGeneration = ++this.#statusReadGeneration;
    try {
      const response = await this.#request(ACCOUNT_READ_METHOD, {
        refreshToken: false,
      });
      if (
        this.#closed ||
        generation !== this.#generation ||
        readGeneration !== this.#statusReadGeneration
      )
        return { status: this.#authStatus };
      this.#authStatus = accountIsChatGPT(response)
        ? "connected"
        : "disconnected";
      return { status: this.#authStatus };
    } catch {
      if (
        this.#closed ||
        generation !== this.#generation ||
        readGeneration !== this.#statusReadGeneration
      )
        return { status: this.#authStatus };
      this.#authStatus = "unknown";
      throw publicError("status-failed");
    }
  }

  /** Clear the local attempt and ask the isolated RPC session to log out. */
  async logout(): Promise<void> {
    if (this.#closed) throw publicError("closed");
    if (this.#logoutInFlight) throw publicError("already-pending");
    const attempt = this.#attempt;
    if (attempt) {
      attempt.ended = "cancelled";
      this.#attempt = undefined;
      if (attempt.loginId) this.#cancelRemote(attempt.loginId);
    }
    this.#generation++;
    this.#statusReadGeneration++;
    this.#lifecycle = "cancelled";
    this.#authStatus = "unknown";
    this.#lastError = undefined;
    this.#logoutInFlight = true;
    try {
      await this.#request(LOGOUT_METHOD);
      if (!this.#closed) this.#authStatus = "disconnected";
    } catch {
      // A timed-out logout may still execute remotely. Never reuse this session.
      await this.close();
      this.#authStatus = "unknown";
      this.#lifecycle = "failed";
      this.#lastError = publicError("logout-failed").message;
      throw publicError("logout-failed");
    } finally {
      this.#logoutInFlight = false;
    }
  }

  getSnapshot(): ChatGPTDeviceSessionSnapshot {
    this.#expireIfNeeded();
    const pending = this.#attempt;
    return {
      lifecycle: this.#lifecycle,
      authStatus: this.#authStatus,
      ...(pending?.challenge ? { pending: { ...pending.challenge } } : {}),
      ...(this.#lastError ? { error: this.#lastError } : {}),
    };
  }

  /** Stop receiving notifications. This does not log out the RPC account. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#generation++;
    this.#statusReadGeneration++;
    if (this.#attempt) {
      const attempt = this.#attempt;
      attempt.ended = "cancelled";
      this.#attempt = undefined;
      if (attempt.loginId) this.#cancelRemote(attempt.loginId);
    }
    this.#lifecycle = "cancelled";
    this.#lastError = undefined;
    const unsubscribe = this.#unsubscribe;
    this.#unsubscribe = undefined;
    if (unsubscribe) {
      try {
        await unsubscribe();
      } catch {
        // Closing the transport is cleanup; provider diagnostics stay private.
      }
    }
  }

  #clock(): number {
    const value = this.#now();
    if (!validClockValue(value)) throw publicError("start-failed");
    return value;
  }

  #expireIfNeeded() {
    if (this.#closed) return;
    const attempt = this.#attempt;
    if (!attempt || this.#clock() < attempt.expiresAt) return;
    attempt.ended = "expired";
    this.#attempt = undefined;
    this.#generation++;
    this.#lifecycle = "expired";
    this.#lastError = publicError("expired").message;
    if (attempt.loginId) this.#cancelRemote(attempt.loginId);
  }

  #parseChallenge(
    response: unknown,
    expiresAt: number,
  ): ChatGPTDeviceLoginChallenge {
    const value = record(response);
    if (
      value?.type !== "chatgptDeviceCode" ||
      !validOpaqueText(value.loginId, MAX_IDENTIFIER_LENGTH) ||
      !validOpaqueText(value.userCode, MAX_USER_CODE_LENGTH) ||
      value.verificationUrl !== CHATGPT_DEVICE_VERIFICATION_URL
    )
      throw publicError("invalid-response");
    return {
      loginId: value.loginId,
      userCode: value.userCode,
      verificationUrl: CHATGPT_DEVICE_VERIFICATION_URL,
      expiresAt,
    };
  }

  #responseLoginId(response: unknown): string | undefined {
    const value = record(response);
    return validOpaqueText(value?.loginId, MAX_IDENTIFIER_LENGTH)
      ? value.loginId
      : undefined;
  }

  #cancelRemote(loginId: string) {
    void Promise.resolve()
      .then(() => this.#request(CANCEL_METHOD, { loginId }))
      .catch(() => undefined);
  }

  async #request(
    method: string,
    params?: unknown,
    onLateResponse?: (response: unknown) => void,
  ): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const request = Promise.resolve().then(() =>
      this.#rpc.request(method, params),
    );
    if (onLateResponse)
      void request.then(
        (response) => {
          if (settled) onLateResponse(response);
        },
        () => undefined,
      );
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(Error("RPC timeout")),
        this.#rpcTimeoutMs,
      );
    });
    try {
      return await Promise.race([request, timeout]);
    } finally {
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
