# OpenRouter flagship moving-platform acceptance

This is a bounded desktop Chromium run against the unchanged saved ZIP at
`docs/evidence/provider-e2e/flagship-openrouter/openrouter/world.zip`. The
verifier served the ZIP from a loopback-only server, used real keyboard events,
and observed only rendered Three.js geometry through the existing devtools
observation hook. It did not write player, transform, score, store, or snapshot
state, and it made no model, account, external-network, or mutating request.

Command:

```sh
node scripts/verify-flagship-platforms.mjs docs/evidence/flagship-platforms
```

The exact snapshot and runtime identity recorded in `report.json` is:

| Artifact | SHA-256 |
| --- | --- |
| `world.zip` | `4675d2a0eed88f143cbc718a8c9178be554e21989841dbb6b11d89c42bbc36da` |
| `project.json` | `fdaabbd42a80478b3395e9220d5385706d646f457e523e2a7010ece3d47837a0` |
| `runtime.js` | `3d2fa966dc49a46eee64bd453e4db5861f57b565d71ec953f26b05c8ae4c7742` |
| `runtime.css` | `0174f4a45f76e1adaa103d5f1275bdbe1ae1c5e4fe710849428b16940b152e76` |

The three experiments used the unchanged catalog entities and their recorded
behavior parameters:

| Platform | Rendered result | Evidence |
| --- | --- | --- |
| `platform-1` | Landed and carried; X displacement `2.2011365796`, player displacement `2.2011365796`, chosen-streak maximum residual below `5e-16`, 18 consecutive on-top samples | `platform-1-released.png` and `report.json` |
| `platform-2` | No rendered landing observed; one loose airborne overlap sample (`player` bottom `1.119` vs rendered platform top `1.008`), no consecutive landing streak, no carry proof | `platform-2-released.png` and `report.json` |
| `platform-3` | Landed and carried; X displacement `0.6291940624`, player displacement `0.6291940624`, chosen-streak maximum residual below `5e-16`, 17 consecutive on-top samples | `platform-3-released.png` and `report.json` |

For each experiment, approach and jump input were released before the carry
sampling interval. Platform tops and bounds came from each rendered platform
mesh's live world-space bounding box; the verifier does not use a fixed `y`
proximity such as `1.44`. Carry requires a consecutive on-top streak of at
least four samples, at least `0.08` units of rendered platform displacement,
and a player/platform displacement residual within 28% of that displacement.

The retained `diagnostic-mapping-reload/` directory contains the first
diagnostic run. Its first platform attempt passed; the other two had no input
because Three object UUIDs changed across page reloads. The final run refreshes
the rendered mapping after each reload and is the acceptance report at the
directory root. The final result is intentionally `failed` because
`platform-2` did not produce a real rendered landing/carry proof within the
three-experiment bound. Its released-input samples kept the player at the
same Z while the rendered platform moved away, then the player returned to the
ground. This is evidence for Astra’s review; no product edit was made in
response.
