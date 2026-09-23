# Stream interruption and recovery acceptance

Local implementation and deterministic rendered acceptance passed on Sep 22;
see `docs/evidence/stream-resilience-20260922/` and the current development
checkpoint. The live cross-provider step below is still open. The wording and
failure-boundary notes that follow describe the original task state.

This is the next bounded implementation handoff after the browser review loop is
integrated. It closes the unchecked stream-resilience item in `prompt.md`; the
existing diagnostic replay and logging work is a baseline, not acceptance of
that item. Keep one Luna worker. Astra reviews the diff and provider evidence.

## Current evidence and failure boundary

- `src/lib/server/generation.ts` withholds a structured-output
  `commit_revision` until the provider reports a complete `stop`. It separately
  recognizes output truncation, provider errors, invalid commands, and aborts.
- `src/lib/server/chatgpt-scene-stream.ts` withholds the hosted commit until the
  private generator returns cleanly. A returned stream without a commit is
  classified as `clean-eof-without-commit`.
- `src/lib/store.ts` reports `clean-eof-without-commit` after a clean HTTP body
  EOF whose last applied command is not `commit_revision`, but its user message
  says the *connection* ended. A body read rejection instead reaches
  `transport-error`; a typed server error record uses `stream-error` or
  `parser-failure`. Thus the reported toast does not establish network loss.
- The checked-in `scripts/replay-generation-diagnostics.mjs` fixtures exercise
  these classes synthetically. The Sep 13 production log sample had an HTTP
  200 with no terminal diagnostic; it did not identify the cause or prove actual
  interrupted-run recovery. Do not infer a provider-wide failure rate from it.

## Implementation contract

1. Trace one admitted run by client run ID and request ID across browser,
   public route, provider adapter, and (for ChatGPT) private host. Preserve
   bounded phase/count/reason metadata only. Ensure an observable, single
   terminal classification for normal EOF without commit, malformed or
   semantically invalid output, provider rejection, transport read loss,
   deadline, user cancellation, and completion-record failure. A provider
   `length`/output-limit result must retain its own classification. Do not log
   prompt text, scene output, secrets, arbitrary error messages, or credentials.
2. Give the browser an accurate, short recovery message for each class. In
   particular, clean EOF without commit must not claim a network connection
   ended. Hide raw `JSON.parse`/schema exception text and output fragments from
   the toast while retaining allowlisted diagnostic codes and safe retry
   feedback. Keep **Try again** an explicit new attempt from the last committed
   scene; never silently replay a model call or claim an uncommitted revision
   succeeded. **Use last working** must restore that committed scene directly.
3. Prove preservation across an interrupted run: stable IDs, previous valid
   revisions, undo history, save/restore, selection where still valid, and game
   state. A partial operation can remain provisional for visual continuity, but
   must not enter the saved/committed baseline after failure. Confirm that
   late bytes from an abandoned run cannot alter a newer run or its journal.
4. Reduce the observed failure only when evidence identifies its cause. Use
   bounded output settings, framing, completion semantics, or provider-specific
   handling as warranted; do not paper over failures by inventing a commit or
   auto-retrying generation. Keep server ledger/credential finalization fences.

## Acceptance evidence

- Extend the existing production-path fixture, not a second mock classifier:
  split UTF-8/JSON bytes, valid early operations then clean EOF, mid-record
  EOF, rejected body read, provider error record, invalid final commit, output
  `length`, deadline, cancel, and late response after a new run. Assert the
  browser message, terminal diagnostic, saved state and recovery controls.
- Run targeted tests, whole-tree typecheck, and the diagnostic replay CLI. A
  rendered desktop and Android-sized recovery fixture must show safe wording
  and intact controls. Record request/run correlation and bounded phase counts.
- At the next meaningful live milestone, exercise one fresh create/edit per
  OpenRouter, funded Gateway, and connected ChatGPT, respecting the authorized
  call/output limits. If a stream fails, retain its sanitized trace and
  reproduce the classified failure locally before changing behavior. These
  live calls use Luna only. An unfunded Gateway or unavailable signed-in
  browser leaves that provider's acceptance open rather than being simulated.
