export class GeneratedGeometryError extends Error {
  readonly code:
    | "invalid-hash"
    | "fetch-failed"
    | "too-large"
    | "parse-failed"
    | "empty-geometry"
    | "integrity-failed"
    | "aborted"
    | "disposed";

  constructor(
    code: GeneratedGeometryError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GeneratedGeometryError";
    this.code = code;
  }
}
