import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { readFile } from "node:fs/promises";
if (!process.env.DATABASE_URL)
  throw Error("Set DATABASE_URL before running migrations.");
const database = new Pool({ connectionString: process.env.DATABASE_URL });
const migration = await getMigrations({
  database,
  emailAndPassword: { enabled: true },
});
await migration.runMigrations();
await database.query(await readFile("scripts/schema.sql", "utf8"));
await database.end();
console.log("Orbsie account and project tables are ready.");
