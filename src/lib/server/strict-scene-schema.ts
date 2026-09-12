import { z } from "zod";
import { modelCommandJSONSchemaForCapabilities } from "../protocol";

type JSONSchema = Record<string, unknown>;

const schemaCache = new Map<string, JSONSchema>();
const validatorCache = new Map<string, z.ZodType>();
const branchValidatorCache = new WeakMap<object, z.ZodType>();

const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$ref",
  "$defs",
  "definitions",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "dependentRequired",
  "dependentSchemas",
]);

export class StrictSceneSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrictSceneSchemaError";
  }
}

function isRecord(value: unknown): value is JSONSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: JSONSchema, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function cloneSchema(value: unknown): JSONSchema {
  if (!isRecord(value))
    throw new StrictSceneSchemaError("Scene schema must contain objects.");
  return value;
}

function discriminator(
  schema: JSONSchema,
): { key: string; value: string | number | boolean | null } | undefined {
  const properties = schema.properties;
  if (!isRecord(properties)) return undefined;
  for (const [key, property] of Object.entries(properties)) {
    if (!isRecord(property)) continue;
    if (hasOwn(property, "const")) {
      const value = property.const;
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      )
        return { key, value };
    }
    if (Array.isArray(property.enum) && property.enum.length === 1) {
      const value = property.enum[0];
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      )
        return { key, value };
    }
  }
  return undefined;
}

function assertDisjointUnion(options: unknown[], path: string[]): void {
  const branches = options.map(cloneSchema);
  const tags = branches.map(discriminator);
  if (
    tags.some((tag) => tag === undefined) ||
    tags.some((tag) => tag?.key !== tags[0]?.key)
  )
    throw new StrictSceneSchemaError(
      `Cannot safely project an undiscriminated oneOf at ${path.join(".") || "root"}.`,
    );
  for (const [index, branch] of branches.entries()) {
    const tag = tags[index];
    const required = Array.isArray(branch.required) ? branch.required : [];
    if (
      branch.additionalProperties !== false ||
      !tag ||
      !required.includes(tag.key)
    )
      throw new StrictSceneSchemaError(
        `Cannot prove a closed required discriminator for oneOf branch ${index} at ${path.join(".") || "root"}.`,
      );
  }
  const values = tags.map((tag) => JSON.stringify(tag?.value));
  if (new Set(values).size !== values.length)
    throw new StrictSceneSchemaError(
      `Cannot safely project an overlapping oneOf at ${path.join(".") || "root"}.`,
    );
}

function presenceWrapper(value: JSONSchema): JSONSchema {
  return {
    anyOf: [
      {
        type: "object",
        properties: { present: { type: "boolean", const: false } },
        required: ["present"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          present: { type: "boolean", const: true },
          value,
        },
        required: ["present", "value"],
        additionalProperties: false,
      },
    ],
  };
}

function schemasEqual(left: JSONSchema, right: JSONSchema): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function projectTuple(
  schema: JSONSchema,
  prefixItems: unknown[],
  path: string[],
): JSONSchema {
  const projected = prefixItems.map((item, index) =>
    projectSchema(cloneSchema(item), [...path, "prefixItems", String(index)]),
  );
  if (hasOwn(schema, "items") && schema.items !== false)
    throw new StrictSceneSchemaError(
      `Tuple rest items are not representable at ${path.join(".")}.`,
    );

  if (projected.every((item) => schemasEqual(item, projected[0]))) {
    return {
      type: "array",
      items: projected[0],
      minItems: projected.length,
      maxItems: projected.length,
    };
  }

  // OpenAI's supported array subset has no positional tuple keyword. Keep
  // heterogeneous tuple semantics by using a closed object on the wire; the
  // decoder restores the original fixed array before canonical parsing.
  const properties: JSONSchema = {};
  for (const [index, item] of projected.entries())
    properties[`item${index}`] = item;
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function projectSchema(schema: JSONSchema, path: string[] = []): JSONSchema {
  for (const key of UNSUPPORTED_SCHEMA_KEYS) {
    if (hasOwn(schema, key))
      throw new StrictSceneSchemaError(
        `Unsupported JSON Schema keyword ${key} at ${path.join(".") || "root"}.`,
      );
  }

  const output: JSONSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (
      key === "$schema" ||
      key === "default" ||
      key === "oneOf" ||
      key === "prefixItems" ||
      key === "items" ||
      key === "properties" ||
      key === "required" ||
      key === "additionalProperties"
    )
      continue;
    output[key] = Array.isArray(value)
      ? value.map((item, index) =>
          isRecord(item)
            ? projectSchema(item, [...path, key, String(index)])
            : item,
        )
      : isRecord(value)
        ? projectSchema(value, [...path, key])
        : value;
  }

  if (Array.isArray(schema.oneOf)) {
    assertDisjointUnion(schema.oneOf, [...path, "oneOf"]);
    output.anyOf = schema.oneOf.map((option, index) =>
      projectSchema(cloneSchema(option), [...path, "oneOf", String(index)]),
    );
  } else if (hasOwn(schema, "oneOf")) {
    throw new StrictSceneSchemaError(
      `oneOf must be an array at ${path.join(".") || "root"}.`,
    );
  }

  if (Array.isArray(schema.prefixItems)) {
    const tuple = projectTuple(schema, schema.prefixItems, path);
    if (tuple.type === "object") {
      delete output.type;
      delete output.minItems;
      delete output.maxItems;
    }
    return { ...output, ...tuple };
  }
  if (hasOwn(schema, "prefixItems"))
    throw new StrictSceneSchemaError(
      `prefixItems must be an array at ${path.join(".") || "root"}.`,
    );

  if (schema.type === "object" || hasOwn(schema, "properties")) {
    const sourceProperties = schema.properties;
    if (sourceProperties !== undefined && !isRecord(sourceProperties))
      throw new StrictSceneSchemaError(
        `Object properties must be an object at ${path.join(".")}.`,
      );
    const required = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter(
            (key): key is string => typeof key === "string",
          )
        : [],
    );
    const properties: JSONSchema = {};
    for (const [key, value] of Object.entries(sourceProperties ?? {})) {
      const projectedValue = projectSchema(cloneSchema(value), [
        ...path,
        "properties",
        key,
      ]);
      properties[key] = required.has(key)
        ? projectedValue
        : presenceWrapper(projectedValue);
    }
    if (
      schema.additionalProperties !== undefined &&
      schema.additionalProperties !== false
    )
      throw new StrictSceneSchemaError(
        `Open objects are not representable at ${path.join(".") || "root"}.`,
      );
    output.type = "object";
    output.properties = properties;
    output.required = Object.keys(properties);
    output.additionalProperties = false;
    return output;
  }

  if (schema.type === "array") {
    if (schema.items === false)
      throw new StrictSceneSchemaError(
        `Array items=false is not representable at ${path.join(".") || "root"}.`,
      );
    if (schema.items !== undefined) {
      if (!isRecord(schema.items))
        throw new StrictSceneSchemaError(
          `Array items must be a schema at ${path.join(".") || "root"}.`,
        );
      output.items = projectSchema(schema.items, [...path, "items"]);
    }
    return output;
  }

  return output;
}

function schemaKey(localModeling: boolean, browserModeling: boolean): string {
  return `${localModeling ? 1 : 0}:${browserModeling ? 1 : 0}`;
}

export function strictSceneCommandJSONSchemaForCapabilities(
  localModeling: boolean,
  browserModeling: boolean,
): JSONSchema {
  const key = schemaKey(localModeling, browserModeling);
  const cached = schemaCache.get(key);
  if (cached) return cached;
  const projected = projectSchema(
    cloneSchema(
      modelCommandJSONSchemaForCapabilities(localModeling, browserModeling),
    ),
  );
  schemaCache.set(key, projected);
  return projected;
}

function schemaMatchesDiscriminator(
  schema: JSONSchema,
  value: unknown,
): boolean {
  const tag = discriminator(schema);
  if (!tag || !isRecord(value)) return false;
  return Object.is(value[tag.key], tag.value);
}

function validatorForSchema(schema: JSONSchema): z.ZodType {
  const cached = branchValidatorCache.get(schema);
  if (cached) return cached;
  const validator = z.fromJSONSchema(schema, {
    defaultTarget: "draft-2020-12",
  });
  branchValidatorCache.set(schema, validator);
  return validator;
}

function wireSchemaForPresenceValue(schema: JSONSchema): JSONSchema {
  const options = schema.anyOf;
  if (!Array.isArray(options) || options.length !== 2)
    throw new StrictSceneSchemaError("Invalid optional wire property schema.");
  const valueBranch = options[1];
  if (!isRecord(valueBranch) || !isRecord(valueBranch.properties))
    throw new StrictSceneSchemaError("Invalid optional wire property schema.");
  const value = valueBranch.properties.value;
  if (!isRecord(value))
    throw new StrictSceneSchemaError("Invalid optional wire property schema.");
  return value;
}

function decodeValue(
  value: unknown,
  schema: JSONSchema,
  projectedSchema: JSONSchema,
  path: string[],
): unknown {
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    const options = (schema.oneOf ?? schema.anyOf) as unknown[];
    const projectedOptions = (projectedSchema.oneOf ??
      projectedSchema.anyOf) as unknown[] | undefined;
    if (!projectedOptions || projectedOptions.length !== options.length)
      throw new StrictSceneSchemaError(
        `Wire union shape does not match the canonical union at ${path.join(".") || "root"}.`,
      );
    const matching = options
      .map((option, index) => ({
        option: cloneSchema(option),
        projectedOption: cloneSchema(projectedOptions[index]),
        index,
      }))
      .filter(({ option }) => schemaMatchesDiscriminator(option, value));
    const candidates = matching.length
      ? matching
      : options.map((option, index) => ({
          option: cloneSchema(option),
          projectedOption: cloneSchema(projectedOptions[index]),
          index,
        }));
    const successes: unknown[] = [];
    for (const candidate of candidates) {
      if (
        !validatorForSchema(candidate.projectedOption).safeParse(value).success
      )
        continue;
      try {
        successes.push(
          decodeValue(value, candidate.option, candidate.projectedOption, [
            ...path,
            String(candidate.index),
          ]),
        );
      } catch {
        // Another union branch may be the matching nullable/geometry variant.
      }
    }
    if (successes.length === 0)
      throw new StrictSceneSchemaError(
        `Wire union could not be decoded at ${path.join(".") || "root"}.`,
      );
    if (schema.oneOf && successes.length !== 1)
      throw new StrictSceneSchemaError(
        `Wire oneOf was ambiguous at ${path.join(".") || "root"}.`,
      );
    return successes[0];
  }

  if (Array.isArray(schema.prefixItems)) {
    if (Array.isArray(value)) {
      return schema.prefixItems.map((item, index) =>
        decodeValue(
          value[index],
          cloneSchema(item),
          cloneSchema(projectedSchema.items),
          [...path, String(index)],
        ),
      );
    }
    if (isRecord(value)) {
      return schema.prefixItems.map((item, index) =>
        decodeValue(
          value[`item${index}`],
          cloneSchema(item),
          cloneSchema(
            isRecord(projectedSchema.properties)
              ? projectedSchema.properties[`item${index}`]
              : undefined,
          ),
          [...path, `item${index}`],
        ),
      );
    }
    throw new StrictSceneSchemaError(
      `Wire tuple has an invalid shape at ${path.join(".") || "root"}.`,
    );
  }

  if (schema.type === "object" || hasOwn(schema, "properties")) {
    if (!isRecord(value))
      throw new StrictSceneSchemaError(
        `Wire object has an invalid shape at ${path.join(".") || "root"}.`,
      );
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter(
            (key): key is string => typeof key === "string",
          )
        : [],
    );
    const output: JSONSchema = {};
    for (const [key, child] of Object.entries(properties)) {
      if (!hasOwn(value, key)) {
        if (required.has(key))
          throw new StrictSceneSchemaError(
            `Wire object is missing ${path.concat(key).join(".")}.`,
          );
        continue;
      }
      const childSchema = cloneSchema(child);
      const projectedChild = cloneSchema(
        isRecord(projectedSchema.properties)
          ? projectedSchema.properties[key]
          : undefined,
      );
      if (required.has(key)) {
        output[key] = decodeValue(value[key], childSchema, projectedChild, [
          ...path,
          key,
        ]);
        continue;
      }
      const wrapper = value[key];
      if (!isRecord(wrapper) || typeof wrapper.present !== "boolean")
        throw new StrictSceneSchemaError(
          `Optional wire property ${path.concat(key).join(".")} has an invalid presence wrapper.`,
        );
      if (wrapper.present) {
        if (!hasOwn(wrapper, "value"))
          throw new StrictSceneSchemaError(
            `Optional wire property ${path.concat(key).join(".")} is missing its value.`,
          );
        output[key] = decodeValue(
          wrapper.value,
          childSchema,
          wireSchemaForPresenceValue(projectedChild),
          [...path, key],
        );
      }
    }
    return output;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value))
      throw new StrictSceneSchemaError(
        `Wire array has an invalid shape at ${path.join(".") || "root"}.`,
      );
    if (!isRecord(schema.items)) return value;
    return value.map((item, index) =>
      decodeValue(
        item,
        schema.items as JSONSchema,
        cloneSchema(projectedSchema.items),
        [...path, String(index)],
      ),
    );
  }

  return value;
}

function validatorForCapabilities(
  localModeling: boolean,
  browserModeling: boolean,
): z.ZodType {
  const key = schemaKey(localModeling, browserModeling);
  const cached = validatorCache.get(key);
  if (cached) return cached;
  const validator = z.fromJSONSchema(
    strictSceneCommandJSONSchemaForCapabilities(localModeling, browserModeling),
    { defaultTarget: "draft-2020-12" },
  );
  validatorCache.set(key, validator);
  return validator;
}

/** Validate the strict wire command, then restore canonical omission/tuple semantics. */
export function decodeStrictSceneCommand(
  input: unknown,
  localModeling = false,
  browserModeling = false,
): unknown {
  const original = cloneSchema(
    modelCommandJSONSchemaForCapabilities(localModeling, browserModeling),
  );
  const parsed = validatorForCapabilities(localModeling, browserModeling).parse(
    input,
  );
  return decodeValue(
    parsed,
    original,
    strictSceneCommandJSONSchemaForCapabilities(localModeling, browserModeling),
    [],
  );
}
