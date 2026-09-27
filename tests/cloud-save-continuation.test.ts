import { beforeAll, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import type { Project } from "../src/lib/protocol";
import {
  cloudSaveAcknowledgementKey,
  computeProjectSnapshotToken,
  createCloudSaveAcknowledgement,
  prepareCloudSaveContinuation,
  readCloudSaveAcknowledgement,
  writeCloudSaveAcknowledgement,
} from "../src/lib/cloud-save-continuation";

beforeAll(() => {
  vi.stubGlobal("crypto", webcrypto);
});

function project(overrides: Partial<Project> = {}): Project {
  return {
    version: 1,
    id: "orb-test",
    title: "Tiny island",
    seed: 42,
    revision: 35,
    entities: [],
    environment: { sky: "#dceee9", ground: "#91b977", water: "#59bdbb" },
    messages: [
      { role: "user", text: "create the island" },
      { role: "assistant", text: "created the island" },
    ],
    ...overrides,
  };
}

async function remote(snapshot: Project) {
  return {
    id: snapshot.id,
    revision: snapshot.revision,
    snapshot,
    snapshotToken: await computeProjectSnapshotToken(snapshot),
  };
}

describe("cloud save continuation", () => {
  it("resumes a verified acknowledged ancestor and keeps the longer cloud transcript", async () => {
    const base = project();
    const cloudBase = project({
      messages: [...base.messages, { role: "assistant", text: "saved note" }],
    });
    const local = project({
      revision: 42,
      environment: { ...base.environment, ground: "#80aa66" },
    });
    const cloud = await remote(cloudBase);
    const acknowledgement = await createCloudSaveAcknowledgement(
      cloudBase,
      "account-a",
      cloud.revision,
      cloud.snapshotToken,
    );

    const result = await prepareCloudSaveContinuation({
      accountId: "account-a",
      project: local,
      history: [base],
      acknowledgement,
      remote: cloud,
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.source).toBe("acknowledged-history");
    expect(result.baseline).toEqual({
      revision: 35,
      snapshotToken: cloud.snapshotToken,
    });
    expect(result.project.environment.ground).toBe("#80aa66");
    expect(result.project.messages).toEqual(cloudBase.messages);
  });

  it("migrates a legacy exact-revision history ancestor with an appended transcript", async () => {
    const base = project();
    const cloudBase = project({
      messages: [...base.messages, { role: "assistant", text: "saved note" }],
    });
    const local = project({
      revision: 42,
      environment: { ...base.environment, ground: "#80aa66" },
    });

    const result = await prepareCloudSaveContinuation({
      accountId: "account-a",
      project: local,
      history: [base],
      acknowledgement: null,
      remote: await remote(cloudBase),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.source).toBe("legacy-history");
    expect(result.project.messages).toEqual(cloudBase.messages);
  });

  it("blocks a competing cloud revision even when its project ID is unchanged", async () => {
    const base = project();
    const local = project({
      revision: 42,
      environment: { ...base.environment, ground: "#80aa66" },
    });
    const originalRemote = await remote(base);
    const acknowledgement = await createCloudSaveAcknowledgement(
      base,
      "account-a",
      base.revision,
      originalRemote.snapshotToken,
    );
    const competing = await remote(
      project({ revision: 36, title: "Another cloud edit" }),
    );

    const result = await prepareCloudSaveContinuation({
      accountId: "account-a",
      project: local,
      history: [base],
      acknowledgement,
      remote: competing,
    });

    expect(result).toEqual({
      status: "blocked",
      reason: "cloud-version-changed",
    });
  });

  it("blocks a switched account instead of reusing another account's acknowledgement", async () => {
    const base = project();
    const cloud = await remote(base);
    const acknowledgement = await createCloudSaveAcknowledgement(
      base,
      "account-b",
      base.revision,
      cloud.snapshotToken,
    );

    const result = await prepareCloudSaveContinuation({
      accountId: "account-a",
      project: project({ revision: 42 }),
      history: [base],
      acknowledgement,
      remote: cloud,
    });

    expect(result).toEqual({ status: "blocked", reason: "account-mismatch" });
  });

  it("blocks when local history cannot prove the acknowledged scene is an ancestor", async () => {
    const base = project();
    const cloud = await remote(base);
    const acknowledgement = await createCloudSaveAcknowledgement(
      base,
      "account-a",
      base.revision,
      cloud.snapshotToken,
    );
    const local = project({
      revision: 42,
      environment: { ...base.environment, ground: "#80aa66" },
    });

    const result = await prepareCloudSaveContinuation({
      accountId: "account-a",
      project: local,
      history: [],
      acknowledgement,
      remote: cloud,
    });

    expect(result).toEqual({
      status: "blocked",
      reason: "local-ancestor-unproven",
    });
  });

  it("rejects history entries that are current, future, or out of revision order", async () => {
    const base = project();
    const local = project({
      revision: 42,
      environment: { ...base.environment, ground: "#80aa66" },
    });
    const cloud = await remote(base);
    const cases = [
      [project({ revision: 42 })],
      [project({ revision: 43 })],
      [project({ revision: 38 }), project({ revision: 35 })],
    ];

    for (const history of cases) {
      const result = await prepareCloudSaveContinuation({
        accountId: "account-a",
        project: local,
        history,
        acknowledgement: null,
        remote: cloud,
      });
      expect(result).toEqual({
        status: "blocked",
        reason: "local-ancestor-unproven",
      });
    }
  });

  it("blocks transcript branches whose appended messages cannot be ordered safely", async () => {
    const base = project();
    const cloudBase = project({
      messages: [...base.messages, { role: "assistant", text: "cloud only" }],
    });
    const local = project({
      revision: 42,
      environment: { ...base.environment, ground: "#80aa66" },
      messages: [...base.messages, { role: "assistant", text: "local only" }],
    });
    const cloud = await remote(cloudBase);
    const acknowledgement = await createCloudSaveAcknowledgement(
      cloudBase,
      "account-a",
      cloud.revision,
      cloud.snapshotToken,
    );

    const result = await prepareCloudSaveContinuation({
      accountId: "account-a",
      project: local,
      history: [base],
      acknowledgement,
      remote: cloud,
    });

    expect(result).toEqual({
      status: "blocked",
      reason: "transcript-order-unproven",
    });
  });

  it("stores only account/project-scoped digests and cloud tokens, not message text", async () => {
    const value = project();
    const cloud = await remote(value);
    const acknowledgement = await createCloudSaveAcknowledgement(
      value,
      "account-a",
      value.revision,
      cloud.snapshotToken,
    );
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, content: string) => entries.set(key, content),
    };

    writeCloudSaveAcknowledgement(storage, acknowledgement);

    const key = cloudSaveAcknowledgementKey("account-a", value.id);
    const serialized = entries.get(key)!;
    expect(serialized).not.toContain("create the island");
    expect(
      readCloudSaveAcknowledgement(storage, "account-a", value.id),
    ).toEqual(acknowledgement);
    expect(
      readCloudSaveAcknowledgement(storage, "account-b", value.id),
    ).toBeNull();
  });
});
