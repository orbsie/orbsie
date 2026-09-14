# Next bounded implementation priorities

Finish and review current durable server task first. Keep one Luna worker; no
nested agents. Root owns acceptance, not a second parallel implementation worker.

## Frequent incomplete streams

The reported exact message comes from `store.ts` after clean reader EOF when the
last applied command is not commit_revision. This alone does not establish a
network failure. Follow stream from provider -> private host -> public route ->
client and reproduce before fixing. Existing Gateway malformed-output diagnostic
is a distinct observation (`generation-framing-debug-task.md`). Preserve errors,
valid early operations, command schemas and completion requirements. Collect only
bounded sanitized phase/duration/count/termination metadata, never credentials or
raw prompts/provider text in public diagnostics. No blind retries. Any continuation
must use last saved state and explicit bounded phases, avoid replaying objects,
retain original undo, and report actual recovery to the user.

## Quiet activity and startup restoration (next UI handoff)

`store.ts` publishActivity currently appends events per operation;
`authoring-activity.ts` only bounds count at18. Add a per-run two-second publication
cadence for intermediate progress, coalescing bursts to newest meaningful summary.
No initial delay for the first progress message; at least2000ms between subsequent
intermediate publications. Terminal outcome is timely and clears pending progress.
Do not delay geometry, commit persistence or controls. Clear timer/pending state on
stop, reset, project/account switch and next run. Cover fake-clock bursts, sustained
updates, terminal flush, cancellation and stale callbacks. Keep existing flat chat
messages and accessible latest-only announcement. Combine with the already-defined
main-page durable startup restore only if it remains one cohesive UI handoff.

## Public discoverability (following bounded handoff)

Current root layout has basic title/description/icon only; home wraps Orbsie;
there is no robots/sitemap/social metadata file. `/o/[id]` queries published rows
and renders a public iframe shell but lacks per-world metadata/headings. Read local
Next metadata/robots/sitemap guides before edits. Add accurate public content and
metadata with canonical https://orbsie.com, crawler endpoints and share metadata.
Never enumerate private or merely local worlds; public listing must honor publication
visibility policy rather than treating possession of a share URL as search consent.
Do not add fake reviews, prices, unsupported OAuth claims or hidden keyword stuffing.
Keep the game entrance/layout/mobile controls intact. Validate server HTML without
JavaScript, route content types, absolute canonical/sitemap URLs, private exclusion,
and production origin output after deployment. Ranking/indexing is not guaranteed.
