import { randomBytes } from "node:crypto";

export type ChatGPTHostIdentity = { ownerId: string; sessionId: string };
export type ChatGPTHost = {
  attemptId: string;
  sandboxName: string;
  capability: string;
  expiresAt: Date;
};
export type ChatGPTHostServiceDeps = {
  read(
    identity: ChatGPTHostIdentity,
  ): ChatGPTHost | null | Promise<ChatGPTHost | null>;
  claim(
    identity: ChatGPTHostIdentity,
  ):
    | { attemptId: string; expiresAt: Date }
    | null
    | Promise<{ attemptId: string; expiresAt: Date } | null>;
  complete(
    identity: ChatGPTHostIdentity,
    attemptId: string,
    sandboxName: string,
    capability: string,
  ): boolean | Promise<boolean>;
  release(
    identity: ChatGPTHostIdentity,
    attemptId: string,
  ): boolean | Promise<boolean>;
  provision(input: {
    name: string;
    capability: string;
    expiresAt: Date;
  }): Promise<void>;
  destroy(name: string): Promise<void>;
};

const error = (message: string) => Error(message);
const identityOkay = (value: unknown): value is string =>
  typeof value === "string" && /^[\x20-\x7e]{1,256}$/.test(value);
const idOkay = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value);
const capabilityOkay = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function checkIdentity(value: ChatGPTHostIdentity) {
  if (!identityOkay(value?.ownerId) || !identityOkay(value?.sessionId))
    throw error("ChatGPT host identity is invalid.");
}
function validHost(value: ChatGPTHost | null): value is ChatGPTHost {
  return (
    !!value &&
    idOkay(value.attemptId) &&
    value.sandboxName === `orbsie-chatgpt-${value.attemptId}` &&
    capabilityOkay(value.capability) &&
    value.expiresAt instanceof Date &&
    Number.isFinite(value.expiresAt.getTime()) &&
    value.expiresAt.getTime() > Date.now()
  );
}
function claimOkay(
  value: { attemptId: string; expiresAt: Date } | null,
): value is { attemptId: string; expiresAt: Date } {
  return (
    !!value &&
    idOkay(value.attemptId) &&
    value.expiresAt instanceof Date &&
    Number.isFinite(value.expiresAt.getTime()) &&
    value.expiresAt.getTime() > Date.now()
  );
}

export function createChatGPTHostService(deps: ChatGPTHostServiceDeps) {
  const cleanup = async (
    identity: ChatGPTHostIdentity,
    attemptId: string,
    name: string,
  ) => {
    try {
      await deps.destroy(name);
    } catch {
      throw error("ChatGPT host cleanup is pending.");
    }
    try {
      return await deps.release(identity, attemptId);
    } catch {
      throw error("ChatGPT host cleanup could not be recorded.");
    }
  };

  async function ensure(identity: ChatGPTHostIdentity): Promise<ChatGPTHost> {
    checkIdentity(identity);
    let existing: ChatGPTHost | null;
    try {
      existing = await deps.read(identity);
    } catch {
      throw error("ChatGPT host could not be read.");
    }
    if (validHost(existing)) return existing;
    let claimed: { attemptId: string; expiresAt: Date } | null;
    try {
      claimed = await deps.claim(identity);
    } catch {
      throw error("ChatGPT host could not be claimed.");
    }
    if (!claimOkay(claimed))
      throw error("Another ChatGPT host attempt is already active.");
    const capability = randomBytes(32).toString("hex");
    const sandboxName = `orbsie-chatgpt-${claimed.attemptId}`;
    try {
      await deps.provision({
        name: sandboxName,
        capability,
        expiresAt: claimed.expiresAt,
      });
      if (
        !(await deps.complete(
          identity,
          claimed.attemptId,
          sandboxName,
          capability,
        ))
      )
        throw error("ChatGPT host could not be finalized.");
      return {
        attemptId: claimed.attemptId,
        sandboxName,
        capability,
        expiresAt: claimed.expiresAt,
      };
    } catch (failure) {
      try {
        await cleanup(identity, claimed.attemptId, sandboxName);
      } catch (cleanupFailure) {
        throw cleanupFailure;
      }
      if (
        failure instanceof Error &&
        failure.message === "ChatGPT host could not be finalized."
      )
        throw failure;
      throw error("ChatGPT host could not be provisioned.");
    }
  }

  async function disconnect(identity: ChatGPTHostIdentity): Promise<boolean> {
    checkIdentity(identity);
    let host: ChatGPTHost | null;
    try {
      host = await deps.read(identity);
    } catch {
      throw error("ChatGPT host could not be read.");
    }
    if (!validHost(host)) return false;
    return cleanup(identity, host.attemptId, host.sandboxName);
  }
  return { ensure, disconnect };
}
