// Deployment entrypoint for one isolated server-side session, never a user companion.
import { startChatGPTHostServer } from "./chatgpt-host-server";

const port = Number(process.env.PORT ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error("Invalid host port.");
const host = await startChatGPTHostServer({
  token: process.env.ORBSIE_CHATGPT_HOST_TOKEN ?? "",
  hostname: "0.0.0.0",
  port,
});
const stop = () => {
  void host.close().catch(() => {
    process.exitCode = 1;
  });
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
console.log(JSON.stringify({ ready: true, port: host.port }));
