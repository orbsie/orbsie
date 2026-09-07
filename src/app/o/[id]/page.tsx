import Link from "next/link";
import { notFound } from "next/navigation";
import { database } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function PublishedOrb({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!process.env.DATABASE_URL) notFound();
  const result = await database().query(
    "SELECT title, public_url, published_revision FROM orbs WHERE id=$1 AND public_url IS NOT NULL",
    [id],
  );
  const orb = result.rows[0] as
    | { title: string; public_url: string; published_revision: number | null }
    | undefined;
  if (!orb) notFound();

  return (
    <main className="published-orb">
      <header>
        <Link href="/" aria-label="Orbsie home" className="wordmark">
          <span className="brand-orb" />
        </Link>
        <div>
          <strong>{orb.title}</strong>
          <span>
            {orb.published_revision == null
              ? "Published world"
              : `Published revision ${orb.published_revision}`}
          </span>
        </div>
        <Link className="primary small" href="/">
          Make your own
        </Link>
      </header>
      <iframe
        src={orb.public_url}
        title={`Play ${orb.title}`}
        allow="fullscreen; gamepad"
        sandbox="allow-scripts allow-same-origin allow-pointer-lock"
      />
    </main>
  );
}
