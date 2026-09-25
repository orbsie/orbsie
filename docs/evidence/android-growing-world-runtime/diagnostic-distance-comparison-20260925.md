# Android camera-distance closure diagnosis

These bounded probes compare fresh Android 15/API 35 `droidlm_api35_midrange`
emulator boots running Chrome 124 and the direct SoftwareWorld Canvas2D
fixture. The 1-entity setting is a diagnostic-only fixture transform; it is not
an acceptance configuration. Every run made zero provider calls and external
requests, and every harness-owned emulator/ADB resource was cleaned up.

| Fixture and initial distance          | Exact result                                                                                                                                                                            | Android process evidence                                                                                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 120 entities, 100 m                   | Readiness-only run passed `fixture.ready()` and captured a ready-scene screenshot. It did not run travel cycles.                                                                        | No matching Chrome failure lines.                                                                                                                                                                                                                     |
| 120 entities, 5,000 m, baseline       | The page target closed during `scene-readiness`, before `fixture.ready()`. HTTP 200 and DOMContentLoaded were recorded; no page or console error preceded closure.                      | Default-buffer collection found no matching failure line.                                                                                                                                                                                             |
| 120 entities, 5,000 m, readiness-only | Same failure stage: page closed before `fixture.ready()`, after HTTP 200 and DOMContentLoaded.                                                                                          | One lowmemorykiller line said it could not open `/proc/2208/oom_score_adj` because PID 2208 might have been killed. It did not identify that PID as Chrome or provide an exit reason.                                                                 |
| 1 entity, 5,000 m                     | Reached `fixture.ready()`, then the target closed during `software-scene-readiness-sample`; the first state sample failed with a closed-target error. An early screenshot was captured. | All-buffer logcat recorded `am_kill` for sandbox PID 2290 as `isolated not needed`. Retained exit info records PID 2290 as `OTHER KILLS BY SYSTEM / ISOLATED NOT NEEDED`. This was collected after target closure and does not establish the trigger. |
| 1 entity, 100 m                       | Navigation failed at `fixture-navigation-and-dom-ready` with `net::ERR_ABORTED`, before DOMContentLoaded.                                                                               | All-buffer logcat recorded two sandbox services dying around the failed navigation (`cch CACC`, PIDs 2238 and 2258); exit info classified them `EXIT_SELF`. A later service exit was `UNKNOWN`. Chrome main PID 1596 remained.                        |

An earlier 1-entity/100 m fresh-boot probe also aborted before DOMContentLoaded
and recorded two sandboxed Chrome child deaths. See
[the earlier report](./1-entity-distance-100-readiness-2026-09-25T05-32-04-551Z/report.json).

The 120-entity comparison is consistent with camera distance contributing to
the failure, because the 100 m run passed while both 5,000 m runs failed before
readiness. It does not establish that cause. The 1-entity runs failed at
different stages, including one failure before document readiness at 100 m and
a later-stage closure after readiness at 5,000 m. Android's isolated-process
exit records describe child-process disposition; they do not by themselves
show why Chrome closed the page, and none establishes OOM. A renderer, browser,
fixture or fresh-emulator interaction remains possible.

No diagnostic run completed the normal 120/160 acceptance flow. No travel,
frame-time or heap acceptance was obtained. Normal acceptance thresholds were
not changed. Exact lifecycle, request, screenshot and cleanup details are in
the individual reports:

- [120 entities at 100 m](./120-entity-distance-100-readiness-2026-09-25T06-14-28-661Z/report.json)
- [120-entity 5,000 m baseline](./120-entity-baseline-2026-09-25T06-15-33-469Z/report.json)
- [120 entities at 5,000 m, readiness-only](./120-entity-distance-5000-readiness-2026-09-25T06-16-52-089Z/report.json)
- [1 entity at 5,000 m](./1-entity-distance-5000-readiness-2026-09-25T06-21-29-328Z/report.json)
- [1 entity at 100 m](./1-entity-distance-100-readiness-2026-09-25T06-22-57-489Z/report.json)
