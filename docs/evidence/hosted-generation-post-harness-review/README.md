# Hosted connection browser regression

Source checkpoint: `2b67a8c`. Run on 2026-09-09 against the local development server at port 3047.

Command: `node scripts/verify-hosted-chatgpt-generation-ui.mjs test-results/hosted-generation-post-harness-review`

Passed two synthetic hosted generation requests, targeted geometry editing, browser-generated assets, reload, expired-connection prompt preservation, no free fallback, and no companion contact from a legacy link. No page errors or unexpected requests were observed. The edited screenshot was inspected.

Account, inference and cloud responses are synthetic. The editor and browser geometry worker are real. This verifies the product path after the hosted harness addition; it does not execute the live acceptance harness or prove subscription consent, live inference, publication, or a complete provider journey. See report.json for individual outcomes.
