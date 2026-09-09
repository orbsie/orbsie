# Instrumented live extrusion retry

Source a889989, rebuilt production app at loopback. Exact Luna model and existing local-only credential, 512 output-token cap unchanged. One live request returned HTTP200; a seed appeared after 3629ms, then the same safe invalid-scene-update error appeared. The harness now failed promptly rather than waiting three minutes. No edit/export/fallback occurred.

Server diagnostic serialization passed 14 synthetic tests, but the browser report contains no diagnostic record from this live response. Diagnostic transport/capture remains unresolved; the rejected field cannot be inferred from this evidence. No third live request was made in this investigation turn.
