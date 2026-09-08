# Play during generation stream evidence

Status: **passed**

The targeted verifier ran one normal-motion browser session against `http://localhost:3030`. It read `docs/evidence/game-program-chatgpt/world.zip`, verified the saved one-crystal project and three rules, and derived the NDJSON stream from that replay: `reserve_entity`, refined `set_geometry`, and `set_game` were flushed first, with the response held open.

The actual editor reached the ready descent state while `.building-message` remained visible. Clicking the real Play button and pressing real `ArrowRight` produced HUD score 7 while building continued. The gated `set_material` update changed the crystal to `#5d8cff`; IndexedDB showed the color and geometry tint, the game program was unchanged, score stayed 7, and Play stayed active while the response remained open. The verifier then flushed `commit_revision` and EOF. After building ended, score remained 7 and real `ArrowUp` produced “Adventure complete” with final score 7.

Evidence:

- App source: `f6e58014983878c6136babfe86c8aaa782bcb4c0`
- Repository checkout: `a7d609a52e454efdcb7c24a74e556ab475c2d02f`
- Replay archive SHA-256: `5e4a41c741b5ffd5bc3524e7da222fc4c2688695a44df47026d3a992bd1d0b5c`
- Project JSON SHA-256: `21f630965d78748a1b6cf458f38714df9094b9bd43c6c6e9118e634bb6b42484`
- Stream timeline and assertions: `docs/evidence/play-during-stream/report.json`
- Final settled screenshot: `docs/evidence/play-during-stream/final.png`

No provider calls, blocked external requests, page errors, or console errors occurred. Chromium reported the known rewritten localhost fixture `POST /api/generate` `net::ERR_ABORTED` after the 200 response was consumed through EOF; it is recorded with the exact fixture URL and was the only request failure.

The check covers this narrow input-rule gameplay path during an open response. It does not establish physical traversal, partial provider/model stream semantics, or live inference behavior.

Astra reviewed the final harness, exact replay hashes, persisted material/game assertions, stream completion flags, and final screenshot. No production code change was required.

```sh
TEST_URL=http://localhost:3030 ORBSIE_APP_SOURCE_COMMIT=f6e58014983878c6136babfe86c8aaa782bcb4c0 node scripts/verify-play-during-stream.mjs
```
