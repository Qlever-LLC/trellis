import type { TrellisCatalogV1, TrellisContractV1 } from "@qlever-llc/trellis-contracts";

import { digestJson, isJsonValue, type JsonValue } from "@qlever-llc/trellis-contracts";
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

function normalizeContract(contract: TrellisContractV1): TrellisContractV1 {
  return {
    format: contract.format,
    id: contract.id,
    displayName: contract.displayName,
    description: contract.description,
    kind: contract.kind,
    ...(contract.uses ? { uses: contract.uses } : {}),
    ...(contract.rpc ? { rpc: contract.rpc } : {}),
    ...(contract.events ? { events: contract.events } : {}),
    ...(contract.subjects ? { subjects: contract.subjects } : {}),
    ...(contract.resources ? { resources: contract.resources } : {}),
    ...(contract.errors ? { errors: contract.errors } : {}),
  };
}

export class ContractStore {
  readonly #contractsByDigest = new Map<string, TrellisContractV1>();
  readonly #activeDigests = new Set<string>();
  readonly #builtinDigests = new Set<string>();
  readonly #activeDigestById = new Map<string, string>();
  readonly #activeSubjectIndex = new Map<
    string,
    ActiveSubjectOwner
  >();
  readonly #validator: ReturnType<typeof compileSchema>;

  constructor(builtins: Array<{ digest: string; contract: TrellisContractV1 }> = []) {
    const schemaPath = new URL(
      "../../packages/contracts/schemas/trellis.contract.v1.schema.json",
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
    const prevDigest = this.#activeDigestById.get(contract.id);
    if (prevDigest && prevDigest !== digest) {
      throw new Error(
        `Contract id '${contract.id}' already active with a different digest`,
      );
    }
    this.#activeDigestById.set(contract.id, digest);
  }

  #indexActiveSubject(
    digest: string,
    contract: TrellisContractV1,
    subject: string,
  ) {
    const prev = this.#activeSubjectIndex.get(subject);
    if (prev && prev.digest !== digest) {
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
    this.#activeDigestById.clear();
    this.#activeSubjectIndex.clear();
    for (const digest of this.#activeDigests) {
      const contract = this.#contractsByDigest.get(digest);
      if (!contract) continue;

      this.#indexActiveId(digest, contract);

      for (const m of Object.values(contract.rpc ?? {})) {
        this.#indexActiveSubject(digest, contract, m.subject);
      }
      for (const e of Object.values(contract.events ?? {})) {
        this.#indexActiveSubject(digest, contract, e.subject);
      }
      for (const s of Object.values(contract.subjects ?? {})) {
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

  findActiveDigestById(id: string): string | undefined {
    return this.#activeDigestById.get(id);
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

  getContract(digest: string, opts?: { includeInactive?: boolean }): TrellisContractV1 | undefined {
    if (!opts?.includeInactive && !this.isActiveDigest(digest)) return undefined;
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
        kind: contract.kind,
      });
    }
    entries.sort((a, b) => a.id.localeCompare(b.id));
    return { format: "trellis.catalog.v1", contracts: entries };
  }

  async validate(raw: unknown): Promise<{ digest: string; canonical: string; contract: TrellisContractV1 }> {
    assertObject(raw);
    if (!isJsonValue(raw)) {
      throw new Error("Contract must be a pure JSON value");
    }

    const { valid, errors } = this.#validator.validate(raw);
    if (!valid) {
      const msg = errors.map((e: { data: { pointer: string }; message: string }) => `${e.data.pointer}: ${e.message}`).join("\n");
      throw new Error(`Invalid contract:\n${msg}`);
    }

    const contract = normalizeContract(raw as unknown as TrellisContractV1);
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
