import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankProject } from "../src/lib/protocol";
import { archiveProjectSnapshot } from "../src/lib/server/storage";
vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(async () => "test-oidc"),
}));
const transport = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", transport);
  vi.stubEnv("GCS_BUCKET", "test-bucket");
  vi.stubEnv("GCP_WORKLOAD_IDENTITY_PROVIDER", "test-audience");
  transport.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("private project archives", () => {
  it("skips unconfigured storage without contacting a provider", async () => {
    vi.stubEnv("GCS_BUCKET", "");
    expect(await archiveProjectSnapshot("owner", blankProject())).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });
  it("uses create-only content addressing and excludes unknown credential fields", async () => {
    transport.mockImplementation(async (url: string) =>
      url.includes("sts.googleapis.com")
        ? Response.json({ access_token: "test-access" })
        : Response.json({ generation: "123" }),
    );
    const project = { ...blankProject(), apiKey: "must-not-archive" };
    const first = await archiveProjectSnapshot("owner", project);
    const repeated = await archiveProjectSnapshot("owner", project);
    const other = await archiveProjectSnapshot("different-owner", project);
    expect(first).toEqual(repeated);
    expect(other?.object).not.toBe(first?.object);
    const [url, request] = transport.mock.calls[1];
    expect(new URL(url).searchParams.get("ifGenerationMatch")).toBe("0");
    expect(request.body).not.toContain("must-not-archive");
    expect(request.headers.Authorization).toBe("Bearer test-access");
    expect(first?.object).not.toContain("owner");
  });
  it("treats an existing immutable object as success and sanitizes provider errors", async () => {
    transport
      .mockResolvedValueOnce(Response.json({ access_token: "test-access" }))
      .mockResolvedValueOnce(new Response(null, { status: 412 }));
    expect(
      (await archiveProjectSnapshot("owner", blankProject()))?.generation,
    ).toBe("existing");
    transport.mockResolvedValueOnce(
      new Response("sensitive provider details", { status: 403 }),
    );
    await expect(
      archiveProjectSnapshot("owner", blankProject()),
    ).rejects.toThrow("Archive authentication failed.");
  });
});
