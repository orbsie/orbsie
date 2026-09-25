# Android growing-world low-count diagnosis

Two readiness-only SoftwareWorld runs used separately booted and harness-owned
Android 15/API 35 `droidlm_api35_midrange` AVDs with Chrome 124. Both requested
100 m initial distance and kept page-level CDP and Performance instrumentation
after `fixture.ready()`.

| Scene entities | Navigation and failure                                                                                                                                                                                                                     | Filtered Android log                                                                                                      |
| -------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
|              1 | Navigation to `/` aborted before `DOMContentLoaded`; no HTTP response was recorded and the root request failed with `net::ERR_ABORTED`.                                                                                                    | ActivityManager reported two `com.android.chrome:sandboxed_process0` child deaths. Chrome main PID 1623 remained present. |
|             40 | `/` and `/fixture.js` returned HTTP 200; the document reached `complete` and the unchanged fixture bundle transferred 4,395,147 bytes. Chrome closed the page during the scene-readiness wait, about 2.5 seconds after `DOMContentLoaded`. | ActivityManager reported one `com.android.chrome:sandboxed_process0` child death. Chrome main PID 1623 remained present.  |

The same sandboxed child death appeared at both scene counts. The one-entity
run ended before the fixture loaded; the 40-entity run loaded the same-size
JavaScript bundle but did not reach scene readiness. This weakens a simple
entity-count-only explanation, but does not isolate an environment cause or
rule out added load at 120/160 entities. No filtered line identifies why the
Chrome child exited or establishes OOM. The entity knob narrows scene data
without reducing bundle size. Neither run produced a readiness screenshot,
travel cycle, frame sample, or heap sample. No provider or external requests
were made.

Both reports show successful cleanup of the browser tab, CDP connection,
ADB forward/reverse mappings, local server, temporary files, and owned AVD.
The diagnostic harness source SHA-256 was
`304e1f13fd5116fe10fee5d85b8de2bcf892657927b031303bc826e233e65375`.
See [the 1-entity report](./1-entity-distance-100-readiness-2026-09-25T05-32-04-551Z/report.json)
and [the 40-entity report](./40-entity-distance-100-readiness-2026-09-25T05-33-00-290Z/report.json)
for exact timings, requests, filtered log lines, and process listings.
