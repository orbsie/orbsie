export class AssetGeometryError extends Error {
  readonly code:
    | "unknown-id"
    | "unsafe-url"
    | "fetch-failed"
    | "too-large"
    | "parse-failed"
    | "empty-geometry"
    | "integrity-failed"
    | "aborted"
    | "disposed";

  constructor(
    code: AssetGeometryError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AssetGeometryError";
    this.code = code;
  }
}
