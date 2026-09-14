import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/orbsie", () => ({ default: () => null }));
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

  it("publishes only the intentional homepage URL", () => {
    expect(sitemap()).toEqual([
      {
        url: `${ORBSIE_SITE_ORIGIN}/`,
        changeFrequency: "weekly",
        priority: 1,
      },
    ]);
    expect(sitemap()[0]).not.toHaveProperty("lastModified");
  });

  it("allows share pages to be fetched while excluding APIs", () => {
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: "/api/" },
      sitemap: `${ORBSIE_SITE_ORIGIN}/sitemap.xml`,
    });
  });
});
