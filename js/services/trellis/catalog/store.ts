import type {
  TrellisCatalogV1,
  TrellisContractV1,
} from "@qlever-llc/trellis/contracts";

import {
  digestJson,
  isJsonValue,
  type JsonValue,
} from "@qlever-llc/trellis/contracts";
import { compileSchema, draft2019 } from "json-schema-library";
import { Type } from "typebox";
import { Value } from "typebox/value";

type CatalogEntry = TrellisCatalogV1["contracts"][number];
const JsonObjectSchema = Type.Object({}, { additionalProperties: true });

type ActiveSubjectOwner = {
  digest: string;
  contractId: string;
  displayName: string;
};

function assertObject(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected object JSON value");
  }
}

function assertValidContractValue(
  value: JsonValue,
): asserts value is TrellisContractV1 {
  void value;
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
    ...(contract.subjects ? { subjects: contract.subjects } : {}),
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
    if (operation.output) {
      assertSchemaRefExists(
        contract,
        operation.output.schema,
        `operation '${name}' output`,
      );
    }
  }

  for (
    const [name, event] of Object.entries(contract.events ?? {}) as Array<
      [string, NonNullable<TrellisContractV1["events"]>[string]]
    >
  ) {
    assertSchemaRefExists(contract, event.event.schema, `event '${name}'`);
  }

  for (
    const [name, subject] of Object.entries(contract.subjects ?? {}) as Array<
      [string, NonNullable<TrellisContractV1["subjects"]>[string]]
    >
  ) {
    if (subject.message) {
      assertSchemaRefExists(
        contract,
        subject.message.schema,
        `subject '${name}'`,
      );
    }
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

  #indexActiveId(digest: string, contract: TrellisContractV1): void {
    const digests = this.#activeDigestsById.get(contract.id) ??
      new Set<string>();
    digests.add(digest);
    this.#activeDigestsById.set(contract.id, digests);
  }

  #indexActiveSubject(
    digest: string,
    contract: TrellisContractV1,
    subject: string,
  ) {
    const prev = this.#activeSubjectIndex.get(subject);
    if (prev && prev.digest !== digest && prev.contractId !== contract.id) {
      throw new Error(
        `Subject '${subject}' already registered by '${prev.displayName}' (${prev.contractId})`,
      );
    }
    this.#activeSubjectIndex.set(subject, {
      digest,
      contractId: contract.id,
      displayName: contract.displayName,
    });
  }

  #rebuildActiveSubjectIndex(): void {
    this.#activeDigestsById.clear();
    this.#activeSubjectIndex.clear();
    for (const digest of this.#activeDigests) {
      const contract = this.#contractsByDigest.get(digest);
      if (!contract) continue;

      this.#indexActiveId(digest, contract);

      for (
        const m of Object.values(contract.rpc ?? {}) as Array<
          NonNullable<TrellisContractV1["rpc"]>[string]
        >
      ) {
        this.#indexActiveSubject(digest, contract, m.subject);
      }
      for (
        const o of Object.values(contract.operations ?? {}) as Array<
          NonNullable<TrellisContractV1["operations"]>[string]
        >
      ) {
        this.#indexActiveSubject(digest, contract, o.subject);
      }
      for (
        const e of Object.values(contract.events ?? {}) as Array<
          NonNullable<TrellisContractV1["events"]>[string]
        >
      ) {
        this.#indexActiveSubject(digest, contract, e.subject);
      }
      for (
        const s of Object.values(contract.subjects ?? {}) as Array<
          NonNullable<TrellisContractV1["subjects"]>[string]
        >
      ) {
        this.#indexActiveSubject(digest, contract, s.subject);
      }
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

  findActiveDigestById(id: string): string | undefined {
    const digests = this.#activeDigestsById.get(id);
    if (!digests || digests.size === 0) return undefined;
    return [...digests].sort((left, right) => left.localeCompare(right))[0];
  }

  setActiveDigests(digests: Iterable<string>): void {
    this.#activeDigests.clear();
    for (const d of digests) {
      if (this.#contractsByDigest.has(d)) {
        this.#activeDigests.add(d);
      }
    }
    this.#rebuildActiveSubjectIndex();
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
    entries.sort((a, b) => a.id.localeCompare(b.id));
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

    const { valid, errors } = this.#validator.validate(raw);
    if (!valid) {
      const msg = errors.map((
        e: { data: { pointer: string }; message: string },
      ) => `${e.data.pointer}: ${e.message}`).join("\n");
      throw new Error(`Invalid contract:\n${msg}`);
    }

    assertValidContractValue(raw);
    const contract = normalizeContract(raw);
    validateSchemaRefs(contract);
    const { digest, canonical } = await digestJson(raw as JsonValue);

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
