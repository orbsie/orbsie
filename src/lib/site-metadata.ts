import type { Metadata } from "next";

export const ORBSIE_SITE_ORIGIN = "https://orbsie.com";
export const ORBSIE_SITE_TITLE = "Orbsie — A little world, made by you";
export const ORBSIE_SITE_DESCRIPTION =
  "Bring a little world to life. Create, play, and share bright interactive worlds with Orbsie.";
export const ORBSIE_SOCIAL_IMAGE = "/social-preview.png";

export const orbsieSiteMetadata: Metadata = {
  metadataBase: new URL(ORBSIE_SITE_ORIGIN),
  title: ORBSIE_SITE_TITLE,
  description: ORBSIE_SITE_DESCRIPTION,
  openGraph: {
    title: ORBSIE_SITE_TITLE,
    description: ORBSIE_SITE_DESCRIPTION,
    url: ORBSIE_SITE_ORIGIN,
    siteName: "Orbsie",
    type: "website",
    images: [
      {
        url: ORBSIE_SOCIAL_IMAGE,
        width: 1254,
        height: 1254,
        alt: "Orbsie little world mark",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: ORBSIE_SITE_TITLE,
    description: ORBSIE_SITE_DESCRIPTION,
    images: [ORBSIE_SOCIAL_IMAGE],
  },
  icons: {
    icon: { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
    shortcut: "/icon.svg",
  },
};
