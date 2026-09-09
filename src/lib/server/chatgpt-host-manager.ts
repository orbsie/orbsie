import { createChatGPTSandboxBackend } from "./chatgpt-sandbox-backend";
import { createChatGPTHostService } from "./chatgpt-host-service";
import {
  claimChatGPTHost,
  completeChatGPTHost,
  readChatGPTHost,
  readExpiredChatGPTHost,
  releaseChatGPTHost,
} from "./chatgpt-host-registry";

export function createChatGPTHostManager(
  options: Parameters<typeof createChatGPTSandboxBackend>[0],
) {
  const backend = createChatGPTSandboxBackend(options);
  const service = createChatGPTHostService({
    read: readChatGPTHost,
    claim: claimChatGPTHost,
    complete: completeChatGPTHost,
    release: releaseChatGPTHost,
    provision: backend.provision,
    destroy: backend.destroy,
  });
  async function cleanupExpired(
    identity: Parameters<typeof readChatGPTHost>[0],
  ) {
    const expired = await readExpiredChatGPTHost(identity);
    if (!expired) return false;
    await backend.destroy(expired.sandboxName);
    return releaseChatGPTHost(identity, expired.attemptId);
  }
  return {
    async ensure(identity: Parameters<typeof readChatGPTHost>[0]) {
      await cleanupExpired(identity);
      return service.ensure(identity);
    },
    async disconnect(identity: Parameters<typeof readChatGPTHost>[0]) {
      if (await cleanupExpired(identity)) return true;
      return service.disconnect(identity);
    },
    cleanupExpired,
    request: backend.request,
  };
}
