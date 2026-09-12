import { createChatGPTSandboxBackend } from "./chatgpt-sandbox-backend";
import {
  ChatGPTHostStaleError,
  createChatGPTHostService,
} from "./chatgpt-host-service";
import {
  claimChatGPTHost,
  completeChatGPTHost,
  readChatGPTHost,
  readExpiredChatGPTHost,
  readSessionChatGPTHost,
  releaseChatGPTHost,
} from "./chatgpt-host-registry";

export function createChatGPTHostManager(
  options: Parameters<typeof createChatGPTSandboxBackend>[0],
) {
  const backend = createChatGPTSandboxBackend(options);
  const readCurrentHost = async (
    identity: Parameters<typeof readChatGPTHost>[0],
  ) => {
    const host = await readChatGPTHost(identity);
    if (!host) return null;
    const artifactDigest = await backend.artifactDigest();
    if (host.artifactDigest !== artifactDigest)
      throw new ChatGPTHostStaleError();
    return host;
  };
  const service = createChatGPTHostService({
    read: readCurrentHost,
    readForDisconnect: readChatGPTHost,
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
    async teardownSession(identity: Parameters<typeof readChatGPTHost>[0]) {
      const host = await readSessionChatGPTHost(identity);
      if (!host) return false;
      await backend.destroy(host.sandboxName);
      return releaseChatGPTHost(identity, host.attemptId);
    },
    async ensure(identity: Parameters<typeof readChatGPTHost>[0]) {
      await cleanupExpired(identity);
      return service.ensure(identity);
    },
    read: readCurrentHost,
    async disconnect(identity: Parameters<typeof readChatGPTHost>[0]) {
      if (await cleanupExpired(identity)) return true;
      return service.disconnect(identity);
    },
    cleanupExpired,
    request: backend.request,
  };
}
