# Flagship live model verification — 2026-09-07

Run: `node scripts/run-flagship-chatgpt.mjs`. The trusted local stdio harness discovers the actual Astra model through `model/list`, requires managed ChatGPT login, and uses low reasoning without fallback. This run resolved to `gpt-6-astra`.

The exact flagship island prompt from `prompt.md` produced 59 valid operations and 19 ready entities in 54.480 seconds. First validated entity reservation arrived at 9.320 seconds. Structural assertions passed for five collectible crystals, three moving platforms with positive speed/amplitude, one portal, two trees, and one pond. Every entity received a coarse geometry refinement before the final committed snapshot.

The first selected-tree edit was rejected before any operation applied: the model tried to reserve an existing entity ID. The reducer correctly raised `Object already exists`. The system prompt had unconditionally instructed reservation first; it was corrected to reserve only new IDs and use setters for existing IDs. One bounded edit-only retry used:

```sh
ORBSIE_RESUME_EVIDENCE=/tmp/orbsie-flagship-live.json node scripts/run-flagship-chatgpt.mjs
```

The retry passed in 6.498 seconds with five valid operations. It changed the selected tree into a larger pink `#ff44aa` mushroom, retained its ID and position, and preserved all 18 unrelated entities and the environment byte-for-byte. The scene still had five collectible crystals, three moving platforms, and one portal. Both successful streams ended with `commit_revision`.

The initial two turns had already started when the owner requested Fast mode. The retry requested `serviceTier: "fast"` for thread and turn; this harness did not expose the returned accepted tier. All three attempts used Astra low. No other live attempts were made.

Full local evidence (commands, before/after snapshots, per-operation timing, original failure): `/tmp/orbsie-flagship-live.json`. Renderable projects: `/tmp/orbsie-flagship-creation.json` and `/tmp/orbsie-flagship-edited.json`. These local artifacts contain generated scene data, not credentials. `npx tsc --noEmit` passed.

This is protocol and scene-structure evidence. It does not prove visual quality, path reachability, jumping/bouncing, frame rate, browser playability, winning, persistence, or publication. Those require separate browser/runtime verification. The protocol stores one behavior per entity, so the platform assertions verify movement rather than a simultaneous bounce behavior.
