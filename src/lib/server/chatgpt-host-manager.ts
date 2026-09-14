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
  readOwnerChatGPTHosts,
  readSessionChatGPTHost,
  renewChatGPTHost,
  releaseChatGPTHost,
} from "./chatgpt-host-registry";
import { CHATGPT_GENERATION_HEADROOM_MS } from "./chatgpt-sandbox-backend";
import type { GenerationObservationCorrelation } from "./generation-observability";

export function createChatGPTHostManager(
  options: Parameters<typeof createChatGPTSandboxBackend>[0],
) {
  const backend = createChatGPTSandboxBackend(options);
  const readCurrentHost = async (
    identity: Parameters<typeof readChatGPTHost>[0],
    readOptions: Parameters<typeof readChatGPTHost>[1] = {},
  ) => {
    readOptions.signal?.throwIfAborted();
    const host = readOptions.signal
      ? await readChatGPTHost(identity, readOptions)
      : await readChatGPTHost(identity);
    if (!host) return null;
    const artifactDigest = await backend.artifactDigest();
    readOptions.signal?.throwIfAborted();
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
    options: { signal?: AbortSignal } = {},
  ) {
    options.signal?.throwIfAborted();
    const expired = await readExpiredChatGPTHost(identity, options);
    if (!expired) return false;
    options.signal?.throwIfAborted();
    await backend.destroy(expired.sandboxName);
    options.signal?.throwIfAborted();
    return releaseChatGPTHost(identity, expired.attemptId);
  }
  const acquireForOperation = async (
    identity: Parameters<typeof readChatGPTHost>[0],
    minHeadroomMs: number,
    options: { signal?: AbortSignal } = {},
  ) => {
    const host = await readCurrentHost(identity, options);
    if (!host) return null;
    if (!host.artifactDigest) throw new ChatGPTHostStaleError();
    const renewed = await renewChatGPTHost(
      identity,
      host.attemptId,
      host.artifactDigest,
      {
        minHeadroomMs,
        signal: options.signal,
        renew: (lockedHost, targetExpiresAt, signal) =>
          backend.renew(lockedHost, targetExpiresAt, signal),
      },
    );
    if (renewed.kind === "stale") throw new ChatGPTHostStaleError();
    if (renewed.kind !== "ready") return null;
    return renewed.host;
  };
  return {
    async teardownSession(identity: Parameters<typeof readChatGPTHost>[0]) {
      const host = await readSessionChatGPTHost(identity);
      if (!host) return false;
      await backend.destroy(host.sandboxName);
      return releaseChatGPTHost(identity, host.attemptId);
    },
    async ensure(
      identity: Parameters<typeof readChatGPTHost>[0],
      options: { signal?: AbortSignal } = {},
    ) {
      options.signal?.throwIfAborted();
      await cleanupExpired(identity, options);
      options.signal?.throwIfAborted();
      return service.ensure(identity);
    },
    read: readCurrentHost,
    acquireForOperation,
    async acquireForGeneration(
      identity: Parameters<typeof readChatGPTHost>[0],
      options: { signal?: AbortSignal } = {},
    ) {
      return acquireForOperation(
        identity,
        CHATGPT_GENERATION_HEADROOM_MS,
        options,
      );
    },
    async disconnect(identity: Parameters<typeof readChatGPTHost>[0]) {
      if (await cleanupExpired(identity)) return true;
      return service.disconnect(identity);
    },
    cleanupExpired,
    request: backend.request,
    privateOperation: (
      host: Parameters<typeof backend.privateOperation>[0],
      operation: Parameters<typeof backend.privateOperation>[1],
      input: unknown,
      options: {
        signal?: AbortSignal;
        correlation?: GenerationObservationCorrelation;
      } = {},
    ) =>
      backend.privateOperation(
        host,
        operation,
        input,
        options.signal,
        options.correlation,
      ),
    destroyHost: backend.destroy,
    releaseHost: releaseChatGPTHost,
    async captureOwnerHosts(identity: Parameters<typeof readChatGPTHost>[0]) {
      return readOwnerChatGPTHosts(identity);
    },
    async disconnectCapturedHosts(
      hosts: Awaited<ReturnType<typeof readOwnerChatGPTHosts>>,
    ) {
      for (const host of hosts) {
        await backend.destroy(host.sandboxName);
        await releaseChatGPTHost(
          { ownerId: host.ownerId, sessionId: host.sessionId },
          host.attemptId,
        );
      }
      return true;
    },
  };
}
