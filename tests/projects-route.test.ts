import { beforeEach, describe, expect, it, vi } from "vitest";
import { committed } from "../src/lib/protocol";
import {
  canonicalSnapshotJSON,
  projectSnapshotToken,
} from "../src/lib/server/project-snapshot-token";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  connect: vi.fn(),
  release: vi.fn(),
  user: vi.fn(),
  boundedJSON: vi.fn(),
  checkOrigin: vi.fn(),
  archive: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  requireUser: state.user,
  database: () => ({ query: state.query, connect: state.connect }),
  checkOrigin: state.checkOrigin,
  boundedJSON: state.boundedJSON,
  HttpError: class HttpError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  apiError: (error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : "error" },
      {
        status:
          typeof error === "object" && error && "status" in error
            ? Number(error.status)
            : 500,
      },
    ),
}));
vi.mock("@/lib/server/generated-registry", () => ({
  requireCloudGeneratedModels: vi.fn(),
}));
vi.mock("@/lib/server/storage", () => ({
  archiveProjectSnapshot: state.archive,
}));
vi.mock("@/lib/protocol", async () => import("../src/lib/protocol"));
vi.mock(
  "@/lib/server/project-snapshot-token",
  async () => import("../src/lib/server/project-snapshot-token"),
);

import { GET, PUT } from "../src/app/api/projects/route";

const origin = "http://localhost:3000";
const project = {
  version: 1 as const,
  id: "orb",
  title: "Test world",
  seed: 42,
  revision: 2,
  entities: [],
  environment: { sky: "#dceee9", ground: "#91b977", water: "#59bdbb" },
  messages: [],
};

function row(snapshot = project, overrides: Record<string, unknown> = {}) {
  return {
    id: snapshot.id,
    title: snapshot.title,
    revision: snapshot.revision,
    snapshot,
    updated_at: "2026-09-08T00:00:00.000Z",
    public_url: null,
    publication_revision: null,
    owner_id: "owner",
    ...overrides,
  };
}

function request() {
  return new Request(origin + "/api/projects", {
    method: "PUT",
    headers: { Origin: origin, "Content-Type": "application/json" },
  });
}

function installClient(...responses: Array<{ rows: unknown[] }>) {
  state.clientQuery.mockReset();
  state.clientQuery.mockImplementationOnce(async () => ({ rows: [] }));
  for (const response of responses)
    state.clientQuery.mockImplementationOnce(async () => response);
  state.connect.mockResolvedValue({
    query: state.clientQuery,
    release: state.release,
  });
}

beforeEach(() => {
  state.query.mockReset();
  state.clientQuery.mockReset();
  state.connect.mockReset();
  state.release.mockReset();
  state.user.mockReset();
  state.boundedJSON.mockReset();
  state.checkOrigin.mockReset();
  state.archive.mockReset();
  state.user.mockResolvedValue({ id: "owner" });
  state.archive.mockResolvedValue(null);
});

describe("project snapshot tokens", () => {
  it("canonicalizes object key order before hashing", () => {
    const first = { z: 3, nested: { b: 2, a: 1 }, a: [2, { d: 4, c: 5 }] };
    const second = { a: [2, { c: 5, d: 4 }], nested: { a: 1, b: 2 }, z: 3 };

    expect(canonicalSnapshotJSON(first)).toBe(canonicalSnapshotJSON(second));
    expect(projectSnapshotToken(first)).toBe(projectSnapshotToken(second));
    expect(projectSnapshotToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(projectSnapshotToken({ title: "1" })).not.toBe(
      projectSnapshotToken({ title: "1.0" }),
    );
    expect(projectSnapshotToken({ value: "true" })).not.toBe(
      projectSnapshotToken({ value: true }),
    );
    expect(projectSnapshotToken({ value: "1" })).not.toBe(
      projectSnapshotToken({ value: 1 }),
    );
  });
});

describe("projects route snapshot CAS", () => {
  it("includes the same token from GET that a fresh PUT returns", async () => {
    const oldSnapshot = { ...project, revision: 1 };
    const newSnapshot = { ...project, revision: 2, title: "Updated world" };
    const oldRow = row(oldSnapshot, { revision: 1 });
    state.query.mockResolvedValue({ rows: [oldRow] });
    const getResponse = await GET(new Request(origin + "/api/projects?id=orb"));
    const getBody = await getResponse.json();
    expect(getBody.project.snapshotToken).toBe(
      projectSnapshotToken(oldSnapshot),
    );

    state.boundedJSON.mockResolvedValue({
      project: newSnapshot,
      baseRevision: 1,
      baseSnapshotToken: getBody.project.snapshotToken,
    });
    installClient({ rows: [oldRow] });
    const putResponse = await PUT(request());

    expect(putResponse.status).toBe(200);
    expect(await putResponse.json()).toMatchObject({
      revision: 2,
      snapshotToken: projectSnapshotToken(committed(newSnapshot)),
      archivePending: false,
    });
    expect(state.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE orbs"),
      expect.any(Array),
    );
  });

  it("rejects a stale token even when its base revision is unchanged", async () => {
    const stored = { ...project, revision: 2, title: "Stored" };
    const incoming = { ...project, revision: 3, title: "Incoming" };
    const storedRow = row(stored);
    const latestRow = row(stored);
    state.boundedJSON.mockResolvedValue({
      project: incoming,
      baseRevision: 2,
      baseSnapshotToken: projectSnapshotToken({ ...stored, title: "Stale" }),
    });
    installClient({ rows: [storedRow] }, { rows: [latestRow] });

    const response = await PUT(request());

    expect(response.status).toBe(409);
    expect((await response.json()).conflict.snapshotToken).toBe(
      projectSnapshotToken(stored),
    );
    expect(
      state.clientQuery.mock.calls.some(([sql]) =>
        String(sql).startsWith("UPDATE orbs"),
      ),
    ).toBe(false);
  });

  it("rejects an existing row when the snapshot token is missing", async () => {
    const stored = { ...project, revision: 2 };
    state.boundedJSON.mockResolvedValue({
      project: { ...project, revision: 3 },
      baseRevision: 2,
    });
    installClient({ rows: [row(stored)] }, { rows: [row(stored)] });

    const response = await PUT(request());

    expect(response.status).toBe(409);
    expect(state.clientQuery).toHaveBeenCalledWith("ROLLBACK");
  });

  it("allows a new row with a null base revision and no token", async () => {
    const fresh = { ...project, id: "new-orb", revision: 0 };
    state.boundedJSON.mockResolvedValue({
      project: fresh,
      baseRevision: null,
    });
    installClient({ rows: [] });

    const response = await PUT(request());

    expect(response.status).toBe(200);
    expect((await response.json()).snapshotToken).toBe(
      projectSnapshotToken(committed(fresh)),
    );
    expect(state.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO orbs"),
      expect.any(Array),
    );
  });

  it("rejects a token on a new row because there is no baseline", async () => {
    const fresh = { ...project, id: "new-orb", revision: 0 };
    state.boundedJSON.mockResolvedValue({
      project: fresh,
      baseRevision: null,
      baseSnapshotToken: "a".repeat(64),
    });
    installClient({ rows: [] });

    const response = await PUT(request());

    expect(response.status).toBe(409);
    expect(
      state.clientQuery.mock.calls.some(([sql]) =>
        String(sql).startsWith("INSERT INTO orbs"),
      ),
    ).toBe(false);
  });
});
