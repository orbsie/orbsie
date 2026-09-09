# First browser-modeling OpenRouter attempt

The harness targeted the production build on local port 3048 with the authorized Luna model and 512-output-token cap. Creation returned HTTP 403 before provider generation: the screenshot shows the app's origin-check error. The local server inherited production BETTER_AUTH_URL, so localhost requests were rejected by `checkOrigin` before model preflight or inference. This is a test-server configuration failure, not evidence about OpenRouter or browser geometry quality.

The server was restarted with BETTER_AUTH_URL matching its loopback origin; the separate `browser-manifold-openrouter-origin` run retains the retry. Production origin validation was not weakened. This initial run does not pass any creation/edit/export gate.
