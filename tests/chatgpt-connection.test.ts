import { describe, expect, it } from "vitest";
import {
  CHATGPT_STALE_CONNECTION_ACTION,
  CHATGPT_STALE_CONNECTION_MESSAGE,
  CHATGPT_DEVICE_URL,
  CHATGPT_LOGIN_PENDING_ACTION,
  isChatGPTLoginPendingError,
  isChatGPTStaleConnectionError,
  parseChatGPTChallenge,
  parseChatGPTModels,
  parseChatGPTSnapshot,
  viewFromSnapshot,
} from "../src/components/chatgpt-connection";

const challenge = {
  loginId: "provider-login-id",
  userCode: "ABCD-EFGH",
  verificationUrl: CHATGPT_DEVICE_URL,
  expiresAt: Date.now() + 60_000,
};

describe("ChatGPT connection response guards", () => {
  it("recognizes only the bounded stale-runtime response for reconnect UI", () => {
    expect(
      isChatGPTStaleConnectionError({
        code: "CHATGPT_CONNECTION_STALE",
        error: CHATGPT_STALE_CONNECTION_MESSAGE,
        sandboxName: "must-not-leak",
      }),
    ).toBe(true);
    expect(CHATGPT_STALE_CONNECTION_ACTION).toBe("Reconnect ChatGPT");
    expect(
      isChatGPTStaleConnectionError({
        code: "CHATGPT_CONNECTION_REQUIRED",
        error: CHATGPT_STALE_CONNECTION_MESSAGE,
      }),
    ).toBe(false);
    expect(
      isChatGPTStaleConnectionError({
        code: "CHATGPT_CONNECTION_STALE",
        error: "older deployment details",
      }),
    ).toBe(false);
  });

  it("offers status refresh for a typed live sign-in conflict", () => {
    const response = {
      code: "CHATGPT_LOGIN_PENDING",
      error:
        "A ChatGPT sign-in is still active. Check its status or finish it in the tab that started it.",
    };
    expect(isChatGPTLoginPendingError(response)).toBe(true);
    expect(
      isChatGPTLoginPendingError({
        ...response,
        error: "provider detail must not be shown",
      }),
    ).toBe(false);
    expect(CHATGPT_LOGIN_PENDING_ACTION).toBe("Check sign-in status");
  });

  it("accepts the exact device URL and strips provider identifiers", () => {
    expect(parseChatGPTChallenge(challenge)).toEqual({
      userCode: "ABCD-EFGH",
      verificationUrl: CHATGPT_DEVICE_URL,
      expiresAt: challenge.expiresAt,
    });
  });

  it.each([
    { ...challenge, verificationUrl: "https://evil.example/device" },
    { ...challenge, userCode: " code with spaces " },
    { ...challenge, expiresAt: "later" },
    { ...challenge, expiresAt: 0 },
  ])("rejects malformed challenge %#", (value) => {
    expect(parseChatGPTChallenge(value)).toBeNull();
  });

  it("keeps only allowlisted pending snapshot fields", () => {
    expect(
      parseChatGPTSnapshot({
        lifecycle: "pending",
        authStatus: "unknown",
        pending: challenge,
        capability: "must-not-leak",
        sandboxName: "must-not-leak",
        error: "provider secret",
      }),
    ).toEqual({
      lifecycle: "pending",
      authStatus: "unknown",
      pending: {
        userCode: "ABCD-EFGH",
        verificationUrl: CHATGPT_DEVICE_URL,
        expiresAt: challenge.expiresAt,
      },
    });
  });

  it("rejects a pending challenge on a non-pending lifecycle", () => {
    expect(
      parseChatGPTSnapshot({
        lifecycle: "cancelled",
        authStatus: "disconnected",
        pending: challenge,
      }),
    ).toBeNull();
  });

  it("recognizes explicit account authentication separately from lifecycle", () => {
    expect(
      parseChatGPTSnapshot({
        lifecycle: "completed",
        authStatus: "connected",
      }),
    ).toEqual({ lifecycle: "completed", authStatus: "connected" });
  });

  it("shows a retryable failed view and only gives device-login advice when classified", () => {
    const disabled = parseChatGPTSnapshot({
      lifecycle: "failed",
      authStatus: "disconnected",
      failureCode: "device-code-disabled",
      error: "access_token=private-secret",
    });
    expect(disabled).toEqual({
      lifecycle: "failed",
      authStatus: "disconnected",
      failureCode: "device-code-disabled",
    });
    expect(viewFromSnapshot(disabled!)).toEqual({
      phase: "error",
      message:
        "Device-code sign-in is disabled for this ChatGPT account. Enable it in ChatGPT security settings, then try again.",
      retryLogin: true,
    });

    const unknown = parseChatGPTSnapshot({
      lifecycle: "failed",
      authStatus: "disconnected",
      failureCode: "access_token=untrusted",
      error: "user_id=private-user",
    });
    expect(unknown).toEqual({
      lifecycle: "failed",
      authStatus: "disconnected",
      failureCode: "other",
    });
    expect(viewFromSnapshot(unknown!)).toEqual({
      phase: "error",
      message: "ChatGPT sign-in failed. Try again.",
      retryLogin: true,
    });
  });

  it("sanitizes the bounded hosted model catalog", () => {
    expect(
      parseChatGPTModels({
        models: [
          {
            id: "catalog-1",
            model: "gpt-5.1",
            displayName: "GPT 5.1",
            supportedReasoningEfforts: ["medium", "low"],
            defaultReasoningEffort: "medium",
            capability: "must-not-leak",
          },
        ],
        providerToken: "must-not-leak",
      }),
    ).toEqual([
      {
        id: "catalog-1",
        model: "gpt-5.1",
        displayName: "GPT 5.1",
        supportedReasoningEfforts: ["medium", "low"],
        defaultReasoningEffort: "medium",
      },
    ]);
  });

  it("retains safe image modalities through the browser parser", () => {
    expect(
      parseChatGPTModels({
        models: [
          {
            id: "catalog-1",
            model: "gpt-5.1",
            displayName: "GPT 5.1",
            supportedReasoningEfforts: ["medium", "low"],
            defaultReasoningEffort: "medium",
            inputModalities: ["text", "image", "image"],
            providerSecret: "must-not-leak",
          },
        ],
      }),
    ).toEqual([
      {
        id: "catalog-1",
        model: "gpt-5.1",
        displayName: "GPT 5.1",
        supportedReasoningEfforts: ["medium", "low"],
        defaultReasoningEffort: "medium",
        inputModalities: ["text", "image"],
      },
    ]);

    for (const inputModalities of [
      undefined,
      [],
      "image",
      ["text", 7],
      Array(17).fill("text"),
    ]) {
      const [parsed] = parseChatGPTModels({
        models: [
          {
            id: "catalog-1",
            model: "gpt-5.1",
            displayName: "GPT 5.1",
            supportedReasoningEfforts: ["medium", "low"],
            defaultReasoningEffort: "medium",
            inputModalities,
          },
        ],
      })!;
      expect(parsed).not.toHaveProperty("inputModalities");
    }
  });

  it("accepts an empty hosted catalog without creating a selection", () => {
    expect(parseChatGPTModels({ models: [] })).toEqual([]);
  });

  it.each([
    {
      models: [
        {
          id: "catalog",
          model: "gpt 5",
          displayName: "GPT",
          supportedReasoningEfforts: ["low"],
          defaultReasoningEffort: "low",
        },
      ],
    },
    {
      models: [
        {
          id: "catalog",
          model: "gpt-5",
          displayName: "GPT",
          supportedReasoningEfforts: [],
          defaultReasoningEffort: "low",
        },
      ],
    },
    {
      models: [
        {
          id: "catalog",
          model: "gpt-5",
          displayName: "GPT",
          supportedReasoningEfforts: ["low"],
          defaultReasoningEffort: "high",
        },
      ],
    },
  ])("rejects an unusable hosted catalog %#", (value) => {
    expect(parseChatGPTModels(value)).toBeNull();
  });

  it("rejects malformed model entries without exposing provider fields", () => {
    expect(
      parseChatGPTModels({
        models: [
          {
            id: "catalog",
            model: "gpt-5",
            displayName: "GPT",
            supportedReasoningEfforts: ["low"],
            defaultReasoningEffort: "low",
          },
          { model: "gpt-unsafe", error: "provider secret" },
        ],
      }),
    ).toBeNull();
  });
});
