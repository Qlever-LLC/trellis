import type {
  TrellisCatalogV1,
  TrellisContractV1,
} from "@qlever-llc/trellis/contracts";

import {
  canonicalizeJson,
  digestContractManifest,
  isJsonValue,
  type JsonValue,
} from "@qlever-llc/trellis/contracts";
import { compileSchema, draft2019, type JsonSchema } from "json-schema-library";
import { Type } from "typebox";
import { Value } from "typebox/value";

type CatalogEntry = TrellisCatalogV1["contracts"][number];
const JsonObjectSchema = Type.Object({}, { additionalProperties: true });

type ActiveSubjectOwner = {
  digest: string;
  contractId: string;
  displayName: string;
  surface: string;
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

  const uses = raw.uses;
  if (!uses || typeof uses !== "object" || Array.isArray(uses)) return;
  for (const [alias, use] of Object.entries(uses)) {
    if (!use || typeof use !== "object" || Array.isArray(use)) continue;
    if (Object.hasOwn(use, "subjects")) {
      throw new Error(
        `Contract uses '${alias}' declares unsupported subjects`,
      );
    }
  }
}

function assertValidContractValue(
  value: JsonValue,
): asserts value is TrellisContractV1 {
  void value;
}

function formatSchemaPath(context: string, pointer: string): string {
  return pointer === "#" || pointer === "" ? context : `${context}${pointer}`;
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

function validateEmbeddedSchemas(contract: TrellisContractV1): void {
  for (const [schemaName, schema] of Object.entries(contract.schemas ?? {})) {
    const context = `schemas.${schemaName}`;
    assertSchemaObjectOrBoolean(schema, context);
    assertNoSchemaRefs(schema, context);
    const compiled = compileSchema(schema, { drafts: [draft2019] });
    const schemaErrors = compiled.schemaErrors ?? [];
    if (schemaErrors.length > 0) {
      const msg = schemaErrors.map((error) =>
        `${
          formatSchemaPath(context, error.data.pointer)
        }: ${error.data.message}`
      ).join("\n");
      throw new Error(`Invalid embedded contract schema:\n${msg}`);
    }
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

function normalizeContract(contract: TrellisContractV1): TrellisContractV1 {
  return {
    format: contract.format,
    id: contract.id,
    displayName: contract.displayName,
    description: contract.description,
    kind: contract.kind,
    ...(contract.schemas ? { schemas: contract.schemas } : {}),
    ...(contract.exports ? { exports: contract.exports } : {}),
    ...(contract.uses ? { uses: contract.uses } : {}),
    ...(contract.state ? { state: contract.state } : {}),
    ...(contract.rpc ? { rpc: contract.rpc } : {}),
    ...(contract.operations ? { operations: contract.operations } : {}),
    ...(contract.events ? { events: contract.events } : {}),
    ...(contract.jobs ? { jobs: contract.jobs } : {}),
    ...(contract.resources ? { resources: contract.resources } : {}),
    ...(contract.errors ? { errors: contract.errors } : {}),
  };
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

export class ContractStore {
  readonly #contractsByDigest = new Map<string, TrellisContractV1>();
  readonly #activeDigests = new Set<string>();
  readonly #builtinDigests = new Set<string>();
  readonly #activeDigestsById = new Map<string, Set<string>>();
  readonly #activeSubjectIndex = new Map<
    string,
    ActiveSubjectOwner
  >();
  readonly #validator: ReturnType<typeof compileSchema>;

  constructor(
    builtins: Array<{ digest: string; contract: TrellisContractV1 }> = [],
  ) {
    const schemaPath = new URL(
      "../../../packages/trellis/contract_support/schemas/trellis.contract.v1.schema.json",
      import.meta.url,
    );
    const contractSchema = Value.Parse(
      JsonObjectSchema,
      JSON.parse(Deno.readTextFileSync(schemaPath)),
    );
    this.#validator = compileSchema(contractSchema, { drafts: [draft2019] });

    for (const builtin of builtins) {
      this.add(builtin.digest, builtin.contract);
      this.#activeDigests.add(builtin.digest);
      this.#builtinDigests.add(builtin.digest);
    }
    this.#rebuildActiveSubjectIndex();
  }

  add(digest: string, contract: TrellisContractV1): void {
    this.#contractsByDigest.set(digest, contract);
  }

  #indexActiveId(
    index: Map<string, Set<string>>,
    digest: string,
    contract: TrellisContractV1,
  ): void {
    const digests = index.get(contract.id) ??
      new Set<string>();
    digests.add(digest);
    index.set(contract.id, digests);
  }

  #indexActiveSubject(
    index: Map<string, ActiveSubjectOwner>,
    digest: string,
    contract: TrellisContractV1,
    subject: string,
    surface: string,
  ) {
    const prev = index.get(subject);
    if (prev && (prev.contractId !== contract.id || prev.surface !== surface)) {
      throw new Error(
        `Subject '${subject}' already registered by '${prev.displayName}' (${prev.contractId})`,
      );
    }
    index.set(subject, {
      digest,
      contractId: contract.id,
      displayName: contract.displayName,
      surface,
    });
  }

  #buildActiveIndexes(activeDigests: Iterable<string>): {
    activeDigestsById: Map<string, Set<string>>;
    activeSubjectIndex: Map<string, ActiveSubjectOwner>;
  } {
    const activeDigestsById = new Map<string, Set<string>>();
    const activeSubjectIndex = new Map<string, ActiveSubjectOwner>();
    for (const digest of activeDigests) {
      const contract = this.#contractsByDigest.get(digest);
      if (!contract) {
        throw new Error(`Unknown active contract digest '${digest}'`);
      }

      this.#indexActiveId(activeDigestsById, digest, contract);

      for (
        const [key, m] of Object.entries(contract.rpc ?? {}) as Array<
          [string, NonNullable<TrellisContractV1["rpc"]>[string]]
        >
      ) {
        this.#indexActiveSubject(
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
        this.#indexActiveSubject(
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
        this.#indexActiveSubject(
          activeSubjectIndex,
          digest,
          contract,
          e.subject,
          `events.${key}`,
        );
      }
    }
    return { activeDigestsById, activeSubjectIndex };
  }

  #rebuildActiveSubjectIndex(): void {
    const { activeDigestsById, activeSubjectIndex } = this.#buildActiveIndexes(
      this.#activeDigests,
    );
    this.#activeDigestsById.clear();
    this.#activeSubjectIndex.clear();
    for (const [id, digests] of activeDigestsById) {
      this.#activeDigestsById.set(id, digests);
    }
    for (const [subject, owner] of activeSubjectIndex) {
      this.#activeSubjectIndex.set(subject, owner);
    }
  }

  findActiveSubject(
    subject: string,
  ): ActiveSubjectOwner | undefined {
    return this.#activeSubjectIndex.get(subject);
  }

  isActiveDigest(digest: string): boolean {
    return this.#activeDigests.has(digest);
  }

  activateDigest(digest: string): void {
    if (!this.#contractsByDigest.has(digest)) {
      return;
    }
    this.#activeDigests.add(digest);
    this.#rebuildActiveSubjectIndex();
  }

  /**
   * Return every active compatible contract digest for a contract lineage.
   */
  getActiveContractsById(id: string): TrellisContractV1[] {
    const digests = this.#activeDigestsById.get(id);
    if (!digests) return [];

    const contracts: TrellisContractV1[] = [];
    for (const digest of digests) {
      const contract = this.#contractsByDigest.get(digest);
      if (contract) contracts.push(contract);
    }
    return contracts;
  }

  getKnownContractsById(id: string): TrellisContractV1[] {
    const contracts: TrellisContractV1[] = [];
    for (const contract of this.#contractsByDigest.values()) {
      if (contract.id === id) contracts.push(contract);
    }
    return contracts;
  }

  setActiveDigests(digests: Iterable<string>): void {
    const nextActiveDigests = new Set<string>();
    for (const digest of digests) {
      if (!this.#contractsByDigest.has(digest)) {
        throw new Error(`Unknown active contract digest '${digest}'`);
      }
      nextActiveDigests.add(digest);
    }
    const { activeDigestsById, activeSubjectIndex } = this.#buildActiveIndexes(
      nextActiveDigests,
    );

    this.#activeDigests.clear();
    for (const digest of nextActiveDigests) {
      this.#activeDigests.add(digest);
    }
    this.#activeDigestsById.clear();
    for (const [id, activeIdDigests] of activeDigestsById) {
      this.#activeDigestsById.set(id, activeIdDigests);
    }
    this.#activeSubjectIndex.clear();
    for (const [subject, owner] of activeSubjectIndex) {
      this.#activeSubjectIndex.set(subject, owner);
    }
  }

  /**
   * Validate a proposed active digest set without changing active catalog state.
   */
  validateActiveDigests(
    digests: Iterable<string>,
  ): Array<{ digest: string; contract: TrellisContractV1 }> {
    const proposedDigests = new Set<string>();
    for (const digest of digests) {
      if (!this.#contractsByDigest.has(digest)) {
        throw new Error(`Unknown active contract digest '${digest}'`);
      }
      proposedDigests.add(digest);
    }
    this.#buildActiveIndexes(proposedDigests);

    const entries: Array<{ digest: string; contract: TrellisContractV1 }> = [];
    for (const digest of proposedDigests) {
      const contract = this.#contractsByDigest.get(digest);
      if (!contract) {
        throw new Error(`Unknown active contract digest '${digest}'`);
      }
      entries.push({ digest, contract });
    }
    return entries;
  }

  getBuiltinDigests(): string[] {
    return [...this.#builtinDigests];
  }

  getContract(
    digest: string,
    opts?: { includeInactive?: boolean },
  ): TrellisContractV1 | undefined {
    if (!opts?.includeInactive && !this.isActiveDigest(digest)) {
      return undefined;
    }
    return this.#contractsByDigest.get(digest);
  }

  /**
   * Return a validated contract cached by digest, regardless of active catalog
   * membership.
   */
  getKnownContract(digest: string): TrellisContractV1 | undefined {
    return this.#contractsByDigest.get(digest);
  }

  getActiveContracts(): TrellisContractV1[] {
    const out: TrellisContractV1[] = [];
    for (const digest of this.#activeDigests) {
      const c = this.#contractsByDigest.get(digest);
      if (c) out.push(c);
    }
    return out;
  }

  getActiveEntries(): Array<{ digest: string; contract: TrellisContractV1 }> {
    const out: Array<{ digest: string; contract: TrellisContractV1 }> = [];
    for (const digest of this.#activeDigests) {
      const contract = this.#contractsByDigest.get(digest);
      if (contract) out.push({ digest, contract });
    }
    return out;
  }

  getActiveCatalog(): TrellisCatalogV1 {
    const entries: CatalogEntry[] = [];
    for (const digest of this.#activeDigests) {
      const contract = this.#contractsByDigest.get(digest);
      if (!contract) continue;
      entries.push({
        id: contract.id,
        digest,
        displayName: contract.displayName,
        description: contract.description,
      });
    }
    entries.sort((a, b) =>
      a.id.localeCompare(b.id) || a.digest.localeCompare(b.digest)
    );
    return { format: "trellis.catalog.v1", contracts: entries };
  }

  async validate(
    raw: unknown,
  ): Promise<
    { digest: string; canonical: string; contract: TrellisContractV1 }
  > {
    assertObject(raw);
    if (!isJsonValue(raw)) {
      throw new Error("Contract must be a pure JSON value");
    }
    assertNoUnsupportedSubjects(raw);

    const { valid, errors } = this.#validator.validate(raw);
    if (!valid) {
      const msg = errors.map((
        e: { data: { pointer: string }; message: string },
      ) => `${e.data.pointer}: ${e.message}`).join("\n");
      throw new Error(`Invalid contract:\n${msg}`);
    }

    assertValidContractValue(raw);
    const contract = normalizeContract(raw);
    validateEmbeddedSchemas(contract);
    validateSchemaRefs(contract);
    validateEventTemplateParams(contract);
    const canonical = canonicalizeJson(raw as JsonValue);
    const digest = digestContractManifest(contract);

    return { digest, canonical, contract };
  }

  /**
   * Add a validated contract and mark it active.
   */
  activate(digest: string, contract: TrellisContractV1): void {
    this.add(digest, contract);
    this.#activeDigests.add(digest);
    this.#rebuildActiveSubjectIndex();
  }
}
