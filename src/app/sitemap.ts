import type { MetadataRoute } from "next";
import { ORBSIE_SITE_ORIGIN } from "../lib/site-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${ORBSIE_SITE_ORIGIN}/`,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
