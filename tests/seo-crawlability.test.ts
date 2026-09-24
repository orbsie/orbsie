import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/orbsie", () => ({ default: () => null }));
const query = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/server/auth", () => ({ database: () => ({ query }) }));
import { metadata } from "../src/app/layout";
import { metadata as homeMetadata } from "../src/app/page";
import robots from "../src/app/robots";
import sitemap from "../src/app/sitemap";
import {
  ORBSIE_SITE_ORIGIN,
  ORBSIE_SOCIAL_IMAGE,
} from "../src/lib/site-metadata";

describe("crawlable metadata", () => {
  it("defines the fixed homepage identity and fetchable social image", () => {
    expect(metadata.metadataBase?.toString()).toBe(`${ORBSIE_SITE_ORIGIN}/`);
    expect(metadata.title).toBe("Orbsie — A little world, made by you");
    expect(metadata.description).toContain("Create, play, and share");
    expect(metadata.openGraph).toMatchObject({
      url: ORBSIE_SITE_ORIGIN,
      siteName: "Orbsie",
      type: "website",
    });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
    expect(existsSync(`public${ORBSIE_SOCIAL_IMAGE}`)).toBe(true);
    const bytes = readFileSync(`public${ORBSIE_SOCIAL_IMAGE}`);
    expect([...bytes.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(homeMetadata.alternates?.canonical).toBe("/");
  });

  it("lists only promoted public Orbs alongside the homepage", async () => {
    vi.stubEnv("DATABASE_URL", "test");
    query.mockResolvedValueOnce({ rows: [{ id: "public-1" }] });
    expect(await sitemap()).toEqual([
      {
        url: `${ORBSIE_SITE_ORIGIN}/`,
        changeFrequency: "weekly",
        priority: 1,
      },
      {
        url: `${ORBSIE_SITE_ORIGIN}/o/public-1`,
        changeFrequency: "weekly",
        priority: 0.6,
      },
    ]);
    expect(query.mock.calls.at(-1)?.[0]).toContain(
      "public_url IS NOT NULL AND published_revision IS NOT NULL",
    );
  });

  it("keeps the homepage available without a database", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(await sitemap()).toEqual([
      {
        url: `${ORBSIE_SITE_ORIGIN}/`,
        changeFrequency: "weekly",
        priority: 1,
      },
    ]);
  });

  it("does not expose malformed project identifiers or fail on database outages", async () => {
    vi.stubEnv("DATABASE_URL", "test");
    query.mockResolvedValueOnce({
      rows: [{ id: "safe-orb" }, { id: "../private" }, { id: "" }],
    });
    expect((await sitemap()).map((entry) => entry.url)).toEqual([
      `${ORBSIE_SITE_ORIGIN}/`,
      `${ORBSIE_SITE_ORIGIN}/o/safe-orb`,
    ]);
    query.mockRejectedValueOnce(Error("database unavailable"));
    expect((await sitemap()).map((entry) => entry.url)).toEqual([
      `${ORBSIE_SITE_ORIGIN}/`,
    ]);
  });

  it("allows share pages to be fetched while excluding APIs", () => {
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: "/api/" },
      sitemap: `${ORBSIE_SITE_ORIGIN}/sitemap.xml`,
    });
  });
});
