import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeCapturedSse,
  captureBody,
  diagnosticFromGenerationOutput,
  reportForRun,
  writePrivateArtifact,
} from "../scripts/lib/scene-json-diagnostic.mjs";

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function bytes(value) {
  return new TextEncoder().encode(value);
}

function sse(content, finishReason) {
  const event = {
    choices: [
      {
        delta: { content },
        ...(finishReason === undefined ? {} : { finish_reason: finishReason }),
      },
    ],
  };
  return bytes(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
}

describe("scene JSON diagnostic helpers", () => {
  it("reconstructs escaped newlines and identifies the first malformed command", () => {
    const command = JSON.stringify({
      type: "commit_revision",
      message: "first line\nsecond line",
    });
    const malformed = '{"type":"reserve_entity';
    const result = analyzeCapturedSse(
      sse(`${command}\n${malformed}\n`, undefined),
    );
    expect(result.finishFrameSeen).toBe(false);
    expect(result.firstInvalid).toMatchObject({
      recordIndex: 2,
      syntaxClass: "unexpected_eof",
      lineLength: malformed.length,
    });
    expect(result.firstInvalid.offendingLine).toBe(malformed);
  });

  it("classifies a multiline SSE data field as framing JSON failure", () => {
    const result = analyzeCapturedSse(
      bytes(
        'data: {"choices":[\n' +
          'data: {"delta":{"content":"{\\"type\\":\\"commit_revision\\"}"}}]}\n\n',
      ),
    );
    expect(result.firstInvalid).toMatchObject({
      recordIndex: 1,
      syntaxClass: "unexpected_eof",
    });
  });

  it("caps tee capture without retaining bytes after the limit", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes("12345"));
        controller.enqueue(bytes("67890"));
        controller.enqueue(bytes("extra"));
        controller.close();
      },
    });
    const result = await captureBody(body, 10);
    expect(result.capturedBytes).toBe(10);
    expect(result.overflow).toBe(true);
    expect(new TextDecoder().decode(result.bytes)).toBe("1234567890");
  });

  it("preserves a bounded prefix when the upstream body errors", async () => {
    let first = true;
    const body = new ReadableStream({
      pull(controller) {
        if (first) {
          first = false;
          controller.enqueue(bytes("prefix"));
        } else {
          controller.error(new Error("provider-secret"));
        }
      },
    });
    const result = await captureBody(body, 100);
    expect(result.readError).toBe(true);
    expect(result.complete).toBe(false);
    expect(new TextDecoder().decode(result.bytes)).toBe("prefix");
    expect(JSON.stringify(result)).not.toContain("provider-secret");
  });

  it("stops waiting on a body that never reaches a terminal frame", async () => {
    const body = new ReadableStream({ start() {} });
    const result = await captureBody(body, 100, 10);
    expect(result.timedOut).toBe(true);
    expect(result.complete).toBe(false);
  });

  it("keeps reports free of scene content and limits generation diagnostics", () => {
    const report = reportForRun({
      status: "generation_failed",
      httpStatus: 200,
      requestCount: 1,
      capture: {
        capturedBytes: 100,
        overflow: false,
        complete: true,
      },
      upstream: {
        capturedTextValid: true,
        sseDataRecords: 2,
        sceneText: '{"secret":"never-report"}',
        finishFrameSeen: false,
        finishReason: null,
        firstInvalid: {
          recordIndex: 1,
          lineLength: 30,
          syntaxClass: "invalid_token",
          offendingLine: '{"secret":"never-report"}',
        },
      },
      generation: diagnosticFromGenerationOutput(
        '{"code":"INVALID_SCENE_JSON","diagnostic":{"operation":4,"issues":[],"finishReason":null}}\n',
      ),
    });
    expect(JSON.stringify(report)).not.toContain("never-report");
    expect(report.generation).toEqual({
      code: "INVALID_SCENE_JSON",
      diagnostic: { operation: 4, issues: 0, finishReason: null },
    });
  });

  it("writes a private raw line artifact only at an explicit outside path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orbsie-scene-diag-test-"));
    temporaryDirectories.push(directory);
    const artifact = join(directory, "offending-line.txt");
    await writePrivateArtifact(artifact, '{"type":"bad"');
    expect(await readFile(artifact, "utf8")).toBe('{"type":"bad"\n');
    expect((await stat(artifact)).mode & 0o077).toBe(0);
  });
});
