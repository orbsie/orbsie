# Real ChatGPT interruption and continuation

The complete browser harness passed using exactly three managed ChatGPT generations with `gpt-6-astra`, low reasoning, default processing. It ran against the development app on port 3017 with an authenticated development account and actual PostgreSQL journal. No fixture generation transport, OpenRouter calls, Gateway calls, or fallback was used.

The browser clicked Stop after the first ready entity reached durable checkpoint sequence/revision 5. The journal reached `cancelled`. Account recovery installed the full `recoveryCheckpoint` and restored the original request in the composer. A second real request carried that recovered scene and completed the missing mushroom and input rules. The already-finished tree retained its ID and exact entity data. The third request changed only the selected tree's material to pink.

The harness then passed reload, independent ZIP export, standalone right-input score +7 and held-key deduplication, up-input win, restart, left-input loss, completed journal recovery, cloud save, and a cookie-only fresh-context cloud reopen. Fresh-context IndexedDB matched the entire saved project; no generation was attempted there and no page errors occurred. External Google Fonts requests were intentionally blocked by the harness.

Authoritative reports: `wrapper.json` and `chatgpt-local.json`. Screenshots include the recovered single tree, final pink edit, standalone states and reopened cloud world. The fresh-context screenshot captures the entry transition, with both complete objects visible. `intermediate-seed.png` in this interrupted mode is captured after continuation submission; initial seed observation/timing comes from the DOM observer, not that image.

This proves user-triggered cancellation and explicit regeneration from the checkpoint, not resumption of an underlying provider stream or every unexpected network-disconnection path. It does not close Blender packaging, the full provider matrix, or dedicated publication. The app recovery fix is commit `8fc9dd1`; its production deployment and read-only smoke are documented separately in `docs/cloud-verification.md`.
