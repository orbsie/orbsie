# ChatGPT authoring and cloud recovery evidence

Two real managed ChatGPT calls used `gpt-6-astra`, low reasoning, default processing, against the local development app at port 3017. No OpenRouter or Gateway calls were made. The account and database were development fixtures; generation was real, with no fixture transport or fallback.

`chatgpt-local.json` and `wrapper.json` retain the original **failed** aggregate result. Creation, selected-object material editing, reload, ZIP export, standalone scoring/win/loss/restart, latest completed journal recovery through the account UI, full recovered IndexedDB snapshot equality, and a same-revision cloud save all passed. The final fresh-context open timed out. This was completed-generation recovery, not interrupted-stream continuation.

The investigation found that the harness's early storage inspection could create `keyval-store` version 1 without its object store before the app initialized. A browser regression reproduced the empty-database mutation. The shared inspection helper now aborts unexpected database upgrades; the regression verifies that inspection leaves a pristine database absent and reads an initialized draft correctly. Fresh-context failures now retain their own screenshot and traffic/page-error diagnostics.

`fresh-reopen.json` is a separate successful replay of the already-saved world, with **zero model calls**. It verifies initially empty local storage, opens the cloud entry through the account UI, compares the entire persisted cloud snapshot (including all four messages), and verifies that the ZIP contains the same snapshot with chat history omitted as specified by `src/lib/export.ts`. The replay blocks generation requests and reports none attempted. Its first diagnostic comparison incorrectly expected exported chat history, and a subsequent diagnostic read encountered an absent draft during asynchronous persistence; both diagnostic defects were corrected before the final replay. The original aggregate failure remains unchanged.

Commands:

```sh
node scripts/verify-browser-storage-inspection.mjs
node scripts/verify-cloud-provider-reopen.mjs
```

The saved-world replay requires the existing private development account fixture and server on port 3017. It does not create accounts, generate models, publish, or deploy. Credentials and cookies are excluded from evidence. Screenshots cover the recovered edited scene, independent standalone win state, and the reopened cloud world. This evidence does not close Blender packaging, interrupted generation, the full provider matrix, or dedicated publication requirements.
