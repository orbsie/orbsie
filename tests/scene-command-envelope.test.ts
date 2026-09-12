import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCENE_COMMAND_ENVELOPE_LIMITS,
  SceneCommandEnvelopeDecoder,
} from "../src/lib/server/scene-command-envelope";

function decodeInChunks(value: string, chunkSize = 1): string[] {
  const decoder = new SceneCommandEnvelopeDecoder();
  const output: string[] = [];
  for (let offset = 0; offset < value.length; offset += chunkSize)
    output.push(...decoder.push(value.slice(offset, offset + chunkSize)));
  output.push(...decoder.finish());
  return output;
}

describe("SceneCommandEnvelopeDecoder", () => {
  it("handles UTF-8 fragmentation, escaped strings, and nested values", () => {
    const command = {
      type: "custom",
      text: 'line\nquote"slash\\unicode ☺',
      nested: [{ ok: true }, [1, 2, { value: null }]],
    };
    const commandJSON = JSON.stringify(command).replace("☺", "\\u263A");
    const envelope = `{"commands":[${commandJSON}]}`;
    const bytes = new TextEncoder().encode(envelope);
    const decoder = new SceneCommandEnvelopeDecoder();
    const output: string[] = [];
    for (let offset = 0; offset < bytes.byteLength; offset++)
      output.push(...decoder.push(bytes.slice(offset, offset + 1)));
    output.push(...decoder.finish());

    expect(output).toEqual([commandJSON]);
    expect(JSON.parse(output[0]!)).toEqual(command);
  });

  it("counts a surrogate pair consistently when text chunks split it", () => {
    const envelope = '{"commands":[{"text":"🌳"}]}';
    const decoder = new SceneCommandEnvelopeDecoder({
      maxTotalBytes: new TextEncoder().encode(envelope).byteLength,
    });
    const output: string[] = [];
    for (let offset = 0; offset < envelope.length; offset++)
      output.push(...decoder.push(envelope.slice(offset, offset + 1)));
    output.push(...decoder.finish());
    expect(output).toEqual(['{"text":"🌳"}']);
  });

  it("emits a complete command before the root envelope is complete", () => {
    const emitted: string[] = [];
    const decoder = new SceneCommandEnvelopeDecoder({
      onCommand: (rawJSON) => emitted.push(rawJSON),
    });
    expect(decoder.push('{"commands":[{"type":"first"}')).toEqual([
      '{"type":"first"}',
    ]);
    expect(emitted).toEqual(['{"type":"first"}']);
    expect(decoder.push(',{"type":"second"}]}')).toEqual(['{"type":"second"}']);
    expect(decoder.finish()).toEqual([]);
  });

  it("accepts JSON whitespace after the completed root object", () => {
    expect(decodeInChunks('{"commands":[]} \n\t')).toEqual([]);
  });

  it("keeps an earlier emission observable when a later envelope delimiter fails", () => {
    const emitted: string[] = [];
    const decoder = new SceneCommandEnvelopeDecoder({
      onCommand: (rawJSON) => emitted.push(rawJSON),
    });
    expect(() => decoder.push('{"commands":[{"ok":1},]}')).toThrow(
      /entry must be an object/,
    );
    expect(emitted).toEqual(['{"ok":1}']);
  });

  it.each([
    ["a root array", "[]"],
    ["a null command", '{"commands":[null]}'],
    ["an array command", '{"commands":[[]]}'],
    ["a missing commands array", '{"commands":{}}'],
    ["an extra root key", '{"commands":[],"extra":true}'],
    ["a trailing root value", '{"commands":[]} trailing'],
    ["a trailing comma", '{"commands":[{"ok":1},]}'],
    ["an invalid escape", '{"commands":[{"text":"\\x"}]}'],
    ["an invalid command token", '{"commands":[{"ok":tru}]}'],
  ])("rejects %s", (_label, value) => {
    expect(() => decodeInChunks(value)).toThrow();
  });

  it.each([
    ["a missing array close", '{"commands":[{"ok":1}'],
    ["a missing root close", '{"commands":[{"ok":1}]'],
    ["an unfinished string", '{"commands":[{"text":"unfinished}]}'],
    ["an unfinished Unicode escape", '{"commands":[{"text":"\\u12'],
  ])("rejects an incomplete %s at finish", (_label, value) => {
    const decoder = new SceneCommandEnvelopeDecoder();
    expect(() => {
      decoder.push(value);
      decoder.finish();
    }).toThrow(/ended before/);
  });

  it("enforces total, per-command, and command-count byte budgets", () => {
    const envelope = '{"commands":[{"one":1},{"two":2}]}';
    expect(() =>
      new SceneCommandEnvelopeDecoder({
        maxTotalBytes: envelope.length - 1,
      }).push(envelope),
    ).toThrow(/envelope exceeds/);
    expect(() =>
      new SceneCommandEnvelopeDecoder({ maxCommandBytes: 8 }).push(
        '{"commands":[{"long":true}]}',
      ),
    ).toThrow(/command exceeds/);
    const incomplete = new SceneCommandEnvelopeDecoder({
      maxCommandBytes: 7,
    });
    expect(() => incomplete.push('{"commands":[{"long":')).toThrow(
      /command exceeds/,
    );

    const decoder = new SceneCommandEnvelopeDecoder({ maxCommands: 1 });
    expect(() => decoder.push(envelope)).toThrow(/command limit/);
    expect(DEFAULT_SCENE_COMMAND_ENVELOPE_LIMITS).toEqual({
      maxTotalBytes: 200_000,
      maxCommandBytes: 100_000,
      maxCommands: 250,
    });
  });

  it("fails closed when the emission callback throws", () => {
    const decoder = new SceneCommandEnvelopeDecoder({
      onCommand: () => {
        throw new Error("consumer stopped");
      },
    });
    expect(() => decoder.push('{"commands":[{"ok":1}]}')).toThrow(
      "consumer stopped",
    );
    expect(() => decoder.push(" ")).toThrow(/envelope is invalid/);
  });
});
