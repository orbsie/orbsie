# Live procedural diagnostic: upstream 429

The corrected observer captured `PROVIDER_STREAM_ERROR` with numeric
`providerStatus:429` before any scene operation. The outer Orbsie response
was HTTP 200 because the failure arrived inside the provider stream. The
harness stopped immediately instead of waiting for the reservation deadline.

One generation request used OpenRouter `openai/gpt-5.6-luna`, low reasoning,
default processing and the unchanged 512-token output cap. There was no
intercepted response, alternate model, edit request or fallback. Further
OpenRouter calls were stopped after this rate-limit evidence.

The observer was separately checked with a local synthetic stream: it
retained the bounded diagnostic while leaving the original response intact,
with no model calls. Runtime source was the production build recorded by
`e85ca5d`; observer integration was corrected in `7723249`.

This is a failed live acceptance attempt. Browser/editor fixture acceptance
and server-write integrity tests support releasing the implementation, but
live procedural creation/editing, all-provider acceptance and publication
remain open requirements. The preceding invalid-model-update attempt still
needs its own diagnosis once live testing can resume.
