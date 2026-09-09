import { afterEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({
  options: undefined as any,
  teardown: vi.fn(),
}));
vi.mock("better-auth", () => ({
  betterAuth: (options: unknown) => {
    state.options = options;
    return {};
  },
}));
vi.mock("pg", () => ({ Pool: class {} }));
vi.mock("../src/lib/server/chatgpt-host-manager", () => ({
  createChatGPTHostManager: () => ({ teardownSession: state.teardown }),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  state.teardown.mockReset();
});
async function hook() {
  vi.stubEnv("DATABASE_URL", "postgres://test");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
  (await import("../src/lib/server/auth")).getAuth();
  return state.options.databaseHooks.session.delete.before;
}
test("session deletion awaits owner-scoped host cleanup before allowing database deletion", async () => {
  vi.stubEnv("ORBSIE_CHATGPT_HOSTED", "1");
  let finish!: () => void;
  state.teardown.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  let done = false;
  const before = await hook();
  const pending = before({ id: "session", userId: "owner" }).then(() => {
    done = true;
  });
  await vi.waitFor(() =>
    expect(state.teardown).toHaveBeenCalledWith({
      sessionId: "session",
      ownerId: "owner",
    }),
  );
  expect(done).toBe(false);
  finish();
  await pending;
  expect(done).toBe(true);
});
test("cleanup failure does not prevent session revocation or expose provider errors", async () => {
  vi.stubEnv("ORBSIE_CHATGPT_HOSTED", "1");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  state.teardown.mockRejectedValue(Error("private provider credential"));
  const before = await hook();
  await expect(
    before({ id: "session", userId: "owner" }),
  ).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledOnce();
  expect(JSON.stringify(warn.mock.calls)).not.toContain(
    "private provider credential",
  );
});
test("accounts without hosted ChatGPT enabled do not require its registry", async () => {
  vi.stubEnv("ORBSIE_CHATGPT_HOSTED", "0");
  const before = await hook();
  await before({ id: "session", userId: "owner" });
  expect(state.teardown).not.toHaveBeenCalled();
});
