# Account UI acceptance — 2026-09-07

## Scope and production evidence

Used Chromium/Playwright against `https://orbsie.com` after account/cloud services became available. Reused the first synthetic account from the ignored mode-0600 cloud acceptance state. Created one separate demo world for UI acceptance; no model inference requests or publication POSTs were made. The cloud acceptance sample was not modified.

Real production browser checks passed:

- Unsubmitted landing prompt survives sign-in.
- Demo generation produces a locally saved 14-object world; cloud Save returns HTTP 200.
- Sign-out/sign-in preserves the active local project and unsubmitted editing prompt.
- A synthetic second-device update to the same owned UI test world causes the stale UI save to return 409 and show an actionable conflict without changing the local draft.
- Opening the cloud copy loads the newer revision and preserves the divergent local recovery copy.
- A subsequent Save returns 200 using the opened cloud revision as its baseline.
- Browser reload recovers the session and cloud library; opening the cloud library item restores the saved world.
- Account dialog has no horizontal overflow at 390 × 844. Screenshot visually inspected.
- No browser page errors; zero inference requests.

Sanitized evidence is in `.vercel/account-ui/{report.json,project.json,conflict.png,share.png,account-mobile.png}`. No credentials/cookies appear in these files.

## Concrete fix

A deterministic browser reproduction found stale cloud-account state: account one receives a conflict, signs out, account two signs in, and the previous account's `Open cloud copy` action remains visible. The assertion failed before the fix and passed afterward.

`orbsie.tsx` now clears account cloud baselines, project lists, conflicts, publication records and link state on successful account transitions. Request guards combine project scope and account generation so delayed cloud/publication responses cannot repopulate an old account. Initial session loading and asynchronous cloud-open metadata callbacks also check the account generation. Sign-out only updates the UI after a successful response; errors retain the session and show a retry message.

No visual redesign or changes to centered prompt/model modes. No world/store/cloud-route edits.

## Validation

- `npx tsc --noEmit` passed.
- `TEST_URL=http://localhost:3012 node scripts/verify-account-switch.mjs` passed after the fix: cloud conflict clears across accounts, published link clears on sign-out, failed sign-out retains the signed-in state.
- `scripts/verify-account-ui.mjs` passed against real production services before this narrowly scoped fix; takes `CLOUD_TEST_STATE` and optional `TEST_URL`/`UI_EVIDENCE_DIR`. Each run creates a separate demo test world and updates it to exercise conflict handling.
- Independent review by `/root/render_performance` identified the initial-session and cloud-open callback guards; both were added and the reviewer rechecked with no additional findings.

## Limits

Actual new-account signup was exercised by the separate API cloud acceptance agent, not this browser run. Real READY/public-link reopening remains blocked by the production Vercel token's `create project` permission error (403), as diagnosed by root/cloud acceptance. This agent did not create another publication attempt. Publication display/reset was exercised with deterministic API fixtures in the browser regression. Root owns final suite/build/deploy and integrated production confirmation.
