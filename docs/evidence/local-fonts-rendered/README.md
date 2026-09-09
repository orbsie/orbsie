# Self-hosted font acceptance

`node scripts/verify-local-fonts.mjs docs/evidence/local-fonts-rendered` passed against the local app with the self-hosted-font changes applied. DM Sans and Manrope both loaded real font faces at weight500 from same-origin WOFF2 files. Three font resource requests (CSS and two WOFF2 files) succeeded, with zero external requests. Astra inspected the settled landing screenshot.

The separate `../flagship-local-fonts/` fixture run passed creation, targeted mushroom edit, slowed platform plus additional collectibles, play HUD, undo and reload. It made no live model calls, used no font stubs, and reported zero external requests/page errors/console errors. Three test transport ERR_ABORTED events remain recorded. Its source field records the baseline e7eb602; the font changes were applied in the worktree for that run.

Fontsource package provenance and unmodified OFL texts are under public/fonts. The initial ../local-fonts/ screenshot was captured before the renderer settled; use this directory for visual review.
