import {
  mkdtemp,
  readFile,
  mkdir,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const target = await mkdtemp("/tmp/orbsie-source-rebuild-");
try {
  const sources = JSON.parse(
    await readFile("public/player/source.json", "utf8"),
  );
  for (const [name, content] of Object.entries(sources)) {
    const path = resolve(target, name);
    if (!path.startsWith(target + "/")) throw Error("Invalid source path");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  await symlink(resolve("node_modules"), target + "/node_modules");
  execFileSync(process.execPath, ["build-source.mjs"], {
    cwd: target,
    stdio: "pipe",
  });
  console.log(
    JSON.stringify({
      status: "passed",
      sourceFiles: Object.keys(sources).length,
      networkInstalls: 0,
    }),
  );
} catch (error) {
  console.error(error.stderr?.toString() ?? String(error));
  process.exitCode = 1;
} finally {
  await rm(target, { recursive: true, force: true });
}
