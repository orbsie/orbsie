#!/usr/bin/env node
// Start the existing production build on loopback for live authoring-review
// tests. `next start` also loads .env.production.local, whose VERCEL=1 makes
// anonymous admission require Vercel's forwarded-IP header and fail with 503
// before inference, so this launcher always overrides the loopback-specific
// values instead of relying on the operator to remember them.
import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_KEYS = new Set(["DATABASE_URL"]);

/** Parse a KEY=value env file, keeping only the isolated database URL. */
export function parseIsolatedEnvFile(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    if (!ALLOWED_KEYS.has(key)) continue;
    values[key] = line
      .slice(index + 1)
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2");
  }
  if (!values.DATABASE_URL)
    throw new Error("The isolated env file must set DATABASE_URL.");
  const database = new URL(values.DATABASE_URL).pathname.slice(1);
  if (!/^orbsie_[a-z0-9_]+$/.test(database) || database === "neondb")
    throw new Error(
      "DATABASE_URL must name a disposable orbsie_* database, never the shared one.",
    );
  return values;
}

/** Build the loopback server environment; overrides win over every .env file. */
export function isolatedReviewServerEnv(baseEnv, isolated, port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new RangeError("Port must be an unprivileged integer.");
  return {
    ...baseEnv,
    DATABASE_URL: isolated.DATABASE_URL,
    BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
    VERCEL: "0",
    ORBSIE_AUTHORING_REVIEW: "1",
    ORBSIE_GENERATION_MAX_TOKENS: "4096",
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [envFile, portText] = process.argv.slice(2);
  if (!envFile || !portText) {
    console.error(
      "Usage: node scripts/start-isolated-review-server.mjs PRIVATE_ENV_FILE PORT",
    );
    process.exit(2);
  }
  const path = resolve(envFile);
  if ((statSync(path).mode & 0o077) !== 0) {
    console.error("The isolated env file must not be group/world readable.");
    process.exit(2);
  }
  const port = Number(portText);
  const env = isolatedReviewServerEnv(
    process.env,
    parseIsolatedEnvFile(readFileSync(path, "utf8")),
    port,
  );
  console.log(
    `Starting isolated review server at ${env.BETTER_AUTH_URL} (VERCEL=0).`,
  );
  const child = spawn(
    "npx",
    ["next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
    { env, stdio: "inherit" },
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  child.on("exit", (code, signal) => process.exit(signal ? 130 : (code ?? 1)));
}
