import Link from "next/link";
import { notFound } from "next/navigation";
import { database } from "../../../lib/server/auth";
import { publicationMetadataSchema } from "../../../lib/publication-metadata";

export const dynamic = "force-dynamic";

export default async function PublishedOrb({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!process.env.DATABASE_URL) notFound();
  const result = await database().query(
    "SELECT published_metadata, public_url, published_revision FROM orbs WHERE id=$1 AND public_url IS NOT NULL",
    [id],
  );
  const orb = result.rows[0] as
    | {
        published_metadata: unknown;
        public_url: string;
        published_revision: number | null;
      }
    | undefined;
  if (!orb) notFound();
  const parsed = publicationMetadataSchema.safeParse(orb.published_metadata);
  const metadata =
    parsed.success && parsed.data.revision === orb.published_revision
      ? parsed.data
      : undefined;
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
              {orb.published_revision == null
                ? "Published world"
                : `Published revision ${orb.published_revision}`}
            </span>
          </div>
        </div>
        <Link className="primary small" href="/">
          Make your own
        </Link>
      </header>
      <iframe
        src={orb.public_url}
        title={`Play ${title}`}
        allow="fullscreen; gamepad"
        sandbox="allow-scripts allow-same-origin allow-pointer-lock"
      />
    </main>
  );
}
