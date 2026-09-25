# OpenRouter publication on Android Chrome

The exact deployment pinned by `provider-artifact-publication-openrouter-current-20260925/report.json` was opened in a signed-out Chrome tab on the Android 15/API 35 `droidlm_api35_midrange` emulator. The pinned source is OpenRouter model `openai/gpt-5.6-luna`, project revision 8. Chrome 124 exposed a 412×786 CSS-pixel viewport at DPR 2.625 with five touch points.

Renderer selection was automatic. The harness observed a successful WebGL2 context whose renderer string identifies Android Emulator SwiftShader, then a successful 2D context and the visible `.software-world` game view. No WebGL context was blocked by the harness. The active game view therefore used Canvas2D through the page's automatic renderer selection.

CDP touch input moved Right and raised the score to 7. Restart returned the score to 0; Forward reached the win state; Restart followed by Left reached the loss state. The retained ready and scored captures visibly show the player, tree, and mushroom; the win and loss captures show their end states. The HUD and the visible scene were both reviewed.

The report records all observed requests, viewport, context details, page and console errors, and cookies. There were no generation requests, external-origin requests, page errors, console errors, or cookies, and no provider calls. Chrome's Enhanced ad privacy onboarding appeared before the check; no option was selected. No login, terms acceptance, publication change, or renderer override occurred.

This is emulator gameplay evidence for the pinned artifact. It does not establish physical-device behavior or performance.
