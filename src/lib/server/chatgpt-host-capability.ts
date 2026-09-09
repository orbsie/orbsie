import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

export const CHATGPT_HOST_CAPABILITY_PURPOSE = "orbsie-chatgpt-host-v1";
const V = "v1",
  IV = 12,
  TAG = 16,
  KEY = 32,
  MIN = 32,
  MAX = 256;
type Context = { ownerId: string; sessionId: string; attemptId: string };
const bad = () => Error("Invalid ChatGPT host capability.");
const validToken = (v: unknown): v is string =>
  typeof v === "string" && /^[\x21-\x7e]{32,256}$/.test(v);
const validPart = (v: unknown): v is string =>
  typeof v === "string" && /^[\x20-\x7e]{1,256}$/.test(v);
function checkedContext(v: unknown): asserts v is Context {
  const c = v as Partial<Context>;
  if (
    !v ||
    typeof v !== "object" ||
    !validPart(c.ownerId) ||
    !validPart(c.sessionId) ||
    !validPart(c.attemptId)
  )
    throw bad();
}
function derive(secret: string): Buffer {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < KEY)
    throw bad();
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret),
      Buffer.alloc(0),
      Buffer.from(CHATGPT_HOST_CAPABILITY_PURPOSE),
      KEY,
    ),
  );
}
function aad(c: Context): Buffer {
  return Buffer.from(
    JSON.stringify([
      CHATGPT_HOST_CAPABILITY_PURPOSE,
      V,
      c.ownerId,
      c.sessionId,
      c.attemptId,
    ]),
  );
}
function encode(v: Buffer): string {
  return v
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
function decode(v: unknown): Buffer {
  if (typeof v !== "string" || v.length > 512 || !v.startsWith(`${V}.`))
    throw bad();
  const encoded = v.slice(3);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw bad();
  const raw = Buffer.from(
    encoded.replaceAll("-", "+").replaceAll("_", "/"),
    "base64",
  );
  if (
    raw.length < IV + TAG + MIN ||
    raw.length > IV + TAG + MAX ||
    encode(raw) !== encoded
  )
    throw bad();
  return raw;
}
export function sealHostCapability(
  value: string,
  context: Context,
  secret: string,
): string {
  if (!validToken(value)) throw bad();
  checkedContext(context);
  const iv = randomBytes(IV);
  const cipher = createCipheriv("aes-256-gcm", derive(secret), iv);
  cipher.setAAD(aad(context));
  const text = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${V}.${encode(Buffer.concat([iv, text, cipher.getAuthTag()]))}`;
}
export function openHostCapability(
  sealed: string,
  context: Context,
  secret: string,
): string {
  try {
    checkedContext(context);
    const raw = decode(sealed);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      derive(secret),
      raw.subarray(0, IV),
    );
    decipher.setAAD(aad(context));
    decipher.setAuthTag(raw.subarray(raw.length - TAG));
    const value = Buffer.concat([
      decipher.update(raw.subarray(IV, raw.length - TAG)),
      decipher.final(),
    ]).toString();
    if (!validToken(value)) throw bad();
    return value;
  } catch {
    throw bad();
  }
}
