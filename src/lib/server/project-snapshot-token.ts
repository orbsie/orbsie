import { createHash } from "node:crypto";

/** Serialize JSON values with object keys in lexical order. */
export function canonicalSnapshotJSON(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined)
      throw new TypeError("Snapshot contains a non-JSON value.");
    return serialized;
  }
  if (Array.isArray(value))
    return `[${value.map(canonicalSnapshotJSON).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalSnapshotJSON(record[key])}`,
    )
    .join(",")}}`;
}

export function projectSnapshotToken(snapshot: unknown): string {
  let parsedSnapshot = snapshot;
  if (typeof snapshot === "string") {
    try {
      parsedSnapshot = JSON.parse(snapshot);
    } catch {
      // Hash a non-JSON string as a JSON string value below.
    }
  }
  return createHash("sha256")
    .update(canonicalSnapshotJSON(parsedSnapshot), "utf8")
    .digest("hex");
}
