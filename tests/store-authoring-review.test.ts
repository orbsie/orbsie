import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  append: vi.fn(),
  cancel: vi.fn(),
  begin: vi.fn(),
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
  get: async (key: string) => structuredClone(mocks.db.get(key)),
  update: async (key: string, change: (value: unknown) => unknown) => {
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
) {
  const binding = await createSceneBinding(project);
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
          : [{ summary: "Sky mismatch.", entityIds: [] }],
      corrections: verdict === "accept" ? [] : [correction],
    },
    corrections:
      verdict === "accept"
        ? []
        : [
            correction,
            { type: "commit_revision", message: "Review correction applied." },
          ],
    binding: { revision: binding.revision, digest: binding.digest },
    revision: binding.revision,
    digest: binding.digest,
    scope,
    remainingCalls: verdict === "accept" ? 0 : 1,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function partialReviewFetcher() {
  let reviewCall = 0;
  return vi.fn<typeof fetch>(async (url, init) => {
    if (url === "/api/generate")
      return streamResponse(JSON.parse(String(init?.body)).project);
    const body = JSON.parse(String(init?.body));
    if (reviewCall++ === 0) {
      const response = await reviewReply(
        body.project,
        "revise",
        "visual+structural",
      );
      const runId = "33333333-3333-4333-8333-333333333333";
      const corrected = applyOperation(
        body.project,
        {
          version: 1,
          projectId: body.project.id,
          runId,
          sequence: 1,
          operationId: "44444444-4444-4444-8444-444444444444",
          baseRevision: body.project.revision,
          command: correction,
        },
        { runId, sequence: 0, seen: new Set() },
      ).project;
      const final = applyOperation(
        corrected,
        {
          version: 1,
          projectId: corrected.id,
          runId,
          sequence: 2,
          operationId: "55555555-5555-4555-8555-555555555555",
          baseRevision: corrected.revision,
          command: {
            type: "commit_revision",
            message: "Review correction applied.",
          },
        },
        { runId, sequence: 1, seen: new Set() },
      ).project;
      const binding = await createSceneBinding(final);
      return Response.json({
        ...response,
        binding: { revision: binding.revision, digest: binding.digest },
        revision: binding.revision,
        digest: binding.digest,
      });
    }
    const response = await reviewReply(
      body.project,
      "revise",
      "visual+structural",
    );
    const binding = await createSceneBinding(body.project);
    return Response.json({
      ...response,
      review: { ...response.review, corrections: [] },
      corrections: [],
      binding: { revision: binding.revision, digest: binding.digest },
      revision: binding.revision,
      digest: binding.digest,
      remainingCalls: 0,
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
    expect(summary).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/);
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

  it("starts a new cloud journal segment for corrections and ends partial", async () => {
    const fetcher = partialReviewFetcher();
    const durable = journal();
    vi.stubGlobal("fetch", fetcher);

    await useOrb.getState().run("Recolor the tree", connection, durable);

    expect(mocks.begin).toHaveBeenCalledTimes(2);
    expect(mocks.begin.mock.calls[0]![0].id).not.toBe(
      mocks.begin.mock.calls[1]![0].id,
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(useOrb.getState().project.environment?.sky).toBe("#aabbff");
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

    useOrb.getState().undo();
    expect(useOrb.getState().reviewContinuation).toBeUndefined();
  });

  it("keeps transient continuation when review notes reach the message limit", async () => {
    const messages = Array.from({ length: 496 }, (_, index) => ({
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
      useOrb.getState().project.messages.filter((message) =>
        message.text.includes("Sky mismatch."),
      ),
    ).toEqual([{ role: "assistant", text: "The review found: Sky mismatch." }]);
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
