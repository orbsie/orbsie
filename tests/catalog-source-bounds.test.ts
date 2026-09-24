import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assetFilePathFor,
  assetManifest,
  requireCatalogAsset,
} from "../src/lib/asset-catalog";
import { transformedCatalogSourceBounds } from "../scripts/lib/catalog-source-bounds.mjs";

const root = path.resolve(__dirname, "..");

async function sourceBoundsFor(id: string) {
  const asset = requireCatalogAsset(id);
  const bytes = await fs.readFile(path.join(root, assetFilePathFor(id)));
  return transformedCatalogSourceBounds(bytes, asset.path);
}

describe("catalog source bounds", () => {
  it("matches every manifest bound to active transformed GLB geometry", async () => {
    const audits = [];
    for (const asset of assetManifest.assets) {
      const source = await sourceBoundsFor(asset.id);
      audits.push({
        id: asset.id,
        nodeCount: source.nodeCount,
        meshCount: source.meshes.length,
        triangles: source.meshes.reduce(
          (total, mesh) => total + mesh.triangles,
          0,
        ),
        manifestBounds: asset.bounds,
        sourceBounds: source.bounds,
        delta: {
          min: source.bounds.min.map(
            (value, axis) => value - asset.bounds.min[axis],
          ),
          max: source.bounds.max.map(
            (value, axis) => value - asset.bounds.max[axis],
          ),
        },
      });
      for (const axis of [0, 1, 2]) {
        expect(source.bounds.min[axis]).toBeCloseTo(asset.bounds.min[axis], 5);
        expect(source.bounds.max[axis]).toBeCloseTo(asset.bounds.max[axis], 5);
        expect(source.bounds.size[axis]).toBeCloseTo(
          asset.bounds.size[axis],
          5,
        );
      }
    }
    if (process.env.WRITE_CATALOG_BOUNDS_AUDIT === "1") {
      const outputDirectory = path.join(
        root,
        "docs/evidence/mushroom-visual-diagnosis",
      );
      await fs.mkdir(outputDirectory, { recursive: true });
      await fs.writeFile(
        path.join(outputDirectory, "catalog-bounds-audit.json"),
        `${JSON.stringify({ assetCount: audits.length, audits }, null, 2)}\n`,
      );
    }
  });

  it("retains translated node placement and active material regions", async () => {
    const source = await sourceBoundsFor("kenney.nature.mushroom-red");
    expect(source.bounds.min[1]).toBeCloseTo(-0.05, 8);
    expect(source.bounds.max[1]).toBeCloseTo(0.1528, 7);
    expect(source.meshes.map((mesh) => mesh.material[0])).toEqual([
      "_defaultMat",
      "colorRed",
    ]);
    expect(source.meshes.map((mesh) => mesh.triangles)).toEqual([32, 16]);
    expect(source.meshes.map((mesh) => mesh.bounds.min[1])).toEqual([
      -0.05,
      expect.closeTo(0.07636, 5),
    ]);
  });

  it("audits embedded-texture bounds without changing source bytes", async () => {
    const id = "assetquest.mushroom.fly-agaric-basic";
    const asset = requireCatalogAsset(id);
    const bytes = await fs.readFile(path.join(root, assetFilePathFor(id)));
    const originalBytes = Buffer.from(bytes);
    const source = await transformedCatalogSourceBounds(bytes, asset.path);

    for (const axis of [0, 1, 2]) {
      expect(source.bounds.min[axis]).toBeCloseTo(asset.bounds.min[axis], 5);
      expect(source.bounds.max[axis]).toBeCloseTo(asset.bounds.max[axis], 5);
    }
    expect(source.meshes).toHaveLength(1);
    expect(source.meshes[0].triangles).toBe(222);
    expect(source.meshes[0].material).toEqual([
      "Mushooms_MAT_embedded_512_png",
    ]);
    expect(bytes).toEqual(originalBytes);
  });
});
