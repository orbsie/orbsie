import { describe, expect, it } from "vitest";
import {
  DEFAULT_PUBLICATION_CREATOR,
  MAX_PUBLICATION_THUMBNAIL_BYTES,
  createPublicationMetadata,
  parsePublicationMetadata,
  publicationThumbnailSchema,
  safePublicCreator,
} from "../src/lib/publication-metadata";

const png = "data:image/png;base64,iVBORw0KGgo=";

function pngDataUrl(bytes: number) {
  const data = new Uint8Array(bytes);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

describe("publication metadata", () => {
  it("accepts a bounded PNG data URL and rejects invalid bytes", () => {
    expect(publicationThumbnailSchema.safeParse(png).success).toBe(true);
    expect(
      publicationThumbnailSchema.safeParse("data:image/png;base64,aGVsbG8=")
        .success,
    ).toBe(false);
    expect(
      publicationThumbnailSchema.safeParse(
        png.replace("iVBORw0KGgo=", "not-base64"),
      ).success,
    ).toBe(false);
  });

  it("rejects a PNG larger than the decoded byte limit", () => {
    const oversized = pngDataUrl(MAX_PUBLICATION_THUMBNAIL_BYTES + 1);
    expect(publicationThumbnailSchema.safeParse(oversized).success).toBe(false);
  });

  it("never publishes an email as the creator", () => {
    expect(safePublicCreator("owner@example.com")).toBe(
      DEFAULT_PUBLICATION_CREATOR,
    );
    expect(safePublicCreator("Owner <owner@example.com>")).toBe(
      DEFAULT_PUBLICATION_CREATOR,
    );
    expect(
      createPublicationMetadata({
        title: "A world",
        creator: "owner@example.com",
        revision: 4,
      }),
    ).toMatchObject({
      title: "A world",
      creator: DEFAULT_PUBLICATION_CREATOR,
      revision: 4,
    });
  });

  it("returns null for malformed public metadata", () => {
    expect(
      parsePublicationMetadata({
        title: "A world",
        creator: "owner@example.com",
        revision: 4,
      }),
    ).toBeNull();
  });
});
