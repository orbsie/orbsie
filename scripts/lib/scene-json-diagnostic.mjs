import { chmod, lstat, open } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export const GATEWAY_COMPLETION_URL =
  "https://ai-gateway.vercel.sh/v1/chat/completions";
export const MAX_CAPTURE_BYTES = 1024 * 1024;

const FINISH_REASONS = new Set([
  "stop",
  "length",
  "tool_calls",
  "content_filter",
  "error",
]);
const DIAGNOSTIC_CODES = new Set([
  "INVALID_SCENE_UPDATE",
  "INVALID_SCENE_JSON",
  "INVALID_SCENE_PROTOCOL",
  "TRUNCATED_SCENE_STREAM",
  "PROVIDER_STREAM_ERROR",
  "CHATGPT_GENERATION_ERROR",
]);
const CHATGPT_GENERATION_STAGES = new Set([
  "catalog",
  "thread-start",
  "turn-start",
  "stream",
]);
const CHATGPT_GENERATION_REASONS = new Set([
  "rpc-rejection",
  "terminal-failure",
  "callback-validation",
  "tool-rejection",
  "timeout",
  "cancelled",
  "output-bound",
  "runtime-closed",
  "model-unavailable",
  "invalid-input",
  "unknown",
]);

function normalizeFinishReason(value) {
  if (value === null || value === undefined) return null;
  return FINISH_REASONS.has(value) ? value : "other";
}

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

function syntaxClass(error) {
  const message = error instanceof Error ? error.message : "";
  if (/unexpected end|unterminated|end of json/i.test(message))
    return "unexpected_eof";
  if (
    /unexpected token|expected property|expected double-quoted/i.test(message)
  )
    return "invalid_token";
  return "invalid_json";
}

function concatenatedBytes(chunks, length) {
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/** Read at most maxBytes from one tee branch, never retaining more than that. */
export async function captureBody(
  body,
  maxBytes = MAX_CAPTURE_BYTES,
  timeoutMs = 180_000,
) {
  if (!body)
    return {
      bytes: new Uint8Array(),
      capturedBytes: 0,
      overflow: false,
      complete: true,
      readError: false,
      timedOut: false,
    };
  const reader = body.getReader();
  const chunks = [];
  let capturedBytes = 0;
  let overflow = false;
  let complete = false;
  let readError = false;
  let timedOut = false;
  const timeout =
    Number.isInteger(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          void reader.cancel("capture timeout").catch(() => {});
        }, timeoutMs)
      : undefined;
  try {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          complete = !timedOut;
          break;
        }
        const bytes =
          value instanceof Uint8Array ? value : new Uint8Array(value);
        const remaining = maxBytes - capturedBytes;
        if (remaining <= 0) {
          overflow = true;
          await reader.cancel("capture limit").catch(() => {});
          break;
        }
        if (bytes.byteLength > remaining) {
          chunks.push(bytes.slice(0, remaining));
          capturedBytes += remaining;
          overflow = true;
          await reader.cancel("capture limit").catch(() => {});
          break;
        }
        chunks.push(bytes);
        capturedBytes += bytes.byteLength;
      }
    } catch {
      // Preserve the bounded prefix; never propagate provider text or errors.
      readError = true;
      await reader.cancel("capture read failure").catch(() => {});
    }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    reader.releaseLock();
  }
  return {
    bytes: concatenatedBytes(chunks, capturedBytes),
    capturedBytes,
    overflow,
    complete,
    readError,
    timedOut,
  };
}

function firstInvalidSceneLine(sceneText) {
  let recordIndex = 0;
  for (const line of sceneText.split("\n")) {
    if (!line.trim()) continue;
    recordIndex += 1;
    try {
      JSON.parse(line);
    } catch (error) {
      return {
        recordIndex,
        lineLength: line.length,
        syntaxClass: syntaxClass(error),
        offendingLine: line,
      };
    }
  }
  return { recordCount: recordIndex };
}

/**
 * Decode a bounded OpenAI-compatible SSE capture without retaining provider
 * payloads in the report. The returned offendingLine is for an explicitly
 * requested private artifact only.
 */
export function analyzeCapturedSse(bytes) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return {
      capturedTextValid: false,
      sseDataRecords: 0,
      sceneText: "",
      finishFrameSeen: false,
      finishReason: null,
      firstInvalid: {
        recordIndex: 0,
        lineLength: 0,
        syntaxClass: "invalid_utf8",
        offendingLine: "",
      },
    };
  }

  let sceneText = "";
  let sseDataRecords = 0;
  let finishFrameSeen = false;
  let finishReason = null;
  let sseFailure;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    sseDataRecords += 1;
    let event;
    try {
      event = JSON.parse(data);
    } catch (error) {
      sseFailure = {
        recordIndex: sseDataRecords,
        lineLength: data.length,
        syntaxClass: syntaxClass(error),
        offendingLine: data,
      };
      break;
    }
    const record = objectRecord(event);
    if (!record) {
      sseFailure = {
        recordIndex: sseDataRecords,
        lineLength: data.length,
        syntaxClass: "invalid_json",
        offendingLine: data,
      };
      break;
    }
    const choice = Array.isArray(record.choices)
      ? objectRecord(record.choices[0])
      : undefined;
    const reason = choice?.finish_reason;
    if (reason !== undefined && reason !== null) {
      finishFrameSeen = true;
      finishReason = normalizeFinishReason(reason);
    }
    const delta = objectRecord(choice?.delta)?.content;
    if (typeof delta === "string") {
      sceneText += delta;
      if (sceneText.length > MAX_CAPTURE_BYTES) {
        sseFailure = {
          recordIndex: 0,
          lineLength: 0,
          syntaxClass: "capture_limit",
          offendingLine: "",
        };
        break;
      }
    }
  }

  const firstInvalid = sseFailure ?? firstInvalidSceneLine(sceneText);
  return {
    capturedTextValid: true,
    sseDataRecords,
    sceneText,
    finishFrameSeen,
    finishReason,
    firstInvalid,
  };
}

function safeDiagnostic(value) {
  const record = objectRecord(value);
  if (
    !record ||
    typeof record.code !== "string" ||
    !DIAGNOSTIC_CODES.has(record.code)
  )
    return undefined;
  const diagnostic = objectRecord(record.diagnostic);
  if (!diagnostic) return { code: record.code };
  const operation =
    typeof diagnostic.operation === "number" &&
    Number.isInteger(diagnostic.operation) &&
    diagnostic.operation >= 0 &&
    diagnostic.operation <= 251
      ? diagnostic.operation
      : 0;
  const output = { code: record.code, diagnostic: { operation } };
  if (Array.isArray(diagnostic.issues))
    output.diagnostic.issues = diagnostic.issues.length;
  if (typeof diagnostic.providerStatus === "number")
    output.diagnostic.providerStatus = diagnostic.providerStatus;
  if (
    diagnostic.finishReason === null ||
    typeof diagnostic.finishReason === "string"
  )
    output.diagnostic.finishReason =
      diagnostic.finishReason === null ||
      FINISH_REASONS.has(diagnostic.finishReason)
        ? diagnostic.finishReason
        : "other";
  if (
    typeof diagnostic.stage === "string" &&
    CHATGPT_GENERATION_STAGES.has(diagnostic.stage)
  )
    output.diagnostic.stage = diagnostic.stage;
  if (
    typeof diagnostic.reason === "string" &&
    CHATGPT_GENERATION_REASONS.has(diagnostic.reason)
  )
    output.diagnostic.reason = diagnostic.reason;
  if (
    typeof diagnostic.rpcCode === "number" &&
    Number.isSafeInteger(diagnostic.rpcCode) &&
    diagnostic.rpcCode >= -32768 &&
    diagnostic.rpcCode <= 32767
  )
    output.diagnostic.rpcCode = diagnostic.rpcCode;
  return output;
}

export function diagnosticFromGenerationOutput(output) {
  let found;
  for (const line of String(output).split("\n")) {
    if (!line.trim()) continue;
    try {
      const candidate = safeDiagnostic(JSON.parse(line));
      if (candidate) found = candidate;
    } catch {
      // Generation output may contain no JSON diagnostic line; omit it.
    }
  }
  return found;
}

export function reportForRun({
  status,
  httpStatus,
  requestCount,
  capture,
  upstream,
  generation,
}) {
  return {
    checkedAt: new Date().toISOString(),
    status,
    provider: "gateway",
    model: "openai/gpt-5.6-luna",
    reasoning: "low",
    serviceTier: "default",
    maxTokens: 4096,
    requestCount,
    httpStatus: Number.isInteger(httpStatus) ? httpStatus : null,
    capturedBytes: capture.capturedBytes,
    captureOverflow: capture.overflow,
    captureComplete: capture.complete,
    captureReadError: capture.readError === true,
    captureTimedOut: capture.timedOut === true,
    upstream: {
      capturedTextValid: upstream.capturedTextValid,
      sseDataRecords: upstream.sseDataRecords,
      sceneCommandLines:
        upstream.firstInvalid?.recordIndex > 0
          ? upstream.firstInvalid.recordIndex - 1
          : upstream.sceneText.split("\n").filter((line) => line.trim()).length,
      finishFrameSeen: upstream.finishFrameSeen,
      finishReason: upstream.finishReason,
      firstInvalid: upstream.firstInvalid
        ? {
            recordIndex: upstream.firstInvalid.recordIndex,
            lineLength: upstream.firstInvalid.lineLength,
            syntaxClass: upstream.firstInvalid.syntaxClass,
          }
        : null,
    },
    generation: generation ?? null,
  };
}

export function assertPrivateArtifactPath(
  artifactPath,
  repositoryRoot = process.cwd(),
) {
  const absolute = resolve(artifactPath);
  if (!isAbsolute(artifactPath))
    throw new Error("The raw artifact path must be absolute.");
  const relativePath = relative(resolve(repositoryRoot), absolute);
  if (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${requireSeparator()}`))
  )
    throw new Error("The raw artifact must be outside the repository.");
  return absolute;
}

function requireSeparator() {
  return "/";
}

export async function writePrivateArtifact(artifactPath, line) {
  const absolute = assertPrivateArtifactPath(artifactPath);
  const handle = await open(absolute, "wx", 0o600);
  try {
    await handle.writeFile(`${line}\n`, { encoding: "utf8" });
  } finally {
    await handle.close();
  }
  await chmod(absolute, 0o600);
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0)
    throw new Error("The raw artifact is not a private regular file.");
  return absolute;
}
