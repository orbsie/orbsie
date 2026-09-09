# Browser modeling live acceptance

Use the existing `scripts/provider-browser-e2e.mjs` harness with `ORBSIE_REQUIRE_BROWSER_MODEL=1`. The gate requires at least one committed generated entity whose job backend and trusted model source are both `browser-manifold`, and selects that entity for the harness's scoped material edit. It does not by itself prove a topology-changing live edit.

Set `ORBSIE_CREATION_PROMPT` to explicitly request a new browser-manifold model, and `ORBSIE_REQUIRE_NEW_ONLY=1` when testing catalog bypass. Keep `ORBSIE_LIVE_E2E=1`, exact Luna model, provider-specific credential scope and authorized output cap explicit. Existing live-call opt-in and credential controls remain in force. Users' model choices remain unrestricted by this test policy.

The default scoped edit preserves geometry and changes material; reload, export and optional publication retain the harness's existing checks. Separately exercise a recipe/topology edit and gameplay during construction before claiming the full SDK milestone. Fixture editor evidence in `docs/evidence/browser-modeling-editor-resume` proves local creation/edit/reload, not live model behavior.

OpenRouter retains the authorized 512-output-token test cap. Gateway funded connection and authorized test budget remain unresolved. ChatGPT tests must explicitly select Luna with regular processing. No successful live browser-modeling run is claimed by adding this gate.

Owner update: ChatGPT connector support is not live and is now backlog work in `prompt.md`. Do not run ChatGPT live acceptance or block the current release on it. Earlier companion evidence remains experimental; active live acceptance targets OpenRouter and Gateway.
