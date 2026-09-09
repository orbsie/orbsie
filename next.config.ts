import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@vercel/sandbox"],
  outputFileTracingIncludes: {
    "/api/chatgpt/*": [
      "./.orbsie/chatgpt-host/server.mjs",
      "./.orbsie/chatgpt-host/package.json",
    ],
    "/api/publish": [
      "./public/player/runtime.js",
      "./public/player/runtime.css",
      "./public/player/generated-geometry-worker.js",
      "./public/player/asset-geometry-worker.js",
      "./public/models/**/*.glb",
      "./assets/catalog/licenses/**/*",
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
