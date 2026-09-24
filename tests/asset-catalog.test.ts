import { describe, expect, it } from "vitest";
import {
  assetFilePathFor,
  assetManifest,
  assetPathFor,
  assetPromptCatalog,
  assetUrlFor,
  assertLocalAssetPath,
  catalogAssetIds,
  catalogAssets,
  findCatalogAsset,
  promptCatalogForPolicy,
  requireCatalogAsset,
} from "../src/lib/asset-catalog";

describe("local 3D asset catalog", () => {
  it("keeps the typed IDs in lockstep with the checked-in manifest", () => {
    expect(catalogAssetIds).toEqual(catalogAssets.map(({ id }) => id));
    expect(assetManifest.policy.rejectUnknownAssetIds).toBe(true);
    expect(assetManifest.policy.rejectRemoteAssetUrls).toBe(true);
    expect(
      catalogAssets.every((asset) => asset.path.startsWith("/models/")),
    ).toBe(true);
  });

  it("resolves only known local paths and exposes compact prompt metadata", () => {
    const tree = requireCatalogAsset("kenney.nature.tree-default");
    expect(assetPathFor(tree.id)).toBe(tree.path);
    expect(assetUrlFor(tree.id)).toBe(tree.path);
    expect(assetFilePathFor(tree.id, "public")).toBe(
      "public/models/kenney/nature-kit/tree_default.glb",
    );
    expect(assetPromptCatalog).toHaveLength(catalogAssets.length);
    expect(assetPromptCatalog[0]).toMatchObject({
      id: tree.id,
      keywords: expect.arrayContaining(["tree"]),
    });
    for (const asset of catalogAssets) {
      const prompt = assetPromptCatalog.find(({ id }) => id === asset.id)!;
      expect(prompt.bounds.min).toHaveLength(3);
      expect(prompt.bounds.max).toHaveLength(3);
      for (let axis = 0; axis < 3; axis += 1) {
        expect(prompt.bounds.min[axis]).toBeLessThanOrEqual(
          asset.bounds.min[axis],
        );
        expect(prompt.bounds.max[axis]).toBeGreaterThanOrEqual(
          asset.bounds.max[axis],
        );
      }
      expect(prompt.origin).toBe(asset.bounds.origin);
      expect(prompt.scale).toEqual({
        axis: asset.scale.axis,
        units: asset.scale.units,
        sourceToRuntime: asset.scale.sourceToRuntime,
      });
    }
    expect(promptCatalogForPolicy("new-only")).toEqual([]);
    expect(findCatalogAsset("not-in-the-catalog")).toBeUndefined();
  });

  it("admits the reviewed textured Asset Quest Fly Agaric with local provenance", () => {
    const mushroom = requireCatalogAsset(
      "assetquest.mushroom.fly-agaric-basic",
    );
    expect(mushroom).toMatchObject({
      path: "/models/assetquest/fly_agaric_basic_textured.glb",
      sizeBytes: 271396,
      sha256:
        "3bb6e9fcabd6b4f88587305943a7f1012eb570fb47f7f6bdd66299b3ac7640f4",
      tags: expect.arrayContaining([
        "mushroom",
        "fly-agaric",
        "amanita-muscaria",
      ]),
      gltf: { nodes: 1, textureCount: 1, embeddedTextures: true },
      bounds: {
        min: [-0.391526460647583, 0, -0.391526460647583],
        max: [0.391526460647583, 1, 0.391526460647583],
      },
    });
    expect(assetManifest.policy.explicitNewOverridesCatalog).toBe(true);
    expect(promptCatalogForPolicy("new-only")).toEqual([]);
    expect(assetManifest.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "assetquest-low-poly-mushroom-kit",
          sourcePageUrl:
            "https://opengameart.org/content/low-poly-mushroom-kit",
          archive: expect.objectContaining({
            fileName: "free_mushroom_pack_assetquest.zip",
            sha256:
              "b32c4bf0c9d5471ffcde83747402d0f8355add48c317f9147950c4f44facaffd",
          }),
          license: expect.objectContaining({
            textSha256:
              "ad0c0abda67dae90291d8d6e2fcb07c841bb210cdedfa9dfdedae605bd8f66c6",
          }),
        }),
      ]),
    );
  });

  it.each([
    ["unknown ID", () => requireCatalogAsset("tree.glb")],
    [
      "remote ID-shaped URL",
      () => assetPathFor("https://evil.example/tree.glb"),
    ],
    ["path traversal", () => assertLocalAssetPath("/models/../secret.glb")],
    [
      "remote path",
      () => assertLocalAssetPath("https://evil.example/tree.glb"),
    ],
    [
      "protocol-relative path",
      () => assertLocalAssetPath("//evil.example/tree.glb"),
    ],
  ])("rejects %s", (_, action) => {
    expect(action).toThrow(/asset-catalog/);
  });
});
