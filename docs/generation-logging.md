# Investigating a generation failure

Use **Download diagnostics** beside a generation error or in **Connections**.
The download is created on the device; it is not uploaded automatically. It retains
up to 20 bounded entries and is at most 64 KiB. It includes provider/tier, release
when configured, request/run IDs, phase timings, renderer capabilities, command
counts and revision/outcome information. Unverified model names are omitted.

History survives reload when browser storage is available. An interrupted active
run retains an explicitly incomplete snapshot. **Reset saved data on this device**
clears diagnostic history together with local drafts. If storage is unavailable,
logging remains best effort and must not prevent generation.

Run synthetic failure replays without credentials or model calls:

```sh
node scripts/replay-generation-diagnostics.mjs
```

The checked-in fixtures execute production stream observation, protocol validation
and the client store through the focused test harness. They cover successful
commit, missing commit, malformed/schema-invalid output, semantic scene errors,
read failure, cancellation and stale-run handling. These are synthetic regression
checks, not live-provider acceptance.

Generation routes return `X-Orbsie-Request-Id`. Search application logs for that
UUID to join public-route, provider and hosted-runtime records. A validated
`X-Orbsie-Client-Run-Id` joins the browser run to those records; neither identifier
grants access to a world, account or hosted operation.

Server records are JSON lines with `schemaVersion: 1`. Compare records within
each `layer`: admission, provider start, first byte, first valid command, commit,
then a terminal summary. Duration uses a monotonic clock; timestamps help locate
records across processes. Missing terminal records can also mean that a process
or log delivery stopped; they are not proof of a particular provider failure.

Check the terminal reason and failure code before treating an HTTP 200 as success.
`clean-eof-without-commit` means the stream ended without its final scene commit.
`parser-failure`, `provider-error`, `transport-error`, `deadline` and `client-abort`
describe different recovery paths. `observation-limit` means the bounded observer
could not fully inspect a record; it does not mean that transport or geometry
failed. `output-limit` instead identifies an application-enforced output bound.
The provider adapter and client validation remain authoritative.

Hosted credential persistence is recorded separately as
`credentialFinalization`. Saving credentials does not establish that scene
generation succeeded. Conversely, a scene can commit before credential cleanup
fails. Match layers by request ID rather than interpreting one layer's completion
as completion of the entire user interaction.

Assign `ORBSIE_BUILD_ID` to the actual running artifact when deploying. Accepted
values are a commit hash or a bounded `local` identifier. An existing isolated
ChatGPT executor can survive a web deployment: do not assign the new web commit
to an older executor. Omitted build identity means unknown.

Ordinary logs exclude prompts, model output, scene data, credentials, account
identifiers and arbitrary error messages. These logs locate failures but cannot
reconstruct a private scene. Use synthetic fixtures for deterministic reproduction.
Any optional raw provider capture belongs outside the repository with explicit
content boundaries and restricted permissions; it is not an ordinary log export.

Production visibility was verified for both routes on deployment `dba95bc` using
rejected requests without model calls. Vercel CLI 59.11.7 historical logs project
only the first log message per request, even with `--expand --json`; use the
request details to see all events. Returned event arrays may be unordered: use
phase names and monotonic durations. Evidence: `evidence/generation-observability-
deployment-20260913/acceptance.json`. Client diagnostic release acceptance is tracked in
`generation-observability-task.md`.
