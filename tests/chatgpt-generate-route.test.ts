import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  session: vi.fn(),
  origin: vi.fn(),
  read: vi.fn(),
  request: vi.fn(),
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
  readChatGPTHost: mocks.read,
}));
vi.mock("@/lib/server/chatgpt-host-manager", () => ({
  createChatGPTHostManager: () => ({ request: mocks.request }),
}));
vi.mock(
  "@/lib/server/chatgpt-scene-stream",
  () => import("../src/lib/server/chatgpt-scene-stream"),
);
import { POST } from "../src/app/api/chatgpt/generate/route";
const payload = () => ({
  model: "gpt-5.6-luna",
  effort: "low",
  prompt: "Create",
  project: blankProject(),
  browserModeling: true,
});
const request = (body: unknown = payload()) =>
  new Request("https://orbsie.test/api/chatgpt/generate", {
    method: "POST",
    headers: {
      origin: "https://orbsie.test",
      "content-type": "application/json",
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
    mocks.request.mockResolvedValue(
      new Response('{"type":"commit_revision","message":"ready"}\n', {
        headers: { "content-type": "application/x-ndjson" },
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });
  it("requires explicit generation enablement", async () => {
    vi.stubEnv("ORBSIE_CHATGPT_GENERATION", "0");
    expect((await POST(request())).status).toBe(404);
    expect(mocks.auth).not.toHaveBeenCalled();
  });
  it("requires sign-in and a preexisting owned host", async () => {
    mocks.session.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.read.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(409);
    expect(mocks.request).not.toHaveBeenCalled();
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
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("commit_revision");
    expect(mocks.read).toHaveBeenCalledWith({
      ownerId: "owner",
      sessionId: "session",
    });
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({ capability: "private-token" }),
      "generate",
      expect.objectContaining({
        input: expect.objectContaining({
          model: "gpt-5.6-luna",
          effort: "low",
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("redacts non-stream host failures", async () => {
    mocks.request.mockResolvedValueOnce(
      new Response("private provider diagnostic", { status: 500 }),
    );
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private provider");
  });
});
