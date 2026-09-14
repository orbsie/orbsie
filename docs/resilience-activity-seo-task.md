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

Root source check: `scripts/schema.sql` has publication URLs/metadata but no
search-discovery consent field. Start sitemap with the public homepage only;
do not enumerate `orbs` as a shortcut. Keep per-world share metadata accurate,
but use `noindex` for share pages until a deliberate discoverability setting exists.
Do not block their crawl with robots.txt while relying on a page-level noindex
directive. API/auth/callback paths must not enter the sitemap. Root layout canonical
must not accidentally canonicalize every published world to `/`.

## Logging and reproduction — additional owner request

Initial source inspection: generation adapters attach bounded diagnostics to error
records, but production route request logs contain no generation terminal summary.
The two-hour production query returned one HTTP200/no diagnostic message; see
stream-resilience-log-check-20260913. Implement correlation and terminal outcomes
as part of the next resilience task, not an unrelated logging framework rewrite.

Use typed structured events with version, generated run/request correlation IDs,
release/artifact identifier, provider/model, monotonic durations, phase, bounded
counts, last command type/revision and enumerated reason. Exactly one terminal
outcome per admitted run; normal HTTP headers must not log as generation success.
Cover initial request, first byte, first valid command, commit, transport EOF,
abort origin, deadline, parser/schema error and credential-finalization outcome.
Host/public/client must retain correlation without exposing host capabilities.
Never log arbitrary Error.message, headers, credential cache, prompt/model text,
login URLs, screenshot bytes or project objects. Bound cardinality and event rate;
keep command-level chatter summarized instead of logging every vertex/operation.

Extend existing diagnostic observer/replay tools and generation journal where useful.
Provide owner-triggered safe diagnostics export (not automatic third-party upload),
including a precise reproduction checklist and known missing evidence. Deterministic
fixture replay covers byte splits, EOF after valid operations, timeout, cancel and
invalid final commit. A full private-content capture is separate, explicit and
bounded; ordinary diagnostics stay content-free. Test sentinel secrets in every
error path, export size limits, stable correlation, one terminal summary and no
behavioral changes to valid generation. Preserve provider test/model/call limits.
