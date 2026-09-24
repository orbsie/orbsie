# OpenRouter three-call authoring review: incomplete

The isolated local production app ran a real browser create/review cycle with
`openai/gpt-6-luna`, standard processing, and a 4,096-output-token cap per call.
The first call committed a scene at revision 15. The first visual and structural
review requested a correction and returned a binding for revision 17. The
browser sent a final visual and structural review for that exact project,
revision, and authoring run. OpenRouter review execution returned HTTP 502 after
about 6.7 seconds, so there is **no final accept verdict**. The run made exactly
three provider calls and no automatic retries. The sanitized request IDs,
revision bindings, and phase order are in [report.json](report.json).

The server's current terminal diagnostic classifies this failure only as
`provider-error`/`host-unavailable`; it does not distinguish a rejected provider
request, an incomplete provider response, or a validation failure. The browser
test exited at that error before it checked revision-17 persistence after
reload. Neither failure source nor recovery is claimed from this run. The
isolated credentials and full-page connection screenshot remain outside the
repository in a mode-0700 private evidence directory; the report contains no
provider key, prompt, raw review payload, or screenshot pixels.
