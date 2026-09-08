# Live ChatGPT-authored input game

Source: `fe95fd5`, tested against the local production build on 2026-09-08.

The real browser paired with an authenticated local ChatGPT companion and made exactly two actual `gpt-6-astra` calls, low reasoning and default processing: scene creation and a scoped material edit. No fixture generation transport or fallback model was used. The first visible reservation arrived in 8,937 ms in this run.

The created scene contains two original procedural/custom objects and exactly three input rules. The selected tree becomes visibly pink in both `chatgpt-local/edit.png` and `chatgpt-local/standalone-input-ready.png`; root inspected both. The other object, geometry parts, transforms, behavior, environment and game program are preserved. Local reload and actual ZIP export pass. The downloaded player passes score 0 → right +7, held-right deduplication, up win, restart to 0 and left loss, with no page errors.

`wrapper.json` records actual generation count and model settings; `chatgpt-local.json` records the browser assertions. External Google Fonts requests were blocked by the test traffic guard. This run does not prove Blender packaging/construction, cloud recovery, individual Orb publication or rendering performance budgets. The earlier automated pass with a failed visible recolor is retained separately in `../chatgpt-authored-input-game-before-material-fix/`.
