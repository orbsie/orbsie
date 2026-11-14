# Publish-readiness execution status

Tracks execution of `docs/publish-readiness-plan-20261113.md`. Update this file
at every handoff; the plan document stays the scope snapshot.

Last updated: 2026-11-13.

| ID | Step | Status | Evidence / blocker |
| --- | --- | --- | --- |
| B01 | ChatGPT feasibility and test bounds | **Blocked — owner/provider** | Needs supported OpenAI client registration + subscription entitlement. |
| B02 | Code-free subscription login | Not started | Depends on B01. |
| B03 | Real OpenRouter OAuth acceptance | **Synthetic gates passed; owner consent open** | `test`/`draft`/`races` fixtures pass against the local production build (`docs/evidence/openrouter-oauth-synthetic-20261113/`). The fresh unmodified PKCE return and a generation using the OAuth-issued key still need the owner's browser. |
| B04 | Review accounting + production schema | **Code fixed; DB gate open** | `authoring-run-limits.ts` derives the reservation (4 calls) and the full-cost boundary is unit-tested. Real-PostgreSQL suite needs an isolated database; production schema still unconfirmed. |
| B05 | Gateway output reliability and recovery | **Blocked — provider** | Fix candidates need funded Gateway runs to validate; no silent repair allowed. |
| B06 | Durable ChatGPT generation and review | Not started | Depends on B01/B02. |
| B07 | Publish the held Gateway artifact | **Blocked — owner credentials** | Needs a synthetic production account and publication execution. |
| B08 | Catalog workflow evidence matrix | **Deterministic half passed** | Catalog audit (11 GLBs, 11 bounds) and the three-mode comparison pass with zero external requests (`docs/evidence/catalog-comparison-20261113/`). Per-provider live cases and the responsiveness verdict still need provider credentials. |
| B09 | Integrated unbounded-world acceptance | **WebGL lane passed; software lane blocked** | WebGL far-world lane passed all 11 checks including the isolated standalone player; the forced-Canvas2D lane stops on a 60 s screenshot timeout under software rendering (`docs/evidence/far-world-browser/current-20261113/`, status failed). Live far edit/publication and Android travel still need access. |
| B10 | Visual quality and formation UX | **Blocked — human judgment + provider** | Requires inspected recordings and live provider scenes. Composer-continuity keyboard evidence passes on the current build; visual quality itself is unreviewed. |
| B11 | Representative performance | **Blocked — hardware** | SwiftShader runs exist but do not count: 14-entity frame intervals median 133 ms / p95 250 ms / p99 367 ms, submit-to-feedback 133 ms DOM and 1106 ms first frame. A normal laptop and physical phones are still required. |
| B12 | Physical iOS/Android gates | **Blocked — owner devices** | No physical devices attached. |
| B13 | Continuous flagship journey per provider | **Blocked — owner access/usage** | Needs cloud, accounts, publication and bounded provider budget in one session. |
| L01 | Freeze a reviewed release | **Deterministic gates passed; release freeze open** | At `b58fd2f`: suite 216 files / 2,018 passed / 30 skipped, typecheck clean, build compiled, catalog audit and standalone source rebuild passed. Live/provider/device/deployment evidence is still required before a candidate can be declared release-ready. |
| L02 | Enable review and deploy candidate | **Blocked — owner production access** | Needs schema confirmation, `ORBSIE_AUTHORING_REVIEW=1`, deploy. |
| L03 | Verify the served release | **Blocked — owner** | Depends on L02. |
| P01 | Waitlist email delivery | Post-launch | Needs Resend terms and sender verification. |
| P02 | Deferred scope | Post-launch | Social, billing, collaboration, multiplayer, marketplace. |

## B04 detail

- Defect: `AUTHORING_RUN_REVIEW_SLOTS = 3` review calls plus the initial
  generation allowed four inference calls, but the shared daily ceiling
  reserved three units (`FREE_AUTHORING_GLOBAL_UNITS = 3`), so a full-length
  free run could overspend the ceiling by one call.
- Fix: both constants live in `src/lib/server/authoring-run-limits.ts`, and the
  reservation is `1 + AUTHORING_RUN_REVIEW_SLOTS`. `trial.ts` accepts global
  units up to that derived maximum and exports the pure budget arithmetic for
  testing.
- Tests: `tests/authoring-run-accounting.test.ts` covers call/unit equality,
  the full-cost claim, the refusal boundary and `floor(limit / units)`
  admission. `tests/authoring-run-ledger.test.ts` fixture updated to a full
  reservation.
- Still open: run
  `RUN_AUTHORING_LEDGER_DATABASE_TEST=1 ORBSIE_LEDGER_TEST_DATABASE_URL=<isolated-db> npx vitest run tests/authoring-run-ledger-database.test.ts tests/authoring-public-review-route-pg.test.ts`
  against a disposable database, then confirm the production ledger schema
  before enabling review.
