# OpenRouter Luna live flagship journey

Run configuration: production build on `http://localhost:3058` with `BETTER_AUTH_URL=http://localhost:3058`, server-owned `ORBSIE_GENERATION_MAX_TOKENS=4096`, harness flags `ORBSIE_LIVE_E2E=1 ORBSIE_OPENROUTER_RAISED_CAP=1 ORBSIE_KEY_SCOPE=local-only ORBSIE_OUTPUT_CAP_TOKENS=4096 ORBSIE_SERVICE_TIER=default --provider openrouter`, exact model `openai/gpt-5.6-luna`, key from `.env.openrouter.local` without logging.

Owner authorization note: the standing local-only cap is 512 output tokens; on 2026-09-10 the owner authorized a bounded raise to 4096 for the flagship/procedural live journeys. The raise is gated behind `ORBSIE_OPENROUTER_RAISED_CAP=1` in `scripts/provider-browser-e2e.mjs` so ordinary runs keep the 512 cap, and this document records the authorization.

The flagship creation prompt (five crystals, three moving platforms, a portal, friendly trees and a pond) produced 28 committed operations with 13 entities: 6 catalog models, 2 procedural entities and 5 generated entities — a genuine mixed catalog/procedural/generated scene from one real request (first reservation 6,268 ms). The scoped material edit passed with the selected ID preserved, all unrelated entities unchanged, and a new committed revision. ZIP export and standalone playback passed; no fallback provider and zero generation diagnostics.

Two earlier attempts in this directory failed on upstream 429 throttling (one before the first reservation, one mid-edit after a fully successful 28-operation creation; the sanitized reports were overwritten by the final passing run). The throttle pattern observed across this session: one generation-sized request roughly every few minutes succeeds; immediate consecutive requests receive 429.

This closes the OpenRouter broader acceptance story and supplies real-provider evidence for the mixed catalog workflow. Remaining open for OpenRouter: the input-game at the standing 512 cap (documented in `browser-input-game-openrouter/`), the garden second scene (throttled; see `garden-openrouter/`), procedural authoring, and OAuth consent.
