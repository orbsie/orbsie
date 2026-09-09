import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Orbsie — A little world, made by you",
  description:
    "Bring a little world to life. Create, play, and share bright interactive worlds with Orbsie.",
  icons: {
    icon: { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
    shortcut: "/icon.svg",
  },
};
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
