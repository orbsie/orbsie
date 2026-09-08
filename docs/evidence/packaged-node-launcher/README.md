# Bundled Node launcher evidence

Run `node scripts/verify-packaged-node-launcher.mjs` using the pinned Node distribution, or set `ORBSIE_NODE_DISTRIBUTION` to its root. The script packages into a temporary directory, verifies relocation and startup without Node on PATH, checks failure without Blender, and removes its temporary artifacts. It makes no network requests or provider calls.

`report.json` records the passing Linux x64 component check. Installed bytes include the application and Node only. Help startup is not Blender cold start. This does not certify a portable Blender installer, clean-host compatibility, browser pairing or model generation.
