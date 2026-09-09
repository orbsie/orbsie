import { createChatGPTSandboxBackend } from "./chatgpt-sandbox-backend";
import { createChatGPTHostService } from "./chatgpt-host-service";
import {
  claimChatGPTHost,
  completeChatGPTHost,
  readChatGPTHost,
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
  return { ...service, request: backend.request };
}
