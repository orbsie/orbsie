import { describe, expect, it } from "vitest";
import {
  CHATGPT_DEVICE_URL,
  parseChatGPTChallenge,
  parseChatGPTModels,
  parseChatGPTSnapshot,
} from "../src/components/chatgpt-connection";

const challenge = {
  loginId: "provider-login-id",
  userCode: "ABCD-EFGH",
  verificationUrl: CHATGPT_DEVICE_URL,
  expiresAt: Date.now() + 60_000,
};

describe("ChatGPT connection response guards", () => {
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
