import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  session: vi.fn(),
  origin: vi.fn(),
  read: vi.fn(),
  acquire: vi.fn(),
  request: vi.fn(),
  privateOperation: vi.fn(),
  createDurable: vi.fn(),
  durableGenerate: vi.fn(),
  DurableError: class extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
  HttpError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/server/auth", () => ({
  getAuth: mocks.auth,
  checkOrigin: mocks.origin,
  HttpError: mocks.HttpError,
  boundedJSON: (request: Request) => request.json(),
}));
vi.mock("@/lib/server/chatgpt-host-registry", () => ({
  CHATGPT_HOST_IDLE_LIFETIME_MS: 10 * 60 * 1000,
  readChatGPTHost: mocks.read,
}));
vi.mock("@/lib/server/chatgpt-host-manager", () => ({
  createChatGPTHostManager: () => ({
    read: mocks.read,
    acquireForGeneration: mocks.acquire,
    request: mocks.request,
  }),
}));
vi.mock("@/lib/server/chatgpt-durable-service", () => ({
  createChatGPTDurableService: mocks.createDurable,
  ChatGPTDurableServiceError: mocks.DurableError,
}));
vi.mock(
  "@/lib/server/chatgpt-scene-stream",
  () => import("../src/lib/server/chatgpt-scene-stream"),
);
import { POST } from "../src/app/api/chatgpt/generate/route";
import { ChatGPTHostStaleError } from "../src/lib/server/chatgpt-host-service";
const payload = () => ({
  model: "gpt-5.6-luna",
  effort: "low",
  prompt: "Create",
  project: blankProject(),
  browserModeling: true,
});
const request = (
  body: unknown = payload(),
  extraHeaders: Record<string, string> = {},
) =>
  new Request("https://orbsie.test/api/chatgpt/generate", {
    method: "POST",
    headers: {
      origin: "https://orbsie.test",
      "content-type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
describe("hosted ChatGPT generation route", () => {
  beforeEach(() => {
    vi.stubEnv("ORBSIE_CHATGPT_HOSTED", "1");
    vi.stubEnv("ORBSIE_CHATGPT_GENERATION", "1");
    mocks.origin.mockImplementation(() => {});
    mocks.session.mockResolvedValue({
      user: { id: "owner" },
      session: { id: "session" },
    });
    mocks.auth.mockReturnValue({ api: { getSession: mocks.session } });
    mocks.read.mockResolvedValue({
      sandboxName: "private-host",
      capability: "private-token",
      expiresAt: new Date(Date.now() + 60000),
    });
    mocks.acquire.mockResolvedValue({
      sandboxName: "private-host",
      capability: "private-token",
      expiresAt: new Date(Date.now() + 60000),
    });
    mocks.request.mockResolvedValue(
      new Response('{"type":"commit_revision","message":"ready"}\n', {
        headers: { "content-type": "application/x-ndjson" },
      }),
    );
    mocks.durableGenerate.mockResolvedValue(
      new Response('{"type":"commit_revision","message":"ready"}\n', {
        headers: { "content-type": "application/x-ndjson" },
      }).body,
    );
    mocks.createDurable.mockReturnValue({ generate: mocks.durableGenerate });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });
  it("requires explicit generation enablement", async () => {
    vi.stubEnv("ORBSIE_CHATGPT_GENERATION", "0");
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(response.headers.get("x-orbsie-request-id")).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(mocks.auth).not.toHaveBeenCalled();
  });
  it("requires sign-in and a preexisting owned host", async () => {
    mocks.session.mockResolvedValueOnce(null);
    const signedOut = await POST(request());
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toMatchObject({
      code: "CHATGPT_CONNECTION_REQUIRED",
    });
    expect(mocks.acquire).not.toHaveBeenCalled();
    mocks.durableGenerate.mockResolvedValueOnce(null);
    const missingHost = await POST(request());
    expect(missingHost.status).toBe(409);
    expect(await missingHost.json()).toMatchObject({
      code: "CHATGPT_CONNECTION_REQUIRED",
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("fails stale deployed hosts before sending a generation request", async () => {
    mocks.durableGenerate.mockRejectedValueOnce(new ChatGPTHostStaleError());
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "CHATGPT_CONNECTION_STALE",
      error: "Your ChatGPT connection needs an update. Reconnect to continue.",
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("records a durable host admission failure with a bounded status", async () => {
    const events: unknown[] = [];
    const info = vi
      .spyOn(console, "info")
      .mockImplementation((line?: unknown) => {
        if (typeof line === "string") events.push(JSON.parse(line));
      });
    mocks.durableGenerate.mockRejectedValueOnce(
      new mocks.DurableError("busy", "private durable detail"),
    );
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "terminal",
        layer: "route",
        terminalReason: "transport-error",
        failureCode: "host-unavailable",
        httpStatus: 409,
      }),
    );
    expect(JSON.stringify(events)).not.toContain("private durable detail");
    info.mockRestore();
  });
  it("rejects origin failures and caller-supplied owner or capability fields", async () => {
    mocks.origin.mockImplementationOnce(() => {
      throw new mocks.HttpError(403, "Wrong origin");
    });
    expect((await POST(request())).status).toBe(403);
    expect(
      (
        await POST(
          request({ ...payload(), ownerId: "other", capability: "injected" }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("streams generation via the signed-in session and selected model", async () => {
    const clientRunId = "22222222-2222-4222-8222-222222222222";
    const response = await POST(
      request(payload(), { "x-orbsie-client-run-id": clientRunId }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("commit_revision");
    expect(mocks.durableGenerate).toHaveBeenCalledWith(
      {
        ownerId: "owner",
        sessionId: "session",
      },
      expect.objectContaining({
        model: "gpt-5.6-luna",
        effort: "low",
      }),
      expect.any(AbortSignal),
      expect.any(Number),
      expect.objectContaining({
        requestId: expect.any(String),
        clientRunId,
      }),
      undefined,
    );
    expect(response.headers.get("x-orbsie-request-id")).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(mocks.request).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("retains modeling feedback through the hosted route", async () => {
    const modelingFeedback = {
      version: 1 as const,
      projectId: "project-a",
      entityId: "tree-0",
      backend: "browser-manifold" as const,
      nodeId: "compose",
      error:
        "[browser-modeling-kernel] node compose contains touching or overlapping solids.",
    };
    const response = await POST(request({ ...payload(), modelingFeedback }));
    expect(response.status).toBe(200);
    expect(mocks.durableGenerate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ modelingFeedback }),
      expect.anything(),
      expect.any(Number),
      expect.objectContaining({ requestId: expect.any(String) }),
      undefined,
    );
  });
  it("retains project-scoped generation feedback through the hosted route", async () => {
    const project = blankProject();
    const generationFeedback = {
      version: 1 as const,
      projectId: project.id,
      code: "INVALID_SCENE_JSON" as const,
      finishReason: null,
      issues: [],
    };
    const response = await POST(
      request({ ...payload(), project, generationFeedback }),
    );
    expect(response.status).toBe(200);
    expect(mocks.durableGenerate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ generationFeedback }),
      expect.anything(),
      expect.any(Number),
      expect.objectContaining({ requestId: expect.any(String) }),
      undefined,
    );
  });
  it("rejects cross-project generation feedback before contacting the host", async () => {
    const response = await POST(
      request({
        ...payload(),
        generationFeedback: {
          version: 1,
          projectId: "other-project",
          code: "INVALID_SCENE_JSON",
          finishReason: null,
          issues: [],
        },
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.durableGenerate).not.toHaveBeenCalled();
  });
  it("redacts non-stream host failures", async () => {
    mocks.durableGenerate.mockRejectedValueOnce(
      new Error("private provider diagnostic"),
    );
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private provider");
  });
});
