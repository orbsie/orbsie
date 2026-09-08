import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

// Operator-only: sends confirmations solely to durable, existing signups.
// Example: node --env-file=.env.local scripts/flush-waitlist.mjs
if (
  !process.env.DATABASE_URL ||
  !process.env.RESEND_API_KEY ||
  !process.env.WAITLIST_EMAIL_FROM
)
  throw Error(
    "Configure database and waitlist email delivery before flushing.",
  );
await mkdir(".vercel", { recursive: true });
const directory = await mkdtemp(".vercel/waitlist-flush-");
try {
  const outfile = join(directory, "run.cjs");
  await build({
    stdin: {
      contents: `import {database} from './src/lib/server/auth';
import {deliverWaitlistConfirmation} from './src/lib/server/waitlist';
async function main() {
  const db=database();
  try {
    const rows=await db.query("SELECT id,email,confirmation_sent_at FROM orbsie_waitlist WHERE confirmation_sent_at IS NULL AND attempts < 5 AND next_attempt_at <= now() AND (first_attempt_at IS NULL OR first_attempt_at > now()-interval '23 hours') ORDER BY created_at LIMIT 20");
    let accepted=0;
    for (const row of rows.rows) {
      if(await deliverWaitlistConfirmation(row)==='sent') accepted++;
      await new Promise(resolve=>setTimeout(resolve,600));
    }
    console.log(JSON.stringify({examined:rows.rows.length,accepted,pending:rows.rows.length-accepted}));
  } finally { await db.end(); }
}
main().catch(()=>{console.error('Waitlist flush could not complete. Pending records remain durable.');process.exitCode=1;});`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    packages: "external",
    platform: "node",
    format: "cjs",
    outfile,
  });
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [outfile], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code !== 0) process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
