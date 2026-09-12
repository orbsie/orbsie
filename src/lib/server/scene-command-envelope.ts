/**
 * Incrementally decodes the structured scene-command envelope proposed for
 * provider transports. It deliberately stops at JSON syntax: command schema
 * validation belongs to the generation pipeline.
 */

export const DEFAULT_SCENE_COMMAND_ENVELOPE_LIMITS = Object.freeze({
  maxTotalBytes: 200_000,
  maxCommandBytes: 100_000,
  maxCommands: 250,
});

export type SceneCommandEnvelopeLimits = {
  maxTotalBytes?: number;
  maxCommandBytes?: number;
  maxCommands?: number;
};

export type SceneCommandEnvelopeDecoderOptions = SceneCommandEnvelopeLimits & {
  onCommand?: (rawJSON: string) => void;
};

export class SceneCommandEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneCommandEnvelopeError";
  }
}

type Phase =
  | "root-start"
  | "root-key"
  | "root-colon"
  | "array-start"
  | "array-value"
  | "array-entry"
  | "command"
  | "array-separator"
  | "root-end"
  | "complete";

type StringContext = "root-key" | "command";

type Container = "object" | "array";

const JSON_WHITESPACE = new Set([" ", "\t", "\r", "\n"]);
const JSON_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t"]);

function isHexDigit(value: string): boolean {
  return /^[0-9a-fA-F]$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Decode `{"commands":[{...},...]}` across arbitrary text or UTF-8 chunks.
 *
 * `push` returns objects completed during that call. `onCommand`, when
 * supplied, is called at the same moment, so an object completed before a
 * later envelope error is still observable without buffering the envelope.
 */
export class SceneCommandEnvelopeDecoder {
  private readonly limits: Required<SceneCommandEnvelopeLimits>;
  private readonly onCommand?: (rawJSON: string) => void;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private text = "";
  private position = 0;
  private phase: Phase = "root-start";
  private stringContext: StringContext | undefined;
  private stringStartPosition = -1;
  private stringEscaped = false;
  private unicodeEscapeDigits = 0;
  private commandStart = -1;
  private commandStack: Container[] = [];
  private totalBytes = 0;
  private commandCount = 0;
  private byteDecoderActive = false;
  private pendingTextHighSurrogate = false;
  private finished = false;
  private failed = false;

  constructor(options: SceneCommandEnvelopeDecoderOptions = {}) {
    this.limits = {
      ...DEFAULT_SCENE_COMMAND_ENVELOPE_LIMITS,
      maxTotalBytes:
        options.maxTotalBytes ??
        DEFAULT_SCENE_COMMAND_ENVELOPE_LIMITS.maxTotalBytes,
      maxCommandBytes:
        options.maxCommandBytes ??
        DEFAULT_SCENE_COMMAND_ENVELOPE_LIMITS.maxCommandBytes,
      maxCommands:
        options.maxCommands ??
        DEFAULT_SCENE_COMMAND_ENVELOPE_LIMITS.maxCommands,
    };
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 1)
        throw new RangeError(`${name} must be a positive safe integer.`);
    }
    this.onCommand = options.onCommand;
  }

  /** Add a text or UTF-8 byte chunk and return complete command objects. */
  push(chunk: string | Uint8Array): string[] {
    this.assertUsable();
    if (typeof chunk === "string") {
      this.flushByteDecoder();
      this.appendText(chunk, this.stringChunkBytes(chunk));
    } else if (chunk instanceof Uint8Array) {
      this.pendingTextHighSurrogate = false;
      this.byteDecoderActive = true;
      let text: string;
      try {
        text = this.decoder.decode(chunk, { stream: true });
      } catch {
        this.fail("The scene command envelope contains invalid UTF-8.");
      }
      this.appendText(text, chunk.byteLength);
    } else {
      throw new TypeError("Scene command chunks must be text or UTF-8 bytes.");
    }
    return this.process();
  }

  /** Finish the input and reject any incomplete or trailing document. */
  finish(): string[] {
    this.assertUsable();
    this.flushByteDecoder();
    const emitted = this.process();
    if (this.phase !== "complete")
      this.fail(
        "The scene command envelope ended before its document was complete.",
      );
    this.finished = true;
    return emitted;
  }

  private assertUsable() {
    if (this.failed)
      throw new SceneCommandEnvelopeError(
        "The scene command envelope is invalid.",
      );
    if (this.finished)
      throw new SceneCommandEnvelopeError(
        "The scene command envelope is already complete.",
      );
  }

  private fail(message: string): never {
    this.failed = true;
    throw new SceneCommandEnvelopeError(message);
  }

  private appendText(text: string, bytes: number) {
    if (this.totalBytes + bytes > this.limits.maxTotalBytes)
      this.fail("The scene command envelope exceeds its byte limit.");
    this.totalBytes += bytes;
    this.text += text;
  }

  private stringChunkBytes(chunk: string): number {
    let bytes = this.encoder.encode(chunk).byteLength;
    if (chunk.length === 0) return bytes;
    if (
      this.pendingTextHighSurrogate &&
      chunk.length > 0 &&
      chunk.charCodeAt(0) >= 0xdc00 &&
      chunk.charCodeAt(0) <= 0xdfff
    )
      bytes -= 2;
    this.pendingTextHighSurrogate =
      chunk.length > 0 &&
      chunk.charCodeAt(chunk.length - 1) >= 0xd800 &&
      chunk.charCodeAt(chunk.length - 1) <= 0xdbff;
    return bytes;
  }

  private flushByteDecoder() {
    if (!this.byteDecoderActive) return;
    let tail: string;
    try {
      tail = this.decoder.decode();
    } catch {
      this.fail("The scene command envelope contains invalid UTF-8.");
    }
    this.byteDecoderActive = false;
    if (tail) this.appendText(tail, 0);
  }

  private process(): string[] {
    const emitted: string[] = [];
    while (this.position < this.text.length) {
      if (this.stringContext) {
        this.processStringCharacter();
        continue;
      }
      const character = this.text[this.position]!;
      if (this.phase === "root-start") {
        if (JSON_WHITESPACE.has(character)) {
          this.position++;
          continue;
        }
        if (character !== "{")
          this.fail("The scene command envelope must start with an object.");
        this.position++;
        this.phase = "root-key";
        continue;
      }
      if (this.phase === "root-key") {
        if (JSON_WHITESPACE.has(character)) {
          this.position++;
          continue;
        }
        if (character !== '"')
          this.fail("The scene command envelope root key must be commands.");
        this.startString("root-key");
        continue;
      }
      if (this.phase === "root-colon") {
        if (JSON_WHITESPACE.has(character)) {
          this.position++;
          continue;
        }
        if (character !== ":")
          this.fail(
            "The scene command envelope root key must be followed by a colon.",
          );
        this.position++;
        this.phase = "array-start";
        continue;
      }
      if (this.phase === "array-start") {
        if (JSON_WHITESPACE.has(character)) {
          this.position++;
          continue;
        }
        if (character !== "[")
          this.fail(
            "The scene command envelope commands value must be an array.",
          );
        this.position++;
        this.phase = "array-value";
        continue;
      }
      if (this.phase === "array-value") {
        if (JSON_WHITESPACE.has(character)) {
          this.position++;
          continue;
        }
        if (character === "]") {
          this.position++;
          this.phase = "root-end";
          continue;
        }
        if (character !== "{")
          this.fail("Every scene command envelope entry must be an object.");
        this.commandStart = this.position;
        this.commandStack = ["object"];
        this.position++;
        this.phase = "command";
        continue;
      }
      if (this.phase === "array-entry") {
        if (JSON_WHITESPACE.has(character)) {
          this.position++;
          continue;
        }
        if (character !== "{")
          this.fail("Every scene command envelope entry must be an object.");
        this.commandStart = this.position;
        this.commandStack = ["object"];
        this.position++;
        this.phase = "command";
        continue;
      }
      if (this.phase === "command") {
        this.processCommandCharacter(emitted);
        continue;
      }
      if (this.phase === "array-separator") {
        if (JSON_WHITESPACE.has(character)) {
          this.position++;
          continue;
        }
        if (character === ",") {
          this.position++;
          this.phase = "array-entry";
          continue;
        }
        if (character === "]") {
          this.position++;
          this.phase = "root-end";
          continue;
        }
        this.fail(
          "Scene command envelope entries must be separated by commas.",
        );
      }
      if (this.phase === "root-end") {
        if (JSON_WHITESPACE.has(character)) {
          this.position++;
          continue;
        }
        if (character !== "}")
          this.fail(
            "The scene command envelope contains an extra root key or trailing value.",
          );
        this.position++;
        this.phase = "complete";
        continue;
      }
      if (this.phase === "complete") {
        if (JSON_WHITESPACE.has(character)) {
          this.position++;
          continue;
        }
        this.fail("The scene command envelope contains trailing data.");
      }
    }
    this.assertCurrentCommandBudget();
    return emitted;
  }

  private assertCurrentCommandBudget() {
    if (this.commandStart < 0) return;
    if (
      this.encoder.encode(this.text.slice(this.commandStart)).byteLength >
      this.limits.maxCommandBytes
    )
      this.fail("A scene command exceeds its byte limit.");
  }

  private startString(context: StringContext) {
    this.stringContext = context;
    this.stringStartPosition = this.position;
    this.stringEscaped = false;
    this.unicodeEscapeDigits = 0;
    this.position++;
  }

  private processStringCharacter() {
    const character = this.text[this.position]!;
    if (this.unicodeEscapeDigits > 0) {
      if (!isHexDigit(character))
        this.fail(
          "The scene command envelope contains an invalid Unicode escape.",
        );
      this.unicodeEscapeDigits--;
      this.position++;
      return;
    }
    if (this.stringEscaped) {
      if (character === "u") this.unicodeEscapeDigits = 4;
      else if (!JSON_ESCAPES.has(character))
        this.fail(
          "The scene command envelope contains an invalid string escape.",
        );
      this.stringEscaped = false;
      this.position++;
      return;
    }
    if (character === "\\") {
      this.stringEscaped = true;
      this.position++;
      return;
    }
    if (character === '"') {
      const context = this.stringContext;
      const raw = this.text.slice(this.stringStartPosition, this.position + 1);
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        this.fail("The scene command envelope contains invalid JSON.");
      }
      this.stringContext = undefined;
      this.stringStartPosition = -1;
      this.position++;
      if (context === "root-key") {
        if (value !== "commands")
          this.fail("The scene command envelope root key must be commands.");
        this.phase = "root-colon";
      }
      return;
    }
    if (character <= "\u001f")
      this.fail(
        "The scene command envelope contains an unescaped control character.",
      );
    this.position++;
  }

  private processCommandCharacter(emitted: string[]) {
    const character = this.text[this.position]!;
    if (character === '"') {
      this.startString("command");
      return;
    }
    if (character === "{" || character === "[") {
      this.commandStack.push(character === "{" ? "object" : "array");
      this.position++;
      return;
    }
    if (character === "}" || character === "]") {
      const expected = character === "}" ? "object" : "array";
      if (this.commandStack.at(-1) !== expected)
        this.fail("The scene command envelope contains mismatched delimiters.");
      this.commandStack.pop();
      this.position++;
      if (this.commandStack.length > 0) return;
      const raw = this.text.slice(this.commandStart, this.position);
      if (this.encoder.encode(raw).byteLength > this.limits.maxCommandBytes)
        this.fail("A scene command exceeds its byte limit.");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.fail("A scene command is not valid JSON.");
      }
      if (!isRecord(parsed))
        this.fail("Every scene command envelope entry must be an object.");
      if (this.commandCount >= this.limits.maxCommands)
        this.fail("The scene command envelope exceeds its command limit.");
      this.commandCount++;
      emitted.push(raw);
      try {
        this.onCommand?.(raw);
      } catch (error) {
        this.failed = true;
        throw error;
      }
      this.commandStart = -1;
      this.phase = "array-separator";
      return;
    }
    this.position++;
  }
}
