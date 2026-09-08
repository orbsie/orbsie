# Gameplay support release regression

The fixture-driven editor and actual downloaded standalone ZIP passed the existing rendered action workflow after the support-loss and negative-scale collision fixes. Checks cover variable conditions, clicks, color, visibility, position, movement paths and restart. Both screenshots were visually reviewed; score 16 and the moved blue cube are visible. No provider calls, browser errors or external standalone requests occurred.

This browser run checks general gameplay/export regression. The specific support-loss and reflected-platform behaviors are covered by the focused engine/session tests, not this browser scenario. The full suite passed 425 tests with 7 explicit skips; the production build and TypeScript checks passed. Complete provider E2E and portable Blender delivery remain open.
