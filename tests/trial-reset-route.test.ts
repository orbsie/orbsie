import { beforeEach, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({
  user: undefined as { email?: string; name: string } | undefined,
}));
vi.mock("../src/lib/server/auth", async () => {
  const actual = await vi.importActual<
    typeof import("../src/lib/server/auth")
  >("../src/lib/server/auth");
  return {
    ...actual,
    checkOrigin: vi.fn(),
    requireUser: vi.fn(async () => {
      if (!gate.user)
        throw new actual.HttpError(
          401,
          "Sign in to publish or save to your cloud library.",
        );
      return gate.user;
    }),
  };
});
const reset = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/server/trial", async () => ({
  ...(await vi.importActual("../src/lib/server/trial")),
  resetRecentTrialUsage: reset,
}));

const { POST } = await import("../src/app/api/trial/reset-recent/route");

const request = () =>
  new Request("https://orbsie.com/api/trial/reset-recent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  gate.user = undefined;
  reset.mockReset();
  vi.unstubAllEnvs();
});

it("404s signed-out and non-admin callers without running the reset", async () => {
  const signedOut = await POST(request());
  expect(signedOut.status).toBe(401);
  expect(reset).not.toHaveBeenCalled();
  vi.stubEnv("ORBSIE_ADMIN_EMAILS", "owner@orbsie.com");
  gate.user = { email: "visitor@orbsie.test", name: "Visitor" };
  const nonAdmin = await POST(request());
  expect(nonAdmin.status).toBe(404);
  expect(reset).not.toHaveBeenCalled();
});

it("404s when the admin allowlist is not configured even for a plausible email", async () => {
  gate.user = { email: "owner@orbsie.com", name: "Owner" };
  const response = await POST(request());
  expect(response.status).toBe(404);
  expect(reset).not.toHaveBeenCalled();
});

it("clears recent usage and reports counts for an admin session", async () => {
  vi.stubEnv("ORBSIE_ADMIN_EMAILS", "Owner@Orbsie.com, other@orbsie.com");
  gate.user = { email: "owner@orbsie.com", name: "Owner" };
  reset.mockResolvedValue({ cleared: 4, visitors: 3, networks: 1 });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ cleared: 4, visitors: 3, networks: 1 });
  expect(reset).toHaveBeenCalledTimes(1);
});

it("maps database failures to an error response", async () => {
  vi.stubEnv("ORBSIE_ADMIN_EMAILS", "owner@orbsie.com");
  gate.user = { email: "owner@orbsie.com", name: "Owner" };
  reset.mockRejectedValue(new Error("pool exhausted"));
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(reset).toHaveBeenCalledTimes(1);
});
