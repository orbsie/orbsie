/** Trusted local stdio transport. Never import this into a hosted application. */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export function selectAstra(models) {
  const model = models.find(
    (m) =>
      /astra/i.test(`${m.id} ${m.model} ${m.displayName}`) &&
      m.supportedReasoningEfforts?.some((e) => e.reasoningEffort === "low"),
  );
  if (!model)
    throw Error(
      "Astra with low reasoning is unavailable in model/list; no fallback is permitted.",
    );
  return model.model;
}

function withoutColors(value) {
  if (Array.isArray(value)) return value.map(withoutColors);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["color", "tint", "environment"].includes(key))
      .map(([key, entry]) => [key, withoutColors(entry)]),
  );
}

export function assertPinkOnlyEdit(before, after, selectedId, expectedColor) {
  const selectedBefore = before.entities.find(
    (entity) => entity.id === selectedId,
  );
  const selectedAfter = after.entities.find(
    (entity) => entity.id === selectedId,
  );
  if (!selectedBefore || !selectedAfter)
    throw Error("Scoped edit removed the selected entity.");
  if (
    JSON.stringify(withoutColors(selectedBefore)) !==
    JSON.stringify(withoutColors(selectedAfter))
  )
    throw Error("Scoped edit changed the selected entity beyond its color.");
  if (selectedAfter.color.toLowerCase() !== expectedColor.toLowerCase())
    throw Error("Selected edit was not applied.");
  if (
    selectedAfter.geometry?.tint !== undefined &&
    selectedAfter.geometry.tint.toLowerCase() !== expectedColor.toLowerCase()
  )
    throw Error("Selected material tint was not applied.");
  if (JSON.stringify(before.environment) !== JSON.stringify(after.environment))
    throw Error("Scoped edit changed the environment.");
  for (const entity of before.entities) {
    if (
      entity.id !== selectedId &&
      JSON.stringify(entity) !==
        JSON.stringify(
          after.entities.find((candidate) => candidate.id === entity.id),
        )
    )
      throw Error("Unrelated entity changed.");
  }
  if (after.entities.length !== before.entities.length)
    throw Error("Scoped edit changed entity count.");
}

export class LocalChatGPT {
  pending = new Map();
  listeners = new Set();
  nextId = 0;
  constructor(cwd) {
    this.process = spawn("codex", ["app-server", "--stdio"], {
      cwd,
      stdio: ["pipe", "pipe", "ignore"],
    });
    createInterface({ input: this.process.stdout }).on("line", (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        this.close();
        return;
      }
      if (event.method && event.id !== undefined) {
        this.process.stdin.write(
          JSON.stringify({
            id: event.id,
            error: {
              code: -32601,
              message:
                "Tools and approvals are not supported by this scene harness.",
            },
          }) + "\n",
        );
      } else if (event.id !== undefined) {
        const pending = this.pending.get(event.id);
        if (pending) {
          this.pending.delete(event.id);
          clearTimeout(pending.timer);
          event.error
            ? pending.reject(Error(event.error.message))
            : pending.resolve(event.result);
        }
      } else for (const listener of this.listeners) listener(event);
    });
    const fail = () => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(Error("Local App Server disconnected."));
      }
      this.pending.clear();
    };
    this.process.on("error", fail);
    this.process.on("exit", fail);
  }
  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`App Server ${method} timed out.`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  async connect() {
    await this.request("initialize", {
      clientInfo: { name: "orbsie_local_test", version: "0.1.0" },
    });
    this.process.stdin.write(
      JSON.stringify({ method: "initialized", params: {} }) + "\n",
    );
    const { account } = await this.request("account/read", {
      refreshToken: false,
    });
    if (account?.type !== "chatgpt")
      throw Error("Managed ChatGPT login required. Run codex login locally.");
    const models = [];
    let cursor;
    do {
      const page = await this.request("model/list", {
        limit: 100,
        includeHidden: false,
        cursor,
      });
      models.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    this.model = selectAstra(models);
    return this.model;
  }
  async generate(instructions, input, onText, signal) {
    signal?.throwIfAborted();
    const { thread } = await this.request("thread/start", {
      model: this.model,
      // Orbsie generation must not inherit the development agents' Fast tier.
      serviceTier: "default",
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "read-only",
      baseInstructions:
        instructions +
        "\nReturn scene commands directly. Do not use any tools, inspect files, or access the network.",
      config: { web_search: "disabled", "features.shell_tool": false },
    });
    signal?.throwIfAborted();
    let turnId;
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        this.listeners.delete(listener);
        signal?.removeEventListener("abort", abort);
        error ? reject(error) : resolve();
      };
      const abort = () => {
        if (turnId)
          void this.request("turn/interrupt", {
            threadId: thread.id,
            turnId,
          }).catch(() => {});
        finish(Error("Local generation canceled or timed out."));
      };
      const timer = setTimeout(abort, 180000);
      const listener = (event) => {
        if (event.params?.threadId !== thread.id) return;
        if (event.method === "item/agentMessage/delta") {
          try {
            onText(event.params.delta);
          } catch (error) {
            if (turnId)
              void this.request("turn/interrupt", {
                threadId: thread.id,
                turnId,
              }).catch(() => {});
            finish(error);
          }
        }
        if (event.method === "turn/completed")
          finish(
            event.params.turn.status === "completed"
              ? undefined
              : Error("Local model turn did not complete."),
          );
      };
      this.listeners.add(listener);
      signal?.addEventListener("abort", abort, { once: true });
      this.request("turn/start", {
        threadId: thread.id,
        model: this.model,
        serviceTier: "default",
        effort: "low",
        input: [{ type: "text", text: JSON.stringify(input) }],
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        approvalPolicy: "never",
      }).then(({ turn }) => {
        turnId = turn.id;
        if (signal?.aborted) abort();
      }, finish);
    });
  }
  close() {
    this.process.stdin.end();
    this.process.kill();
  }
}
