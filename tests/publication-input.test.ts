import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock("@/lib/server/auth", async () => ({
  ...(await import("../src/lib/server/auth")),
  requireUser: async () => ({ id: "owner" }),
  database: mock.database,
}));
vi.mock("@/lib/protocol", async () => import("../src/lib/protocol"));
import { POST } from "../src/app/api/publish/route";
beforeEach(() => {
  mock.database.mockReset();
  vi.stubEnv("BETTER_AUTH_URL", "https://orbsie.test");
});
afterEach(() => vi.unstubAllEnvs());
it.each([
  { projectId: "orb", revision: "1" },
  { revision: 1 },
  { projectId: "", revision: 1 },
  { projectId: "orb", revision: -1 },
])(
  "rejects invalid publication input before accessing storage: %j",
  async (body) => {
    const response = await POST(
      new Request("https://orbsie.test/api/publish", {
        method: "POST",
        headers: {
          origin: "https://orbsie.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Check your world and revision before publishing.",
    });
    expect(mock.database).not.toHaveBeenCalled();
  },
);
