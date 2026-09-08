import { expect, it } from "vitest";
import {
  PublicationRecoveryError,
  recoverPublicationDeployment,
} from "../src/lib/server/publication-recovery";

const matching = (overrides: Record<string, unknown> = {}) => ({
  id: "deployment-1",
  state: "READY",
  url: "orb.vercel.app",
  meta: {
    orbId: "orb",
    orbRevision: "2",
    artifactDigest: "a".repeat(64),
  },
  ...overrides,
});

function listPages(pages: unknown[]) {
  const calls: URLSearchParams[] = [];
  let index = 0;
  return {
    calls,
    list: async (params: URLSearchParams, _signal?: AbortSignal) => {
      calls.push(new URLSearchParams(params));
      const page = pages[index++];
      if (page instanceof Error) throw page;
      return page;
    },
  };
}

function lookup(
  listDeployments: (
    params: URLSearchParams,
    signal: AbortSignal,
  ) => Promise<unknown>,
  options: Partial<Parameters<typeof recoverPublicationDeployment>[0]> = {},
) {
  return recoverPublicationDeployment({
    orbId: "orb",
    vercelProjectId: "prj_test",
    revision: 2,
    artifactDigest: "a".repeat(64),
    listDeployments,
    ...options,
  });
}

it("reuses an exact accepted deployment found on a later page", async () => {
  const pages = listPages([
    { deployments: [], pagination: { next: 123 } },
    { deployments: [], pagination: { next: 100 } },
    { deployments: [matching()], pagination: { next: null } },
  ]);

  await expect(lookup(pages.list)).resolves.toMatchObject({
    id: "deployment-1",
  });
  expect(pages.calls).toHaveLength(3);
  expect(Object.fromEntries(pages.calls[0])).toEqual({
    projectId: "prj_test",
    limit: "100",
  });
  expect(Object.fromEntries(pages.calls[1])).toEqual({
    projectId: "prj_test",
    limit: "100",
    until: "123",
  });
  expect(pages.calls[2].get("until")).toBe("100");
});

it("returns null after an exhaustive no-match search", async () => {
  const pages = listPages([
    { deployments: [{ meta: { orbId: "other" } }], pagination: { next: 99 } },
    { deployments: [], pagination: { next: null } },
  ]);

  await expect(lookup(pages.list)).resolves.toBeNull();
  expect(pages.calls).toHaveLength(2);
});

it.each(["ERROR", "CANCELED"])(
  "does not reuse a matching %s deployment",
  async (state) => {
    const pages = listPages([
      { deployments: [matching({ state })], pagination: { next: null } },
    ]);

    await expect(lookup(pages.list)).resolves.toBeNull();
  },
);

it("requires every immutable metadata field to match", async () => {
  const pages = listPages([
    {
      deployments: [
        matching({
          meta: {
            orbId: "orb",
            orbRevision: "2",
            artifactDigest: "b".repeat(64),
          },
        }),
        matching({
          meta: {
            orbId: "orb",
            orbRevision: "3",
            artifactDigest: "a".repeat(64),
          },
        }),
        matching({
          meta: {
            orbId: "other",
            orbRevision: "2",
            artifactDigest: "a".repeat(64),
          },
        }),
      ],
      pagination: { next: null },
    },
  ]);

  await expect(lookup(pages.list)).resolves.toBeNull();
});

it.each([
  {
    name: "missing pagination",
    page: { deployments: [] },
  },
  {
    name: "invalid cursor type",
    page: { deployments: [], pagination: { next: true } },
  },
  {
    name: "malformed cursor string",
    page: { deployments: [], pagination: { next: "123.5" } },
  },
  {
    name: "non-positive cursor",
    page: { deployments: [], pagination: { next: 0 } },
  },
  {
    name: "non-integer cursor",
    page: { deployments: [], pagination: { next: 1.5 } },
  },
  {
    name: "invalid deployment list",
    page: { deployments: "not-an-array", pagination: { next: null } },
  },
])("fails closed for $name", async ({ page }) => {
  const pages = listPages([page]);
  await expect(lookup(pages.list)).rejects.toBeInstanceOf(
    PublicationRecoveryError,
  );
});

it("accepts a documented numeric-string timestamp cursor", async () => {
  const pages = listPages([
    { deployments: [], pagination: { next: "123" } },
    { deployments: [], pagination: { next: null } },
  ]);

  await expect(lookup(pages.list)).resolves.toBeNull();
  expect(pages.calls[1].get("until")).toBe("123");
});

it.each([7, 8])("fails closed on a non-advancing cursor %s", async (next) => {
  const pages = listPages([
    { deployments: [], pagination: { next: 7 } },
    { deployments: [], pagination: { next } },
  ]);

  await expect(lookup(pages.list)).rejects.toBeInstanceOf(
    PublicationRecoveryError,
  );
  expect(pages.calls).toHaveLength(2);
});

it("fails closed at the page bound", async () => {
  const pages = listPages(
    Array.from({ length: 5 }, (_, index) => ({
      deployments: [],
      pagination: { next: 100 - index },
    })),
  );

  await expect(lookup(pages.list)).rejects.toBeInstanceOf(
    PublicationRecoveryError,
  );
  expect(pages.calls).toHaveLength(5);
});

it("fails closed on a list network error", async () => {
  const upstream = new Error("socket closed");
  const pages = listPages([upstream]);

  await expect(lookup(pages.list)).rejects.toBeInstanceOf(
    PublicationRecoveryError,
  );
});

it("preserves an identified upstream error for route mapping", async () => {
  const upstream = new Error("rate limited");
  const pages = listPages([upstream]);

  await expect(
    lookup(pages.list, { isUpstreamError: (error) => error === upstream }),
  ).rejects.toBe(upstream);
});

it("fails closed when a matching record lacks deployment identity", async () => {
  const pages = listPages([
    {
      deployments: [matching({ id: undefined, uid: undefined })],
      pagination: { next: null },
    },
  ]);

  await expect(lookup(pages.list)).rejects.toBeInstanceOf(
    PublicationRecoveryError,
  );
});

it("fails closed when a matching record lacks a URL", async () => {
  const pages = listPages([
    {
      deployments: [matching({ url: "" })],
      pagination: { next: null },
    },
  ]);

  await expect(lookup(pages.list)).rejects.toBeInstanceOf(
    PublicationRecoveryError,
  );
});

it("fails closed when a resolved page arrives after abort", async () => {
  const controller = new AbortController();
  const pages = listPages([{ deployments: [], pagination: { next: null } }]);
  const list = async (params: URLSearchParams, signal: AbortSignal) => {
    controller.abort("deadline");
    return pages.list(params, signal);
  };

  await expect(
    lookup(list, { signal: controller.signal }),
  ).rejects.toBeInstanceOf(PublicationRecoveryError);
});
