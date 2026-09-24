# Four-call browser review fixture

The deterministic local fixture ran against the real Orbsie editor and canvas
on Sep 24, 2026. Its new software-renderer path made four intercepted requests:
initial creation, two correction-bearing reviews, then a final verdict. Each
review captured the correct rendered revision, and all three image digests
changed across the two corrections. The final revision was saved and both
desktop and phone viewport screenshots were inspected. No live model calls
were made. The existing three-call WebGL/software paths, partial continuation,
and signed-in journal conflict/recovery checks also passed in this run.

`report.json` is the sanitized fixture output. The PNGs show the synthetic
lantern scene after the second correction. This fixture validates transport,
revision fencing, rendering, and persistence; it does not demonstrate live
model quality or provider acceptance. Production authoring review remains off.
