/** Test-only HTTP fixture transport. Never imported by the application/player. */
import { createServer } from "node:http";
import { build } from "esbuild";
let transport;
export async function installFixtureGeneration(context) {
  if (!transport) {
    const bundled = await build({
      entryPoints: ["src/lib/fixtures.ts"],
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
    });
    const { fixtureCommands, fixtureEdit } = await import(
      `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString("base64")}`
    );
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const { project, prompt, selected } = JSON.parse(body);
      const commands = project.entities.length
        ? fixtureEdit(project, prompt, selected)
        : fixtureCommands(prompt.toLowerCase().includes("garden"));
      response.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
      });
      for (const command of commands) {
        if (response.destroyed) break;
        await new Promise((resolve) =>
          setTimeout(resolve, command.type === "reserve_entity" ? 170 : 240),
        );
        response.write(JSON.stringify(command) + "\n");
      }
      response.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    server.unref();
    transport = `http://127.0.0.1:${server.address().port}/api/generate`;
  }
  await context.route("**/api/trial", (route) =>
    route.fulfill({ json: { enabled: true, remaining: 3, limit: 3 } }),
  );
  await context.route("**/api/generate", (route) =>
    route.continue({ url: transport }),
  );
}
