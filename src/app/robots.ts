import type { MetadataRoute } from "next";
import { ORBSIE_SITE_ORIGIN } from "../lib/site-metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
    sitemap: `${ORBSIE_SITE_ORIGIN}/sitemap.xml`,
  };
}
