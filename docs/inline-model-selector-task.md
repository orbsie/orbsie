# Inline model selector handoff

User requests direct chat dropdown instead of opening a dialog, respecting exactly
Quality / Balanced / Budget as the default choices. Implicit, easy interaction is
a product requirement. Queue after ChatGPT session-persistence fix; one Luna worker.

## Source and ownership

Own src/components/orbsie.tsx, a small extracted selector if useful, relevant styles,
and focused tests. Coordinate any chatgpt-connection.tsx callback/catalog changes.
Current composer mode-button opens settings; panel-foot exposes effort. API catalog
loads only while settings is open; ChatGPT catalog resides inside connection dialog.
Reuse modelModesForProvider (Gateway Budget has a different ID) and validated
resolveChatGPTPresetOptions. Do not hardcode model availability or invent effort.

## Behavior

Connected model trigger displays selected high-level tier and opens anchored
choices directly. Exactly Quality, Balanced, Budget model options; concise optional
explanations. Picking available option immediately updates next-request connection
and closes dropdown, preserving draft/world. No confirmation or model dialog.
Connection management stays in existing settings. Advanced custom-model support can
remain there, preserving existing user freedom; do not silently change an existing
custom selection just by opening dropdown. Use honest neutral trigger for custom
selection. Do not expose raw model IDs/reasoning effort in normal composer copy.

Fetch/cache validated provider catalog independently of settings dialog on demand;
handle loading/error/retry/unavailable options inline. Reject stale responses when
provider/account changes; no automatic inference or provider fallback. ChatGPT uses
its own supported model/effort presets. Free access must continue to work with its
server-selected model; do not imply arbitrary free tier selection is honored.
Unauthenticated connection action may still use connection flow, not pretend ready.

Keyboard and touch: visible focus, trigger expanded/control semantics, focus options,
Escape/outside dismiss, focus return, no clipping at phone width or over composer.
Do not interrupt ongoing generation or reset its selected model mid-run.

## Evidence

Targeted tests for all three providers' preset mapping (including Gateway Budget),
selection without opening dialog, draft preservation, unavailable/loading/error,
keyboard dismiss/focus and stale catalog result. Browser fixture desktop + phone
show direct dropdown and one-step choice. No live model calls required. Typecheck
and relevant targeted suites once; report changed files/results/remaining risks.

## Same chat UX handoff: flatten progress messages

User additionally requests each progress update as an individual chat message in
the parent thread, removing the nested activity box. Current orbsie.tsx1534 renders
a bordered section with latest status above a nested historical list; globals.css561
styles that extra panel. Replace with sibling assistant-style message rows directly
in chat-messages, chronological events once each, bounded existing activity history.
Reuse normal message visual language; remove obsolete panel/list styling. Keep
project/run identity and stale guards, announce only newest event politely (do not
reannounce whole history), preserve scroll/touch behavior and clear active/completed/
failed states. Show factual high-level activity summaries, never private reasoning.
Do not persist transient progress into exported project chat or double-render latest.
Verify desktop/phone streaming and completion, chronological order, no nested
activity panel, accessibility latest announcement, and unchanged draft/gameplay.
