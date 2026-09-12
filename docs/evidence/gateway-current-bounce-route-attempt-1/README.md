# Gateway current seven bounce route — attempt 1

This is the first bounded offline browser attempt against the unchanged
Gateway export. It used real desktop keyboard events and read-only rendered
telemetry from the standalone ZIP. No teleport, state mutation, provider call,
model call, external request, or page error was observed.

The source contract is project `d8d48be6-dae2-4531-a7cb-77e8906b4c75`,
revision `37`, ZIP SHA-256
`33ed9d40916776583a1246701901d40247fd5712358d4c4a790cbeaff8e0668a`,
`project.json` SHA-256
`9886bff93cecfd654368c461fdc8ae6783c399bf24ff45f67d41843b64b688eb`,
`runtime.js` SHA-256
`825e0fea3acca57a52af9c06eb3489128788494575196b9ca68b68035c782917`, and
`runtime.css` SHA-256
`3d3800a8f3cab26abb0fcf4dac4f0f34dc12d45c135050327698099130010182`.

Observed evidence:

- `platform-1`: descending contact `24646.1 ms`, ascent `24775.4 ms`.
- `platform-2`: descending contact `26689.7 ms`, ascent `26819.7 ms`.
- `platform-3`: descending contact `29729.5 ms`, ascent `29854.5 ms`.
- `crystal-3` was collected during the post-route bounce, reaching score 7.
- The player then returned to ground at `31169.3 ms`; the route driver had
  not reached the portal before the bounded attempt ended.

This is a partial result: it proves all three bounce transitions and all seven
collectibles, but not portal victory or Play again reset. See
[`summary.json`](summary.json) and the retained
[`desktop-route-failure.png`](desktop-route-failure.png) and video for the
raw run artifacts.
