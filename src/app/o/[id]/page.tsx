import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  ORBSIE_SITE_ORIGIN,
  ORBSIE_SOCIAL_IMAGE,
} from "../../../lib/site-metadata";
import { readPublishedOrb } from "../../../lib/server/published-orb";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const orb = await readPublishedOrb(id);
  if (!orb) notFound();
  const metadata = orb.metadata;
  const title = metadata?.title || "Published world";
  const creator = metadata?.creator || "Orbsie creator";
  const revision = orb.publishedRevision;
  const canonical = `${ORBSIE_SITE_ORIGIN}/o/${encodeURIComponent(id)}`;
  const description = metadata
    ? `Play ${title}, an interactive world by ${creator}. Published revision ${revision}.`
    : "Play a published interactive world on Orbsie.";
  return {
    title:
      revision === null
        ? `${title} | Orbsie`
        : `${title} — Revision ${revision} | Orbsie`,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: canonical,
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
      title,
      description,
      images: [ORBSIE_SOCIAL_IMAGE],
    },
  };
}

export default async function PublishedOrb({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const orb = await readPublishedOrb(id);
  if (!orb) notFound();
  const metadata = orb.metadata;
  const title = metadata?.title ?? "Published world";
  const creator = metadata?.creator ?? "Orbsie creator";

  return (
    <main className="published-orb">
      <header>
        <Link href="/" aria-label="Orbsie home" className="wordmark">
          <span className="brand-orb" />
        </Link>
        <div className="published-identity">
          {metadata?.thumbnail && (
            // A bounded inline PNG from this immutable release, not a remote image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="published-thumbnail"
              src={metadata.thumbnail}
              alt={`Preview of ${title}`}
              width={80}
              height={45}
            />
          )}
          <div>
            <strong>{title}</strong>
            <span>By {creator}</span>
            <span>
              {orb.publishedRevision == null
                ? "Published world"
                : `Published revision ${orb.publishedRevision}`}
            </span>
          </div>
        </div>
        <Link className="primary small" href="/">
          Make your own
        </Link>
      </header>
      <iframe
        src={orb.publicUrl}
        title={`Play ${title}`}
        allow="fullscreen; gamepad"
        sandbox="allow-scripts allow-same-origin allow-pointer-lock"
      />
    </main>
  );
}
