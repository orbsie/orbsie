import type { MetadataRoute } from "next";
import { ORBSIE_SITE_ORIGIN } from "../lib/site-metadata";
import { database } from "../lib/server/auth";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    {
      url: `${ORBSIE_SITE_ORIGIN}/`,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
  if (!process.env.DATABASE_URL) return entries;

  try {
    // Public promotion is the only discovery boundary. Draft title/snapshot and
    // in-flight publication metadata must never enter the sitemap.
    const result = await database().query(
      "SELECT id FROM orbs WHERE public_url IS NOT NULL AND published_revision IS NOT NULL ORDER BY id LIMIT 5000",
    );
    for (const row of result.rows) {
      if (typeof row.id !== "string" || !/^[\w-]{1,80}$/.test(row.id)) continue;
      entries.push({
        url: `${ORBSIE_SITE_ORIGIN}/o/${encodeURIComponent(row.id)}`,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  } catch {
    // Keep the homepage discoverable during a transient database outage.
  }
  return entries;
}
