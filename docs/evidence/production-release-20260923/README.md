# Production release check — September 23, 2026

Local source commit `0a28ae0` passed `npm run build`. Vercel deployed it as
`dpl_2K6W21xkePP1Egkv9brNrbBEZFc4` with the production environment and
reported Ready. The candidate served `/`, `/api/config`, `/robots.txt`,
`/sitemap.xml`, and `/player/runtime.css`; the last file's SHA-256 matched the
local build. The deployment was promoted to `https://orbsie.com/`, and Vercel
inspection resolved that domain to the new deployment.

The signed-out production browser smoke used a 390×844 mobile viewport and
deliberately disabled WebGL to test compatibility graphics. The software canvas
painted the planet, the prompt composer remained visible, and no generation
request was made. [report.json](report.json) records the status, canvas pixel,
and page-error classification; [the screenshot](landing-software-mobile.png)
shows the result. The single Three.js WebGL-context error was expected during
fallback.

Android 15 emulator Chrome also opened the promoted `orbsie.com` page at
412×786 CSS pixels with WebGL forced unavailable. Its software canvas painted
the planet and the composer remained available, with zero generation requests.
The [Android screenshot](landing-android15-software.png) and `android15Emulator`
entry in the report record this separate check.

This release check does not cover a live provider request, ChatGPT consent,
physical mobile hardware, new game export/publication, or the disabled
production authoring-review flag.
