import { readFile } from "node:fs/promises";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  query: vi.fn(),
  write: vi.fn(),
  read: vi.fn(),
  user: vi.fn(),
  release: vi.fn(),
  enabled: true,
}));
vi.mock("../src/lib/server/auth", async () => ({
  ...(await vi.importActual("../src/lib/server/auth")),
  requireUser: state.user,
  database: () => ({
    query: state.query,
    connect: async () => ({ query: state.query, release: state.release }),
  }),
}));
vi.mock("../src/lib/server/generated-storage", () => ({
  writeCloudGeneratedModel: state.write,
  readCloudGeneratedModel: state.read,
  cloudGeneratedModelsEnabled: () => state.enabled,
  CloudGeneratedModelError: class extends Error {},
}));
import { PUT, GET } from "../src/app/api/generated-models/route";
import { HttpError } from "../src/lib/server/auth";
const origin = "http://localhost:3000";
async function payload() {
  const report = JSON.parse(
    await readFile("docs/evidence/local-modeling/report.json", "utf8"),
  );
  return {
    metadata: report.metadata,
    glb: (await readFile("docs/evidence/local-modeling/model.glb")).toString(
      "base64",
    ),
  };
}
const put = (value: unknown) =>
  PUT(
    new Request(origin + "/api/generated-models", {
      method: "PUT",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(value),
    }),
  );
beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", origin);
  state.enabled = true;
  state.query.mockReset();
  state.write.mockReset();
  state.read.mockReset();
  state.user.mockReset();
  state.release.mockReset();
  state.user.mockResolvedValue({ id: "alice" });
  state.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes("count(*)") ? [{ count: 0, bytes: 0 }] : [],
  }));
  state.write.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
it("reserves owner quota before writing and marks ready only after the verified upload", async () => {
  const value = await payload();
  state.write.mockImplementation(async (owner: string) => {
    expect(owner).toBe("alice");
    expect(state.query.mock.calls.some(([sql]) => sql === "COMMIT")).toBe(true);
    expect(
      state.query.mock.calls.some(([sql]) =>
        sql.startsWith("UPDATE generated_models"),
      ),
    ).toBe(false);
  });
  expect((await put(value)).status).toBe(200);
  expect(state.query).toHaveBeenCalledWith(
    expect.stringContaining("UPDATE generated_models"),
    ["alice", value.metadata.sha256],
  );
});
it("retains a pending reservation after storage failure without claiming readiness", async () => {
  state.write.mockRejectedValue(Error("offline"));
  expect((await put(await payload())).status).toBe(500);
  expect(
    state.query.mock.calls.some(([sql]) =>
      sql.startsWith("UPDATE generated_models"),
    ),
  ).toBe(false);
});
it("enforces quota and hash integrity before cloud writes", async () => {
  const value = await payload();
  state.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes("count(*)") ? [{ count: 256, bytes: 0 }] : [],
  }));
  expect((await put(value)).status).toBe(413);
  expect(state.write).not.toHaveBeenCalled();
  expect(
    (
      await put({
        ...value,
        metadata: { ...value.metadata, sha256: "0".repeat(64) },
      })
    ).status,
  ).toBe(400);
  expect(state.write).not.toHaveBeenCalled();
});
it("denies unauthenticated requests and keeps another owner's model unavailable", async () => {
  const value = await payload();
  state.user.mockRejectedValueOnce(new HttpError(401, "Sign in"));
  expect((await put(value)).status).toBe(401);
  expect(state.query).not.toHaveBeenCalled();
  expect(
    (
      await GET(
        new Request(
          origin + "/api/generated-models?hash=" + value.metadata.sha256,
        ),
      )
    ).status,
  ).toBe(404);
  expect(state.query).toHaveBeenCalledWith(
    expect.stringContaining("owner_id=$1"),
    ["alice", value.metadata.sha256],
  );
  expect(state.read).not.toHaveBeenCalled();
});
it("returns private verified assets only for a ready owner record", async () => {
  const value = await payload();
  state.query.mockResolvedValue({ rows: [{ metadata: value.metadata }] });
  state.read.mockResolvedValue({
    metadata: value.metadata,
    glb: new Uint8Array(Buffer.from(value.glb, "base64")),
  });
  const response = await GET(
    new Request(origin + "/api/generated-models?hash=" + value.metadata.sha256),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(state.read).toHaveBeenCalledWith("alice", value.metadata);
});
