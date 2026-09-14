import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ database: vi.fn() }));
vi.mock("../src/lib/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/server/auth")>()),
  database: state.database,
}));

import { withDatabaseTransaction } from "../src/lib/server/trial";

function client() {
  return {
    query: vi.fn(async (_sql: string) => ({ rows: [], rowCount: 0 })),
    release: vi.fn(),
  };
}

function flush() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

describe("database transaction acquisition", () => {
  beforeEach(() => state.database.mockReset());

  it("releases an immediately resolved client when acquisition is pre-aborted", async () => {
    const connection = client();
    state.database.mockReturnValue({
      connect: vi.fn(() => Promise.resolve(connection)),
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      withDatabaseTransaction(async () => "unreachable", {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await flush();

    expect(connection.release).toHaveBeenCalledOnce();
    expect(connection.query).not.toHaveBeenCalled();
  });

  it("releases a client that arrives after an aborted acquisition", async () => {
    let resolveClient!: (value: ReturnType<typeof client>) => void;
    state.database.mockReturnValue({
      connect: vi.fn(
        () =>
          new Promise<ReturnType<typeof client>>((resolve) => {
            resolveClient = resolve;
          }),
      ),
    });
    const controller = new AbortController();
    const operation = withDatabaseTransaction(async () => "unreachable", {
      signal: controller.signal,
    });
    controller.abort();

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    const connection = client();
    resolveClient(connection);
    await flush();

    expect(connection.release).toHaveBeenCalledOnce();
    expect(connection.query).not.toHaveBeenCalled();
  });

  it.each(["acquireTimeoutMs", "lockTimeoutMs", "statementTimeoutMs"] as const)(
    "validates %s before opening a pool connection",
    async (option) => {
      const connect = vi.fn(() => Promise.resolve(client()));
      state.database.mockReturnValue({ connect });

      await expect(
        withDatabaseTransaction(async () => "unreachable", {
          [option]: 0,
        }),
      ).rejects.toThrow(RangeError);

      expect(connect).not.toHaveBeenCalled();
    },
  );

  it("releases a successfully used client exactly once", async () => {
    const connection = client();
    state.database.mockReturnValue({
      connect: vi.fn(async () => connection),
    });

    await expect(withDatabaseTransaction(async () => "done")).resolves.toBe(
      "done",
    );

    expect(connection.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      "COMMIT",
    ]);
    expect(connection.release).toHaveBeenCalledOnce();
  });
});
