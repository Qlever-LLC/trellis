import type {
  ContractSchemaRef,
  ContractSchemas,
  JsonSchema,
} from "@qlever-llc/trellis/contracts";
import { canonicalizeJson, isJsonValue } from "@qlever-llc/trellis/contracts";

type JsonObject = { [key: string]: JsonSchema };

const SUPPORTED_OBJECT_KEYS = new Set([
  "additionalProperties",
  "properties",
  "required",
  "type",
]);

function isJsonObject(value: JsonSchema): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectValue(value: JsonObject, key: string): JsonSchema | undefined {
  return value[key];
}

function stringArray(value: JsonSchema | undefined): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const strings: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") return null;
    if (seen.has(item)) return null;
    seen.add(item);
    strings.push(item);
  }
  return strings;
}

function propertiesObject(value: JsonSchema | undefined): JsonObject | null {
  if (value === undefined) return {};
  if (!isJsonObject(value)) return null;
  return value;
}

function isOpenObject(schema: JsonObject): boolean {
  return objectValue(schema, "additionalProperties") !== false;
}

function hasSupportedAdditionalProperties(schema: JsonObject): boolean {
  const additionalProperties = objectValue(schema, "additionalProperties");
  return additionalProperties === undefined ||
    typeof additionalProperties === "boolean";
}

function hasOnlySupportedObjectKeys(schema: JsonObject): boolean {
  return Object.keys(schema).every((key) => SUPPORTED_OBJECT_KEYS.has(key));
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightValues = new Set(right);
  return left.every((value) => rightValues.has(value));
}

function isResolvedSchemaCompatible(
  left: JsonSchema,
  right: JsonSchema,
): boolean {
  if (canonicalizeJson(left) === canonicalizeJson(right)) return true;
  if (!isJsonObject(left) || !isJsonObject(right)) return false;
  if (objectValue(left, "type") !== "object") return false;
  if (objectValue(right, "type") !== "object") return false;
  if (!hasOnlySupportedObjectKeys(left) || !hasOnlySupportedObjectKeys(right)) {
    return false;
  }
  if (
    !hasSupportedAdditionalProperties(left) ||
    !hasSupportedAdditionalProperties(right)
  ) return false;

  const leftRequired = stringArray(objectValue(left, "required"));
  const rightRequired = stringArray(objectValue(right, "required"));
  if (!leftRequired || !rightRequired) return false;
  if (!sameStringSet(leftRequired, rightRequired)) return false;
  const required = new Set(leftRequired);

  const leftProperties = propertiesObject(objectValue(left, "properties"));
  const rightProperties = propertiesObject(objectValue(right, "properties"));
  if (!leftProperties || !rightProperties) return false;

  if (
    (!isOpenObject(left) || !isOpenObject(right)) &&
    !sameStringSet(Object.keys(leftProperties), Object.keys(rightProperties))
  ) return false;

  for (const [name, leftProperty] of Object.entries(leftProperties)) {
    const rightProperty = rightProperties[name];
    if (rightProperty === undefined) {
      if (required.has(name)) return false;
      if (!isOpenObject(right)) return false;
      continue;
    }
    if (!isResolvedSchemaCompatible(leftProperty, rightProperty)) return false;
  }

  for (const name of Object.keys(rightProperties)) {
    if (leftProperties[name] === undefined && required.has(name)) return false;
    if (leftProperties[name] === undefined && !isOpenObject(left)) return false;
  }

  return true;
}

function resolveSchemaRef(
  ref: ContractSchemaRef,
  schemas: ContractSchemas | undefined,
): JsonSchema | null {
  const schema = schemas?.[ref.schema];
  if (schema === undefined) return null;
  if (!isJsonValue(schema) && typeof schema !== "boolean") return null;
  return schema;
}

/**
 * Returns true when two contract schema refs resolve to identical schemas or a
 * conservative same-lineage compatible object evolution.
 */
export function areSchemaRefsCompatible(
  leftRef: ContractSchemaRef,
  leftSchemas: ContractSchemas | undefined,
  rightRef: ContractSchemaRef,
  rightSchemas: ContractSchemas | undefined,
): boolean {
  const leftSchema = resolveSchemaRef(leftRef, leftSchemas);
  const rightSchema = resolveSchemaRef(rightRef, rightSchemas);
  if (leftSchema === null || rightSchema === null) return false;
  return isResolvedSchemaCompatible(leftSchema, rightSchema);
}
