import { appendFileSync, mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const MAX_CAPTURE_TEXT = 4096;

/**
 * Local-diagnostics only: when ORBSIE_PRIVATE_PARSER_CAPTURE_DIR names an
 * absolute directory and the server is not on Vercel, append the rejected
 * model line or command plus the application's own error message to a
 * mode-0600 file. Never enabled in deployments; capture failures are ignored.
 */
export function capturePrivateGenerationRejection(record: {
  subreason: string;
  text: string;
  error?: unknown;
}) {
  const directory = process.env.ORBSIE_PRIVATE_PARSER_CAPTURE_DIR;
  if (!directory || !isAbsolute(directory) || process.env.VERCEL === "1")
    return;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    appendFileSync(
      join(directory, "rejections.jsonl"),
      JSON.stringify({
        at: new Date().toISOString(),
        subreason: record.subreason,
        error:
          record.error instanceof Error
            ? record.error.message.slice(0, 500)
            : undefined,
        text: record.text.slice(0, MAX_CAPTURE_TEXT),
      }) + "\n",
      { mode: 0o600 },
    );
  } catch {
    // Diagnostics must never change generation behavior.
  }
}
