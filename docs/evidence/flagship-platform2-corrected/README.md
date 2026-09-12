# Corrected flagship platform-2 acceptance

This is one focused desktop Chromium run against the unchanged saved OpenRouter
flagship ZIP. The previous failed three-platform evidence remains in
`docs/evidence/flagship-platforms/`; this directory records the bounded
platform-2 correction only.

Command:

```sh
FLAGSHIP_PLATFORM_ID=platform-2 \
  node scripts/verify-flagship-platforms.mjs \
  docs/evidence/flagship-platform2-corrected
```

The driver served the ZIP from a loopback-only server, used real keyboard
events, observed rendered Three.js telemetry, and made no model, account,
external-network, mutating, store, physics, or snapshot request. It kept
airborne correction input until a descending sample crossed the source contact
height and the player center overlapped the source X/Z footprint. Source
contact is derived from the checked-in catalog bounds and entity transform to
match `src/lib/gameplay.ts` `platformTop`/`isInsidePlatform`; the visible mesh
top is not used for contact height.

Result: **passed**. The single selected experiment landed at `3068.2 ms` at
source contact height `1.44062499895`, with descending `true`, source overlap
`true`, and a consecutive rendered on-top streak of `21` samples. After input
release, the platform moved `-1.4458089412` along Z and the player moved
`-1.4458089412`, with maximum residual `8.9e-16`. There were zero external or
mutating requests and zero page errors. See `report.json` and
`platform-2-released.png` for the complete telemetry and screenshot.

## Provenance

| Artifact | Value |
| --- | --- |
| Repository HEAD at run | `f3b03612d0af2dfe86dca8379b3e323de50c329b` |
| Verifier SHA-256 at browser run | `7838e32e29575bbef343bc00d305cf741c8230cfa547701668f964ffc31375b2` |
| Verifier dirty at run | `true` |
| Helper SHA-256 at browser run | `6012469c66fba72ea2a07194e0838b0df39ccafc97af6b0be24fa735ccef4afe` |
| Post-run verifier SHA-256 | `0fec69ab76693d98b5d8719e54b99434ab948b3727a6ce0ddbfe436ae610329b` (fail-closed transform guard and hash-field recording added after the browser run; no browser rerun) |
| `world.zip` SHA-256 | `4675d2a0eed88f143cbc718a8c9178be554e21989841dbb6b11d89c42bbc36da` |
| `project.json` SHA-256 | `fdaabbd42a80478b3395e9220d5385706d646f457e523e2a7010ece3d47837a0` |
| `runtime.js` SHA-256 | `3d2fa966dc49a46eee64bd453e4db5861f57b565d71ec953f26b05c8ae4c7742` |
| `runtime.css` SHA-256 | `0174f4a45f76e1adaa103d5f1275bdbe1ae1c5e4fe710849428b16940b152e76` |

The offline regression in
`tests/flagship-platforms-verifier.test.ts` replays the retained failed
sequence: it rejects the old platform-2 airborne release, accepts the retained
source contacts for platforms 1 and 3, and verifies the source contact height
and overlap criteria.
