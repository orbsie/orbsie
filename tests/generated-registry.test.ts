import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import type { Project } from "../src/lib/protocol";
const query = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/server/auth", async () => ({
  ...(await vi.importActual("../src/lib/server/auth")),
  database: () => ({ query }),
}));
import { requireCloudGeneratedModels } from "../src/lib/server/generated-registry";
const metadata = JSON.parse(
  readFileSync("docs/evidence/local-modeling/report.json", "utf8"),
).metadata;
const project = {
  entities: [{ geometry: { kind: "generated", model: metadata } }],
} as Project;
beforeEach(() => query.mockReset());
it("does not require asset storage for worlds without generated files", async () => {
  expect(
    (
      await requireCloudGeneratedModels("alice", {
        entities: [],
      } as unknown as Project)
    ).size,
  ).toBe(0);
  expect(query).not.toHaveBeenCalled();
});
it("requires ready assets belonging to the saving account", async () => {
  query.mockResolvedValue({ rows: [] });
  await expect(
    requireCloudGeneratedModels("alice", project),
  ).rejects.toMatchObject({ status: 409 });
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("owner_id=$1 AND ready=true"),
    ["alice", [metadata.sha256]],
  );
});
it("returns canonical saved metadata while allowing a different creation timestamp", async () => {
  const saved = { ...metadata, createdAt: "2026-01-01T00:00:00.000Z" };
  query.mockResolvedValue({
    rows: [{ sha256: metadata.sha256, metadata: saved }],
  });
  expect(
    (await requireCloudGeneratedModels("alice", project)).get(metadata.sha256),
  ).toEqual(saved);
});
it("rejects mismatched provenance even for an existing content hash", async () => {
  query.mockResolvedValue({
    rows: [
      {
        sha256: metadata.sha256,
        metadata: { ...metadata, blenderVersion: "different" },
      },
    ],
  });
  await expect(
    requireCloudGeneratedModels("alice", project),
  ).rejects.toMatchObject({ status: 409 });
});
it("rejects unfinished construction before querying storage", async () => {
  await expect(
    requireCloudGeneratedModels("alice", {
      entities: [{ geometry: { kind: "generated" } }],
    } as Project),
  ).rejects.toMatchObject({ status: 409 });
  expect(query).not.toHaveBeenCalled();
});
