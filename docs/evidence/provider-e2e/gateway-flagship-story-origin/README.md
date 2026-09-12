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
