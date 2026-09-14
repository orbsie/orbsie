#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(
  process.argv[2] ??
    resolve(here, "fixtures/generation-observability-fixtures.json"),
);
await access(fixturePath);

// Replay through Vitest so this command executes the browser observer and
// protocol parser used by the app. Keeping this CLI as a thin runner avoids a
// second stream classifier with subtly different validation rules.
const result = spawnSync(
  "npx",
  [
    "vitest",
    "run",
    "tests/generation-observability-replay.test.ts",
    "tests/authoring-activity-store.test.ts",
    "-t",
    "checked-in generation diagnostic replay|replays stream fixtures",
  ],
  {
    cwd: resolve(here, ".."),
    env: {
      ...process.env,
      ORBSIE_GENERATION_DIAGNOSTIC_FIXTURE: fixturePath,
    },
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error(`Generation diagnostic replay failed (${result.status}).`);

process.stdout.write(
  `${JSON.stringify({
    fixture: fixturePath,
    replayedBy: "tests/generation-observability-replay.test.ts",
  })}\n`,
);
