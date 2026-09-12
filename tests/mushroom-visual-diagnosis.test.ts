import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { AssetGeometryLoader } from "../src/lib/asset-geometry";
import {
  assetFilePathFor,
  requireCatalogAsset,
} from "../src/lib/asset-catalog";

const root = path.resolve(__dirname, "..");
const mushroomId = "kenney.nature.mushroom-red" as const;

async function checkedInBytes(): Promise<ArrayBuffer> {
  const bytes = await fs.readFile(
    path.join(root, assetFilePathFor(mushroomId)),
  );
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function boundsOf(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object);
  return {
    min: box.min.toArray(),
    max: box.max.toArray(),
  };
}

function roundedColors(geometry: THREE.BufferGeometry) {
  const color = geometry.getAttribute("color");
  const values = new Set<string>();
  for (let index = 0; index < color.count; index++)
    values.add(
      [color.getX(index), color.getY(index), color.getZ(index)]
        .map((value) => value.toFixed(5))
        .join(","),
    );
  return [...values].sort();
}

describe("catalog mushroom visual diagnosis", () => {
  it("preserves the raw cap/stem geometry through the production decoder", async () => {
    const raw = await checkedInBytes();
    const source = await new GLTFLoader().parseAsync(
      raw,
      requireCatalogAsset(mushroomId).path,
    );
    source.scene.updateMatrixWorld(true);
    const rawMeshes: Array<{
      triangles: number;
      material: string;
      color: string;
      bounds: ReturnType<typeof boundsOf>;
    }> = [];
    source.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = Array.isArray(mesh.material)
        ? mesh.material[0]
        : mesh.material;
      rawMeshes.push({
        triangles:
          (mesh.geometry.index?.count ??
            mesh.geometry.getAttribute("position").count) / 3,
        material: material.name,
        color:
          material instanceof THREE.MeshBasicMaterial ||
          material instanceof THREE.MeshStandardMaterial
            ? material.color.getHexString()
            : "unknown",
        bounds: boundsOf(mesh),
      });
    });

    const loader = new AssetGeometryLoader({
      fetchBytes: async () => raw,
    });
    const loaded = await loader.load(mushroomId);
    const decodedBounds = loaded.geometry.boundingBox!;
    const sourceBounds = boundsOf(source.scene);
    expect(rawMeshes.map((mesh) => mesh.triangles)).toEqual([32, 16]);
    expect(rawMeshes.map((mesh) => mesh.material)).toEqual([
      "_defaultMat",
      "colorRed",
    ]);
    expect(rawMeshes.map((mesh) => mesh.color)).toEqual(["ffffff", "f19398"]);
    expect(loaded.geometry.getAttribute("position").count).toBe(144);
    expect(decodedBounds.min.toArray()).toEqual(
      sourceBounds.min.map((value) => expect.closeTo(value, 6)),
    );
    expect(decodedBounds.max.toArray()).toEqual(
      sourceBounds.max.map((value) => expect.closeTo(value, 6)),
    );
    expect(roundedColors(loaded.geometry)).toEqual([
      "0.87843,0.29020,0.31373",
      "1.00000,1.00000,1.00000",
    ]);
    expect(
      loaded.geometry.getAttribute("formationPosition").count,
    ).toBeGreaterThan(0);
    expect(loaded.geometry.getAttribute("formationColor").count).toBe(
      loaded.geometry.getAttribute("formationPosition").count,
    );

    if (process.env.WRITE_MUSHROOM_DIAGNOSTIC === "1") {
      const outputDirectory = path.join(
        root,
        "docs/evidence/mushroom-visual-diagnosis",
      );
      await fs.mkdir(outputDirectory, { recursive: true });
      await fs.writeFile(
        path.join(outputDirectory, "geometry-comparison.json"),
        `${JSON.stringify(
          {
            source: {
              id: mushroomId,
              path: assetFilePathFor(mushroomId),
              bytes: raw.byteLength,
              sha256: createHash("sha256")
                .update(new Uint8Array(raw))
                .digest("hex"),
              meshes: rawMeshes,
              bounds: sourceBounds,
            },
            decoded: {
              positionCount: loaded.geometry.getAttribute("position").count,
              triangleCount: loaded.geometry.getAttribute("position").count / 3,
              bounds: {
                min: decodedBounds.min.toArray(),
                max: decodedBounds.max.toArray(),
              },
              colors: roundedColors(loaded.geometry),
              formationAttributes: {
                positionCount:
                  loaded.geometry.getAttribute("formationPosition").count,
                colorCount:
                  loaded.geometry.getAttribute("formationColor").count,
              },
              userData: loaded.geometry.userData,
            },
            conclusion:
              "The checked-in GLB decodes as a two-material low-poly mushroom with preserved node transforms and material regions. The prior manifest omitted the active node's -0.05 Y translation, so at scale 14 it could shift the visible placement by 0.7 units; a screenshot captured before this metadata correction cannot establish a source-shape-only cause. Formation's requested tint also intentionally replaces both material regions with one color, so the corrected scene should be rerendered before choosing a visual fix.",
          },
          null,
          2,
        )}\n`,
      );
    }

    loaded.release();
    loader.dispose();
    source.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  });
});
