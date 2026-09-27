import { expect, it } from "vitest";
import {
  assertLivePublicationOptIn,
  PublicationAcceptanceError,
  republishWorld,
  resumePublicationAcceptance,
  runTerminalReplacementAcceptance,
  runPublicationAcceptance,
} from "../scripts/lib/publication-acceptance.mjs";
import { createPublicationTransport } from "../scripts/lib/publication-transport.mjs";

const world = {
  version: 1,
  id: "publication-harness-fixture",
  title: "A tiny island to share",
  seed: 42,
  revision: 0,
  environment: { sky: "#dceee9", ground: "#91b977", water: "#59bdbb" },
  messages: [],
  entities: [
    {
      id: "crystal-accept",
      label: "Glowing crystal",
      position: [1, 0, 0],
      color: "#a1f0d7",
      scale: [1, 1, 1],
      geometry: { kind: "crystal", detail: "refined" },
      behavior: { type: "collect" },
      stage: "ready",
    },
  ],
};

type FixtureOptions = {
  firstPostStatus?: number;
  protectedFirstPoll?: boolean;
  secondProjectId?: string;
  secondGetProjectId?: string;
  firstPollError?: boolean;
  secondPollError?: boolean;
  omitProjectId?: boolean;
  genericProjectId?: boolean;
  browserReady?: boolean;
  browserCanvas?: boolean;
  browserErrors?: string[];
  secondPostState?: string;
  secondPostStatus?: number;
  secondSnapshotMaterialOverride?: { entityId: string; color: string };
};

function result(body: unknown, status = 200, cookies?: string) {
  return {
    body,
    status,
    ok: status >= 200 && status < 300,
    ...(cookies ? { cookies } : {}),
  };
}

function fixtureTransport(
  options: FixtureOptions = {},
  fixtureWorld = world,
  materialMutation?: { entityId: string; color: string },
) {
  const requests: Array<{
    path: string;
    init: Record<string, unknown>;
    label: string;
  }> = [];
  const publicRequests: string[] = [];
  let firstPolls = 0;
  let secondPolls = 0;
  let firstSnapshot = structuredClone(fixtureWorld);
  firstSnapshot.revision = 1;
  let secondSnapshot = republishWorld(firstSnapshot, materialMutation);
  const transport = {
    requests,
    publicRequests,
    request: async (
      path: string,
      init: Record<string, unknown>,
      label: string,
    ) => {
      requests.push({ path, init, label });
      if (path === "/api/auth/sign-up/email")
        return result({}, 200, "orbsie_session=fixture");
      if (path === "/api/projects") {
        const body = JSON.parse(String(init.body));
        const revision = body.project.revision;
        if (revision === 1)
          return result({ revision: 1, snapshotToken: "a".repeat(64) });
        expect(body.baseRevision).toBe(1);
        expect(body.baseSnapshotToken).toBe("a".repeat(64));
        return result({ revision: 2, snapshotToken: "b".repeat(64) });
      }
      if (path === "/api/publish") {
        const body = JSON.parse(String(init.body));
        const revision = body.revision;
        if (revision === 1 && options.firstPostStatus)
          return result(
            { error: "provider rejected publication" },
            options.firstPostStatus,
          );
        if (revision === 2 && options.secondPostStatus)
          return result(
            { error: "provider rejected replacement" },
            options.secondPostStatus,
          );
        const publication: Record<string, unknown> = {
          state:
            revision === 1
              ? "VERIFYING"
              : (options.secondPostState ?? "BUILDING"),
          servedRevision: revision === 1 ? null : 1,
          url: `/o/${fixtureWorld.id}`,
          deploymentUrl: `https://deployment-${revision}.vercel.app`,
          deploymentId: `deployment-${revision}`,
          vercelProjectId:
            revision === 2
              ? (options.secondProjectId ?? "project-1")
              : "project-1",
        };
        if (options.omitProjectId || options.genericProjectId)
          delete publication.vercelProjectId;
        if (options.genericProjectId) publication.projectId = fixtureWorld.id;
        return result(publication);
      }
      if (path.startsWith("/api/publish?")) {
        const revision = path.includes("projectId=") ? 1 : 1;
        if (options.protectedFirstPoll)
          return result({
            state: "PROTECTED",
            error: "Deployment protection is enabled.",
          });
        if (options.firstPollError)
          return result({
            state: "VERIFYING",
            error: "integrity check failed",
          });
        if (path.includes("publication-harness-fixture")) {
          if (firstPolls++ === 0 && secondPolls === 0) {
            const status: Record<string, unknown> = {
              state: "READY",
              servedRevision: 1,
              url: `/o/${fixtureWorld.id}`,
              deploymentUrl: "https://deployment-1.vercel.app",
              vercelProjectId: "project-1",
            };
            if (options.omitProjectId || options.genericProjectId)
              delete status.vercelProjectId;
            if (options.genericProjectId) status.projectId = fixtureWorld.id;
            return result(status);
          }
          if (secondPolls++ === 0) {
            const status: Record<string, unknown> = {
              state: "BUILDING",
              servedRevision: 1,
              url: `/o/${fixtureWorld.id}`,
              deploymentUrl: "https://deployment-2.vercel.app",
              vercelProjectId: options.secondGetProjectId ?? "project-1",
            };
            if (options.omitProjectId || options.genericProjectId)
              delete status.vercelProjectId;
            if (options.genericProjectId) status.projectId = fixtureWorld.id;
            return result(status);
          }
          if (options.secondPollError)
            return result({
              state: "VERIFYING",
              error: "replacement integrity check failed",
            });
          const status: Record<string, unknown> = {
            state: "READY",
            servedRevision: 2,
            url: `/o/${fixtureWorld.id}`,
            deploymentUrl: "https://deployment-2.vercel.app",
            vercelProjectId: options.secondGetProjectId ?? "project-1",
          };
          if (options.omitProjectId || options.genericProjectId)
            delete status.vercelProjectId;
          if (options.genericProjectId) status.projectId = fixtureWorld.id;
          return result(status);
        }
        throw new Error(`unexpected status path: ${path}`);
      }
      throw new Error(`unexpected request: ${path}`);
    },
    publicGet: async (url: string) => {
      publicRequests.push(url);
      if (url.endsWith("/project.json")) {
        const snapshot = structuredClone(
          url.includes("deployment-1") ? firstSnapshot : secondSnapshot,
        );
        if (
          !url.includes("deployment-1") &&
          options.secondSnapshotMaterialOverride
        ) {
          const entity = snapshot.entities.find(
            (candidate: { id: string }) =>
              candidate.id === options.secondSnapshotMaterialOverride?.entityId,
          );
          if (entity)
            entity.color = options.secondSnapshotMaterialOverride.color;
        }
        return result(JSON.stringify(snapshot));
      }
      return { status: 200, text: "<main></main>" };
    },
    browserReady: async () => ({
      status: 200,
      ready: options.browserReady ?? true,
      canvas: options.browserCanvas ?? true,
      pageErrors: options.browserErrors ?? [],
    }),
  };
  return transport;
}

function resumeFixtureTransport(statusBody: Record<string, unknown>) {
  const firstWorld = structuredClone(world);
  firstWorld.revision = 1;
  const secondWorld = republishWorld(firstWorld);
  const requests: string[] = [];
  return {
    requests,
    request: async (
      path: string,
      _init: Record<string, unknown>,
      _label: string,
    ) => {
      requests.push(path);
      if (path === "/api/auth/sign-in/email")
        return result({}, 200, "orbsie_session=fixture");
      if (path.startsWith("/api/publish?")) return result(statusBody);
      throw new Error(`unexpected resume request: ${path}`);
    },
    publicGet: async (url: string) => {
      if (url.endsWith("/project.json")) {
        const snapshot = url.includes("deployment-1")
          ? firstWorld
          : secondWorld;
        return result(JSON.stringify(snapshot));
      }
      return { status: 200, text: "<main></main>" };
    },
    browserReady: async () => ({
      status: 200,
      ready: true,
      canvas: true,
      pageErrors: [],
    }),
  };
}

function terminalReplacementTransport(
  options: {
    state?: "ERROR" | "CANCELED" | "READY";
    projectId?: string;
    servedRevision?: number;
  } = {},
) {
  const requests: string[] = [];
  let polls = 0;
  const firstWorld = structuredClone(world);
  firstWorld.revision = 1;
  return {
    requests,
    request: async (
      path: string,
      _init: Record<string, unknown>,
      _label: string,
    ) => {
      requests.push(path);
      if (!path.startsWith("/api/publish?"))
        throw new Error(`unexpected terminal replacement request: ${path}`);
      polls += 1;
      return result({
        state: polls === 1 ? "BUILDING" : (options.state ?? "ERROR"),
        servedRevision: options.servedRevision ?? 1,
        deploymentUrl:
          polls === 1
            ? "https://deployment-2.vercel.app"
            : "https://deployment-1.vercel.app",
        deploymentId: polls === 1 ? "deployment-2" : "deployment-2",
        vercelProjectId: options.projectId ?? "project-1",
      });
    },
    publicGet: async (url: string) => {
      if (url.endsWith("/project.json"))
        return result(JSON.stringify(firstWorld));
      return result("<main></main>");
    },
    browserReady: async () => ({
      status: 200,
      ready: true,
      canvas: true,
      pageErrors: [],
    }),
  };
}

const terminalFirstWorld = structuredClone(world);
terminalFirstWorld.revision = 1;
const terminalFirstRelease = {
  deploymentId: "deployment-1",
  deploymentUrl: "https://deployment-1.vercel.app",
  vercelProjectId: "project-1",
};
const terminalSecondSubmission = {
  state: "BUILDING",
  deploymentId: "deployment-2",
  deploymentUrl: "https://deployment-2.vercel.app",
  vercelProjectId: "project-1",
};

it("uses browser readiness instead of raw HTML data-ready markup", async () => {
  const transport = fixtureTransport();
  const report = await runPublicationAcceptance({
    transport,
    world,
    email: "fixture@example.test",
    password: "fixture-password",
    pollDelayMs: 0,
    sleep: async () => undefined,
  });

  expect(report.first.signedOutSnapshot).toMatchObject({
    revision: 1,
    title: world.title,
  });
  expect(transport.publicRequests).toContain("https://deployment-1.vercel.app");
});

it("fails signed-out acceptance when the browser reports page errors", async () => {
  const transport = fixtureTransport({ browserErrors: ["render failed"] });
  const progress: unknown[] = [];
  await expect(
    runPublicationAcceptance({
      transport,
      world,
      email: "fixture@example.test",
      password: "fixture-password",
      onProgress: async (snapshot) => {
        progress.push(snapshot);
      },
      pollDelayMs: 0,
      sleep: async () => undefined,
    }),
  ).rejects.toThrow(/page error/);
  const last = progress.at(-1) as {
    steps: Array<Record<string, unknown>>;
  };
  expect(last.steps).toContainEqual(
    expect.objectContaining({
      step: "publish revision 1",
      deploymentId: "deployment-1",
      deploymentUrl: "https://deployment-1.vercel.app",
      vercelProjectId: "project-1",
    }),
  );
});

it("preserves sanitized publish evidence through an early failure", async () => {
  const transport = fixtureTransport({ firstPostStatus: 403 });
  const progress: unknown[] = [];
  await expect(
    runPublicationAcceptance({
      transport,
      world,
      email: "fixture@example.test",
      password: "fixture-password",
      onProgress: async (snapshot) => {
        progress.push(snapshot);
      },
      pollDelayMs: 0,
      sleep: async () => undefined,
    }),
  ).rejects.toMatchObject({ status: 403 });
  const last = progress.at(-1) as {
    account: { email: string };
    world: { id: string };
    last: {
      step: string;
      status: number;
    };
  };
  expect(last.account.email).toBe("fixture@example.test");
  expect(last.world.id).toBe(world.id);
  expect(last.last).toMatchObject({ step: "publish revision 1", status: 403 });
  expect(JSON.stringify(last)).not.toContain("fixture-password");
});

it("requires an explicit live gate before the harness can run", () => {
  expect(() => assertLivePublicationOptIn({ NODE_ENV: "test" })).toThrow(
    "ORBSIE_LIVE_E2E=1",
  );
  expect(() =>
    assertLivePublicationOptIn({ NODE_ENV: "test", ORBSIE_LIVE_E2E: "1" }),
  ).not.toThrow();
});

it("preserves the first-publish path when republish is unset", async () => {
  const transport = fixtureTransport();
  const report = await runPublicationAcceptance({
    transport,
    world,
    email: "fixture@example.test",
    password: "fixture-password",
    pollDelayMs: 0,
    sleep: async () => undefined,
  });

  expect(report.republish).toBeNull();
  expect(report.first).toMatchObject({
    revision: 1,
    title: world.title,
    deploymentId: "deployment-1",
    vercelProjectId: "project-1",
    signedOutSnapshot: { revision: 1, title: world.title },
  });
  expect(
    transport.requests.filter((entry) => entry.path === "/api/projects"),
  ).toHaveLength(1);
  expect(
    transport.requests.filter((entry) => entry.path === "/api/publish"),
  ).toHaveLength(1);
});

it.each(["ERROR", "CANCELED"] as const)(
  "accepts %s replacement failure while proving exact old release continuity",
  async (state) => {
    const transport = terminalReplacementTransport({ state });
    const progress: unknown[] = [];
    const report = await runTerminalReplacementAcceptance({
      transport,
      cookies: "orbsie_session=fixture",
      projectId: terminalFirstWorld.id,
      firstRelease: terminalFirstRelease,
      firstWorld: terminalFirstWorld,
      secondSubmission: terminalSecondSubmission,
      pollDelayMs: 0,
      sleep: async () => undefined,
      onProgress: async (snapshot) => {
        progress.push(snapshot);
      },
    });

    expect(report).toMatchObject({
      state,
      replacementSucceeded: false,
      status: {
        deploymentId: "deployment-2",
        deploymentUrl: "https://deployment-1.vercel.app",
        servedRevision: 1,
        vercelProjectId: "project-1",
      },
      oldRelease: {
        snapshot: terminalFirstWorld,
      },
    });
    expect(progress.at(-1)).toMatchObject({
      last: {
        step: "previous public release after terminal replacement snapshot",
      },
    });
    expect(transport.requests).toHaveLength(2);
  },
);

it("rejects a terminal replacement check when owner status is READY", async () => {
  const transport = terminalReplacementTransport({ state: "READY" });
  await expect(
    runTerminalReplacementAcceptance({
      transport,
      cookies: "orbsie_session=fixture",
      projectId: terminalFirstWorld.id,
      firstRelease: terminalFirstRelease,
      firstWorld: terminalFirstWorld,
      secondSubmission: terminalSecondSubmission,
      maxPolls: 2,
      pollDelayMs: 0,
    }),
  ).rejects.toThrow(/READY.*replacement failure/);
});

it("rejects terminal replacement status mapped to another Vercel project", async () => {
  const transport = terminalReplacementTransport({ projectId: "project-2" });
  await expect(
    runTerminalReplacementAcceptance({
      transport,
      cookies: "orbsie_session=fixture",
      projectId: terminalFirstWorld.id,
      firstRelease: terminalFirstRelease,
      firstWorld: terminalFirstWorld,
      secondSubmission: terminalSecondSubmission,
      pollDelayMs: 0,
    }),
  ).rejects.toThrow(/same Vercel project|status Vercel project mapping/);
});

it("rejects terminal replacement status that serves the new revision", async () => {
  const transport = terminalReplacementTransport({ servedRevision: 2 });
  await expect(
    runTerminalReplacementAcceptance({
      transport,
      cookies: "orbsie_session=fixture",
      projectId: terminalFirstWorld.id,
      firstRelease: terminalFirstRelease,
      firstWorld: terminalFirstWorld,
      secondSubmission: terminalSecondSubmission,
      pollDelayMs: 0,
    }),
  ).rejects.toThrow(/original served revision/);
});

it("saves revision 2 with CAS, retains the queued release, and verifies the final snapshot", async () => {
  const transport = fixtureTransport();
  const report = await runPublicationAcceptance({
    transport,
    world,
    email: "fixture@example.test",
    password: "fixture-password",
    republish: true,
    pollDelayMs: 0,
    sleep: async () => undefined,
  });

  expect(report.republish).toMatchObject({
    revision: 2,
    title: "A tiny island to share — Sunset crystal garden",
    materialColor: "#ff8f6b",
    vercelProjectId: "project-1",
    deploymentId: "deployment-2",
    servedRevision: 2,
    previousRelease: { revision: 1, title: world.title },
    pendingWindow: {
      observed: true,
      state: "BUILDING",
      servedRevision: 1,
      previousRelease: {
        deploymentId: "deployment-1",
        deploymentUrl: "https://deployment-1.vercel.app",
        browser: { ready: true, canvas: true },
        snapshot: { revision: 1, title: world.title },
      },
    },
    finalSnapshot: {
      revision: 2,
      title: "A tiny island to share — Sunset crystal garden",
    },
  });
  const saves = transport.requests.filter(
    (entry) => entry.path === "/api/projects",
  );
  expect(saves).toHaveLength(2);
  expect(JSON.parse(String(saves[1].init.body))).toMatchObject({
    baseRevision: 1,
    baseSnapshotToken: "a".repeat(64),
    project: {
      revision: 2,
      title: "A tiny island to share — Sunset crystal garden",
    },
  });
});

it("republishes an explicitly selected material and checks that same entity in signed-out snapshots", async () => {
  const materialMutation = { entityId: "crystal-1", color: "#ff8f6b" };
  const worldWithCrystal1 = structuredClone(world);
  worldWithCrystal1.entities.push({
    ...structuredClone(world.entities[0]),
    id: "crystal-1",
    color: "#56eaff",
  });
  const transport = fixtureTransport({}, worldWithCrystal1, materialMutation);
  const report = await runPublicationAcceptance({
    transport,
    world: worldWithCrystal1,
    email: "fixture@example.test",
    password: "fixture-password",
    republish: true,
    materialMutation,
    pollDelayMs: 0,
    sleep: async () => undefined,
  });

  expect(report.first.signedOutSnapshot.entities).toContainEqual(
    expect.objectContaining({ id: "crystal-1", color: "#56eaff" }),
  );
  expect(report.republish).toMatchObject({
    materialEntityId: "crystal-1",
    materialColor: "#ff8f6b",
    pendingWindow: {
      previousRelease: {
        snapshot: {
          revision: 1,
          entities: expect.arrayContaining([
            expect.objectContaining({ id: "crystal-1", color: "#56eaff" }),
          ]),
        },
      },
    },
    finalSnapshot: {
      revision: 2,
      entities: expect.arrayContaining([
        expect.objectContaining({ id: "crystal-1", color: "#ff8f6b" }),
      ]),
    },
  });
  const saves = transport.requests.filter(
    (entry) => entry.path === "/api/projects",
  );
  const revision2 = JSON.parse(String(saves[1].init.body));
  expect(
    revision2.project.entities.find(
      (entity: { id: string }) => entity.id === "crystal-1",
    ).color,
  ).toBe("#ff8f6b");
  expect(
    worldWithCrystal1.entities.find((entity) => entity.id === "crystal-1")
      ?.color,
  ).toBe("#56eaff");
});

it("rejects a signed-out replacement snapshot with the wrong selected material", async () => {
  const materialMutation = { entityId: "crystal-1", color: "#ff8f6b" };
  const worldWithCrystal1 = structuredClone(world);
  worldWithCrystal1.entities.push({
    ...structuredClone(world.entities[0]),
    id: "crystal-1",
    color: "#56eaff",
  });
  const transport = fixtureTransport(
    {
      secondSnapshotMaterialOverride: {
        entityId: "crystal-1",
        color: "#56eaff",
      },
    },
    worldWithCrystal1,
    materialMutation,
  );

  await expect(
    runPublicationAcceptance({
      transport,
      world: worldWithCrystal1,
      email: "fixture@example.test",
      password: "fixture-password",
      republish: true,
      materialMutation,
      pollDelayMs: 0,
      sleep: async () => undefined,
    }),
  ).rejects.toThrow("final public release entity crystal-1 material");
});

it("checks the previous release after a failed replacement without polling or retrying", async () => {
  const transport = fixtureTransport({ secondPostStatus: 502 });
  const progress: unknown[] = [];
  await expect(
    runPublicationAcceptance({
      transport,
      world,
      email: "fixture@example.test",
      password: "fixture-password",
      republish: true,
      onProgress: async (snapshot) => {
        progress.push(snapshot);
      },
      pollDelayMs: 0,
      sleep: async () => undefined,
    }),
  ).rejects.toMatchObject({ status: 502 });

  expect(
    transport.requests.filter((entry) =>
      entry.path.startsWith("/api/publish?"),
    ),
  ).toHaveLength(1);
  const last = progress.at(-1) as {
    last: {
      failedReplacement: {
        previousRelease: {
          deploymentId: string;
          deploymentUrl: string;
          browser: { ready: boolean; canvas: boolean };
          snapshot: { revision: number; title: string };
        };
      };
    };
  };
  expect(last.last.failedReplacement.previousRelease).toMatchObject({
    deploymentId: "deployment-1",
    deploymentUrl: "https://deployment-1.vercel.app",
    browser: { ready: true, canvas: true },
    snapshot: { revision: 1, title: world.title },
  });
});

it("records an unobserved pending window when revision 2 is already ready", async () => {
  const transport = fixtureTransport({ secondPostState: "READY" });
  const progress: unknown[] = [];
  await expect(
    runPublicationAcceptance({
      transport,
      world,
      email: "fixture@example.test",
      password: "fixture-password",
      republish: true,
      onProgress: async (snapshot) => {
        progress.push(snapshot);
      },
      pollDelayMs: 0,
      sleep: async () => undefined,
    }),
  ).rejects.toThrow(/previous-release window/);

  const last = progress.at(-1) as {
    last: {
      pendingWindow: {
        observed: boolean;
        state: string;
        servedRevision: number;
      };
    };
  };
  expect(last.last.pendingWindow).toEqual({
    observed: false,
    state: "READY",
    servedRevision: 1,
    note: expect.stringContaining("already terminal"),
  });
  expect(
    transport.requests.filter((entry) =>
      entry.path.startsWith("/api/publish?"),
    ),
  ).toHaveLength(1);
});

it("persists pending-window evidence before a later replacement poll failure", async () => {
  const transport = fixtureTransport({ secondPollError: true });
  const progress: unknown[] = [];
  await expect(
    runPublicationAcceptance({
      transport,
      world,
      email: "fixture@example.test",
      password: "fixture-password",
      republish: true,
      onProgress: async (snapshot) => {
        progress.push(snapshot);
      },
      pollDelayMs: 0,
      sleep: async () => undefined,
    }),
  ).rejects.toThrow(/integrity check failed/);

  const last = progress.at(-1) as {
    steps: Array<{
      pendingWindow?: {
        observed: boolean;
        state: string;
        servedRevision: number;
      };
    }>;
  };
  expect(last.steps).toContainEqual(
    expect.objectContaining({
      pendingWindow: expect.objectContaining({
        observed: true,
        state: "BUILDING",
        servedRevision: 1,
      }),
    }),
  );
});

it("accepts Vercel INITIALIZING as a legitimate pending revision-2 state", async () => {
  const transport = fixtureTransport({ secondPostState: "INITIALIZING" });
  const report = await runPublicationAcceptance({
    transport,
    world,
    email: "fixture@example.test",
    password: "fixture-password",
    republish: true,
    pollDelayMs: 0,
    sleep: async () => undefined,
  });

  expect(report.republish).toMatchObject({
    deploymentId: "deployment-2",
    servedRevision: 2,
  });
});

it("resumes an existing ready revision with read-only status and public checks", async () => {
  const transport = resumeFixtureTransport({
    state: "READY",
    servedRevision: 2,
    deploymentUrl: "https://deployment-2.vercel.app",
    vercelProjectId: "project-1",
  });
  const firstWorld = structuredClone(world);
  firstWorld.revision = 1;
  const secondWorld = republishWorld(firstWorld);
  const report = await resumePublicationAcceptance({
    transport,
    projectId: world.id,
    email: "fixture@example.test",
    password: "fixture-password",
    expectedVercelProjectId: "project-1",
    firstRelease: {
      deploymentId: "deployment-1",
      deploymentUrl: "https://deployment-1.vercel.app",
      vercelProjectId: "project-1",
    },
    secondRelease: {
      deploymentId: "deployment-2",
      deploymentUrl: "https://deployment-2.vercel.app",
      vercelProjectId: "project-1",
    },
    firstWorld,
    secondWorld,
  });

  expect(report.pendingWindow).toMatchObject({
    observed: false,
    state: "READY",
  });
  expect(report.oldRelease.snapshot).toMatchObject({ revision: 1 });
  expect(report.finalRelease).not.toBeNull();
  expect(report.finalRelease!.snapshot).toMatchObject({
    revision: 2,
    title: secondWorld.title,
  });
  expect(transport.requests).toEqual([
    "/api/auth/sign-in/email",
    `/api/publish?projectId=${world.id}`,
  ]);
});

it("uses the production Origin header for resume sign-in and bounds status reads", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return {
      status: 200,
      ok: true,
      text: async () => "{}",
    };
  };
  const transport = createPublicationTransport(
    "https://orbsie.com",
    fakeFetch as unknown as typeof fetch,
  );
  await transport.request(
    "/api/auth/sign-in/email",
    { method: "POST", body: "{}" },
    "resume sign-in",
  );
  await transport.request(
    "/api/publish?projectId=publication-harness-fixture",
    { cookie: "orbsie_session=fixture" },
    "resume publication status",
  );

  expect(calls).toHaveLength(2);
  expect(calls[0]).toMatchObject({
    url: "https://orbsie.com/api/auth/sign-in/email",
    init: {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://orbsie.com",
      },
    },
  });
  expect(calls[1]).toMatchObject({
    url: "https://orbsie.com/api/publish?projectId=publication-harness-fixture",
    init: {
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://orbsie.com",
        Cookie: "orbsie_session=fixture",
      },
    },
  });
  expect(
    calls.some(
      ({ url, init }) =>
        url.endsWith("/api/projects") ||
        (init.method === "POST" && url.includes("/api/publish")),
    ),
  ).toBe(false);
});

it.each([401, 403, 429])(
  "fails fast on a publication HTTP %s without polling repeatedly",
  async (status) => {
    const transport = fixtureTransport({ firstPostStatus: status });
    await expect(
      runPublicationAcceptance({
        transport,
        world,
        email: "fixture@example.test",
        password: "fixture-password",
        pollDelayMs: 0,
        sleep: async () => undefined,
      }),
    ).rejects.toMatchObject({ status });
    expect(
      transport.requests.filter((entry) =>
        entry.path.startsWith("/api/publish?"),
      ).length,
    ).toBe(0);
  },
);

it("fails fast when status polling reports deployment protection or an error", async () => {
  for (const options of [
    { protectedFirstPoll: true },
    { firstPollError: true },
  ]) {
    const transport = fixtureTransport(options);
    await expect(
      runPublicationAcceptance({
        transport,
        world,
        email: "fixture@example.test",
        password: "fixture-password",
        pollDelayMs: 0,
        sleep: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(PublicationAcceptanceError);
    expect(
      transport.requests.filter((entry) =>
        entry.path.startsWith("/api/publish?"),
      ).length,
    ).toBe(1);
  }
});

it("rejects a republish response that maps revision 2 to another Vercel project", async () => {
  const transport = fixtureTransport({ secondProjectId: "project-2" });
  await expect(
    runPublicationAcceptance({
      transport,
      world,
      email: "fixture@example.test",
      password: "fixture-password",
      republish: true,
      pollDelayMs: 0,
      sleep: async () => undefined,
    }),
  ).rejects.toThrow(/same Vercel project/);
  expect(transport.publicRequests).toHaveLength(2);
});

it("rejects a ready GET response that maps revision 2 to another Vercel project", async () => {
  const transport = fixtureTransport({ secondGetProjectId: "project-2" });
  await expect(
    runPublicationAcceptance({
      transport,
      world,
      email: "fixture@example.test",
      password: "fixture-password",
      republish: true,
      pollDelayMs: 0,
      sleep: async () => undefined,
    }),
  ).rejects.toThrow(/GET\/POST Vercel project mapping/);
});

it("fails closed when the publication API does not expose a Vercel project identity", async () => {
  const transport = fixtureTransport({ omitProjectId: true });
  await expect(
    runPublicationAcceptance({
      transport,
      world,
      email: "fixture@example.test",
      password: "fixture-password",
      republish: true,
      pollDelayMs: 0,
      sleep: async () => undefined,
    }),
  ).rejects.toThrow(/both POST and GET must expose vercelProjectId/);
});

it("does not treat the Orb projectId field as a Vercel project identity", async () => {
  const transport = fixtureTransport({ genericProjectId: true });
  await expect(
    runPublicationAcceptance({
      transport,
      world,
      email: "fixture@example.test",
      password: "fixture-password",
      republish: true,
      pollDelayMs: 0,
      sleep: async () => undefined,
    }),
  ).rejects.toThrow(/both POST and GET must expose vercelProjectId/);
});
