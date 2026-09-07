# Provider connection and model comparison UI — 2026-09-07

Commit: `e0da489d94db56978961ff797aebbf89803e1e9a` (requires the model metadata/API work in `b4c803e`, cherry-picked locally as `bb7fea8`).

## Changes

- The centered prompt identifies Demo and offers `Connect provider`, opening API-key connection directly. Settings explicitly explain that real generation needs a provider API key and does not require Orbsie sign-in.
- Removed the account-storage/generation prerequisite text. Publishing retains its existing `Sign in to publish` action; local saving remains automatic.
- Quality / Balanced / Budget cards contain only those labels. Model names remain inside Advanced.
- Advanced is a searchable, selectable ranked model list with all input, cached-input, and output price estimates directly on each row. Desktop uses comparison columns; mobile rows wrap into a model heading and three labeled prices.
- Ranking is labeled estimated 3D suitability, with source/date and the caveat that unranked models lack comparable evidence. Rates are labeled estimated USD per million tokens; unavailable values render `—`, while explicit zero remains `$0`.
- Continue requires a model and key for provider mode. Switching provider clears the previous key. Provider select has an explicit accessible name.
- Updated the existing live snapshot verifier to inspect the selected model row instead of the removed native model select.

## Validation

- `npx tsc --noEmit` passed with metadata dependency integrated.
- `TEST_URL=http://localhost:3013 node scripts/verify-provider-ui.mjs` passed twice, including final mobile Demo layout check.
- Fixture browser checks: prompt survives connection; exactly three label-only presets; search/no-results/unranked selection; explicit-zero versus unknown cached prices; per-row ranking/selection; provider change clears key; generation proceeds while account capability is disabled and no auth requests occur; local save completes; publishing still asks for sign-in.
- One synthetic `/api/generate` response, zero requests to real providers, zero auth requests, zero page errors. No real account credentials or provider keys were read.
- Desktop 1440 × 1000 and mobile 390 × 844 screenshots were visually inspected. The globe and centered composer remain intact; Demo action, model catalog, and document have no horizontal overflow.

Sanitized evidence copied to root `.vercel/provider-ui/`: `report.json`, `landing-desktop.png`, `landing-demo-mobile.png`, `landing-mobile.png`, `advanced-desktop.png`, `advanced-mobile.png`. These intentionally show synthetic model fixtures, not live catalog pricing.

Root owns integrated backend anonymous-generation route validation, final build, deployment, and production acceptance. No production model inference was performed.
