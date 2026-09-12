# Gateway flagship story — stopped after creation

Local production build from source `9098500`, served at 127.0.0.1:3068 with
BETTER_AUTH_URL matching that origin and ORBSIE_GENERATION_MAX_TOKENS=4096.
One Luna generation request returned HTTP 200. The resulting saved project
failed the friendly-tree creation assertion, so neither edit ran. No provider
retry, account creation, publication, or deployment occurred. Visual and
semantic diagnosis remains required; HTTP 200 alone is not acceptance.

Earlier retained directories record pre-provider configuration failures:
`gateway-flagship-story` rejected the advertised output cap before generation;
`gateway-flagship-story-bounded` made one app request rejected by checkOrigin
before provider execution. They must not be counted as successful model calls.
The private temporary credential file was removed after the terminal run.

## Visual diagnosis

Root inspected `gateway/failure.png`: the scene visibly contains trees labelled
Friendly Oak, Sunny Pine, and Little Oak. The friendly-tree assertion searched
only label plus geometry kind, so catalog assets with `kind: asset` could be
missed. This is a classifier defect, not evidence that Gateway omitted trees.
The report records 29 operations, 6 catalog entities, 2 procedural entities,
5 generated entities, and a visible seed. These facts do not prove either
subsequent edit, undo, reload, or the complete flagship story.

The current harness persisted the created project after the semantic assertion;
therefore this failed assertion did not retain the full project JSON. Fixing
that evidence ordering is required before another meaningful acceptance run.
