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

## Interface decisions for the decoder task

Use a typed optional texture descriptor alongside geometry, not a THREE.Texture
hidden in geometry.userData (BufferGeometry.clone serializes userData). Extend
AssetGeometryTransfer, prepared result, loader lease and hook together. Descriptor:
RGBA Uint8Array, width/height, color-space and wrapping/filter metadata. Transfer
pixel buffers once; count their byte length in each existing memory/cache budget.
Create/release GPU textures at the rendering ownership boundary. Preserve stable
asset leases while a texture is in use, including cancellation and replacement.

Initial image support is PNG bufferView only, one distinct base-color map, max
1024x1024 decoded pixels. Validate PNG dimensions before image decode; reject
multiple atlases/unsupported extensions explicitly. A512x512 candidate is the
first visual experiment. Network/resource policy stays deny-by-default.
World's existing assetRecipe.tint is the explicit recolor signal; ignore the atlas
when that tint is present. Preserve untinted source appearance and shared-cache
isolation. Particle samples can use a bounded texture-color lookup in the worker.

## Renderer and export handoff after decoder commit 3d6a839

Source review confirms the editor and standalone player both import World;
export.ts copies the immutable catalog GLB plus exact source license through
bundleCatalogAssets. Embedded PNG bytes therefore need no separate texture URL
or export-side texture fetch. Rebuild the player and its worker only after the
shared rendering change; verify exported playback, not just source inclusion.

useAssetGeometry currently clones geometry and immediately releases its lease.
Extend its result with a per-hook DataTexture while retaining the loader lease
until hook cleanup. Share immutable RGBA storage; never mutate its pixels for
entity tint. Dispose the hook's GPU texture, cloned geometry and lease exactly
once on replacement/unmount. An aborted resolution must release without exposing
stale state. Texture instances must not be stored in geometry.userData.

World Formation currently preserves previousShape only. Pending or failed asset
replacement must preserve the last committed appearance as well as its geometry;
do not attach the new atlas to an old mesh or dispose an atlas still displayed.
Use an explicit retained appearance lifetime for that last-good snapshot. Apply
assetRecipe.tint by omitting the atlas and replacing vertex/particle colors;
clearing tint must restore the unchanged source atlas. Game-time color overrides
already replace diffuseColor after color_fragment; preserve that ordering after
map_fragment so gameplay tint remains uniform too.

Map changes must update the material's shader variant (needsUpdate where required),
while ordinary formation frames update uniforms without recompiling each frame.
Keep particle formation separate: supply bounded UV-sampled atlas colors in the
worker, multiplied by the source material/vertex colors in linear space. Verify
texture orientation using the actual decoded candidate, not a symmetric mock.

Next bounded worker owns use-asset-geometry, World appearance helpers, needed
formation sampling, focused lifetime/render tests and player build integration.
Do not dispatch until the active WebGL correction is reviewed. Do not add a
catalog ID yet. Acceptance must cover untinted/pink/restored source views,
last-good appearance during stale/failed replacement, shared texture isolation,
cleanup, and offline exported playback with zero provider calls.
