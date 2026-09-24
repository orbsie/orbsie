# Production eleven-asset catalog acceptance

Source `b5cfd63` was deployed Ready as
`dpl_5o8L1QdSiftYKbNduMPLTgFBuCPL` at `https://orbsie.com/` (immutable
deployment `https://orbsie-12kmnbr4f-grappeggias-projects.vercel.app`).
`scripts/verify-catalog-worker-browser.mjs` ran against that public URL with
all API calls intercepted. `report.json` records 11 successful catalog-worker
decodes and loads, visible mixed-scene rendering, ZIP export and direct/built
standalone playback, and new-only catalog rejection. No real model calls,
external requests, or page errors occurred. The fixture checks behavior with
synthetic generation; it does not certify live provider output.

Read-only HTTP checks returned 200 for `/`, `/robots.txt`, `/sitemap.xml`,
`/api/config`, `/models/assetquest/fly_agaric_basic_textured.glb`,
`/player/runtime.js`, and `/player/source.json`. Their response SHA-256 values,
respectively, were:

```
cc32748f2f65e196d2f3197b44a0c5c11b243af2f8a74f48b4622ab73adbdb9e
dca8b6d75af71ee5437dde4f70a34e0a1ddfa500f5cc8cc089dc30ce856e7025
2ecf9849d1ea4bfdbe3f8382e8fc93b7fd28da5da695da5a7d7f5f2980b5d20e
699338ef03d5ff1e35f4eba51f8f54ec18719d9bcf12b2b77dd5b2f2ea440bf9
3bb6e9fcabd6b4f88587305943a7f1012eb570fb47f7f6bdd66299b3ac7640f4
93bddf643212a5ea2ff7544a39cbfa68c14f8bf7e40d81ecc5e90b8893474327
42bd2d2f8a540f9aa1b86a891d9f19162f8ce4bbe382b7284f9e8dd594856467
```

The mushroom asset and two player artifacts match the checked-in bytes. The
standalone screenshot still shows the small two-object fixture at a distant
play-camera scale; visual legibility remains open.
