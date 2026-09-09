# Live OpenRouter extrusion attempt

Source 997da50, production build served at loopback with BETTER_AUTH_URL matching that origin and ORBSIE_GENERATION_MAX_TOKENS=512. Existing local-only credential, exact openai/gpt-5.6-luna, regular processing. One live generation request returned HTTP200; the seed appeared after 4614ms, then the app rejected an invalid scene update. No edit/export calls were made and no fallback was used.

This is a failed live acceptance run. The screenshot shows the safe invalid-update error; the existing scene remained intact. The report timed out awaiting a committed reply. The harness now checks visible generation errors promptly instead of waiting the full reply deadline. The exact invalid model field was not captured, so its cause remains unresolved. No automatic retry or token-cap increase was made.
