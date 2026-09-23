import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/server/auth")>()),
  getAuth: () => null,
  isAdminEmail: () => false,
}));

import { GET } from "../src/app/api/config/route";

afterEach(() => vi.unstubAllEnvs());

describe("authoring review configuration", () => {
  it("advertises review only with its switch and durable session storage", async () => {
    const request = new Request("https://orbsie.test/api/config");
    vi.stubEnv("ORBSIE_AUTHORING_REVIEW", "0");
    vi.stubEnv("DATABASE_URL", "postgres://example.invalid/test");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
    expect((await (await GET(request)).json()).authoringReview).toBe(false);

    vi.stubEnv("ORBSIE_AUTHORING_REVIEW", "1");
    vi.stubEnv("DATABASE_URL", "");
    expect((await (await GET(request)).json()).authoringReview).toBe(false);

    vi.stubEnv("DATABASE_URL", "postgres://example.invalid/test");
    expect((await (await GET(request)).json()).authoringReview).toBe(true);
  });
});
