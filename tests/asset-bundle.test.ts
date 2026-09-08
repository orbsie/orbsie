import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { bundleCatalogAssets } from "../src/lib/asset-bundle";
import { blankProject, type Project } from "../src/lib/protocol";
const project = (): Project => ({
  ...blankProject(),
  entities: [
    {
      id: "tree",
      label: "Tree",
      position: [0, 0, 0],
      scale: [1, 1, 1],
      color: "#ffffff",
      stage: "ready",
      geometry: {
        kind: "asset",
        assetId: "kenney.nature.tree-default",
        detail: "refined",
      },
    },
  ],
});
const read = (path: string) =>
  readFile(path.startsWith("models/") ? `public/${path}` : path);
it("bundles the exact referenced model once with preserved license and provenance", async () => {
  const p = project();
  p.entities.push({ ...p.entities[0], id: "tree2" });
  const files = await bundleCatalogAssets(p, read);
  expect(Object.keys(files).filter((path) => path.endsWith(".glb"))).toEqual([
    "models/kenney/nature-kit/tree_default.glb",
  ]);
  const metadata = JSON.parse(
    new TextDecoder().decode(files["assets/catalog/used-assets.json"]),
  );
  expect(metadata.assets).toHaveLength(1);
  expect(metadata.sources[0].license.spdx).toBe("CC0-1.0");
  expect(files[metadata.sources[0].license.textFile]).toEqual(
    await read(metadata.sources[0].license.textFile),
  );
});
it("rejects tampered model bytes and license text instead of shipping incomplete attribution", async () => {
  await expect(
    bundleCatalogAssets(project(), async (path) => {
      const bytes = await read(path);
      if (path.endsWith(".glb")) bytes[bytes.length - 1] ^= 1;
      return bytes;
    }),
  ).rejects.toThrow("integrity");
  await expect(
    bundleCatalogAssets(project(), async (path) =>
      path.endsWith(".txt")
        ? new TextEncoder().encode("changed license")
        : read(path),
    ),
  ).rejects.toThrow("integrity");
});
it("does not fetch assets for procedural-only projects", async () => {
  expect(
    await bundleCatalogAssets(blankProject(), async () => {
      throw Error("unexpected read");
    }),
  ).toEqual({});
});
