# Garden interaction verification

The test uses the actual production build from `385b66206f7b827bdab9da1c5b7a9356f5c5a11b` at localhost:3031. The supplied source SHA is provenance supplied by the operator, not a browser attestation. Run with:

```sh
TEST_URL=http://localhost:3031 ORBSIE_APP_SOURCE_COMMIT=385b66206f7b827bdab9da1c5b7a9356f5c5a11b node scripts/verify-garden-interaction.mjs
```

One test-only intercepted generation response creates the garden through the normal composer and reducer. The browser reloads and reopens the saved world before entering Play. The test locates a rendered flower by color, checks its position and area are stable before clicking, clicks with a real pointer, verifies its colored area expands, then clicks again and requires the position and area to return within three pixels and five percent of the original. Before, expanded and restored screenshots retain the visible evidence.

The downloaded ZIP must contain the garden title and 12 bloom behaviors. A separate browser context serves only the ZIP contents from a new local origin and repeats the same pointer interaction. This proves a second scene type in the current editor and independent exported runtime; it does not prove a live provider garden, touch interaction, source rebuild, or dedicated cloud publication. Authored scene recovery is checked; temporary Play-mode flower size is not claimed to persist across reload.

Chromium runs headlessly with SwiftShader, at 1440×1000 for the editor and 1280×800 for the exported player, with normal motion. Google Fonts requests are explicitly stubbed in the editor. Other external requests are rejected and recorded; the standalone runtime permits only its own origin and data URLs. The report must show one fixture generation request, zero live provider calls, zero unexpected external requests and zero page errors. These are functional checks, not hardware performance certification.

Astra reviewed the worker's initial harness and screenshots, then added the stable baseline, reversible toggle assertions, exact generation-request counting and corrected source/provenance labels before the final targeted run.
