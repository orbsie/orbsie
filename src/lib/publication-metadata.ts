import { z } from "zod";

export const PUBLICATION_METADATA_TITLE_MAX_LENGTH = 100;
export const PUBLICATION_METADATA_CREATOR_MAX_LENGTH = 100;
export const MAX_PUBLICATION_THUMBNAIL_BYTES = 200 * 1024;
const PUBLICATION_THUMBNAIL_PREFIX = "data:image/png;base64,";
export const MAX_PUBLICATION_THUMBNAIL_BASE64_LENGTH =
  Math.ceil(MAX_PUBLICATION_THUMBNAIL_BYTES / 3) * 4;
export const MAX_PUBLICATION_THUMBNAIL_DATA_URL_LENGTH =
  PUBLICATION_THUMBNAIL_PREFIX.length + MAX_PUBLICATION_THUMBNAIL_BASE64_LENGTH;
// Keep enough room for the JSON envelope and the largest accepted PNG data URL.
export const MAX_PUBLICATION_REQUEST_BYTES = 300_000;
export const DEFAULT_PUBLICATION_CREATOR = "Orbsie creator";

const pngSignature = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function decodeBase64(value: string) {
  const base64 = value.slice(PUBLICATION_THUMBNAIL_PREFIX.length);
  if (
    !base64 ||
    base64.length % 4 !== 0 ||
    base64.length > MAX_PUBLICATION_THUMBNAIL_BASE64_LENGTH ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    )
  )
    return null;
  try {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    if (bytes.byteLength > MAX_PUBLICATION_THUMBNAIL_BYTES) return null;
    return bytes;
  } catch {
    return null;
  }
}

function isPngDataUrl(value: string) {
  if (
    !value.startsWith(PUBLICATION_THUMBNAIL_PREFIX) ||
    value.length > MAX_PUBLICATION_THUMBNAIL_DATA_URL_LENGTH
  )
    return false;
  const bytes = decodeBase64(value);
  return (
    bytes !== null &&
    bytes.byteLength >= pngSignature.byteLength &&
    pngSignature.every((byte, index) => bytes[index] === byte)
  );
}

export const publicationThumbnailSchema = z
  .string()
  .max(MAX_PUBLICATION_THUMBNAIL_DATA_URL_LENGTH)
  .refine(isPngDataUrl, "Thumbnail must be a valid PNG data URL.");

function isEmailLike(value: string) {
  return value.includes("@");
}

function isSafeCreator(value: string) {
  return !/[\u0000-\u001f\u007f]/.test(value) && !isEmailLike(value);
}

export function safePublicCreator(value: unknown) {
  if (typeof value !== "string") return DEFAULT_PUBLICATION_CREATOR;
  const name = value.trim();
  if (
    !name ||
    name.length > PUBLICATION_METADATA_CREATOR_MAX_LENGTH ||
    !isSafeCreator(name)
  )
    return DEFAULT_PUBLICATION_CREATOR;
  return name;
}

export const publicationMetadataSchema = z
  .object({
    title: z.string().max(PUBLICATION_METADATA_TITLE_MAX_LENGTH),
    creator: z
      .string()
      .min(1)
      .max(PUBLICATION_METADATA_CREATOR_MAX_LENGTH)
      .refine(isSafeCreator, "Creator must be a public display name."),
    thumbnail: publicationThumbnailSchema.optional(),
    revision: z.number().int().min(0),
  })
  .strict();

export type PublicationMetadata = z.infer<typeof publicationMetadataSchema>;

export function createPublicationMetadata(input: {
  title: string;
  creator: unknown;
  thumbnail?: string;
  revision: number;
}): PublicationMetadata {
  return publicationMetadataSchema.parse({
    title: input.title,
    creator: safePublicCreator(input.creator),
    ...(input.thumbnail === undefined ? {} : { thumbnail: input.thumbnail }),
    revision: input.revision,
  });
}

export function parsePublicationMetadata(value: unknown) {
  const parsed = publicationMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
