# Published flagship touch run — snapshot contact metadata mismatch

This diagnostic run used the existing published flagship URL in `report.json`
at 390×844 with CDP touch emulation. It is browser emulation, not a physical
phone test.

The run failed to prove a platform-1 landing because the verifier used the
current repository catalog manifest for this older saved ZIP. The saved ZIP
and the earlier passing desktop report use platform-grass Y bounds 0 to
0.0825, which put player contact at Y 1.440625. The current repository bounds
are -0.05 to 0.0325, which moved the verifier's computed contact down to
1.428125. The trace includes player samples at Y 1.440625, so the mismatch
rejected the actual snapshot contact. The report preserves this failed run and
video as regression evidence; its landing result is not a product-runtime
failure finding.

The run made zero model calls and recorded only same-origin GETs. It had no
external or mutating requests, blocked API requests, or page errors.
