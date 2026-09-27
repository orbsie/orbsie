# OpenRouter continuous publication acceptance — 2026-09-27

A fresh `openai/gpt-6-luna` creation and selected-object edit ran against the loopback production build with the local-only OpenRouter key, low reasoning, default service tier, a 4,096-token server and request cap, and exactly two generation requests. Both returned HTTP 200. The flow saved revision 9 to cloud, then published that same project through the authenticated production API. The public URL reached a ready snapshot and playable canvas in a signed-out browser.

The first launch was refused before inference because the server advertised its default 10,000-token ceiling. It made zero generation requests. The same build was restarted with `ORBSIE_GENERATION_MAX_TOKENS=4096` and the model run then passed; there was no code change or additional model request.

The OpenRouter key was only used by the loopback harness and was not sent to `orbsie.com`. The production publication process received the fresh account credentials and project ID/revision only.

Evidence files: `provider-run.json`, `preflight.json`, the conversation-free `project.json`, `publication.json`, and `signed-out-playback.png`. The original ZIP and intermediate editor captures were inspected for credential strings and omitted from committed evidence; no keys, passwords, cookies, or account email are retained.

The initial signed-out screenshot was taken when the canvas became ready, before
the two catalog models had appeared. A separate read-only Chromium revisit
waited 10 seconds and captured `signed-out-assets-loaded.png`; the island and
tree were then visible, and both referenced GLB requests returned HTTP 200
without failed requests. This screenshot verifies asset appearance on desktop,
not mobile touch behavior.
