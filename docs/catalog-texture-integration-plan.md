# Catalog texture integration task contract

Status: proposed architecture, not implemented or accepted. Provider connection
acceptance remains higher priority. Root source review:0d45bcd.

The Asset Quest mushroom experiment retains its silhouette but loses texture
fidelity when baked into vertex colors. Raising its refinement budget did not
improve the reviewed image. Preserve the existing catalog and converter outputs;
do not tune that budget again as a substitute for image fidelity.

## Bounded first implementation

Support one embedded base-color atlas per catalog asset, retaining a merged
geometry and UVs. Offline preparation must consolidate compatible materials;
unsupported material features fail explicitly. Do not promise general glTF
material support or add arbitrary remote textures. Start with a512-square atlas
and measure visual fidelity before admission; this size is a candidate, not a
quality guarantee. Keep the original CC0 text and source hashes with any derivative.

The decoder currently drops UVs and flattens material colors in
src/lib/asset-geometry-core.ts. Its URL guard rejects nested resources, including
loader-created blob URLs. Do not loosen that guard globally. Validate embedded
image buffer-view ranges and MIME types before decoding; enforce compressed-byte
and decoded-pixel limits, and permit only URLs created by that validated decode.
Reject external image URIs. Extend the worker result with bounded pixel data,
dimensions and sampling metadata; include pixels in transfer and cache budgets.
Keep the geometry-only result valid for the existing ten assets.

AssetGeometryLoader and useAssetGeometry must explicitly own texture lifetime,
reference counting, per-entity mutation isolation, cancellation and disposal.
World formation needs a texture reveal compatible with existing particles and
stable entity replacement. Explicit entity recolor must replace appearance
uniformly as it does today; multiplying a source texture by pink is not equivalent.
The editor and standalone player must share this behavior. Baked export must
retain the self-contained atlas and exact license, with no editor service calls.

## Acceptance required before new catalog admission

- Decode a real embedded-atlas GLB in the actual worker, bounded memory and finite
  UV/geometry, with malformed ranges/images and external URI rejection tested.
- Render original, textured asset and uniform-pink views from front and rear;
  root reviews spot edges, silhouette and recolor. Retain hashes and screenshots.
- Existing untextured assets, formation/cancellation and shared-cache disposal
  retain their behavior. Test a real stale-load replacement, not only mocks.
- Targeted entity edit preserves ID and unrelated objects; reload/export and
  standalone player preserve appearance without network or credentials.
- Measure file size, decode time and frame disruption in the owner browser;
  representative mobile performance remains a separate release requirement.

Implement sequentially with one Luna worker: decoder/transfer/cache contract,
then renderer/export integration, then derivative asset admission after review.
Do not enable the new catalog ID until all corresponding paths are ready.
