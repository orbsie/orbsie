import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/server/auth", () => ({
  requireUser: async () => ({ id: "owner" }),
  database: () => mock,
  checkOrigin: vi.fn(),
  boundedJSON: vi.fn(),
  HttpError: class extends Error {},
  apiError: (e: Error) => Response.json({ error: e.message }, { status: 500 }),
}));
vi.mock("@/lib/protocol", async () => import("../src/lib/protocol"));
import { GET } from "../src/app/api/publish/route";
beforeEach(() => {
  mock.query.mockReset();
  process.env.VERCEL_DEPLOY_TOKEN = "test";
  process.env.VERCEL_TEAM_ID = "test";
});
it("atomically labels the confirmed URL with its revision", async () => {
  mock.query.mockResolvedValueOnce({
    rows: [
      {
        deployment_id: "d2",
        public_url: "https://old",
        publication_revision: 2,
        published_revision: 1,
      },
    ],
  });
  mock.query.mockResolvedValueOnce({ rows: [{ published_revision: 2 }] });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ readyState: "READY", url: "new.example" }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 })),
  );
  const response = await GET(
    new Request("https://orbsie.test/api/publish?projectId=orb"),
  );
  expect(await response.json()).toMatchObject({
    state: "READY",
    servedRevision: 2,
    deploymentUrl: "https://new.example",
  });
  expect(mock.query.mock.calls[1][0]).toContain(
    "public_url=$1,published_revision=publication_revision",
  );
  expect(mock.query.mock.calls[1][1]).toEqual([
    "https://new.example",
    "orb",
    "owner",
    "d2",
    2,
  ]);
});
it("does not claim readiness when an in-flight status request loses the deployment compare-and-swap", async () => {
  mock.query.mockResolvedValueOnce({
    rows: [
      { deployment_id: "old", publication_revision: 2, published_revision: 1 },
    ],
  });
  mock.query.mockResolvedValueOnce({ rows: [] });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ readyState: "READY", url: "old.example" }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 })),
  );
  const response = await GET(
    new Request("https://orbsie.test/api/publish?projectId=orb"),
  );
  expect(await response.json()).toEqual({ state: "VERIFYING" });
  expect(mock.query.mock.calls[1][0]).toContain(
    "AND deployment_id=$4 AND publication_revision=$5",
  );
});
it("continues reporting the served revision when a later attempt fails protection checks", async () => {
  mock.query.mockResolvedValueOnce({
    rows: [
      {
        deployment_id: "d2",
        public_url: "https://old",
        publication_revision: 2,
        published_revision: 1,
      },
    ],
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ readyState: "READY", url: "new.example" }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 })),
  );
  const response = await GET(
    new Request("https://orbsie.test/api/publish?projectId=orb"),
  );
  expect(await response.json()).toMatchObject({
    state: "PROTECTED",
    servedRevision: 1,
    deploymentUrl: "https://old",
  });
  expect(mock.query).toHaveBeenCalledTimes(1);
});
