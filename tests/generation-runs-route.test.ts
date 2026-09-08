import { beforeEach, expect, it, vi } from "vitest";
const repo = vi.hoisted(() => ({
  startGenerationRun: vi.fn(),
  appendGenerationRun: vi.fn(),
  readGenerationRun: vi.fn(),
  latestGenerationRun: vi.fn(),
  cancelGenerationRun: vi.fn(),
}));
vi.mock("../src/lib/server/generation-runs", async () => ({
  ...(await vi.importActual("../src/lib/server/generation-runs")),
  ...repo,
}));
vi.mock("../src/lib/server/auth", async () => ({
  ...(await vi.importActual("../src/lib/server/auth")),
  requireUser: async () => ({ id: "owner" }),
}));
import { GET, PUT, POST, PATCH } from "../src/app/api/generation-runs/route";
beforeEach(() => {
  Object.values(repo).forEach((fn) => fn.mockReset());
  vi.stubEnv("BETTER_AUTH_URL", "https://orbsie.test");
});
it("rejects cross-origin mutation before journal access", async () => {
  const response = await POST(
    new Request("https://orbsie.test/api/generation-runs", {
      method: "POST",
      headers: { origin: "https://evil.test" },
      body: "{}",
    }),
  );
  expect(response.status).toBe(403);
  expect(repo.startGenerationRun).not.toHaveBeenCalled();
});
it("scopes latest recovery lookup to authenticated owner and disables caching", async () => {
  repo.latestGenerationRun.mockResolvedValue({ id: "run" });
  const response = await GET(
    new Request("https://orbsie.test/api/generation-runs?projectId=world"),
  );
  expect(repo.latestGenerationRun).toHaveBeenCalledWith("owner", "world");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("rejects oversized streamed append without calling the repository", async () => {
  const response = await PUT(
    new Request("https://orbsie.test/api/generation-runs", {
      method: "PUT",
      headers: { origin: "https://orbsie.test" },
      body: " ".repeat(521 * 1024),
    }),
  );
  expect(response.status).toBe(413);
  expect(repo.appendGenerationRun).not.toHaveBeenCalled();
});
it("validates cancellation identity", async () => {
  const response = await PATCH(
    new Request("https://orbsie.test/api/generation-runs", {
      method: "PATCH",
      headers: { origin: "https://orbsie.test" },
      body: JSON.stringify({ runId: "../other" }),
    }),
  );
  expect(response.status).toBe(400);
  expect(repo.cancelGenerationRun).not.toHaveBeenCalled();
});
