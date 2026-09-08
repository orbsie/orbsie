# Browser renderer availability

`node scripts/probe-browser-renderer.mjs` opens an isolated regular Chrome window on the available display and reads its WebGL renderer, without network or model requests. The recorded renderer is SwiftShader; this is not hardware-GPU evidence. Host `nvidia-smi` separately reported a Quadro RTX 8000 with driver 595.84, but physical GPU presence does not prove that Chrome uses it. A headless ANGLE/OpenGL probe returned no WebGL context.

No driver, display-server, or user-browser settings were changed. Normal-laptop hardware-rendered performance remains unverified and requires a browser session that actually exposes the GPU. The formation benchmark now includes its own actual WebGL renderer identifier for subsequent runs. Even a hardware renderer identifier alone does not certify frame-time targets.
