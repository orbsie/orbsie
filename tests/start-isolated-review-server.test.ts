import { describe, expect, it } from "vitest";
import {
  isolatedReviewServerEnv,
  parseIsolatedEnvFile,
} from "../scripts/start-isolated-review-server.mjs";

describe("isolated review server launcher", () => {
  it("keeps only the disposable database and forces loopback values", () => {
    const isolated = parseIsolatedEnvFile(
      [
        "# private",
        'DATABASE_URL="postgres://u:p@db.example/orbsie_diag_1?sslmode=require"',
        "VERCEL=1",
        "BETTER_AUTH_URL=https://orbsie.com",
      ].join("\n"),
    );
    expect(Object.keys(isolated)).toEqual(["DATABASE_URL"]);
    const env = isolatedReviewServerEnv(
      { VERCEL: "1", PATH: "/bin" },
      isolated,
      3069,
    );
    expect(env).toMatchObject({
      PATH: "/bin",
      VERCEL: "0",
      BETTER_AUTH_URL: "http://127.0.0.1:3069",
      ORBSIE_AUTHORING_REVIEW: "1",
      ORBSIE_GENERATION_MAX_TOKENS: "4096",
      DATABASE_URL: "postgres://u:p@db.example/orbsie_diag_1?sslmode=require",
    });
  });

  it("refuses the shared database and invalid ports", () => {
    expect(() =>
      parseIsolatedEnvFile("DATABASE_URL=postgres://u:p@db.example/neondb"),
    ).toThrow(/disposable/);
    expect(() => parseIsolatedEnvFile("VERCEL=0")).toThrow(/DATABASE_URL/);
    expect(() =>
      isolatedReviewServerEnv(
        {},
        { DATABASE_URL: "postgres://x/orbsie_a" },
        80,
      ),
    ).toThrow(RangeError);
  });
});
