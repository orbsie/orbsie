import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { preflightArtifact } from "../scripts/verify-provider-artifact-publication.mjs";

const sources = {
  gateway: {
    path: "docs/evidence/provider-e2e/gateway-reload-recovery/gateway/world.zip",
    provider: "gateway",
    originModel: null,
    projectId: "4a5d7783-c7fd-44e0-bf19-864bab9f9b08",
    revision: 9,
    projectSha256:
      "dca4cd48fcdce89b8a26cc305ae461d3f1d34bad36708224917d52f950e57105",
    sourceDigest:
      "1bf290c0ff72cd4d9412e94f6dbb41fa07d36d6cdae4995ad58216a35829b618",
  },
  openrouter: {
    path: "docs/evidence/provider-e2e/input-game-union-policy/openrouter/world.zip",
    provider: "openrouter",
    originModel: "openai/gpt-5.6-luna",
    projectId: "3be44077-067b-4177-bf63-ad0ed4cc7a8a",
    revision: 8,
    projectSha256:
      "1953b8a4833cf87ccb4ebb8df66bae57c5c5707d2889250abbb4f0889ba5dc47",
    sourceDigest:
      "1376f1c06f0b6b26490de37b5e2f1b48ca88d390129be6f4b10e246014946bf6",
  },
};

async function loadSource(name) {
  return new Uint8Array(await readFile(sources[name].path));
}

describe("provider artifact publication source preflight", () => {
  it.each(Object.entries(sources))(
    "validates the pinned %s fixture and its project/gameplay data",
    async (name, expected) => {
      const artifact = preflightArtifact(await loadSource(name), name);

      expect(artifact).toMatchObject({
        sourceProvider: expected.provider,
        sourceOriginModel: expected.originModel,
        sourceZipPath: expected.path,
        project: {
          id: expected.projectId,
          revision: expected.revision,
          entities: [{ id: "original-tree" }, { id: "original-mushroom" }],
          game: {
            rules: [
              { id: "right-score" },
              { id: "up-win" },
              { id: "left-lose" },
            ],
          },
        },
        sourceProjectSha256: expected.projectSha256,
        sourceDigest: expected.sourceDigest,
      });
    },
  );

  it("keeps the imported one-argument API pinned to Gateway", async () => {
    const artifact = preflightArtifact(await loadSource("gateway"));

    expect(artifact.sourceProvider).toBe("gateway");
    expect(artifact.project.id).toBe(sources.gateway.projectId);
    expect(artifact.sourceDigest).toBe(sources.gateway.sourceDigest);
  });

  it("rejects tampering and selecting the wrong pinned source", async () => {
    const openrouterZip = await loadSource("openrouter");
    expect(() => preflightArtifact(openrouterZip, "gateway")).toThrow(
      "fixture-source-zip-hash",
    );

    openrouterZip[0] ^= 0xff;
    expect(() => preflightArtifact(openrouterZip, "openrouter")).toThrow(
      "fixture-source-zip-hash",
    );
  });

  it("rejects source names outside the allowlist", async () => {
    const gatewayZip = await loadSource("gateway");
    expect(() => preflightArtifact(gatewayZip, "/tmp/world.zip")).toThrow(
      "config-source-invalid",
    );
  });
});
