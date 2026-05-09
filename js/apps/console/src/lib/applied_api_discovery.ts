import { isJsonValue, type JsonValue } from "@qlever-llc/trellis/contracts";

export type AppliedApiContractDetail = {
  contract: JsonValue;
};

type ContractDetail = AppliedApiContractDetail;
type JsonObject = { [key: string]: JsonValue };

export type AppliedApiSchemaRow = {
  name: string;
  exported: boolean;
  title?: string;
  description?: string;
  type: string;
  schema: JsonValue;
};

export type AppliedApiUseRow = {
  alias: string;
  contractId: string;
  rpcCalls: string[];
  operationCalls: string[];
  eventPublishes: string[];
  eventSubscribes: string[];
};

function isJsonObject(value: unknown): value is JsonObject {
  return isJsonValue(value) && typeof value === "object" && value !== null &&
    !Array.isArray(value);
}

function getObjectProperty(
  source: JsonObject,
  key: string,
): JsonObject | undefined {
  const value = source[key];
  return isJsonObject(value) ? value : undefined;
}

function getStringProperty(
  source: JsonObject,
  key: string,
): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function getStringArrayProperty(source: JsonObject, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function manifestObject(detail: ContractDetail): JsonObject | undefined {
  return isJsonObject(detail.contract) ? detail.contract : undefined;
}

function schemaType(schema: JsonValue): string {
  if (typeof schema === "boolean") return schema ? "true" : "false";
  if (!isJsonObject(schema)) return "schema";

  const type = schema.type;
  if (typeof type === "string") return type;
  if (Array.isArray(type)) {
    const types = type.filter((entry): entry is string =>
      typeof entry === "string"
    );
    if (types.length > 0) return types.join(" | ");
  }
  return "object";
}

/**
 * Builds table rows for the schemas embedded in an installed contract detail.
 */
export function getAppliedApiSchemaRows(
  detail: ContractDetail,
): AppliedApiSchemaRow[] {
  const manifest = manifestObject(detail);
  const schemas = manifest ? getObjectProperty(manifest, "schemas") : undefined;
  if (!schemas) return [];

  const exportsObject = manifest
    ? getObjectProperty(manifest, "exports")
    : undefined;
  const exportedSchemas = new Set(
    exportsObject ? getStringArrayProperty(exportsObject, "schemas") : [],
  );

  return Object.entries(schemas)
    .map(([name, schema]) => ({
      name,
      exported: exportedSchemas.has(name),
      title: isJsonObject(schema)
        ? getStringProperty(schema, "title")
        : undefined,
      description: isJsonObject(schema)
        ? getStringProperty(schema, "description")
        : undefined,
      type: schemaType(schema),
      schema,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Builds table rows for cross-contract API dependencies declared by a contract.
 */
export function getAppliedApiUseRows(
  detail: ContractDetail,
): AppliedApiUseRow[] {
  const manifest = manifestObject(detail);
  const uses = manifest ? getObjectProperty(manifest, "uses") : undefined;
  if (!uses) return [];

  return Object.entries(uses)
    .flatMap(([alias, value]) => {
      if (!isJsonObject(value)) return [];
      const contractId = getStringProperty(value, "contract");
      if (!contractId) return [];

      const rpc = getObjectProperty(value, "rpc");
      const operations = getObjectProperty(value, "operations");
      const events = getObjectProperty(value, "events");
      return [{
        alias,
        contractId,
        rpcCalls: rpc ? getStringArrayProperty(rpc, "call") : [],
        operationCalls: operations
          ? getStringArrayProperty(operations, "call")
          : [],
        eventPublishes: events ? getStringArrayProperty(events, "publish") : [],
        eventSubscribes: events
          ? getStringArrayProperty(events, "subscribe")
          : [],
      }];
    })
    .sort((left, right) => left.alias.localeCompare(right.alias));
}
