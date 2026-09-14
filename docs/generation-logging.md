# Investigating a generation failure

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
failed. The provider adapter and client validation remain authoritative.

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

Client diagnostic download and production log-visibility acceptance are tracked
separately in `generation-observability-task.md`. Server unit tests alone do not
establish either of those outcomes.
