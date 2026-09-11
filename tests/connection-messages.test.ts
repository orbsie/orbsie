import { describe, expect, it } from "vitest";
import {
  connectionNoticeCopy,
  noticeForGenerationCode,
} from "../src/lib/connection-messages";

describe("connection message catalog", () => {
  it("distinguishes signed-out and signed-in free-exhausted copy", () => {
    expect(
      connectionNoticeCopy("free-exhausted", { signedIn: false }),
    ).toMatch(/Sign in or connect a provider/);
    expect(
      connectionNoticeCopy("free-exhausted", { signedIn: true }),
    ).toMatch(/Connect a provider/);
  });

  it("returns stable user-facing copy for every notice", () => {
    for (const notice of [
      "free-unavailable",
      "offline",
      "provider-key-rejected",
      "provider-access-denied",
      "provider-payment",
      "provider-rate-limited",
    ] as const) {
      const text = connectionNoticeCopy(notice, { signedIn: false });
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/error|failed|invalid/i);
    }
  });

  it("maps generation error codes to notices", () => {
    expect(noticeForGenerationCode("FREE_LIMIT_REACHED")).toBe(
      "free-exhausted",
    );
    expect(noticeForGenerationCode("PROVIDER_AUTH_REJECTED")).toBe(
      "provider-key-rejected",
    );
    expect(noticeForGenerationCode("PROVIDER_ACCESS_DENIED")).toBe(
      "provider-access-denied",
    );
    expect(noticeForGenerationCode("SOMETHING_ELSE")).toBeUndefined();
    expect(noticeForGenerationCode(undefined)).toBeUndefined();
  });
});
