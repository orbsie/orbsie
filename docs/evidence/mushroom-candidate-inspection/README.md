# Mushroom candidate inspection

This is a bounded inspection of the public **Low Poly Mushroom Kit** by Asset Quest. It does not ship an asset or change the catalog.

## Source and license

- Archive: `https://opengameart.org/sites/default/files/free_mushroom_pack_assetquest.zip`
- Author page: `https://opengameart.org/content/low-poly-mushroom-kit`
- Archive: 54,791,351 bytes; SHA-256 `b32c4bf0c9d5471ffcde83747402d0f8355add48c317f9147950c4f44facaffd`
- The captured author page states `License(s): CC0` and the archive `License.txt` states Creative Commons Zero, CC0, for personal, educational, and commercial use. The exact license evidence is preserved at [License.txt](./License.txt).
- The download obeyed the site `robots.txt` crawl delay of 10 seconds. The archive and selected extraction are preserved under `/tmp/orbsie-mushroom-candidate.nIL3N8/`.

## Selected candidate

Only these archive members were extracted:

- `Meshes/Fly_Agaric_Big.fbx` — 34,304 bytes, SHA-256 `b3a436902476d2a8e08fc84917ff1da8fff640185064229659f1d8dbbec56d9c`
- `Textures/Mushrooms_C.tga` — 50,331,692 bytes, SHA-256 `b45f16a2c725d3975040a3e34174c994992d40822e4a57449c79f765ed240680`
- `License.txt` — 567 bytes, SHA-256 `ad0c0abda67dae90291d8d6e2fcb07c841bb210cdedfa9dfdedae605bd8f66c6`

The mesh is binary FBX 7.7 (version 7700), Y-up, unit scale 1.0. A bounded parser found 137 position vertices, 131 polygons, and 254 triangles after triangulating its triangles/quads. Raw source bounds are `[-8.83735, -0.16625, -8.83735]` to `[8.83735, 19.61449, 8.83735]`, size `17.67470 x 19.78074 x 17.67470` source units. UVs are present (ByPolygonVertex, 516 indices).

The FBX material (`Mushooms_MAT`) references the external `../Textures/Mushrooms_C.tga`; the extracted TGA is uncompressed 4096x4096 24-bit. The pack also has a 3.53 MB PNG alternate, but the FBX explicitly names the TGA. There are no OBJ or glTF mesh files in the 30-entry archive.

## Quality and integration assessment

The source names this mesh Fly Agaric Big; it has 254 triangles. Bounds and naming alone do not establish its silhouette. Without rendering, this inspection cannot establish a smooth, recognizable cap/stem result. Its appearance also depends on the external diffuse texture.

The current catalog geometry path removes UV attributes and creates vertex colors from material color and `COLOR_0`; it does not sample diffuse texture maps. The candidate therefore is not directly usable in the current catalog path: it would need a separately reviewed FBX-to-self-contained-GLB/material treatment, and that conversion was intentionally not performed here.

See [report.json](./report.json) for machine-readable hashes, counts, bounds, and limits. No app, catalog, model, browser, or shipped asset was changed.
