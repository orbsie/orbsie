import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyOperation,
  blankProject,
  commandSchema,
  type Command,
} from "../src/lib/protocol";
import {
  observeGenerationStream,
  createGenerationObservation,
} from "../src/lib/generation-observability";
import {
  beginClientGenerationDiagnostic,
  clearGenerationDiagnostics,
  readGenerationDiagnostics,
} from "../src/lib/generation-diagnostics-client";

type ReplayFixture = {
  name: string;
  chunks?: string[];
  splitUtf8?: string;
  expected: string;
  readError?: boolean;
  abort?: "deadline" | "client";
  stale?: boolean;
  schemaError?: boolean;
  applyError?: boolean;
};

const defaultFixturePath = new URL(
  "../scripts/fixtures/generation-observability-fixtures.json",
  import.meta.url,
).pathname;
const fixturePath =
  process.env.ORBSIE_GENERATION_DIAGNOSTIC_FIXTURE ?? defaultFixturePath;
const fixtures = JSON.parse(
  readFileSync(fixturePath, "utf8"),
) as ReplayFixture[];

const requestId = "11111111-1111-4111-8111-111111111111";
const clientRunId = "22222222-2222-4222-8222-222222222222";

function streamFor(fixture: ReplayFixture) {
  if (fixture.readError)
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("fixture reader failure"));
      },
    });
  const encoder = new TextEncoder();
  if (fixture.splitUtf8 !== undefined) {
    const bytes = encoder.encode(fixture.splitUtf8);
    const splitAt = bytes.findIndex((value) => value === 0xc3);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt + 1));
        controller.enqueue(bytes.slice(splitAt + 1));
        controller.close();
      },
    });
  }
  const chunks = (fixture.chunks ?? []).map((chunk) => encoder.encode(chunk));
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  try {
    while (!(await reader.read()).done) {
      // Consume the observer output like the app's fetch-body consumer.
    }
  } catch {
    // A source read failure is part of the replayed terminal outcome.
  }
}

function fixtureRecords(fixture: ReplayFixture): unknown[] {
  return (fixture.chunks ?? [])
    .join("")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function applyFixtureCommand(record: unknown) {
  const command = commandSchema.parse(record) as Command;
  const project = blankProject();
  const runId = clientRunId;
  expect(() =>
    applyOperation(
      project,
      {
        version: 1,
        projectId: project.id,
        runId,
        sequence: 1,
        operationId: "33333333-3333-4333-8333-333333333333",
        baseRevision: project.revision,
        command,
      },
      { runId, sequence: 0, seen: new Set() },
    ),
  ).toThrow();
}

describe("checked-in generation diagnostic replay", () => {
  it("runs every fixture through production parsing and stream observation", async () => {
    expect(fixtures.length).toBeGreaterThan(0);

    for (const fixture of fixtures) {
      if (fixture.stale) {
        clearGenerationDiagnostics();
        const diagnostic = beginClientGenerationDiagnostic({
          runId: clientRunId,
          provider: "free",
        });
        diagnostic.terminal({ reason: "stale-run", failureCode: "unknown" });
        const entry = readGenerationDiagnostics().find(
          (candidate) => candidate.kind === "generation",
        );
        expect(
          entry && entry.kind === "generation" ? entry.terminal : null,
        ).toMatchObject({ reason: fixture.expected });
        continue;
      }

      if (fixture.schemaError) {
        expect(() =>
          fixtureRecords(fixture).map((record) => commandSchema.parse(record)),
        ).toThrow();
        expect("parser-failure").toBe(fixture.expected);
        continue;
      }

      if (fixture.applyError) {
        const [record] = fixtureRecords(fixture);
        applyFixtureCommand(record);
        expect("parser-failure").toBe(fixture.expected);
        continue;
      }

      const events: unknown[] = [];
      const observation = createGenerationObservation({
        layer: "route",
        requestId,
        clientRunId,
        provider: "free",
        sink: (event) => events.push(event),
      });
      const controller =
        fixture.abort === undefined ? undefined : new AbortController();
      if (controller)
        controller.abort(
          new DOMException(
            fixture.abort === "deadline" ? "deadline" : "cancelled",
            fixture.abort === "deadline" ? "TimeoutError" : "AbortError",
          ),
        );
      await drain(
        observeGenerationStream(
          streamFor(fixture),
          observation,
          controller?.signal,
        ),
      );
      const terminal = events.find(
        (event) =>
          event &&
          typeof event === "object" &&
          (event as Record<string, unknown>).event === "terminal",
      ) as Record<string, unknown> | undefined;
      expect(terminal?.terminalReason).toBe(fixture.expected);
    }
  });
});
