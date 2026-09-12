# Input consumption latency

This directory contains one bounded offline SwiftShader attempt against the production `World` renderer. The fixture used Playwright keyboard events and CDP touch events on buttons wired through `beginPlayerPointerInput`/`endPlayerPointerInput`; no provider or model calls were made.

The attempt timed out waiting for the fixture readiness callback, so it captured no latency samples and does not establish the browser correctness gate. The renderer did produce the island; see [input-consumption-latency-failure.png](./input-consumption-latency-failure.png). The concrete cause was an async fixture setup race: `useOrb.load(project)` completed after the fixture set `playing: true`, resetting it to `false` before `Player` could announce readiness. The fixture now awaits `load(project, true)` before mounting; this correction was made after the sole browser attempt and was not rerun.

`report.attempt-1.json` preserves the exact failed-run report and source hashes. Its fixture hash is `2bb2fe125961a73e5bd9f958250ea2c7111f99236301d9a34d25377bf417dedb`. The current corrected fixture hash is `6d5a32219325a120b4421d8512823e1a40faf27cc0396e4460087f7a6195248a`. The report records zero external requests and zero provider calls; no latency statistic is reported because no sample was captured.

Samples represent accepted input to the `consumePressed()` simulation boundary. They do not measure rendered feedback, input-to-photon latency, or device performance.
