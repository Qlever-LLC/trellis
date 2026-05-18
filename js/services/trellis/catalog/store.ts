import type {
  JsonSchema,
  TrellisCatalogV1,
  TrellisContractV1,
} from "@qlever-llc/trellis/contracts";

import {
  canonicalizeJson,
  digestContractManifest,
  isJsonValue,
  type JsonValue,
  parseContractManifest,
} from "@qlever-llc/trellis/contracts";

import { templateToWildcard } from "./subject_templates.ts";

type CatalogEntry = TrellisCatalogV1["contracts"][number];

export type ContractEntry = { digest: string; contract: TrellisContractV1 };

export type ValidatedContract = {
  digest: string;
  canonical: string;
  contract: TrellisContractV1;
};

export type ActiveSubjectOwner = {
  digest: string;
  contractId: string;
  displayName: string;
  surface: string;
};

export type ActiveContractIndexes = {
  digestsByContractId: Map<string, Set<string>>;
  activeSubjectIndex: Map<string, ActiveSubjectOwner>;
};

export type ActiveCapabilityDefinition = {
  key: string;
  displayName: string;
  description: string;
  consequence?: string;
  contractId: string;
  contractDigest: string;
  contractDisplayName: string;
};

function assertObject(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected object JSON value");
  }
}

function assertNoUnsupportedSubjects(raw: Record<string, unknown>): void {
  if (Object.hasOwn(raw, "subjects")) {
    throw new Error("Contract subjects are not supported in v1");
  }

  const resources = raw.resources;
  if (resources && typeof resources === "object" && !Array.isArray(resources)) {
    if (Object.hasOwn(resources, "jobs")) {
      throw new Error("/resources/jobs is not supported in v1");
    }
    if (
      Object.hasOwn(resources, "stream") || Object.hasOwn(resources, "streams")
    ) {
      throw new Error("/resources/stream is not supported in v1");
    }
  }

  const uses = raw.uses;
  if (!uses || typeof uses !== "object" || Array.isArray(uses)) return;
  for (const group of ["required", "optional"]) {
    const groupedUses = (uses as Record<string, unknown>)[group];
    if (
      !groupedUses || typeof groupedUses !== "object" ||
      Array.isArray(groupedUses)
    ) {
      continue;
    }
    for (const [alias, use] of Object.entries(groupedUses)) {
      if (!use || typeof use !== "object" || Array.isArray(use)) continue;
      if (!Object.hasOwn(use, "subjects")) continue;
      throw new Error(
        `Contract uses '${alias}' declares unsupported subjects`,
      );
    }
  }
}

function assertNoSchemaRefs(schema: JsonValue, context: string): void {
  if (!schema || typeof schema !== "object") return;

  if (Array.isArray(schema)) {
    for (const [index, item] of schema.entries()) {
      assertNoSchemaRefs(item, `${context}/${index}`);
    }
    return;
  }

  for (const [key, value] of Object.entries(schema)) {
    if (key === "$ref") {
      if (typeof value === "string" && !value.startsWith("#")) {
        throw new Error(`${context}: remote $ref is not supported`);
      }
      throw new Error(`${context}: $ref is not supported in embedded schemas`);
    }
    assertNoSchemaRefs(value, `${context}/${key}`);
  }
}

function assertSchemaObjectOrBoolean(
  schema: JsonValue,
  context: string,
): asserts schema is JsonSchema {
  if (typeof schema === "boolean") return;
  if (schema && typeof schema === "object" && !Array.isArray(schema)) return;
  throw new Error(
    `${context}: embedded schema must be a JSON object or boolean`,
  );
}

const JSON_SCHEMA_TYPES = new Set([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
]);

function assertValidEmbeddedSchemaKeywords(
  schema: JsonValue,
  context: string,
): void {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema)) {
    for (const [index, item] of schema.entries()) {
      assertValidEmbeddedSchemaKeywords(item, `${context}/${index}`);
    }
    return;
  }

  const type = schema.type;
  if (typeof type === "string" && !JSON_SCHEMA_TYPES.has(type)) {
    throw new Error(`${context}/type: unknown JSON Schema type '${type}'`);
  }
  if (
    Array.isArray(type) &&
    !type.every((item) =>
      typeof item === "string" && JSON_SCHEMA_TYPES.has(item)
    )
  ) {
    throw new Error(
      `${context}/type: type array contains an unknown JSON Schema type`,
    );
  }

  for (const [key, value] of Object.entries(schema)) {
    assertValidEmbeddedSchemaKeywords(value, `${context}/${key}`);
  }
}

function validateEmbeddedSchemas(contract: TrellisContractV1): void {
  for (const [schemaName, schema] of Object.entries(contract.schemas ?? {})) {
    const context = `schemas.${schemaName}`;
    assertSchemaObjectOrBoolean(schema, context);
    assertNoSchemaRefs(schema, context);
    assertValidEmbeddedSchemaKeywords(schema, context);
  }
}

function isJsonPointer(pointer: string): boolean {
  if (!pointer.startsWith("/")) return false;
  for (let index = 0; index < pointer.length; index += 1) {
    if (pointer[index] !== "~") continue;
    const escaped = pointer[index + 1];
    if (escaped !== "0" && escaped !== "1") return false;
    index += 1;
  }
  return true;
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getDirectSchemaProperties(
  schema: JsonValue,
): Record<string, JsonValue> | undefined {
  if (!isJsonObject(schema)) return undefined;
  const properties = schema.properties;
  if (!isJsonObject(properties)) return undefined;
  return properties;
}

function schemaPointerResolves(schema: JsonValue, pointer: string): boolean {
  let current = schema;
  for (const rawSegment of pointer.slice(1).split("/")) {
    const segment = decodeJsonPointerSegment(rawSegment);
    const properties = getDirectSchemaProperties(current);
    if (!properties || !Object.hasOwn(properties, segment)) return false;
    current = properties[segment];
  }
  return true;
}

function extractSubjectTemplatePointers(
  subject: string,
  context: string,
): string[] {
  const pointers: string[] = [];
  let index = 0;
  while (index < subject.length) {
    const open = subject.indexOf("{", index);
    const close = subject.indexOf("}", index);
    if (close !== -1 && (open === -1 || close < open)) {
      throw new Error(`${context} subject has malformed template token`);
    }
    if (open === -1) break;

    const end = subject.indexOf("}", open + 1);
    if (end === -1) {
      throw new Error(`${context} subject has malformed template token`);
    }
    const token = subject.slice(open + 1, end);
    if (token.includes("{") || token.includes("}")) {
      throw new Error(`${context} subject has malformed template token`);
    }
    if (!isJsonPointer(token)) {
      throw new Error(
        `${context} subject template token '${token}' must be a JSON Pointer`,
      );
    }
    pointers.push(token);
    index = end + 1;
  }
  return pointers;
}

function validateEventTemplateParams(contract: TrellisContractV1): void {
  for (
    const [name, event] of Object.entries(contract.events ?? {}) as Array<
      [string, NonNullable<TrellisContractV1["events"]>[string]]
    >
  ) {
    const context = `event '${name}'`;
    const templatePointers = extractSubjectTemplatePointers(
      event.subject,
      context,
    );
    for (const param of event.params ?? []) {
      if (!isJsonPointer(param)) {
        throw new Error(`${context} param '${param}' must be a JSON Pointer`);
      }
    }

    const params = event.params ?? [];
    const matches = params.length === templatePointers.length &&
      params.every((param, index) => param === templatePointers[index]);
    if (!matches) {
      throw new Error(
        `${context} params must list subject template pointers in order`,
      );
    }

    const payloadSchema = contract.schemas?.[event.event.schema];
    if (!payloadSchema) continue;
    for (const pointer of templatePointers) {
      if (!schemaPointerResolves(payloadSchema, pointer)) {
        throw new Error(
          `${context} param '${pointer}' does not resolve against event payload schema`,
        );
      }
    }
  }
}

function assertSchemaRefExists(
  contract: TrellisContractV1,
  schemaName: string,
  context: string,
) {
  if (!contract.schemas || !Object.hasOwn(contract.schemas, schemaName)) {
    throw new Error(`${context}: unknown schema '${schemaName}'`);
  }
}

function validateSchemaRefs(contract: TrellisContractV1) {
  for (const schemaName of contract.exports?.schemas ?? []) {
    assertSchemaRefExists(contract, schemaName, "exports.schemas");
  }

  for (
    const [name, store] of Object.entries(contract.state ?? {}) as Array<
      [string, NonNullable<TrellisContractV1["state"]>[string]]
    >
  ) {
    assertSchemaRefExists(contract, store.schema.schema, `state '${name}'`);
    for (
      const [version, schema] of Object.entries(
        store.acceptedVersions ?? {},
      ) as Array<[string, { schema: string }]>
    ) {
      assertSchemaRefExists(
        contract,
        schema.schema,
        `state '${name}' acceptedVersions '${version}'`,
      );
    }
  }

  for (
    const [name, resource] of Object.entries(
      contract.resources?.kv ?? {},
    ) as Array<[
      string,
      NonNullable<NonNullable<TrellisContractV1["resources"]>["kv"]>[string],
    ]>
  ) {
    assertSchemaRefExists(
      contract,
      resource.schema.schema,
      `resources.kv '${name}'`,
    );
  }

  for (
    const [name, rpc] of Object.entries(contract.rpc ?? {}) as Array<
      [string, NonNullable<TrellisContractV1["rpc"]>[string]]
    >
  ) {
    assertSchemaRefExists(contract, rpc.input.schema, `rpc '${name}' input`);
    assertSchemaRefExists(contract, rpc.output.schema, `rpc '${name}' output`);
  }

  for (
    const [name, operation] of Object.entries(
      contract.operations ?? {},
    ) as Array<[
      string,
      NonNullable<TrellisContractV1["operations"]>[string],
    ]>
  ) {
    assertSchemaRefExists(
      contract,
      operation.input.schema,
      `operation '${name}' input`,
    );
    if (operation.progress) {
      assertSchemaRefExists(
        contract,
        operation.progress.schema,
        `operation '${name}' progress`,
      );
    }
    assertSchemaRefExists(
      contract,
      operation.output.schema,
      `operation '${name}' output`,
    );
  }

  for (
    const [name, event] of Object.entries(contract.events ?? {}) as Array<
      [string, NonNullable<TrellisContractV1["events"]>[string]]
    >
  ) {
    assertSchemaRefExists(contract, event.event.schema, `event '${name}'`);
  }

  for (
    const [name, error] of Object.entries(contract.errors ?? {}) as Array<
      [string, NonNullable<TrellisContractV1["errors"]>[string]]
    >
  ) {
    if (error.schema) {
      assertSchemaRefExists(contract, error.schema.schema, `error '${name}'`);
    }
  }

  const jobsQueues = contract.jobs ?? {};
  for (
    const [queueType, queue] of Object.entries(jobsQueues) as Array<
      [
        string,
        NonNullable<NonNullable<TrellisContractV1["jobs"]>>[string],
      ]
    >
  ) {
    assertSchemaRefExists(
      contract,
      queue.payload.schema,
      `jobs queue '${queueType}' payload`,
    );
    if (queue.result) {
      assertSchemaRefExists(
        contract,
        queue.result.schema,
        `jobs queue '${queueType}' result`,
      );
    }
  }
}

function indexActiveId(
  index: Map<string, Set<string>>,
  digest: string,
  contract: TrellisContractV1,
): void {
  const digests = index.get(contract.id) ?? new Set<string>();
  digests.add(digest);
  index.set(contract.id, digests);
}

function indexActiveSubject(
  index: Map<string, ActiveSubjectOwner>,
  digest: string,
  contract: TrellisContractV1,
  subject: string,
  surface: string,
): void {
  const effectiveSubject = templateToWildcard(subject);
  const prev = index.get(effectiveSubject);
  if (prev && (prev.contractId !== contract.id || prev.surface !== surface)) {
    throw new Error(
      `Subject '${effectiveSubject}' already registered by '${prev.displayName}' (${prev.contractId})`,
    );
  }
  index.set(effectiveSubject, {
    digest,
    contractId: contract.id,
    displayName: contract.displayName,
    surface,
  });
}

export function buildActiveContractIndexes(
  entriesByDigest: ReadonlyMap<string, TrellisContractV1>,
  digests: Iterable<string>,
): ActiveContractIndexes {
  const digestsByContractId = new Map<string, Set<string>>();
  const activeSubjectIndex = new Map<string, ActiveSubjectOwner>();
  for (const digest of digests) {
    const contract = entriesByDigest.get(digest);
    if (!contract) {
      throw new Error(`Unknown active contract digest '${digest}'`);
    }

    indexActiveId(digestsByContractId, digest, contract);

    for (
      const [key, m] of Object.entries(contract.rpc ?? {}) as Array<
        [string, NonNullable<TrellisContractV1["rpc"]>[string]]
      >
    ) {
      indexActiveSubject(
        activeSubjectIndex,
        digest,
        contract,
        m.subject,
        `rpc.${key}`,
      );
    }
    for (
      const [key, o] of Object.entries(contract.operations ?? {}) as Array<
        [string, NonNullable<TrellisContractV1["operations"]>[string]]
      >
    ) {
      indexActiveSubject(
        activeSubjectIndex,
        digest,
        contract,
        o.subject,
        `operations.${key}`,
      );
    }
    for (
      const [key, e] of Object.entries(contract.events ?? {}) as Array<
        [string, NonNullable<TrellisContractV1["events"]>[string]]
      >
    ) {
      indexActiveSubject(
        activeSubjectIndex,
        digest,
        contract,
        e.subject,
        `events.${key}`,
      );
    }
  }
  return { digestsByContractId, activeSubjectIndex };
}

export function validateActiveDigestEntries(
  entriesByDigest: ReadonlyMap<string, TrellisContractV1>,
  digests: Iterable<string>,
): ContractEntry[] {
  const proposedDigests = new Set<string>();
  for (const digest of digests) {
    if (!entriesByDigest.has(digest)) {
      throw new Error(`Unknown active contract digest '${digest}'`);
    }
    proposedDigests.add(digest);
  }
  buildActiveContractIndexes(entriesByDigest, proposedDigests);

  const entries: ContractEntry[] = [];
  for (const digest of proposedDigests) {
    const contract = entriesByDigest.get(digest);
    if (!contract) {
      throw new Error(`Unknown active contract digest '${digest}'`);
    }
    entries.push({ digest, contract });
  }
  return entries;
}

export function findActiveSubject(
  index: ReadonlyMap<string, ActiveSubjectOwner>,
  subject: string,
): ActiveSubjectOwner | undefined {
  return index.get(templateToWildcard(subject));
}

export function getContractsById(
  entries: Iterable<ContractEntry>,
  id: string,
): TrellisContractV1[] {
  const contracts: TrellisContractV1[] = [];
  for (const entry of entries) {
    if (entry.contract.id === id) contracts.push(entry.contract);
  }
  return contracts;
}

export function getActiveCapabilityDefinitions(
  entries: Iterable<ContractEntry>,
): ActiveCapabilityDefinition[] {
  const capabilities = new Map<string, ActiveCapabilityDefinition>();
  const sortedEntries = [...entries].sort((left, right) =>
    left.contract.id.localeCompare(right.contract.id) ||
    left.digest.localeCompare(right.digest)
  );

  for (const { digest, contract } of sortedEntries) {
    for (const [key, metadata] of Object.entries(contract.capabilities ?? {})) {
      if (capabilities.has(key)) continue;
      capabilities.set(key, {
        key,
        displayName: metadata.displayName,
        description: metadata.description,
        ...(metadata.consequence ? { consequence: metadata.consequence } : {}),
        contractId: contract.id,
        contractDigest: digest,
        contractDisplayName: contract.displayName,
      });
    }
  }

  return [...capabilities.values()].sort((left, right) =>
    left.key.localeCompare(right.key)
  );
}

export function getActiveCatalog(
  entries: Iterable<ContractEntry>,
): TrellisCatalogV1 {
  const contracts: CatalogEntry[] = [];
  for (const { digest, contract } of entries) {
    contracts.push({
      id: contract.id,
      digest,
      displayName: contract.displayName,
      description: contract.description,
    });
  }
  contracts.sort((a, b) =>
    a.id.localeCompare(b.id) || a.digest.localeCompare(b.digest)
  );
  return { format: "trellis.catalog.v1", contracts };
}

export async function validateContractManifest(
  raw: unknown,
): Promise<ValidatedContract> {
  assertObject(raw);
  if (!isJsonValue(raw)) {
    throw new Error("Contract must be a pure JSON value");
  }
  assertNoUnsupportedSubjects(raw);

  const contract = parseContractManifest(raw);
  validateEmbeddedSchemas(contract);
  validateSchemaRefs(contract);
  validateEventTemplateParams(contract);
  const canonical = canonicalizeJson(contract);
  const digest = digestContractManifest(contract);

  return { digest, canonical, contract };
}
