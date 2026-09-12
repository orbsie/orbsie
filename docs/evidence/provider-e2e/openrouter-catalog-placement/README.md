# OpenRouter catalog placement attempt

This was one bounded live browser run against the rebuilt local app at `http://127.0.0.1:3068` using OpenRouter Luna (`openai/gpt-5.6-luna`), low reasoning, default service tier, a local-only key, and the owner-authorized 4096-token cap. The application source was `f565a7a3229cf4de9d73e13a6432d152eec13d56`. The ordinary prompts were:

1. `Build a tiny island with one friendly tree standing on the ground. Keep it simple and commit the world.`
2. `Make this a giant pink mushroom`

The run consumed exactly two generation responses, both HTTP 200, with no generation budget violation, fallback, or blocked external request. Creation passed with six operations, one catalog entity, one browser-generated entity, and one generated entity. The harness then blocked the geometry edit before accepting it because the edited generated recipe changed appearance metadata by adding `tint: "#f05a9d"`; the geometry edit invariant requires appearance and collision properties to remain unchanged. Consequently, `export`, standalone playback, and post-edit bounds were not reached. No retry was made.

Preserved screenshots are under `openrouter/`: [connection-model.png](./openrouter/connection-model.png), [intermediate-seed.png](./openrouter/intermediate-seed.png), and [failure.png](./openrouter/failure.png). The failure capture shows the pre-accepted cyan/peach generated object rather than a verified giant pink mushroom. Since the edit transaction was blocked before its new geometry was accepted, there is no honest post-edit source hash, world bound, scale comparison, or catalog-placement conclusion from this run. The sanitized harness report is [openrouter.json](./openrouter.json).
