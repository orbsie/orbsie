import type { Metadata } from "next";
import "./globals.css";
import { orbsieSiteMetadata } from "../lib/site-metadata";

export const metadata: Metadata = orbsieSiteMetadata;
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/fonts/fonts.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
