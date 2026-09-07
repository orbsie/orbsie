import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Orbsie — A little world, made by you",
  description:
    "Bring a little world to life. Create, play, and share bright interactive worlds with Orbsie.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
