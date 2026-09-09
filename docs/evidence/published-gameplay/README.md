# Published revision 64 gameplay

On 2026-09-09 the existing independent deployment at https://orb-112b8c73b06252e06c23-m4l2c3c18-grappeggias-projects.vercel.app served Sunbeam Pond, revision 64, with 19 entities and five collectibles. The harness fetched that public project, never substituted a fixture or changed the deployed state, and drove real keyboard/touch input in fresh contexts. Three.js observation supplied read-only player coordinates; no score, transform or store writes were injected. No model calls, account writes or external browser requests were needed.

Desktop passed all five pickups, portal win, visible completion, restart to zero, no horizontal overflow and an empty cookie jar. This completed run is in `desktop-pass-mobile-incomplete.json`; its subsequent mobile run did not finish, so the overall invocation failed. Mobile later passed independently in `mobile-pass.json` after improving the input driver. Astra visually inspected both retained win screenshots.

Earlier evidence is preserved: walking alone collected only ground-level crystals; adding jumps completed desktop but initially missed elevated touch pickups. Telemetry in `mobile-drift.json` showed successful jumping with horizontal displacement from moving platforms. The final driver re-approaches each target after settling, uses shorter input steps near the target, and allows at most three jump attempts. The game and publication were unchanged.

Command: `WIN_PUBLISHED=1 WIN_INPUT=mobile TEST_URL=https://orb-112b8c73b06252e06c23-m4l2c3c18-grappeggias-projects.vercel.app WIN_OUTPUT=test-results/published-winning-mobile-aligned node scripts/verify-winning-traversal.mjs`. Omit WIN_INPUT for both input modes; use desktop for keyboard only. The default without WIN_PUBLISHED retains the existing fixture test.

This proves this previously published collectible game's signed-out keyboard/touch win and reset. It does not prove fresh provider generation, play during construction, every interaction, republishing recovery, current-source publication, native mobile performance, or the complete OpenRouter/Gateway/ChatGPT matrix.

Final keyboard check: the improved driver also passed an independent desktop-only invocation (`desktop-pass.json`) at 2026-09-09T13:41Z. Reports now record explicit overall passed/failed status and bounded failure text, so a completed desktop sub-run cannot conceal a later failed mobile sub-run. This rerun exercised the updated navigation driver and required no model calls.
