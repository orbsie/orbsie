# Orbsie curated 3D asset catalog

This catalog contains a small, reviewed set of self-contained GLB models for nature, structures, and platform scenes. The first source is Kenney's original [Nature Kit](https://kenney.nl/assets/nature-kit), downloaded from its official asset page on 2026-09-07. The official page marks the kit as [Creative Commons CC0](https://creativecommons.org/publicdomain/zero/1.0/); the exact license shipped inside the archive is preserved at [`licenses/kenney-nature-kit-License.txt`](licenses/kenney-nature-kit-License.txt).

The machine-readable contract is [`manifest.json`](manifest.json). Every entry has a stable catalog ID, a local public path, source archive entry, archive hash, per-file SHA-256, structural GLB review, material/texture counts, bounds, and scale/normalization notes. The original 10.5 MB archive is deliberately not checked in: `manifest.json` records its URL and SHA-256 so the selection can be reproduced without making an export depend on a third-party download.

The checked-in selection is intentionally small (10 GLBs, about 130 KB total) and contains only models that rendered successfully in a browser contact sheet. The contact sheet is [`preview/kenney-nature-kit-contact-sheet.png`](preview/kenney-nature-kit-contact-sheet.png). Models use Kenney's Y-up scene units, preserve their source origins, and have no external texture dependencies. The catalog does not embed colliders; each entry carries a reviewed runtime collider recommendation for the authoring/runtime layer.

Catalog policy for integration:

- Catalog assets and generated/procedural geometry are both valid choices. Use an asset only when its tags and bounds fit the request; otherwise generate a new form.
- An explicit request for a new/original model sets `assetPolicy` to `new-only` for that object and follow-up edits. A catalog ID must not be selected or silently substituted in that scope.
- Mixed scenes are expected. Keep asset-backed entities and generated entities under the same stable entity/revision system.
- Runtime and export code must resolve only IDs from this local manifest and local paths. Reject unknown IDs and arbitrary remote URLs.
- Public exports should copy the referenced GLB and this license/provenance record into the export bundle.

Run `node scripts/verify-catalog-assets.mjs` after moving or updating a model. It checks safe local paths, exact file hashes, the preserved license hash, GLB headers, and the catalog byte budget.
