/** Captures the mounted renderer synchronously, before its WebGL buffer clears. */
let capture: (() => string) | undefined;
export function registerPublicationThumbnail(next: () => string) {
  capture = next;
  return () => {
    if (capture === next) capture = undefined;
  };
}
export function capturePublicationThumbnail(): string | undefined {
  return capture?.();
}
