# Experience instrumentation release

Source `a1a0451` deployed successfully to `https://orbsie-pul7czaq7-grappeggias-projects.vercel.app` and was aliased to `https://orbsie.com` on 2026-09-08. The production build passed. Before deployment, the rebuilt standalone player replayed a saved ChatGPT-authored game with scoring, win, loss and restart; the flagship editor fixture passed combined revision, undo and reload checks.

The read-only production smoke passed: homepage 200, anonymous generation-journal request 401, exact committed player and decoder-worker hashes, visible canvas and expected composer, and no browser page errors or non-GET requests. The captured landing screenshot was visually inspected. No model generation was submitted. The existing Google Fonts stylesheet is an external GET dependency.

This establishes the platform release and bundle integrity, not complete live-provider E2E, latency targets, native-GPU performance or independent per-Orb publication. Those requirements remain open as recorded in `../../scope-audit.md`.
