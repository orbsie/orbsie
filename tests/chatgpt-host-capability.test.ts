import { describe, expect, it } from "vitest";
import {
  openHostCapability,
  sealHostCapability,
} from "../src/lib/server/chatgpt-host-capability";

const token = "host-token-" + "x".repeat(40);
const secret = "better-auth-secret-" + "s".repeat(40);
const context = {
  ownerId: "owner-1",
  sessionId: "session-1",
  attemptId: "attempt-1",
};

describe("ChatGPT host capability", () => {
  it("round trips a token through a versioned base64url envelope", () => {
    const sealed = sealHostCapability(token, context, secret);
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(openHostCapability(sealed, context, secret)).toBe(token);
  });

  it("uses a fresh nonce for every seal", () => {
    const first = sealHostCapability(token, context, secret);
    const second = sealHostCapability(token, context, secret);
    expect(second).not.toBe(first);
    expect(openHostCapability(first, context, secret)).toBe(token);
    expect(openHostCapability(second, context, secret)).toBe(token);
  });

  it("binds the ciphertext to exact context and key", () => {
    const sealed = sealHostCapability(token, context, secret);
    for (const changed of [
      { ...context, ownerId: "other-owner" },
      { ...context, sessionId: "other-session" },
      { ...context, attemptId: "other-attempt" },
    ])
      expect(() => openHostCapability(sealed, changed, secret)).toThrow(
        "Invalid ChatGPT host capability.",
      );
    expect(() => openHostCapability(sealed, context, "k".repeat(32))).toThrow(
      "Invalid ChatGPT host capability.",
    );
  });

  it("rejects tampering, truncation, oversized, and wrong-version envelopes", () => {
    const sealed = sealHostCapability(token, context, secret);
    const [version, encoded] = sealed.split(".");
    const last = encoded.at(-1)!;
    const tampered = `${version}.${encoded.slice(0, -1)}${last === "A" ? "B" : "A"}`;
    for (const value of [
      tampered,
      `${version}.${encoded.slice(0, -2)}`,
      `v2.${encoded}`,
      `${version}.${encoded}A`.repeat(3),
      "v1.not_base64!",
    ])
      expect(() => openHostCapability(value, context, secret)).toThrow(
        "Invalid ChatGPT host capability.",
      );
  });

  it("rejects invalid inputs without exposing their values", () => {
    for (const value of ["short", "x".repeat(257), "x".repeat(31) + "\n"]) {
      expect(() => sealHostCapability(value, context, secret)).toThrow(
        "Invalid ChatGPT host capability.",
      );
    }
    for (const changed of [
      { ...context, ownerId: "" },
      { ...context, sessionId: "x".repeat(257) },
      { ...context, attemptId: "bad\nvalue" },
    ])
      expect(() => sealHostCapability(token, changed, secret)).toThrow(
        "Invalid ChatGPT host capability.",
      );
    expect(() => sealHostCapability(token, context, "secret")).toThrow(
      "Invalid ChatGPT host capability.",
    );
    expect(() => openHostCapability("v1.secret", context, secret)).toThrow(
      "Invalid ChatGPT host capability.",
    );
  });
});
