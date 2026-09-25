import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  append: vi.fn(),
  cancel: vi.fn(),
  begin: vi.fn(),
  failNextDbUpdate: false,
  db: new Map<string, unknown>(),
}));

vi.mock("../src/lib/scene-review-capture", async () => ({
  ...(await vi.importActual<typeof import("../src/lib/scene-review-capture")>(
    "../src/lib/scene-review-capture",
  )),
  captureSceneReview: mocks.capture,
}));
vi.mock("../src/lib/cloud-generation-journal", () => ({
  appendCloudGenerationOperation: mocks.append,
  cancelCloudGenerationRun: mocks.cancel,
}));
vi.mock("../src/lib/cloud-generated-models", () => ({
  uploadCloudGeneratedModels: vi.fn().mockResolvedValue(true),
  downloadCloudGeneratedModels: vi.fn().mockResolvedValue(true),
}));
vi.mock("idb-keyval", () => ({
  clear: async () => mocks.db.clear(),
  del: async (key: string) => mocks.db.delete(key),
  get: async (key: string) => structuredClone(mocks.db.get(key)),
  set: async (key: string, value: unknown) =>
    mocks.db.set(key, structuredClone(value)),
  update: async (key: string, change: (value: unknown) => unknown) => {
    if (mocks.failNextDbUpdate) {
      mocks.failNextDbUpdate = false;
      throw Error("Local save failed.");
    }
    mocks.db.set(key, structuredClone(change(mocks.db.get(key))));
  },
}));

import { createSceneBinding } from "../src/lib/scene-binding";
import {
  applyOperation,
  blankProject,
  type Command,
  type Envelope,
} from "../src/lib/protocol";
import { fixtureEntities } from "../src/lib/fixtures";
import { SceneReviewCaptureError } from "../src/lib/scene-review-capture";
import { authoringReviewIssueSummary } from "../src/lib/authoring-activity";
import {
  assertCloudJournalBaseline,
  authoringReviewEligibleForConnection,
  useOrb,
  type GenerationJournalConnection,
} from "../src/lib/store";
import type { GenerationRun } from "../src/lib/generation-journal";

const authoringRunId = "11111111-1111-4111-8111-111111111111";
const connection = {
  provider: "free" as const,
  model: "",
  key: "",
  renderer: "software" as const,
  authoringReview: true,
};
const correction: Command = {
  type: "set_environment",
  sky: "#aabbff",
};

function initialCommands(project: ReturnType<typeof blankProject>): string {
  const id = project.entities[0]!.id;
  return (
    [
      { type: "set_material", id, color: "#ff66aa" },
      { type: "commit_revision", message: "Initial scene." },
    ]
      .map((command) => JSON.stringify(command))
      .join("\n") + "\n"
  );
}

function capture(project: ReturnType<typeof blankProject>) {
  return {
    image:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    width: 1,
    height: 1,
    byteLength: 114,
    renderer: "software" as const,
    projectId: project.id,
    revision: project.revision,
    readiness: {
      renderedRevision: project.revision,
      transitionSettled: true,
      readyAssetIds: project.entities.map((entity) => entity.id),
      pendingAssetIds: [],
      failedAssetIds: [],
    },
    errors: [],
  };
}

async function reviewReply(
  project: ReturnType<typeof blankProject>,
  verdict: "accept" | "revise",
  scope: "visual+structural" | "structural-only",
  options: {
    correction?: Command;
    remainingCalls?: number;
    final?: boolean;
    issueSummary?: string;
  } = {},
) {
  const binding = await createSceneBinding(project);
  const corrections =
    verdict === "revise" && !options.final
      ? [
          options.correction ?? correction,
          {
            type: "commit_revision" as const,
            message: "Review correction applied.",
          },
        ]
      : [];
  return {
    review: {
      version: 1,
      projectId: project.id,
      reviewedRevision: project.revision,
      scope,
      verdict,
      summary:
        verdict === "accept"
          ? "The scene is ready."
          : "The sky needs correction.",
      issues:
        verdict === "accept"
          ? []
          : [
              {
                summary: options.issueSummary ?? "Sky mismatch.",
                entityIds: [],
              },
            ],
      corrections:
        verdict === "accept" || options.final
          ? []
          : [options.correction ?? correction],
    },
    corrections,
    binding: { revision: binding.revision, digest: binding.digest },
    revision: binding.revision,
    digest: binding.digest,
    scope,
    remainingCalls:
      options.remainingCalls ?? (verdict === "accept" || options.final ? 0 : 1),
  };
}

function streamResponse(project: ReturnType<typeof blankProject>) {
  return new Response(initialCommands(project), {
    headers: {
      "Content-Type": "application/x-ndjson",
      "X-Orbsie-Authoring-Run-Id": authoringRunId,
      "X-Orbsie-Review-Image-Supported": "1",
    },
  });
}

function selectedRemovalResponse(selected: string) {
  const commands: Command[] = [
    { type: "remove_entity", id: selected },
    { type: "commit_revision", message: "Removed selected object." },
  ];
  return new Response(
    commands.map((command) => JSON.stringify(command)).join("\n") + "\n",
    {
      headers: {
        "Content-Type": "application/x-ndjson",
        "X-Orbsie-Authoring-Run-Id": authoringRunId,
        "X-Orbsie-Review-Image-Supported": "1",
      },
    },
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function applyReviewCorrections(
  project: ReturnType<typeof blankProject>,
  commands: readonly Command[],
) {
  let current = project;
  let cursor = {
    runId: crypto.randomUUID(),
    sequence: 0,
    seen: new Set<string>(),
  };
  for (const command of commands) {
    const envelope: Envelope = {
      version: 1,
      projectId: current.id,
      runId: cursor.runId,
      sequence: cursor.sequence + 1,
      operationId: crypto.randomUUID(),
      baseRevision: current.revision,
      command,
    };
    const applied = applyOperation(current, envelope, cursor);
    current = applied.project;
    cursor = applied.cursor;
  }
  return current;
}

function partialReviewFetcher(
  options: {
    firstRemainingCalls?: number;
    secondRemainingCalls?: number;
    secondVerdict?: "accept" | "revise";
    issueSummaries?: string[];
  } = {},
) {
  let reviewCall = 0;
  return vi.fn<typeof fetch>(async (url, init) => {
    if (url === "/api/generate")
      return streamResponse(JSON.parse(String(init?.body)).project);
    const body = JSON.parse(String(init?.body));
    if (body.phase === "final-review") {
      const response = await reviewReply(
        body.project,
        "revise",
        "visual+structural",
        { final: true, issueSummary: options.issueSummaries?.[reviewCall] },
      );
      return Response.json(response);
    }
    if (body.phase !== "review")
      throw Error("Unexpected authoring review phase.");

    const ordinal = reviewCall++;
    if (ordinal > 1 || (ordinal === 1 && options.firstRemainingCalls === 1))
      throw Error("The review loop exceeded its admitted calls.");
    const secondPass = ordinal === 1;
    const verdict = secondPass ? (options.secondVerdict ?? "revise") : "revise";
    const response = await reviewReply(
      body.project,
      verdict,
      "visual+structural",
      {
        correction: secondPass
          ? { type: "set_environment", sky: "#ccddaa" }
          : correction,
        issueSummary: options.issueSummaries?.[ordinal],
        remainingCalls:
          verdict === "accept"
            ? 0
            : secondPass
              ? (options.secondRemainingCalls ?? 1)
              : (options.firstRemainingCalls ?? 2),
      },
    );
    if (response.review.verdict === "accept") return Response.json(response);
    const corrected = applyReviewCorrections(
      body.project,
      response.corrections,
    );
    const binding = await createSceneBinding(corrected);
    return Response.json({
      ...response,
      binding: { revision: binding.revision, digest: binding.digest },
      revision: binding.revision,
      digest: binding.digest,
    });
  });
}

function journal(): GenerationJournalConnection {
  const runs = new Map<string, GenerationRun>();
  return {
    isCurrent: () => true,
    begin: async (project, runId, prompt, selected) => {
      const run: GenerationRun = {
        id: runId,
        projectId: project.id,
        sequence: 0,
        state: "running",
        checkpoint: project,
        prompt,
        selected,
        baseRevision: project.revision,
        cloudBaselineCurrent: true,
      };
      runs.set(runId, run);
      mocks.begin(run);
      return run;
    },
  };
}

beforeEach(async () => {
  mocks.capture.mockReset();
  mocks.append.mockReset();
  mocks.cancel.mockReset().mockResolvedValue(undefined);
  mocks.begin.mockReset();
  mocks.failNextDbUpdate = false;
  mocks.db.clear();
  vi.stubGlobal("Worker", class {});
  const project = {
    ...blankProject(),
    entities: [fixtureEntities()[0]!],
  };
  await useOrb.getState().load(project);
  mocks.capture.mockImplementation(
    async (request: { projectId: string; revision: number }) =>
      capture({
        ...useOrb.getState().project,
        id: request.projectId,
        revision: request.revision,
      }),
  );
  mocks.append.mockImplementation(
    async (envelope: Envelope) =>
      ({
        id: envelope.runId,
        projectId: envelope.projectId,
        sequence: envelope.sequence,
        state:
          envelope.command.type === "commit_revision" ? "complete" : "running",
        checkpoint: applyOperation(useOrb.getState().project, envelope, {
          runId: envelope.runId,
          sequence: envelope.sequence - 1,
          seen: new Set(),
        }).project,
        prompt: "review",
        baseRevision: 0,
        cloudBaselineCurrent: true,
      }) satisfies GenerationRun,
  );
});

afterEach(() => {
  useOrb.getState().stop();
  vi.unstubAllGlobals();
});

describe("store browser authoring review loop", () => {
  it("sanitizes and bounds review issue summaries", () => {
    const summary = authoringReviewIssueSummary(
      `  sky\n\u202e mismatch ${"x".repeat(250)}  `,
    );
    expect(summary).not.toMatch(
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/,
    );
    expect(Array.from(summary)).toHaveLength(180);
    expect(summary).toContain("sky mismatch");
  });

  it("requires free allowance for review while a linked ready provider remains eligible", () => {
    expect(
      authoringReviewEligibleForConnection(
        true,
        { provider: "free", model: "", key: "" },
        false,
      ),
    ).toBe(false);
    expect(
      authoringReviewEligibleForConnection(
        true,
        { provider: "free", model: "", key: "" },
        true,
      ),
    ).toBe(true);
    expect(
      authoringReviewEligibleForConnection(
        true,
        { provider: "openrouter", model: "scene-model", key: "linked-key" },
        false,
      ),
    ).toBe(true);
  });

  it("rejects a cloud correction segment after a concurrent revision", () => {
    expect(() =>
      assertCloudJournalBaseline(
        { revision: 4, snapshotToken: "token-a" },
        { revision: 4, snapshotToken: "token-a" },
      ),
    ).not.toThrow();
    expect(() =>
      assertCloudJournalBaseline(
        { revision: 4, snapshotToken: "token-a" },
        { revision: 5, snapshotToken: "token-b" },
      ),
    ).toThrow("A newer cloud save exists");
  });

  it("accepts the first review with one UI run and image evidence", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate")
        return streamResponse(JSON.parse(String(init?.body)).project);
      const body = JSON.parse(String(init?.body));
      return Response.json(
        await reviewReply(body.project, "accept", "visual+structural"),
      );
    });
    vi.stubGlobal("fetch", fetcher);

    await useOrb.getState().run("Recolor the tree", connection);

    expect(fetcher).toHaveBeenCalledTimes(2);
    const reviewBody = JSON.parse(String(fetcher.mock.calls[1]![1]?.body));
    expect(reviewBody).toMatchObject({
      phase: "review",
      runId: authoringRunId,
      project: { revision: 2 },
      reviewImage: { renderer: "software" },
    });
    expect(useOrb.getState().authoringActivity.at(-1)?.message).toBe(
      "Scene verified. Changes are applied.",
    );
    expect(useOrb.getState().building).toBe(false);
  });

  it("offers a saved-revision continuation when an admitted review fails", async () => {
    let generationRequestedAt = 0;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate") {
        generationRequestedAt = Date.now();
        return streamResponse(JSON.parse(String(init?.body)).project);
      }
      return new Response(JSON.stringify({ error: "Review unavailable." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const originalIds = useOrb
      .getState()
      .project.entities.map((entity) => entity.id);

    await useOrb.getState().run("Recolor the tree", connection);

    const state = useOrb.getState();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(state.project.revision).toBe(2);
    expect(state.project.entities.map((entity) => entity.id)).toEqual(
      originalIds,
    );
    expect(state.saved).toBe(true);
    expect(state.interruptedReviewContinuation).toMatchObject({
      projectId: state.project.id,
      revision: state.project.revision,
      prompt: "Recolor the tree",
      priorRunId: authoringRunId,
      browserModeling: true,
      provider: "free",
      model: "",
      reviewImageSupported: true,
    });
    expect(state.interruptedReviewContinuation!.expiresAt).toBeLessThanOrEqual(
      generationRequestedAt + 15 * 60 * 1000,
    );
    expect(state.interruptedReviewContinuation).not.toHaveProperty("key");
    expect(state.reviewContinuation).toBeUndefined();
    expect(state.generationRecovery).toBeUndefined();
    expect(state.authoringActivity.at(-1)).toMatchObject({
      kind: "failed",
      message: "Scene saved, but review could not finish.",
      revision: state.project.revision,
    });
    const savedLibrary = mocks.db.get("orbsie-library") as Record<
      string,
      ReturnType<typeof blankProject>
    >;
    expect(savedLibrary[state.project.id]?.revision).toBe(
      state.project.revision,
    );
    const continuationKey = `orbsie-review-continuation:${state.project.id}`;
    const savedContinuation = mocks.db.get(continuationKey) as {
      version: number;
      projectDigest: string;
      continuation: Record<string, unknown>;
    };
    expect(savedContinuation.version).toBe(1);
    expect(savedContinuation.projectDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(savedContinuation.continuation).toMatchObject({
      projectId: state.project.id,
      revision: state.project.revision,
      priorRunId: authoringRunId,
      provider: "free",
    });
    expect(savedContinuation.continuation.expiresAt).toBeGreaterThan(
      Date.now(),
    );
    expect(savedContinuation).not.toHaveProperty("key");
    expect(savedContinuation.continuation).not.toHaveProperty("key");

    await useOrb.getState().load(state.project);
    expect(useOrb.getState().authoringActivity).toEqual([]);
    expect(useOrb.getState().interruptedReviewContinuation).toMatchObject({
      priorRunId: authoringRunId,
      revision: state.project.revision,
    });

    mocks.db.set(continuationKey, {
      ...savedContinuation,
      continuation: {
        ...savedContinuation.continuation,
        expiresAt: Date.now() - 1,
      },
    });
    await useOrb.getState().load(state.project);
    expect(useOrb.getState().interruptedReviewContinuation).toBeUndefined();
    expect(mocks.db.has(continuationKey)).toBe(false);

    mocks.db.set(continuationKey, savedContinuation);
    await useOrb.getState().load({
      ...state.project,
      revision: state.project.revision + 1,
    });
    expect(useOrb.getState().interruptedReviewContinuation).toBeUndefined();
    expect(mocks.db.has(continuationKey)).toBe(false);
  });

  it("restores the original selection when the saved scene removed that entity", async () => {
    const selected = useOrb.getState().project.entities[0]!.id;
    useOrb.getState().set({ selected });
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (url === "/api/generate") return selectedRemovalResponse(selected);
      return new Response(JSON.stringify({ error: "Review unavailable." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);

    await useOrb.getState().run("Remove the selected tree", connection);

    const saved = useOrb.getState();
    expect(
      saved.project.entities.some((entity) => entity.id === selected),
    ).toBe(false);
    expect(saved.saved).toBe(true);
    expect(saved.interruptedReviewContinuation?.selected).toBe(selected);

    await useOrb.getState().load(saved.project);

    expect(useOrb.getState().authoringActivity).toEqual([]);
    expect(useOrb.getState().interruptedReviewContinuation?.selected).toBe(
      selected,
    );
  });

  it("resumes the saved review with one start and one review request", async () => {
    const resumedRunId = "33333333-3333-4333-8333-333333333333";
    let resumed = false;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate")
        return streamResponse(JSON.parse(String(init?.body)).project);
      if (url === "/api/generate/review/start") {
        resumed = true;
        return Response.json({
          runId: resumedRunId,
          reviewImageSupported: true,
        });
      }
      const body = JSON.parse(String(init?.body));
      if (!resumed)
        return Response.json({ error: "Review unavailable." }, { status: 502 });
      return Response.json(
        await reviewReply(body.project, "accept", "visual+structural"),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const selected = useOrb.getState().project.entities[0]!.id;
    useOrb.getState().set({ selected });

    await useOrb.getState().run("Recolor the tree", connection);
    const failed = useOrb.getState();
    const savedRevision = failed.project.revision;
    const originalPromptCount = failed.project.messages.filter(
      (message) =>
        message.role === "user" && message.text === "Recolor the tree",
    ).length;
    expect(failed.interruptedReviewContinuation).toMatchObject({
      priorRunId: authoringRunId,
      selected,
      browserModeling: true,
      provider: "free",
    });

    const savedProject = failed.project;
    await useOrb.getState().load(savedProject);
    expect(useOrb.getState().authoringActivity).toEqual([]);
    expect(useOrb.getState().interruptedReviewContinuation).toMatchObject({
      priorRunId: authoringRunId,
      revision: savedRevision,
    });

    await useOrb.getState().resumeInterruptedReview(connection);

    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/generate",
      "/api/generate/review",
      "/api/generate/review/start",
      "/api/generate/review",
    ]);
    const startBody = JSON.parse(String(fetcher.mock.calls[2]![1]?.body));
    expect(startBody).toMatchObject({
      priorRunId: authoringRunId,
      prompt: "Recolor the tree",
      selected,
      browserModeling: true,
      project: { id: failed.project.id, revision: savedRevision },
    });
    const resumedReviewBody = JSON.parse(
      String(fetcher.mock.calls[3]![1]?.body),
    );
    expect(resumedReviewBody).toMatchObject({
      runId: resumedRunId,
      prompt: "Recolor the tree",
      selected,
      project: { id: failed.project.id, revision: savedRevision },
    });
    const finalState = useOrb.getState();
    expect(finalState.project.revision).toBe(savedRevision);
    expect(
      finalState.project.messages.filter(
        (message) =>
          message.role === "user" && message.text === "Recolor the tree",
      ),
    ).toHaveLength(originalPromptCount);
    expect(finalState.interruptedReviewContinuation).toBeUndefined();
    expect(finalState.saved).toBe(true);
    expect(mocks.db.has(`orbsie-review-continuation:${savedProject.id}`)).toBe(
      false,
    );
  });

  it("does not admit a stale or connection-mismatched continuation", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate")
        return streamResponse(JSON.parse(String(init?.body)).project);
      return Response.json({ error: "Review unavailable." }, { status: 502 });
    });
    vi.stubGlobal("fetch", fetcher);
    await useOrb.getState().run("Recolor the tree", connection);

    await useOrb
      .getState()
      .resumeInterruptedReview({ ...connection, model: "different-model" });
    expect(fetcher).toHaveBeenCalledTimes(2);

    const state = useOrb.getState();
    useOrb.setState({
      project: { ...state.project, revision: state.project.revision + 1 },
    });
    await useOrb.getState().resumeInterruptedReview(connection);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(useOrb.getState().interruptedReviewContinuation?.revision).toBe(
      state.project.revision,
    );
  });

  it("does not admit when the pre-start scene capture fails", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate")
        return streamResponse(JSON.parse(String(init?.body)).project);
      return Response.json({ error: "Review unavailable." }, { status: 502 });
    });
    vi.stubGlobal("fetch", fetcher);
    await useOrb.getState().run("Recolor the tree", connection);
    mocks.capture.mockRejectedValueOnce(
      new SceneReviewCaptureError("timeout", "capture timeout"),
    );

    await useOrb.getState().resumeInterruptedReview(connection);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(useOrb.getState().interruptedReviewContinuation?.priorRunId).toBe(
      authoringRunId,
    );
  });

  it("keeps the prior run binding when the review-start response is lost", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate")
        return streamResponse(JSON.parse(String(init?.body)).project);
      if (url === "/api/generate/review/start")
        throw Error("Connection lost after admission.");
      return Response.json({ error: "Review unavailable." }, { status: 502 });
    });
    vi.stubGlobal("fetch", fetcher);
    await useOrb.getState().run("Recolor the tree", connection);
    const originalExpiry =
      useOrb.getState().interruptedReviewContinuation!.expiresAt;

    await useOrb.getState().resumeInterruptedReview(connection);

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(useOrb.getState().interruptedReviewContinuation?.priorRunId).toBe(
      authoringRunId,
    );
    expect(useOrb.getState().interruptedReviewContinuation?.expiresAt).toBe(
      originalExpiry,
    );
    expect(useOrb.getState().saved).toBe(true);
    const savedContinuation = mocks.db.get(
      `orbsie-review-continuation:${useOrb.getState().project.id}`,
    ) as { continuation: Record<string, unknown> };
    expect(savedContinuation.continuation).toMatchObject({
      priorRunId: authoringRunId,
      expiresAt: originalExpiry,
    });
  });

  it("preserves the old binding when the review response is lost", async () => {
    let resumed = false;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate")
        return streamResponse(JSON.parse(String(init?.body)).project);
      if (url === "/api/generate/review/start") {
        resumed = true;
        return Response.json({
          runId: "77777777-7777-4777-8777-777777777777",
          reviewImageSupported: true,
        });
      }
      if (!resumed)
        return Response.json({ error: "Review unavailable." }, { status: 502 });
      throw Error("Review response lost.");
    });
    vi.stubGlobal("fetch", fetcher);
    await useOrb.getState().run("Recolor the tree", connection);
    const originalExpiry =
      useOrb.getState().interruptedReviewContinuation!.expiresAt;

    await useOrb.getState().resumeInterruptedReview(connection);

    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(useOrb.getState().interruptedReviewContinuation?.priorRunId).toBe(
      authoringRunId,
    );
    expect(useOrb.getState().error).toContain("admission is unknown");
    expect(useOrb.getState().interruptedReviewContinuation?.expiresAt).toBe(
      originalExpiry,
    );
    expect(useOrb.getState().saved).toBe(true);
  });

  it("uses structural-only review when admitted image support has fallen", async () => {
    let resumed = false;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate")
        return streamResponse(JSON.parse(String(init?.body)).project);
      if (url === "/api/generate/review/start") {
        resumed = true;
        return Response.json({
          runId: "99999999-9999-4999-8999-999999999999",
          reviewImageSupported: false,
        });
      }
      if (!resumed)
        return Response.json({ error: "Review unavailable." }, { status: 502 });
      const body = JSON.parse(String(init?.body));
      return Response.json(
        await reviewReply(body.project, "accept", "structural-only"),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    await useOrb.getState().run("Recolor the tree", connection);

    await useOrb.getState().resumeInterruptedReview(connection);

    expect(fetcher).toHaveBeenCalledTimes(4);
    const startBody = JSON.parse(String(fetcher.mock.calls[2]![1]?.body));
    const reviewBody = JSON.parse(String(fetcher.mock.calls[3]![1]?.body));
    expect(startBody.priorRunId).toBe(authoringRunId);
    expect(reviewBody.phase).toBe("review");
    expect(reviewBody).not.toHaveProperty("reviewImage");
    expect(reviewBody.structuralObservations).toMatchObject({
      renderer: "software",
    });
    expect(useOrb.getState().authoringActivity.at(-1)?.message).toBe(
      "Scene structure verified. Changes are applied.",
    );
    expect(useOrb.getState().interruptedReviewContinuation).toBeUndefined();
    expect(useOrb.getState().saved).toBe(true);
  });

  it("preserves disabled browser modeling if support becomes available", async () => {
    vi.stubGlobal("Worker", undefined);
    let resumed = false;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate")
        return streamResponse(JSON.parse(String(init?.body)).project);
      if (url === "/api/generate/review/start") {
        resumed = true;
        return Response.json({
          runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          reviewImageSupported: true,
        });
      }
      const body = JSON.parse(String(init?.body));
      if (!resumed)
        return Response.json({ error: "Review unavailable." }, { status: 502 });
      return Response.json(
        await reviewReply(body.project, "accept", "visual+structural"),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    await useOrb.getState().run("Recolor the tree", connection);
    expect(
      useOrb.getState().interruptedReviewContinuation?.browserModeling,
    ).toBe(false);
    vi.stubGlobal("Worker", class {});

    await useOrb.getState().resumeInterruptedReview(connection);

    expect(fetcher).toHaveBeenCalledTimes(4);
    const startBody = JSON.parse(String(fetcher.mock.calls[2]![1]?.body));
    const reviewBody = JSON.parse(String(fetcher.mock.calls[3]![1]?.body));
    expect(startBody.browserModeling).toBe(false);
    expect(reviewBody.browserModeling).toBe(false);
    expect(useOrb.getState().interruptedReviewContinuation).toBeUndefined();
  });

  it("does not rebind after a review preflight failure without admission evidence", async () => {
    let resumed = false;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate")
        return streamResponse(JSON.parse(String(init?.body)).project);
      if (url === "/api/generate/review/start") {
        resumed = true;
        return Response.json({
          runId: "88888888-8888-4888-8888-888888888888",
          reviewImageSupported: true,
        });
      }
      return Response.json(
        { error: "Review preflight failed." },
        {
          status: 409,
          headers: resumed ? {} : undefined,
        },
      );
    });
    vi.stubGlobal("fetch", fetcher);
    await useOrb.getState().run("Recolor the tree", connection);

    await useOrb.getState().resumeInterruptedReview(connection);

    expect(useOrb.getState().interruptedReviewContinuation?.priorRunId).toBe(
      authoringRunId,
    );
    expect(useOrb.getState().error).toContain("review could not finish");
  });

  it("restores the last saved scene when a resumed correction cannot save", async () => {
    const resumedRunId = "55555555-5555-4555-8555-555555555555";
    let resumed = false;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate")
        return streamResponse(JSON.parse(String(init?.body)).project);
      if (url === "/api/generate/review/start") {
        resumed = true;
        return Response.json({
          runId: resumedRunId,
          reviewImageSupported: true,
        });
      }
      const body = JSON.parse(String(init?.body));
      if (!resumed)
        return Response.json({ error: "Review unavailable." }, { status: 502 });
      const response = await reviewReply(
        body.project,
        "revise",
        "visual+structural",
        { remainingCalls: 2 },
      );
      const corrected = applyReviewCorrections(
        body.project,
        response.corrections,
      );
      const binding = await createSceneBinding(corrected);
      return Response.json({
        ...response,
        binding: { revision: binding.revision, digest: binding.digest },
        revision: binding.revision,
        digest: binding.digest,
      });
    });
    vi.stubGlobal("fetch", fetcher);
    await useOrb.getState().run("Recolor the tree", connection);
    const savedBeforeResume = structuredClone(useOrb.getState().project);
    mocks.failNextDbUpdate = true;

    await useOrb.getState().resumeInterruptedReview(connection);

    const state = useOrb.getState();
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(state.project).toEqual(savedBeforeResume);
    expect(state.saved).toBe(true);
    expect(state.interruptedReviewContinuation).toMatchObject({
      priorRunId: resumedRunId,
      revision: savedBeforeResume.revision,
    });
    const savedLibrary = mocks.db.get("orbsie-library") as Record<
      string,
      ReturnType<typeof blankProject>
    >;
    expect(savedLibrary[state.project.id]).toEqual(savedBeforeResume);
  });

  it("cancels during capture before the review-only admission request", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate")
        return streamResponse(JSON.parse(String(init?.body)).project);
      return Response.json({ error: "Review unavailable." }, { status: 502 });
    });
    vi.stubGlobal("fetch", fetcher);
    await useOrb.getState().run("Recolor the tree", connection);
    const gate = deferred<ReturnType<typeof capture>>();
    mocks.capture.mockReturnValueOnce(gate.promise);

    const resume = useOrb.getState().resumeInterruptedReview(connection);
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(2));
    useOrb.getState().stop();
    gate.resolve(capture(useOrb.getState().project));
    await resume;

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(useOrb.getState().interruptedReviewContinuation).toBeUndefined();
  });

  it("refreshes the prior run ID when the resumed review request fails", async () => {
    const resumedRunId = "44444444-4444-4444-8444-444444444444";
    let resumed = false;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate")
        return streamResponse(JSON.parse(String(init?.body)).project);
      if (url === "/api/generate/review/start") {
        resumed = true;
        return Response.json({
          runId: resumedRunId,
          reviewImageSupported: true,
        });
      }
      if (!resumed)
        return Response.json({ error: "Review unavailable." }, { status: 502 });
      return Response.json(
        { error: "Review unavailable again." },
        {
          status: 502,
          headers: { "X-Orbsie-Review-Failure-Kind": "scene-review-model" },
        },
      );
    });
    vi.stubGlobal("fetch", fetcher);
    await useOrb.getState().run("Recolor the tree", connection);
    const revision = useOrb.getState().project.revision;
    const originalExpiry =
      useOrb.getState().interruptedReviewContinuation!.expiresAt;

    await useOrb.getState().resumeInterruptedReview(connection);

    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(useOrb.getState().interruptedReviewContinuation).toMatchObject({
      priorRunId: resumedRunId,
      revision,
      projectId: useOrb.getState().project.id,
    });
    expect(
      useOrb.getState().interruptedReviewContinuation!.expiresAt,
    ).toBeGreaterThan(originalExpiry);
    expect(useOrb.getState().saved).toBe(true);
    expect(useOrb.getState().project.revision).toBe(revision);
    const savedContinuation = mocks.db.get(
      `orbsie-review-continuation:${useOrb.getState().project.id}`,
    ) as { continuation: Record<string, unknown> };
    expect(savedContinuation.continuation).toMatchObject({
      priorRunId: resumedRunId,
      expiresAt: useOrb.getState().interruptedReviewContinuation!.expiresAt,
    });
    const savedLibrary = mocks.db.get("orbsie-library") as Record<
      string,
      ReturnType<typeof blankProject>
    >;
    expect(savedLibrary[useOrb.getState().project.id]?.revision).toBe(revision);
  });

  it("starts a journal correction segment for a resumed review finding", async () => {
    const resumedRunId = "66666666-6666-4666-8666-666666666666";
    let resumed = false;
    let reviewOrdinal = 0;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate")
        return streamResponse(JSON.parse(String(init?.body)).project);
      if (url === "/api/generate/review/start") {
        resumed = true;
        return Response.json({
          runId: resumedRunId,
          reviewImageSupported: true,
        });
      }
      if (!resumed)
        return Response.json({ error: "Review unavailable." }, { status: 502 });
      const body = JSON.parse(String(init?.body));
      if (reviewOrdinal++ > 0)
        return Response.json(
          await reviewReply(body.project, "accept", "visual+structural"),
        );
      const response = await reviewReply(
        body.project,
        "revise",
        "visual+structural",
        { remainingCalls: 2 },
      );
      const corrected = applyReviewCorrections(
        body.project,
        response.corrections,
      );
      const binding = await createSceneBinding(corrected);
      return Response.json({
        ...response,
        binding: { revision: binding.revision, digest: binding.digest },
        revision: binding.revision,
        digest: binding.digest,
      });
    });
    vi.stubGlobal("fetch", fetcher);
    await useOrb.getState().run("Recolor the tree", connection);

    await useOrb.getState().resumeInterruptedReview(connection, journal());

    expect(mocks.begin).toHaveBeenCalledOnce();
    expect(mocks.append).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(mocks.begin).toHaveBeenCalledOnce();
    expect(mocks.begin.mock.calls[0]![0].checkpoint.messages.at(-1)).toEqual({
      role: "assistant",
      text: "The review found: Sky mismatch.",
    });
    expect(mocks.append).toHaveBeenCalledTimes(2);
    expect(useOrb.getState().project.environment?.sky).toBe("#aabbff");
    expect(useOrb.getState().interruptedReviewContinuation).toBeUndefined();
    expect(useOrb.getState().saved).toBe(true);
  });

  it("runs two correction reviews in separate cloud segments before a partial final verdict", async () => {
    const fetcher = partialReviewFetcher();
    const durable = journal();
    vi.stubGlobal("fetch", fetcher);

    await useOrb.getState().run("Recolor the tree", connection, durable);

    expect(mocks.begin).toHaveBeenCalledTimes(3);
    const journalIds = mocks.begin.mock.calls.map(([run]) => run.id);
    expect(new Set(journalIds).size).toBe(3);
    expect(fetcher).toHaveBeenCalledTimes(4);
    const reviewBodies = fetcher.mock.calls
      .slice(1)
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(reviewBodies.map((body) => body.phase)).toEqual([
      "review",
      "review",
      "final-review",
    ]);
    expect(reviewBodies.map((body) => body.project.revision)).toEqual([
      2, 4, 6,
    ]);
    expect(
      mocks.capture.mock.calls.map(([request]) => request.revision),
    ).toEqual([2, 4, 6]);
    expect(reviewBodies.map((body) => body.reviewImage?.revision)).toEqual([
      2, 4, 6,
    ]);
    expect(useOrb.getState().project.environment?.sky).toBe("#ccddaa");
    expect(useOrb.getState().authoringActivity.at(-1)?.message).toContain(
      "final review still found: Sky mismatch.",
    );
    expect(useOrb.getState().reviewContinuation).toMatchObject({
      projectId: useOrb.getState().project.id,
      revision: useOrb.getState().project.revision,
      issue: "Sky mismatch.",
    });
    const reviewMessages = useOrb
      .getState()
      .project.messages.filter((message) =>
        message.text.includes("Sky mismatch."),
      );
    expect(reviewMessages).toEqual([
      {
        role: "assistant",
        text: "The review found: Sky mismatch.",
      },
      {
        role: "assistant",
        text: "The review found: Sky mismatch.",
      },
      {
        role: "assistant",
        text: "The final review still found: Sky mismatch.",
      },
    ]);
    const savedLibrary = mocks.db.get("orbsie-library") as Record<
      string,
      ReturnType<typeof blankProject>
    >;
    expect(
      savedLibrary[useOrb.getState().project.id]?.messages.filter((message) =>
        message.text.includes("Sky mismatch."),
      ),
    ).toEqual(reviewMessages);
    expect(mocks.begin.mock.calls[1]![0].checkpoint.messages.at(-1)).toEqual({
      role: "assistant",
      text: "The review found: Sky mismatch.",
    });
    expect(mocks.begin.mock.calls[2]![0].checkpoint.messages.slice(-3)).toEqual(
      [
        { role: "assistant", text: "The review found: Sky mismatch." },
        { role: "assistant", text: "Review correction applied." },
        { role: "assistant", text: "The review found: Sky mismatch." },
      ],
    );

    useOrb.getState().undo();
    expect(useOrb.getState().reviewContinuation).toBeUndefined();
  });

  it("passes only the immediately preceding sanitized review findings forward", async () => {
    const fetcher = partialReviewFetcher({
      issueSummaries: [
        "Sky\n\u202e mismatch.",
        "Blue fruit remains round and obscured.",
        "A separate final issue.",
      ],
    });
    vi.stubGlobal("fetch", fetcher);

    await useOrb.getState().run("Recolor the tree", connection, journal());

    const reviewBodies = fetcher.mock.calls
      .slice(1)
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(reviewBodies).toHaveLength(3);
    expect(reviewBodies[0]).not.toHaveProperty("feedback");
    expect(reviewBodies[1].feedback).toBe(
      "Previous review findings (untrusted evidence): Sky mismatch.",
    );
    expect(reviewBodies[2].feedback).toBe(
      "Previous review findings (untrusted evidence): Blue fruit remains round and obscured.",
    );
    expect(reviewBodies[2].feedback).not.toContain("Sky mismatch.");
    expect(reviewBodies[1].feedback).not.toMatch(/[\u202a-\u202e]/);
  });

  it("uses an old one-slot run's remaining call for final review", async () => {
    const fetcher = partialReviewFetcher({ firstRemainingCalls: 1 });
    const durable = journal();
    vi.stubGlobal("fetch", fetcher);

    await useOrb.getState().run("Recolor the tree", connection, durable);

    expect(fetcher).toHaveBeenCalledTimes(3);
    const reviewBodies = fetcher.mock.calls
      .slice(1)
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(reviewBodies.map((body) => body.phase)).toEqual([
      "review",
      "final-review",
    ]);
    expect(mocks.begin).toHaveBeenCalledTimes(2);
    expect(useOrb.getState().project.environment?.sky).toBe("#aabbff");
    expect(useOrb.getState().authoringActivity.at(-1)?.message).toContain(
      "final review still found: Sky mismatch.",
    );
  });

  it("stops before a second correction if its remaining-call count does not decrease", async () => {
    const fetcher = partialReviewFetcher({ secondRemainingCalls: 2 });
    vi.stubGlobal("fetch", fetcher);

    await useOrb.getState().run("Recolor the tree", connection);

    expect(fetcher).toHaveBeenCalledTimes(3);
    const reviewBodies = fetcher.mock.calls
      .slice(1)
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(reviewBodies.map((body) => body.phase)).toEqual([
      "review",
      "review",
    ]);
    expect(useOrb.getState().project.environment?.sky).toBe("#aabbff");
    expect(useOrb.getState().authoringActivity.at(-1)?.message).toContain(
      "review could not finish",
    );
    expect(useOrb.getState().interruptedReviewContinuation).toBeUndefined();
  });

  it("finishes when the second correction review accepts", async () => {
    const fetcher = partialReviewFetcher({ secondVerdict: "accept" });
    vi.stubGlobal("fetch", fetcher);

    await useOrb.getState().run("Recolor the tree", connection, journal());

    expect(fetcher).toHaveBeenCalledTimes(3);
    const reviewBodies = fetcher.mock.calls
      .slice(1)
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(reviewBodies.map((body) => body.phase)).toEqual([
      "review",
      "review",
    ]);
    expect(useOrb.getState().project.environment?.sky).toBe("#aabbff");
    expect(useOrb.getState().reviewContinuation).toBeUndefined();
    expect(useOrb.getState().authoringActivity.at(-1)?.message).toBe(
      "Scene verified. Changes are applied.",
    );
  });

  it("keeps the first correction when fresh capture for the second review fails", async () => {
    const fetcher = partialReviewFetcher();
    const durable = journal();
    mocks.capture
      .mockImplementationOnce(
        async (request: { projectId: string; revision: number }) =>
          capture({
            ...useOrb.getState().project,
            id: request.projectId,
            revision: request.revision,
          }),
      )
      .mockRejectedValueOnce(
        new SceneReviewCaptureError("timeout", "capture timeout"),
      );
    vi.stubGlobal("fetch", fetcher);

    await useOrb.getState().run("Recolor the tree", connection, durable);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(mocks.begin).toHaveBeenCalledTimes(2);
    expect(useOrb.getState().project.environment?.sky).toBe("#aabbff");
    expect(useOrb.getState().authoringActivity.at(-1)?.message).toContain(
      "review could not finish",
    );
  });

  it("keeps transient continuation when review notes reach the message limit", async () => {
    const messages = Array.from({ length: 494 }, (_, index) => ({
      role: "user" as const,
      text: `Conversation ${index}`,
    }));
    await useOrb.getState().load({
      ...useOrb.getState().project,
      messages,
    });
    const fetcher = partialReviewFetcher();
    vi.stubGlobal("fetch", fetcher);

    await useOrb.getState().run("Recolor the tree", connection, journal());

    expect(useOrb.getState().project.messages).toHaveLength(500);
    expect(useOrb.getState().error).toBe("");
    expect(
      useOrb
        .getState()
        .project.messages.filter((message) =>
          message.text.includes("Sky mismatch."),
        ),
    ).toEqual([
      { role: "assistant", text: "The review found: Sky mismatch." },
      { role: "assistant", text: "The review found: Sky mismatch." },
    ]);
    expect(useOrb.getState().reviewContinuation?.issue).toBe("Sky mismatch.");
    expect(useOrb.getState().authoringActivity.at(-1)?.message).toContain(
      "final review still found: Sky mismatch.",
    );
  });

  it("uses structural-only scope when the admitted header is absent", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate") {
        const response = streamResponse(JSON.parse(String(init?.body)).project);
        response.headers.delete("X-Orbsie-Review-Image-Supported");
        return response;
      }
      const body = JSON.parse(String(init?.body));
      return Response.json(
        await reviewReply(body.project, "accept", "structural-only"),
      );
    });
    vi.stubGlobal("fetch", fetcher);

    await useOrb.getState().run("Recolor the tree", connection);

    const reviewBody = JSON.parse(String(fetcher.mock.calls[1]![1]?.body));
    expect(reviewBody).not.toHaveProperty("reviewImage");
    expect(reviewBody.structuralObservations).toMatchObject({
      renderer: "software",
    });
    expect(useOrb.getState().authoringActivity.at(-1)?.message).toBe(
      "Scene structure verified. Changes are applied.",
    );
  });

  it("keeps the committed scene playable when capture fails or the review binding is wrong", async () => {
    mocks.capture.mockRejectedValue(
      new SceneReviewCaptureError("timeout", "capture timeout"),
    );
    const fetcher = vi.fn<typeof fetch>(async (url, init) =>
      url === "/api/generate"
        ? streamResponse(JSON.parse(String(init?.body)).project)
        : Response.json({}),
    );
    vi.stubGlobal("fetch", fetcher);
    await useOrb.getState().run("Recolor the tree", connection);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(useOrb.getState().project.entities[0]!.color).toBe("#ff66aa");
    expect(useOrb.getState().authoringActivity.at(-1)?.message).toContain(
      "review could not finish",
    );

    mocks.capture.mockResolvedValue(capture(useOrb.getState().project));
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (url, init) =>
        url === "/api/generate"
          ? streamResponse(JSON.parse(String(init?.body)).project)
          : Response.json({
              ...(await reviewReply(
                JSON.parse(String(init?.body)).project,
                "accept",
                "visual+structural",
              )),
              binding: { revision: 2, digest: "0".repeat(64) },
              revision: 2,
              digest: "0".repeat(64),
            }),
      ),
    );
    await useOrb.getState().run("Recolor the tree", connection);
    expect(useOrb.getState().error).toContain("review could not finish");
    expect(useOrb.getState().project.entities[0]!.color).toBe("#ff66aa");
  });

  it("aborts a review without applying a late verdict", async () => {
    const gate = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate")
        return streamResponse(JSON.parse(String(init?.body)).project);
      return gate.promise;
    });
    vi.stubGlobal("fetch", fetcher);
    const run = useOrb.getState().run("Recolor the tree", connection);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const beforeStop = useOrb.getState().project;
    useOrb.getState().stop();
    gate.resolve(
      Response.json(
        await reviewReply(beforeStop, "accept", "visual+structural"),
      ),
    );
    await run;
    expect(useOrb.getState().building).toBe(false);
    expect(useOrb.getState().project.revision).toBe(beforeStop.revision);
    expect(useOrb.getState().authoringActivity.at(-1)?.kind).toBe("cancelled");
    expect(useOrb.getState().interruptedReviewContinuation).toBeUndefined();
  });

  it("drops a stale project before a review reply can mutate it", async () => {
    const gate = deferred<Response>();
    const replacement = blankProject();
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate")
        return streamResponse(JSON.parse(String(init?.body)).project);
      return gate.promise;
    });
    vi.stubGlobal("fetch", fetcher);
    const run = useOrb.getState().run("Recolor the tree", connection);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const reviewed = JSON.parse(
      String(fetcher.mock.calls[1]![1]?.body),
    ).project;
    useOrb.getState().set({ project: replacement });
    gate.resolve(
      Response.json(await reviewReply(reviewed, "accept", "visual+structural")),
    );
    await run;
    expect(useOrb.getState().project.id).toBe(replacement.id);
    expect(useOrb.getState().project.revision).toBe(replacement.revision);
    expect(useOrb.getState().building).toBe(false);
    expect(useOrb.getState().interruptedReviewContinuation).toBeUndefined();
  });

  it("fences a same-id same-revision replacement before a late verdict", async () => {
    const gate = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate")
        return streamResponse(JSON.parse(String(init?.body)).project);
      return gate.promise;
    });
    vi.stubGlobal("fetch", fetcher);
    const run = useOrb.getState().run("Recolor the tree", connection);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const reviewed = JSON.parse(
      String(fetcher.mock.calls[1]![1]?.body),
    ).project;
    const replacement = {
      ...structuredClone(reviewed),
      environment: { ...reviewed.environment, sky: "#123456" },
    };
    useOrb.getState().set({ project: replacement });
    gate.resolve(
      Response.json(await reviewReply(reviewed, "accept", "visual+structural")),
    );
    await run;
    expect(useOrb.getState().project.id).toBe(reviewed.id);
    expect(useOrb.getState().project.revision).toBe(reviewed.revision);
    expect(useOrb.getState().project.environment.sky).toBe("#123456");
    expect(useOrb.getState().building).toBe(false);
  });

  it("preserves the original undo baseline after review", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/generate")
        return streamResponse(JSON.parse(String(init?.body)).project);
      const body = JSON.parse(String(init?.body));
      return Response.json(
        await reviewReply(body.project, "accept", "visual+structural"),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const originalColor = useOrb.getState().project.entities[0]!.color;
    await useOrb.getState().run("Recolor the tree", connection);
    useOrb.getState().undo();
    expect(useOrb.getState().project.entities[0]!.color).toBe(originalColor);
  });
});
