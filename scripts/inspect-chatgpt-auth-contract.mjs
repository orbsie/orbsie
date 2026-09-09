// Offline protocol inspection: never starts login or inference.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "orbsie-auth-contract-"));
try {
  const version = execFileSync("codex", ["--version"], {
    encoding: "utf8",
    timeout: 10000,
  }).trim();
  execFileSync(
    "codex",
    ["app-server", "generate-json-schema", "--out", directory],
    { timeout: 30000, stdio: "pipe" },
  );
  const files = await readdir(directory, { recursive: true });
  async function schema(name) {
    const matches = files.filter(
      (file) => file === name || file.endsWith(`/${name}`),
    );
    if (matches.length !== 1) throw Error(`Expected one ${name} schema.`);
    return JSON.parse(await readFile(join(directory, matches[0]), "utf8"));
  }
  const params = await schema("LoginAccountParams.json");
  const response = await schema("LoginAccountResponse.json");
  const variant = (document, type) =>
    document.oneOf?.find((entry) =>
      entry.properties?.type?.enum?.includes(type),
    );
  const deviceRequest = variant(params, "chatgptDeviceCode");
  const deviceResponse = variant(response, "chatgptDeviceCode");
  const required = ["loginId", "userCode", "verificationUrl", "type"];
  if (
    !deviceRequest ||
    !required.every((field) => deviceResponse?.required?.includes(field))
  ) {
    throw Error(
      "Installed protocol lacks the required device authorization contract.",
    );
  }
  console.log(
    JSON.stringify(
      {
        version,
        deviceAuthorizationContract: true,
        deviceResponseRequiredFields: deviceResponse.required,
        externalTokenModeDescription:
          variant(params, "chatgptAuthTokens")?.description ?? null,
        loginStarted: false,
        inferencePerformed: false,
        hostedWorkflowVerified: false,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
