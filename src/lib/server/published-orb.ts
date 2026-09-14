import { cache } from "react";
import { database } from "./auth";
import {
  parsePublicationMetadata,
  type PublicationMetadata,
} from "../publication-metadata";

export type PublishedOrbRecord = {
  publicUrl: string;
  publishedRevision: number | null;
  metadata: PublicationMetadata | null;
};

/** Read the immutable promoted projection used by both the page and its metadata. */
export const readPublishedOrb = cache(
  async (id: string): Promise<PublishedOrbRecord | null> => {
    if (!process.env.DATABASE_URL) return null;
    const result = await database().query(
      "SELECT published_metadata, public_url, published_revision FROM orbs WHERE id=$1 AND public_url IS NOT NULL",
      [id],
    );
    const row = result.rows[0] as
      | {
          published_metadata: unknown;
          public_url: unknown;
          published_revision: unknown;
        }
      | undefined;
    if (!row || typeof row.public_url !== "string") return null;
    const publishedRevision =
      typeof row.published_revision === "number" &&
      Number.isSafeInteger(row.published_revision) &&
      row.published_revision >= 0
        ? row.published_revision
        : null;
    const parsed = parsePublicationMetadata(row.published_metadata);
    return {
      publicUrl: row.public_url,
      publishedRevision,
      metadata: parsed && parsed.revision === publishedRevision ? parsed : null,
    };
  },
);
