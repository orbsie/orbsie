# OpenRouter post-residency browser run

The live browser harness completed its configured provider checks at
2026-09-23 12:09:28 UTC against the isolated production server at
`http://127.0.0.1:3014`. The run used the local-only OpenRouter scope, model
`openai/gpt-6-luna`, service tier `default`, and a 4096-token output cap.

Creation and the material edit passed. The harness recorded exactly two
`/api/generate` requests, both HTTP 200, with a generation budget of two. It
recorded no budget violations or blocked external requests. The configured
provider checks passed.

The report's flagship journey status is `incomplete`: this bounded two-call run
did not exercise the separate full flagship gameplay journey. The JSON also
records the harness checkout as clean but leaves the application source commit
unrecorded.

`openrouter.json` and the browser artifacts are sanitized. The local credential
was loaded into the harness process and is absent from every file in this
directory.
