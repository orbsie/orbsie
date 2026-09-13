/**
 * A renderer capture that may be sent to a trusted model adapter for review.
 * This type intentionally contains only primitive, bounded data. Callers must
 * bind projectId and revision to the current server-owned project before
 * constructing a model request.
 */
export type SceneReviewRenderer = "webgl" | "software";

export type SceneReviewImage = {
  projectId: string;
  revision: number;
  renderer: SceneReviewRenderer;
  width: number;
  height: number;
  image: string;
};

export const MAX_REVIEW_IMAGE_BYTES = 128 * 1024;
export const MAX_REVIEW_IMAGE_PIXELS = 2_000_000;
const MAX_REVIEW_IMAGE_DECODED_BYTES = Math.floor(
  (MAX_REVIEW_IMAGE_BYTES * 3) / 4,
);
const DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IMAGE_KEYS = [
  "projectId",
  "revision",
  "renderer",
  "width",
  "height",
  "image",
];

export type ReviewImageErrorCode =
  | "invalid-image"
  | "invalid-capture"
  | "identity-mismatch"
  | "dimension-mismatch"
  | "payload-too-large";

/** Safe, typed failures for the internal image transport boundary. */
export class ReviewImageValidationError extends Error {
  readonly code: ReviewImageErrorCode;

  constructor(code: ReviewImageErrorCode, message: string) {
    super(message);
    this.name = "ReviewImageValidationError";
    this.code = code;
  }
}

export class UnsupportedReviewImageError extends Error {
  readonly code = "unsupported-image" as const;

  constructor() {
    super("The selected model does not support image review.");
    this.name = "UnsupportedReviewImageError";
  }
}

function invalid(code: ReviewImageErrorCode, message: string): never {
  throw new ReviewImageValidationError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validProjectId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 80 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validDimension(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function decodeBase64(payload: string): Uint8Array {
  // Check the textual form before atob. This rejects whitespace and non-
  // canonical padding without asking the decoder to allocate untrusted data.
  if (
    payload.length === 0 ||
    payload.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)
  )
    invalid("invalid-image", "Review image data is not valid PNG data.");
  let binary: string;
  try {
    binary = globalThis.atob(payload);
  } catch {
    invalid("invalid-image", "Review image data is not valid PNG data.");
  }
  if (binary.length === 0 || binary.length > MAX_REVIEW_IMAGE_DECODED_BYTES)
    invalid("payload-too-large", "Review image exceeds the image limit.");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function inspectPngDataUrl(image: unknown): {
  width: number;
  height: number;
  byteLength: number;
} {
  if (typeof image !== "string")
    invalid("invalid-image", "Review image must be a PNG data URL.");
  if (image.length > MAX_REVIEW_IMAGE_BYTES)
    invalid("payload-too-large", "Review image exceeds the image limit.");
  if (utf8Bytes(image) > MAX_REVIEW_IMAGE_BYTES)
    invalid("payload-too-large", "Review image exceeds the image limit.");
  if (!image.startsWith(DATA_URL_PREFIX))
    invalid("invalid-image", "Review image must be a PNG data URL.");
  const bytes = decodeBase64(image.slice(DATA_URL_PREFIX.length));
  if (bytes.byteLength < 33)
    invalid("invalid-image", "Review image is not a complete PNG.");
  for (let index = 0; index < PNG_SIGNATURE.length; index++)
    if (bytes[index] !== PNG_SIGNATURE[index])
      invalid("invalid-image", "Review image is not a PNG image.");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG's first chunk must be the complete 13-byte IHDR chunk. Reading only
  // these bounded bytes is enough to validate dimensions without parsing the
  // rest of the image or accepting a non-PNG data URL.
  if (
    view.getUint32(8) !== 13 ||
    String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR"
  )
    invalid("invalid-image", "Review image has an invalid PNG header.");
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1 || width > MAX_REVIEW_IMAGE_PIXELS / height)
    invalid("invalid-image", "Review image exceeds the pixel limit.");

  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const allowedBitDepths: Record<number, readonly number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (
    !Object.hasOwn(allowedBitDepths, colorType) ||
    !allowedBitDepths[colorType].includes(bitDepth) ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    (bytes[28] !== 0 && bytes[28] !== 1)
  )
    invalid("invalid-image", "Review image has an invalid PNG format.");

  let offset = 8;
  let sawImageData = false;
  let sawEnd = false;
  let chunkCount = 0;
  while (offset < bytes.byteLength) {
    if (++chunkCount > 4096 || bytes.byteLength - offset < 12)
      invalid("invalid-image", "Review image has an invalid PNG structure.");
    const length = view.getUint32(offset);
    const chunkEnd = offset + 12 + length;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.byteLength)
      invalid("invalid-image", "Review image has an invalid PNG structure.");
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    if (offset === 8 && (type !== "IHDR" || length !== 13))
      invalid("invalid-image", "Review image has an invalid PNG header.");
    if (type === "IDAT") sawImageData = true;
    if (type === "IEND") {
      if (
        length !== 0 ||
        sawEnd ||
        !sawImageData ||
        chunkEnd !== bytes.byteLength
      )
        invalid("invalid-image", "Review image has an invalid PNG structure.");
      sawEnd = true;
      break;
    }
    offset = chunkEnd;
  }
  if (!sawEnd)
    invalid("invalid-image", "Review image has an incomplete PNG structure.");
  return { width, height, byteLength: utf8Bytes(image) };
}

/** Validate a PNG data URL independently of any renderer/client metadata. */
export function validateReviewImageDataUrl(value: unknown) {
  return inspectPngDataUrl(value);
}

/**
 * Validate one complete capture and optionally bind it to a server-owned
 * project snapshot. The returned value is a fresh primitive copy.
 */
export function validateSceneReviewImage(
  value: unknown,
  expected?: { projectId: string; revision: number },
): SceneReviewImage {
  if (!isRecord(value) || !hasExactKeys(value, IMAGE_KEYS))
    invalid("invalid-capture", "Review image metadata is invalid.");
  if (
    !validProjectId(value.projectId) ||
    !validRevision(value.revision) ||
    (value.renderer !== "webgl" && value.renderer !== "software") ||
    !validDimension(value.width) ||
    !validDimension(value.height) ||
    typeof value.image !== "string"
  )
    invalid("invalid-capture", "Review image metadata is invalid.");
  if (expected) {
    if (value.projectId !== expected.projectId)
      invalid("identity-mismatch", "Review image belongs to another project.");
    if (value.revision !== expected.revision)
      invalid("identity-mismatch", "Review image belongs to another revision.");
  }
  const png = inspectPngDataUrl(value.image);
  if (png.width !== value.width || png.height !== value.height)
    invalid(
      "dimension-mismatch",
      "Review image dimensions do not match metadata.",
    );
  return {
    projectId: value.projectId,
    revision: value.revision,
    renderer: value.renderer,
    width: value.width,
    height: value.height,
    image: value.image,
  };
}
