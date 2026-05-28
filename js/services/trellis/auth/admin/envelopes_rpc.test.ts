import { assert, assertEquals } from "@std/assert";
import { type BaseError, Result } from "@qlever-llc/result";
import {
  digestContractManifest,
  type TrellisContractV1,
} from "@qlever-llc/trellis/contracts";
import { createTestContracts } from "../../catalog/test_contracts.ts";
import type {
  ContractResourceBindings,
  ResourceProvisioningOptions,
} from "../../catalog/resources.ts";
import type { ContractRecord } from "../../catalog/schemas.ts";
import type {
  DeploymentEnvelope,
  DeploymentGrantOverride,
  DeploymentResourceBinding,
  EnvelopeBoundary,
  EnvelopeExpansionRequest,
  EnvelopeHistoryEntry,
  IdentityEnvelopeRecord,
  ImplementationOffer,
  Session,
} from "../schemas.ts";
import {
  createAuthEnvelopeExpansionsListHandler,
  createAuthEnvelopeExpansionsRejectHandler,
  createAuthEnvelopesApproveRequestHandler,
  createAuthEnvelopesChangesPreviewHandler,
  createAuthEnvelopesExpandHandler,
  createAuthEnvelopesGetHandler,
  createAuthEnvelopesGrantOverridesListHandler,
  createAuthEnvelopesGrantOverridesPutHandler,
  createAuthEnvelopesGrantOverridesRemoveHandler,
  createAuthEnvelopesListHandler,
  createAuthEnvelopesShrinkHandler,
} from "./envelopes_rpc.ts";

const adminContext = {
  caller: {
    type: "user" as const,
    participantKind: "app" as const,
    userId: "admin",
    identity: {
      identityId: "idn_admin",
      provider: "github",
      subject: "admin",
    },
    active: true,
    name: "Admin",
    email: "admin@example.com",
    capabilities: ["admin"],
    lastAuth: new Date().toISOString(),
  },
};

const EMPTY_BOUNDARY: EnvelopeBoundary = {
  contracts: [],
  surfaces: [],
  capabilities: [],
  resources: [],
};

function mustTake<
  T,
  E extends BaseError<{
    id: string;
    type: string;
    message: string;
    context?: Record<string, unknown>;
    traceId?: string;
  }>,
>(result: Result<T, E>): T {
  if (result.isErr()) throw result.error;
  return result.take() as T;
}

class InMemoryDeploymentEnvelopeStorage {
  #records = new Map<string, DeploymentEnvelope>();
  putCount = 0;
  onApproveExpansion?: (record: {
    envelope: DeploymentEnvelope;
    delta: EnvelopeBoundary;
    resourceBindings: DeploymentResourceBinding[];
    history?: EnvelopeHistoryEntry;
    request: { requestId: string; state: "approved" };
  }) => Promise<boolean>;

  seed(record: DeploymentEnvelope): void {
    this.#records.set(record.deploymentId, record);
  }

  async get(deploymentId: string): Promise<DeploymentEnvelope | undefined> {
    await Promise.resolve();
    return this.#records.get(deploymentId);
  }

  async put(record: DeploymentEnvelope): Promise<void> {
    await Promise.resolve();
    this.putCount += 1;
    this.#records.set(record.deploymentId, record);
  }

  async approveExpansion(record: {
    envelope: DeploymentEnvelope;
    delta: EnvelopeBoundary;
    resourceBindings: DeploymentResourceBinding[];
    history?: EnvelopeHistoryEntry;
    request: { requestId: string; state: "approved" };
  }): Promise<boolean> {
    await Promise.resolve();
    this.putCount += 1;
    this.#records.set(record.envelope.deploymentId, record.envelope);
    return await this.onApproveExpansion?.(record) ?? true;
  }

  async list(): Promise<DeploymentEnvelope[]> {
    await Promise.resolve();
    return [...this.#records.values()].sort((left, right) =>
      left.deploymentId.localeCompare(right.deploymentId)
    );
  }

  async listEnabled(): Promise<DeploymentEnvelope[]> {
    return (await this.list()).filter((record) => !record.disabled);
  }

  async listFiltered(filters: {
    kind?: string;
    disabled?: boolean;
  } = {}): Promise<DeploymentEnvelope[]> {
    return (await this.list()).filter((record) =>
      (filters.kind === undefined || record.kind === filters.kind) &&
      (filters.disabled === undefined || record.disabled === filters.disabled)
    );
  }
}

class InMemoryEnvelopeHistoryStorage {
  records: EnvelopeHistoryEntry[] = [];

  async put(record: EnvelopeHistoryEntry): Promise<void> {
    await Promise.resolve();
    this.records.push(record);
  }

  seed(record: EnvelopeHistoryEntry): void {
    this.records.push(record);
  }

  async listByScope(
    scopeKind: EnvelopeHistoryEntry["scopeKind"],
    scopeId: string,
  ): Promise<EnvelopeHistoryEntry[]> {
    await Promise.resolve();
    return this.records.filter((record) =>
      record.scopeKind === scopeKind && record.scopeId === scopeId
    );
  }
}

class InMemoryDeploymentResourceBindingStorage {
  #records = new Map<string, DeploymentResourceBinding>();
  putCount = 0;

  async get(
    deploymentId: string,
    kind: string,
    alias: string,
  ): Promise<DeploymentResourceBinding | undefined> {
    await Promise.resolve();
    return this.#records.get(`${deploymentId}:${kind}:${alias}`);
  }

  async put(record: DeploymentResourceBinding): Promise<void> {
    await Promise.resolve();
    this.putCount += 1;
    this.#records.set(
      `${record.deploymentId}:${record.kind}:${record.alias}`,
      record,
    );
  }

  seed(record: DeploymentResourceBinding): void {
    this.#records.set(
      `${record.deploymentId}:${record.kind}:${record.alias}`,
      record,
    );
  }

  async listByDeployment(
    deploymentId: string,
  ): Promise<DeploymentResourceBinding[]> {
    await Promise.resolve();
    return this.list().filter((binding) =>
      binding.deploymentId === deploymentId
    );
  }

  list(): DeploymentResourceBinding[] {
    return [...this.#records.values()].sort((left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.alias.localeCompare(right.alias)
    );
  }
}

class InMemoryIdentityEnvelopeStorage {
  #records: IdentityEnvelopeRecord[] = [];

  seed(record: IdentityEnvelopeRecord): void {
    this.#records.push(record);
  }

  async list(): Promise<IdentityEnvelopeRecord[]> {
    await Promise.resolve();
    return [...this.#records];
  }

  async listApproved(): Promise<IdentityEnvelopeRecord[]> {
    return (await this.list()).filter((record) => record.answer === "approved");
  }
}

class InMemoryDeploymentPortalRouteStorage {
  #records = new Map<
    string,
    {
      deploymentId: string;
      portalId: string | null;
      entryUrl: string | null;
      disabled: boolean;
      updatedAt: string;
    }
  >();

  seed(
    record: {
      deploymentId: string;
      portalId: string | null;
      entryUrl: string | null;
      disabled: boolean;
      updatedAt: string;
    },
  ): void {
    this.#records.set(record.deploymentId, record);
  }

  async get(deploymentId: string) {
    await Promise.resolve();
    return this.#records.get(deploymentId);
  }
}

class InMemoryDeploymentGrantOverrideStorage {
  #records: DeploymentGrantOverride[] = [];

  seed(record: DeploymentGrantOverride): void {
    this.#records.push(record);
  }

  async replaceForDeployment(
    deploymentId: string,
    records: DeploymentGrantOverride[],
  ): Promise<void> {
    await Promise.resolve();
    this.#records = [
      ...this.#records.filter((record) => record.deploymentId !== deploymentId),
      ...records,
    ];
  }

  async listByDeployment(deploymentId: string) {
    await Promise.resolve();
    return this.#records.filter((record) =>
      record.deploymentId === deploymentId
    );
  }

  async listCountedPage(query: { offset?: number; limit: number }) {
    await Promise.resolve();
    const offset = query.offset ?? 0;
    const entries = [...this.#records]
      .sort((left, right) =>
        left.deploymentId.localeCompare(right.deploymentId) ||
        left.grantKind.localeCompare(right.grantKind) ||
        String(left.capability).localeCompare(String(right.capability)) ||
        String(left.capabilityGroupKey).localeCompare(
          String(right.capabilityGroupKey),
        ) ||
        left.identityKind.localeCompare(right.identityKind) ||
        left.contractId.localeCompare(right.contractId) ||
        String(left.origin).localeCompare(String(right.origin)) ||
        String(left.sessionPublicKey).localeCompare(
          String(right.sessionPublicKey),
        )
      )
      .slice(offset, offset + query.limit);
    return {
      entries,
      count: this.#records.length,
      offset,
      limit: query.limit,
      nextOffset:
        query.limit <= 0 || offset + query.limit >= this.#records.length
          ? undefined
          : offset + query.limit,
    };
  }
}

class InMemoryContractStorage {
  #records = new Map<string, ContractRecord>();
  putCount = 0;

  async put(record: ContractRecord): Promise<void> {
    await Promise.resolve();
    this.putCount += 1;
    this.#records.set(record.digest, record);
  }

  async get(digest: string): Promise<ContractRecord | undefined> {
    await Promise.resolve();
    return this.#records.get(digest);
  }
}

class InMemoryImplementationOfferStorage {
  #records: ImplementationOffer[] = [];

  seed(record: ImplementationOffer): void {
    this.#records.push(record);
  }

  async listByDeployment(
    deploymentKind: ImplementationOffer["deploymentKind"],
    deploymentId: string,
  ): Promise<ImplementationOffer[]> {
    await Promise.resolve();
    return this.#records.filter((record) =>
      record.deploymentKind === deploymentKind &&
      record.deploymentId === deploymentId
    );
  }
}

class InMemoryEnvelopeExpansionRequestStorage {
  #records: EnvelopeExpansionRequest[] = [];

  seed(record: EnvelopeExpansionRequest): void {
    this.#records.push(record);
  }

  async listByDeployment(
    deploymentId: string,
  ): Promise<EnvelopeExpansionRequest[]> {
    await Promise.resolve();
    return (await this.list()).filter((record) =>
      record.deploymentId === deploymentId
    );
  }

  async list(): Promise<EnvelopeExpansionRequest[]> {
    await Promise.resolve();
    return [...this.#records].sort((left, right) =>
      left.deploymentId.localeCompare(right.deploymentId) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.requestId.localeCompare(right.requestId)
    );
  }

  async listFiltered(filters: {
    deploymentId?: string;
    state?: string;
  } = {}): Promise<EnvelopeExpansionRequest[]> {
    return (await this.list()).filter((record) =>
      (filters.deploymentId === undefined ||
        record.deploymentId === filters.deploymentId) &&
      (filters.state === undefined || record.state === filters.state)
    );
  }

  async get(requestId: string): Promise<EnvelopeExpansionRequest | undefined> {
    await Promise.resolve();
    return this.#records.find((record) => record.requestId === requestId);
  }

  async latestApprovedByContractId(
    contractId: string,
  ): Promise<EnvelopeExpansionRequest | undefined> {
    await Promise.resolve();
    return this.#records
      .filter((record) =>
        record.contractId === contractId && record.state === "approved"
      )
      .sort((left, right) =>
        (right.decidedAt ?? "").localeCompare(left.decidedAt ?? "") ||
        right.createdAt.localeCompare(left.createdAt) ||
        right.requestId.localeCompare(left.requestId)
      )[0];
  }

  async updateState(record: {
    requestId: string;
    state: "pending" | "approved" | "rejected";
    decidedAt: string | null;
    decidedBy: Record<string, unknown> | null;
    decisionReason: string | null;
  }): Promise<boolean> {
    await Promise.resolve();
    const current = await this.get(record.requestId);
    if (!current || current.state !== "pending") return false;
    Object.assign(current, {
      state: record.state,
      decidedAt: record.decidedAt,
      decidedBy: record.decidedBy,
      decisionReason: record.decisionReason,
    });
    return true;
  }
}

class InMemorySessionStorage {
  #records = new Map<string, Session>();
  deleted: string[] = [];

  seed(sessionKey: string, session: Session): void {
    this.#records.set(sessionKey, session);
  }

  async listEntries(): Promise<
    Array<{ sessionKey: string; session: Session }>
  > {
    await Promise.resolve();
    return [...this.#records.entries()]
      .map(([sessionKey, session]) => ({ sessionKey, session }))
      .sort((left, right) => left.sessionKey.localeCompare(right.sessionKey));
  }

  async listEntriesForDeploymentEnvelopePreview(
    deploymentId: string,
  ): Promise<Array<{ sessionKey: string; session: Session }>> {
    return (await this.listEntries()).filter((entry) =>
      entry.session.type === "user" ||
      ("deploymentId" in entry.session &&
        entry.session.deploymentId === deploymentId)
    );
  }

  async deleteBySessionKey(sessionKey: string): Promise<void> {
    await Promise.resolve();
    this.deleted.push(sessionKey);
    this.#records.delete(sessionKey);
  }
}

function dependencyContract(): TrellisContractV1 {
  return {
    format: "trellis.contract.v1",
    id: "acme.platform@v1",
    displayName: "Platform",
    description: "Platform API",
    kind: "service",
    capabilities: {
      "platform.read": {
        displayName: "Read platform",
        description: "Read platform data.",
      },
      "events.publish": {
        displayName: "Publish events",
        description: "Publish events.",
      },
    },
    schemas: { Empty: { type: "object" } },
    rpc: {
      Read: {
        version: "v1",
        subject: "rpc.v1.platform.Read",
        input: { schema: "Empty" },
        output: { schema: "Empty" },
        capabilities: { call: ["platform.read"] },
      },
    },
    events: {
      Changed: {
        version: "v1",
        subject: "events.v1.platform.Changed",
        event: { schema: "Empty" },
        capabilities: { publish: ["events.publish"] },
      },
    },
  };
}

function serviceContract(): TrellisContractV1 {
  return {
    format: "trellis.contract.v1",
    id: "acme.billing@v1",
    displayName: "Billing",
    description: "Billing service",
    kind: "service",
    capabilities: {
      "billing.call": {
        displayName: "Call billing",
        description: "Call billing RPCs.",
      },
    },
    schemas: { Empty: { type: "object" } },
    uses: {
      required: {
        platform: {
          contract: "acme.platform@v1",
          rpc: { call: ["Read"] },
        },
      },
    },
    rpc: {
      Charge: {
        version: "v1",
        subject: "rpc.v1.billing.Charge",
        input: { schema: "Empty" },
        output: { schema: "Empty" },
        capabilities: { call: ["billing.call"] },
      },
    },
  };
}

function eventConsumerServiceContract(): TrellisContractV1 {
  return {
    ...serviceContract(),
    uses: {
      required: {
        platform: {
          contract: "acme.platform@v1",
          events: { subscribe: ["Changed"] },
        },
      },
    },
    eventConsumers: {
      ingest: {
        events: [{ use: "platform", event: "Changed" }],
      },
    },
  } as TrellisContractV1;
}

function resourceContract(): TrellisContractV1 {
  return {
    ...serviceContract(),
    resources: {
      kv: {
        cache: {
          purpose: "Cache billing records",
          schema: { schema: "Empty" },
          required: true,
          history: 2,
          ttlMs: 1000,
        },
      },
      store: {
        uploads: {
          purpose: "Uploaded billing files",
          required: true,
          ttlMs: 2000,
          maxTotalBytes: 100000,
        },
      },
    },
    jobs: {
      reconcile: {
        payload: { schema: "Empty" },
        maxDeliver: 3,
      },
    },
  };
}

function makeEnvelope(
  boundary = EMPTY_BOUNDARY,
  overrides: Partial<Omit<DeploymentEnvelope, "boundary">> = {},
): DeploymentEnvelope {
  return {
    deploymentId: "billing.default",
    kind: "service",
    disabled: false,
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    boundary,
    ...overrides,
  };
}

function makeImplementationOffer(
  contract = serviceContract(),
): ImplementationOffer {
  return {
    offerId: "offer-1",
    deploymentKind: "service",
    deploymentId: "billing.default",
    instanceId: "instance-1",
    contractId: contract.id,
    contractDigest: digestContractManifest(contract),
    lineageKey: contract.id,
    status: "accepted",
    liveness: "healthy",
    firstOfferedAt: "2026-05-07T00:00:00.000Z",
    acceptedAt: "2026-05-07T00:00:00.000Z",
    lastRefreshedAt: "2026-05-07T00:00:00.000Z",
    staleAt: null,
    expiresAt: null,
  };
}

function expandedBoundary(): EnvelopeBoundary {
  return {
    contracts: [
      { contractId: "acme.billing@v1", required: true },
      { contractId: "acme.platform@v1", required: true },
    ],
    surfaces: [
      {
        contractId: "acme.platform@v1",
        kind: "rpc",
        name: "Read",
        action: "call",
        required: true,
      },
    ],
    capabilities: ["platform.read"],
    resources: [{ kind: "kv", alias: "cache", required: true }],
  };
}

function shrunkBoundary(): EnvelopeBoundary {
  return {
    contracts: [{ contractId: "acme.billing@v1", required: true }],
    surfaces: [],
    capabilities: [],
    resources: [],
  };
}

function makeServiceSession(contract = serviceContract()): Session {
  return {
    type: "service",
    trellisId: "service-trellis-id",
    origin: "service",
    id: "svc-1",
    email: "svc@example.com",
    name: "Billing service",
    createdAt: new Date("2026-05-07T00:00:00.000Z"),
    lastAuth: new Date("2026-05-07T00:00:00.000Z"),
    instanceId: "instance-1",
    deploymentId: "billing.default",
    instanceKey: "session-key-1",
    contractId: contract.id,
    contractDigest: digestContractManifest(contract),
  };
}

function makeDeps(options: {
  envelope?: DeploymentEnvelope;
  contracts?: ReturnType<typeof createTestContracts>;
  provisionResourceBindings?: (
    options: ResourceProvisioningOptions,
  ) => Promise<ContractResourceBindings>;
} = {}) {
  const envelopes = new InMemoryDeploymentEnvelopeStorage();
  envelopes.seed(options.envelope ?? makeEnvelope());
  const resources = new InMemoryDeploymentResourceBindingStorage();
  const contractStorage = new InMemoryContractStorage();
  const history = new InMemoryEnvelopeHistoryStorage();
  const contracts = options.contracts ?? createTestContracts([{
    digest: "platform-digest",
    contract: dependencyContract(),
  }]);
  return {
    envelopes,
    resources,
    contractStorage,
    history,
    handler: createAuthEnvelopesExpandHandler({
      contracts,
      contractStorage,
      deploymentEnvelopeStorage: envelopes,
      envelopeHistoryStorage: history,
      deploymentResourceBindingStorage: resources,
      provisionResources: options.provisionResourceBindings
        ? async (_nats, _contract, _deploymentId, provisioningOptions) => ({
          bindings: await options.provisionResourceBindings?.(
            provisioningOptions ?? {},
          ) ?? {},
          created: [],
          adopted: [],
        })
        : async () => ({ bindings: {}, created: [], adopted: [] }),
      now: () => new Date("2026-05-07T01:00:00.000Z"),
      logger: { trace: () => {} },
    }),
  };
}

Deno.test("Auth.Envelopes.List returns admin-visible envelope authority rows", async () => {
  const envelopes = new InMemoryDeploymentEnvelopeStorage();
  envelopes.seed(
    makeEnvelope({
      capabilities: ["billing.call"],
      contracts: [],
      surfaces: [],
      resources: [],
    }),
  );
  envelopes.seed(
    makeEnvelope(EMPTY_BOUNDARY, {
      deploymentId: "phone.default",
      kind: "device",
      disabled: true,
    }),
  );
  const handler = createAuthEnvelopesListHandler({
    deploymentEnvelopeStorage: envelopes,
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { disabled: false, limit: 100 },
    context: adminContext,
  });
  if (result.isErr()) throw result.error;
  const value = mustTake(result);
  if (!("entries" in value)) throw new Error("expected page response");

  assertEquals(
    value.entries.map((envelope: DeploymentEnvelope) => envelope.deploymentId),
    [
      "billing.default",
    ],
  );
  assertEquals(value.count, 1);
  assertEquals(value.offset, 0);
  assertEquals(value.limit, 100);
  assertEquals(value.nextOffset, undefined);
  assertEquals(value.entries[0]?.boundary.capabilities, ["billing.call"]);
});

Deno.test("Auth.Envelopes.Get returns envelope detail for Console review", async () => {
  const envelopes = new InMemoryDeploymentEnvelopeStorage();
  const resources = new InMemoryDeploymentResourceBindingStorage();
  const history = new InMemoryEnvelopeHistoryStorage();
  const offers = new InMemoryImplementationOfferStorage();
  const requests = new InMemoryEnvelopeExpansionRequestStorage();
  const portalRoutes = new InMemoryDeploymentPortalRouteStorage();
  const grantOverrides = new InMemoryDeploymentGrantOverrideStorage();
  const contract = serviceContract();
  const digest = digestContractManifest(contract);

  envelopes.seed(makeEnvelope());
  resources.seed({
    deploymentId: "billing.default",
    kind: "kv",
    alias: "cache",
    binding: { bucket: "billing-cache" },
    limits: null,
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
  });
  history.seed({
    entryId: "envh-1",
    scopeKind: "deployment",
    scopeId: "billing.default",
    action: "expand",
    delta: expandedBoundary(),
    resultingUpdatedAt: "2026-05-07T00:00:00.000Z",
    actor: null,
    reason: null,
    source: { contractId: contract.id, contractDigest: digest },
    createdAt: "2026-05-07T00:00:00.000Z",
  });
  offers.seed(makeImplementationOffer(contract));
  requests.seed({
    requestId: "req-1",
    deploymentId: "billing.default",
    requestedByKind: "service",
    requestedBy: { deploymentId: "billing.default" },
    contractId: contract.id,
    contractDigest: digest,
    contract,
    state: "pending",
    createdAt: "2026-05-07T00:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    delta: expandedBoundary(),
  });
  portalRoutes.seed({
    deploymentId: "billing.default",
    portalId: "ops",
    entryUrl: "https://ops.example.com",
    disabled: false,
    updatedAt: "2026-05-07T00:00:00.000Z",
  });
  grantOverrides.seed({
    deploymentId: "billing.default",
    identityKind: "web",
    grantKind: "capability",
    contractId: contract.id,
    origin: "https://app.example.com",
    sessionPublicKey: null,
    capability: "billing.call",
    capabilityGroupKey: null,
  });
  const handler = createAuthEnvelopesGetHandler({
    deploymentEnvelopeStorage: envelopes,
    deploymentResourceBindingStorage: resources,
    envelopeHistoryStorage: history,
    implementationOfferStorage: offers,
    envelopeExpansionRequestStorage: requests,
    deploymentPortalRouteStorage: portalRoutes,
    deploymentGrantOverrideStorage: grantOverrides,
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { deploymentId: "billing.default" },
    context: adminContext,
  });
  const value = mustTake(result);

  assertEquals(value.envelope.deploymentId, "billing.default");
  assertEquals(value.resourceBindings.map((binding) => binding.alias), [
    "cache",
  ]);
  assertEquals(value.contractHistory.map((record) => record.entryId), [
    "envh-1",
  ]);
  assertEquals(
    value.implementationOffers.map((record) => record.contractDigest),
    [
      digest,
    ],
  );
  assertEquals(value.expansionRequests.map((request) => request.requestId), [
    "req-1",
  ]);
  assertEquals(value.expansionRequests[0]?.contract, {
    id: contract.id,
    digest,
    redacted: true,
    format: contract.format,
    displayName: contract.displayName,
    description: contract.description,
    kind: contract.kind,
  });
  assertEquals(value.portalRoute?.portalId, "ops");
  assertEquals(value.grantOverrides.map((override) => override.capability), [
    "billing.call",
  ]);
});

Deno.test("Auth.Envelopes.GrantOverrides.List returns compact paged grant override rows", async () => {
  const grantOverrides = new InMemoryDeploymentGrantOverrideStorage();
  grantOverrides.seed({
    deploymentId: "billing.default",
    identityKind: "web",
    grantKind: "capability",
    contractId: "acme.billing@v1",
    origin: "https://app.example.com",
    sessionPublicKey: null,
    capability: "billing.call",
    capabilityGroupKey: null,
  });
  grantOverrides.seed({
    deploymentId: "ops.default",
    identityKind: "session",
    grantKind: "capability-group",
    contractId: "acme.ops@v1",
    origin: null,
    sessionPublicKey: "session-key",
    capability: null,
    capabilityGroupKey: "ops-admins",
  });
  const handler = createAuthEnvelopesGrantOverridesListHandler({
    deploymentGrantOverrideStorage: grantOverrides,
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { limit: 1, offset: 0 },
    context: adminContext,
  });
  const value = mustTake(result) as {
    entries: DeploymentGrantOverride[];
    count: number;
    nextOffset?: number;
  };

  assertEquals(value.entries.map((override) => override.deploymentId), [
    "billing.default",
  ]);
  assertEquals(value.count, 2);
  assertEquals(value.nextOffset, 1);
});

Deno.test("Auth.Envelopes.GrantOverrides.Put replaces deployment override rows", async () => {
  const envelopes = new InMemoryDeploymentEnvelopeStorage();
  const grantOverrides = new InMemoryDeploymentGrantOverrideStorage();
  envelopes.seed(makeEnvelope());
  grantOverrides.seed({
    deploymentId: "billing.default",
    identityKind: "session",
    grantKind: "capability",
    contractId: "acme.billing@v1",
    origin: null,
    sessionPublicKey: "old-session",
    capability: "old.capability",
    capabilityGroupKey: null,
  });
  const override: DeploymentGrantOverride = {
    deploymentId: "billing.default",
    identityKind: "web",
    grantKind: "capability-group",
    contractId: "acme.billing@v1",
    origin: "https://app.example.com",
    sessionPublicKey: null,
    capability: null,
    capabilityGroupKey: "billing-operators",
  };
  const handler = createAuthEnvelopesGrantOverridesPutHandler({
    deploymentEnvelopeStorage: envelopes,
    deploymentGrantOverrideStorage: grantOverrides,
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { deploymentId: "billing.default", overrides: [override] },
    context: adminContext,
  });
  const value = mustTake(result) as {
    grantOverrides: DeploymentGrantOverride[];
  };

  assertEquals(value.grantOverrides, [override]);
  assertEquals(await grantOverrides.listByDeployment("billing.default"), [
    override,
  ]);
});

Deno.test("Auth.Envelopes.GrantOverrides.Remove removes exact matching rows", async () => {
  const envelopes = new InMemoryDeploymentEnvelopeStorage();
  const grantOverrides = new InMemoryDeploymentGrantOverrideStorage();
  envelopes.seed(makeEnvelope());
  const removed: DeploymentGrantOverride = {
    deploymentId: "billing.default",
    identityKind: "web",
    grantKind: "capability",
    contractId: "acme.billing@v1",
    origin: "https://app.example.com",
    sessionPublicKey: null,
    capability: "billing.call",
    capabilityGroupKey: null,
  };
  const retained: DeploymentGrantOverride = {
    ...removed,
    capability: "billing.read",
  };
  grantOverrides.seed(removed);
  grantOverrides.seed(retained);
  const handler = createAuthEnvelopesGrantOverridesRemoveHandler({
    deploymentEnvelopeStorage: envelopes,
    deploymentGrantOverrideStorage: grantOverrides,
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { deploymentId: "billing.default", overrides: [removed] },
    context: adminContext,
  });
  const value = mustTake(result) as {
    grantOverrides: DeploymentGrantOverride[];
  };

  assertEquals(value.grantOverrides, [retained]);
  assertEquals(await grantOverrides.listByDeployment("billing.default"), [
    retained,
  ]);
});

Deno.test("Auth.EnvelopeExpansions.List returns filtered expansion requests", async () => {
  const contract = serviceContract();
  const requests = new InMemoryEnvelopeExpansionRequestStorage();
  requests.seed({
    requestId: "request-2",
    deploymentId: "phone.default",
    requestedByKind: "device",
    requestedBy: { instanceId: "device-1" },
    contractId: contract.id,
    contractDigest: digestContractManifest(contract),
    contract,
    state: "pending",
    createdAt: "2026-05-07T00:01:00.000Z",
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    delta: EMPTY_BOUNDARY,
  });
  requests.seed({
    requestId: "request-1",
    deploymentId: "billing.default",
    requestedByKind: "service",
    requestedBy: { instanceId: "svc-1" },
    contractId: contract.id,
    contractDigest: digestContractManifest(contract),
    contract,
    state: "pending",
    createdAt: "2026-05-07T00:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    delta: expandedBoundary(),
  });
  requests.seed({
    requestId: "request-3",
    deploymentId: "billing.default",
    requestedByKind: "service",
    requestedBy: { instanceId: "svc-2" },
    contractId: contract.id,
    contractDigest: digestContractManifest(contract),
    contract,
    state: "approved",
    createdAt: "2026-05-07T00:02:00.000Z",
    decidedAt: "2026-05-07T01:00:00.000Z",
    decidedBy: { type: "user", id: "admin" },
    decisionReason: null,
    delta: EMPTY_BOUNDARY,
  });
  const handler = createAuthEnvelopeExpansionsListHandler({
    envelopeExpansionRequestStorage: requests,
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { deploymentId: "billing.default", state: "pending", limit: 100 },
    context: adminContext,
  });

  if (result.isErr()) throw result.error;
  const value = mustTake(result);
  if (!("entries" in value)) throw new Error("expected page response");
  assertEquals(
    value.entries.map((request: EnvelopeExpansionRequest) => request.requestId),
    [
      "request-1",
    ],
  );
  assertEquals(value.count, 1);
  assertEquals(value.offset, 0);
  assertEquals(value.limit, 100);
  assertEquals(value.nextOffset, undefined);
  assertEquals(value.entries[0]?.delta, expandedBoundary());
  assertEquals(value.entries[0]?.contract, {
    id: contract.id,
    digest: digestContractManifest(contract),
    redacted: true,
    format: contract.format,
    displayName: contract.displayName,
    description: contract.description,
    kind: contract.kind,
  });
});

Deno.test("Auth.Envelopes.Expand expands modeled rows and stores history", async () => {
  const contract = serviceContract();
  const { handler, envelopes, contractStorage, history } = makeDeps();

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract,
      expectedDigest: digestContractManifest(contract),
    },
    context: adminContext,
  });

  if (result.isErr()) throw result.error;
  const value = mustTake(result);
  assertEquals(envelopes.putCount, 1);
  assertEquals(contractStorage.putCount, 1);
  const storedContract = await contractStorage.get(
    digestContractManifest(contract),
  );
  assertEquals(storedContract?.id, contract.id);
  assertEquals(JSON.parse(storedContract?.contract ?? "null"), contract);
  assertEquals(value.envelope.boundary.contracts, [
    { contractId: "acme.billing@v1", required: true },
    { contractId: "acme.platform@v1", required: true },
  ]);
  assertEquals(value.envelope.boundary.capabilities, [
    "platform.read",
  ]);
  assertEquals(value.delta.contracts, value.envelope.boundary.contracts);
  assertEquals(
    value.contractHistory[0]?.source.contractDigest,
    digestContractManifest(contract),
  );
  assertEquals(history.records.length, 1);
  assertEquals(history.records[0]?.action, "expand");
  assertEquals(history.records[0]?.scopeId, "billing.default");
  assertEquals(history.records[0]?.delta, value.delta);
  assertEquals(
    history.records[0]?.resultingUpdatedAt,
    value.envelope.updatedAt,
  );
  assertEquals(history.records[0]?.actor, { type: "user", id: "admin" });
  assertEquals(history.records[0]?.source, {
    contractId: contract.id,
    contractDigest: digestContractManifest(contract),
  });
});

Deno.test("Auth.Envelopes.Expand resolves required dependency surfaces from known inactive contracts", async () => {
  const contract = serviceContract();
  const contracts = createTestContracts();
  contracts.addKnownTestContract({
    digest: "platform-digest",
    contract: dependencyContract(),
  });
  const { handler } = makeDeps({ contracts });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract,
      expectedDigest: digestContractManifest(contract),
    },
    context: adminContext,
  });

  if (result.isErr()) throw result.error;
  const value = mustTake(result);
  assertEquals(value.delta.contracts, [
    { contractId: "acme.billing@v1", required: true },
    { contractId: "acme.platform@v1", required: true },
  ]);
  assertEquals(value.delta.surfaces, [{
    contractId: "acme.billing@v1",
    kind: "rpc",
    name: "Charge",
    action: "call",
    required: true,
  }, {
    contractId: "acme.platform@v1",
    kind: "rpc",
    name: "Read",
    action: "call",
    required: true,
  }]);
  assertEquals(value.delta.capabilities, ["platform.read"]);
});

Deno.test("Auth.EnvelopeExpansions.Approve expands envelope from pending request", async () => {
  const contract = serviceContract();
  const { envelopes, resources, contractStorage } = makeDeps();
  const requests = new InMemoryEnvelopeExpansionRequestStorage();
  envelopes.onApproveExpansion = async (record) => {
    const updated = await requests.updateState({
      requestId: record.request.requestId,
      state: "approved",
      decidedAt: "2026-05-07T01:00:00.000Z",
      decidedBy: { type: "user", id: "admin" },
      decisionReason: "demo approval",
    });
    for (const binding of record.resourceBindings) await resources.put(binding);
    return updated;
  };
  requests.seed({
    requestId: "request-1",
    deploymentId: "billing.default",
    requestedByKind: "service",
    requestedBy: { instanceId: "svc-1" },
    contractId: contract.id,
    contractDigest: digestContractManifest(contract),
    contract,
    state: "pending",
    createdAt: "2026-05-07T00:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    delta: EMPTY_BOUNDARY,
  });
  const handler = createAuthEnvelopesApproveRequestHandler({
    contracts: createTestContracts([{
      digest: "platform-digest",
      contract: dependencyContract(),
    }]),
    contractStorage,
    deploymentEnvelopeStorage: envelopes,
    deploymentResourceBindingStorage: resources,
    envelopeExpansionRequestStorage: requests,
    provisionResources: async () => ({
      bindings: {},
      created: [],
      adopted: [],
    }),
    now: () => new Date("2026-05-07T01:00:00.000Z"),
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { requestId: "request-1", reason: "demo approval" },
    context: adminContext,
  });

  if (result.isErr()) throw result.error;
  const value = mustTake(result);
  if (Result.isErr(value)) throw value.error;
  assertEquals(value.request.state, "approved");
  assertEquals(value.request.decisionReason, "demo approval");
  assertEquals(value.request.contract, {
    id: contract.id,
    digest: digestContractManifest(contract),
    redacted: true,
    format: contract.format,
    displayName: contract.displayName,
    description: contract.description,
    kind: contract.kind,
  });
  assertEquals(envelopes.putCount, 1);
  assertEquals(contractStorage.putCount, 1);
  assertEquals(
    JSON.parse(
      (await contractStorage.get(digestContractManifest(contract)))?.contract ??
        "null",
    ),
    contract,
  );
  assertEquals((await requests.get("request-1"))?.state, "approved");
});

Deno.test("Auth.EnvelopeExpansions.Approve keeps inactive ambiguous dependencies pending", async () => {
  const contract = serviceContract();
  const contracts = createTestContracts();
  contracts.addKnownTestContract({
    digest: "platform-old",
    contract: dependencyContract(),
  });
  contracts.addKnownTestContract({
    digest: "platform-new",
    contract: {
      ...dependencyContract(),
      schemas: {
        Empty: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      },
    },
  });
  const { envelopes, resources, contractStorage } = makeDeps({
    contracts,
  });
  const requests = new InMemoryEnvelopeExpansionRequestStorage();
  envelopes.onApproveExpansion = async (record) => {
    const updated = await requests.updateState({
      requestId: record.request.requestId,
      state: "approved",
      decidedAt: "2026-05-07T01:00:00.000Z",
      decidedBy: { type: "user", id: "admin" },
      decisionReason: "approve own boundary",
    });
    return updated;
  };
  requests.seed({
    requestId: "request-ambiguous-dep",
    deploymentId: "billing.default",
    requestedByKind: "service",
    requestedBy: { instanceId: "svc-1" },
    contractId: contract.id,
    contractDigest: digestContractManifest(contract),
    contract,
    state: "pending",
    createdAt: "2026-05-07T00:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    delta: EMPTY_BOUNDARY,
  });
  const handler = createAuthEnvelopesApproveRequestHandler({
    contracts,
    contractStorage,
    deploymentEnvelopeStorage: envelopes,
    deploymentResourceBindingStorage: resources,
    envelopeExpansionRequestStorage: requests,
    provisionResources: async () => ({
      bindings: {},
      created: [],
      adopted: [],
    }),
    now: () => new Date("2026-05-07T01:00:00.000Z"),
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: {
      requestId: "request-ambiguous-dep",
      reason: "approve own boundary",
    },
    context: adminContext,
  });

  if (result.isErr()) throw result.error;
  const value = mustTake(result);
  if (Result.isErr(value)) throw value.error;
  assertEquals(value.request.state, "approved");
  assertEquals(value.delta.contracts, [
    { contractId: "acme.billing@v1", required: true },
    { contractId: "acme.platform@v1", required: true },
  ]);
  assertEquals(value.delta.surfaces, [{
    contractId: "acme.billing@v1",
    kind: "rpc",
    name: "Charge",
    action: "call",
    required: true,
  }]);
  assertEquals(value.delta.capabilities, []);
  assertEquals(
    (await requests.get("request-ambiguous-dep"))?.state,
    "approved",
  );
});

Deno.test("Auth.EnvelopeExpansions.Approve provisions event consumers using active dependency entries", async () => {
  const contract = eventConsumerServiceContract();
  const activeDependency = dependencyContract();
  const staleDependency = {
    ...activeDependency,
    schemas: {
      ...activeDependency.schemas,
      BillingConfirmSubscriptionCheckoutResponseSchema: {
        type: "object",
        properties: { legacy: { type: "string" } },
      },
    },
  } satisfies TrellisContractV1;
  const contracts = createTestContracts([{
    digest: "platform-active",
    contract: activeDependency,
  }]);
  contracts.addKnownTestContract({
    digest: "platform-stale",
    contract: staleDependency,
  });
  const { envelopes, resources, contractStorage } = makeDeps({ contracts });
  const requests = new InMemoryEnvelopeExpansionRequestStorage();
  const seenDependencyDigests: string[][] = [];
  envelopes.onApproveExpansion = async (record) => {
    for (const binding of record.resourceBindings) await resources.put(binding);
    return await requests.updateState({
      requestId: record.request.requestId,
      state: "approved",
      decidedAt: "2026-05-07T01:00:00.000Z",
      decidedBy: { type: "user", id: "admin" },
      decisionReason: null,
    });
  };
  requests.seed({
    requestId: "request-consumer",
    deploymentId: "billing.default",
    requestedByKind: "service",
    requestedBy: { instanceId: "svc-1" },
    contractId: contract.id,
    contractDigest: digestContractManifest(contract),
    contract,
    state: "pending",
    createdAt: "2026-05-07T00:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    delta: EMPTY_BOUNDARY,
  });
  const handler = createAuthEnvelopesApproveRequestHandler({
    contracts,
    contractStorage,
    deploymentEnvelopeStorage: envelopes,
    deploymentResourceBindingStorage: resources,
    envelopeExpansionRequestStorage: requests,
    provisionResources: async (_nats, _contract, _deploymentId, options) => {
      seenDependencyDigests.push(
        (options?.knownContractEntries ?? []).map((entry) => entry.digest),
      );
      return {
        bindings: {
          eventConsumers: {
            ingest: {
              stream: "trellis",
              consumerName: "billing-ingest",
              filterSubjects: ["events.v1.platform.Changed"],
              replay: "new",
              ordering: "strict",
              concurrency: 1,
              ackWaitMs: 300000,
              maxDeliver: 6,
              backoffMs: [5000, 30000, 120000, 600000, 1800000],
            },
          },
        },
        created: [],
        adopted: [],
      };
    },
    now: () => new Date("2026-05-07T01:00:00.000Z"),
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { requestId: "request-consumer" },
    context: adminContext,
  });

  if (result.isErr()) throw result.error;
  const value = mustTake(result);
  if (Result.isErr(value)) throw value.error;
  assertEquals(value.request.state, "approved");
  assertEquals(seenDependencyDigests, [["platform-active"]]);
  assertEquals(
    resources.list().map((binding) => [
      binding.kind,
      binding.alias,
      binding.binding,
    ]),
    [[
      "event-consumer",
      "ingest",
      {
        stream: "trellis",
        consumerName: "billing-ingest",
        filterSubjects: ["events.v1.platform.Changed"],
        replay: "new",
        ordering: "strict",
        concurrency: 1,
        ackWaitMs: 300000,
        maxDeliver: 6,
        backoffMs: [5000, 30000, 120000, 600000, 1800000],
      },
    ]],
  );
});

Deno.test("Auth.EnvelopeExpansions.Approve provisions event consumers using latest approved dependency fallback", async () => {
  const contract = eventConsumerServiceContract();
  const approvedDependency = dependencyContract();
  const staleDependency = {
    ...approvedDependency,
    schemas: {
      ...approvedDependency.schemas,
      BillingConfirmSubscriptionCheckoutResponseSchema: {
        type: "object",
        properties: { legacy: { type: "string" } },
      },
    },
  } satisfies TrellisContractV1;
  const contracts = createTestContracts();
  contracts.addKnownTestContract({
    digest: "platform-stale",
    contract: staleDependency,
  });
  const { envelopes, resources, contractStorage } = makeDeps({ contracts });
  const requests = new InMemoryEnvelopeExpansionRequestStorage();
  const seenDependencyDigests: string[][] = [];
  envelopes.onApproveExpansion = async (record) => {
    for (const binding of record.resourceBindings) await resources.put(binding);
    return await requests.updateState({
      requestId: record.request.requestId,
      state: "approved",
      decidedAt: "2026-05-07T01:00:00.000Z",
      decidedBy: { type: "user", id: "admin" },
      decisionReason: null,
    });
  };
  requests.seed({
    requestId: "request-platform-approved",
    deploymentId: "platform.default",
    requestedByKind: "service",
    requestedBy: { instanceId: "platform-svc" },
    contractId: approvedDependency.id,
    contractDigest: digestContractManifest(approvedDependency),
    contract: approvedDependency,
    state: "approved",
    createdAt: "2026-05-06T00:00:00.000Z",
    decidedAt: "2026-05-06T01:00:00.000Z",
    decidedBy: { type: "user", id: "admin" },
    decisionReason: null,
    delta: EMPTY_BOUNDARY,
  });
  requests.seed({
    requestId: "request-consumer-approved-fallback",
    deploymentId: "billing.default",
    requestedByKind: "service",
    requestedBy: { instanceId: "svc-1" },
    contractId: contract.id,
    contractDigest: digestContractManifest(contract),
    contract,
    state: "pending",
    createdAt: "2026-05-07T00:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    delta: EMPTY_BOUNDARY,
  });
  const handler = createAuthEnvelopesApproveRequestHandler({
    contracts,
    contractStorage,
    deploymentEnvelopeStorage: envelopes,
    deploymentResourceBindingStorage: resources,
    envelopeExpansionRequestStorage: requests,
    provisionResources: async (_nats, _contract, _deploymentId, options) => {
      seenDependencyDigests.push(
        (options?.knownContractEntries ?? []).map((entry) => entry.digest),
      );
      return {
        bindings: {
          eventConsumers: {
            ingest: {
              stream: "trellis",
              consumerName: "billing-ingest",
              filterSubjects: ["events.v1.platform.Changed"],
              replay: "new",
              ordering: "strict",
              concurrency: 1,
              ackWaitMs: 300000,
              maxDeliver: 6,
              backoffMs: [5000, 30000, 120000, 600000, 1800000],
            },
          },
        },
        created: [],
        adopted: [],
      };
    },
    now: () => new Date("2026-05-07T01:00:00.000Z"),
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { requestId: "request-consumer-approved-fallback" },
    context: adminContext,
  });

  if (result.isErr()) throw result.error;
  const value = mustTake(result);
  if (Result.isErr(value)) throw value.error;
  assertEquals(value.request.state, "approved");
  assertEquals(seenDependencyDigests, [[
    digestContractManifest(approvedDependency),
  ]]);
});

Deno.test("Auth.EnvelopeExpansions.Approve rejects terminal requests", async () => {
  const contract = serviceContract();
  const { envelopes, resources, contractStorage } = makeDeps();
  const requests = new InMemoryEnvelopeExpansionRequestStorage();
  requests.seed({
    requestId: "request-approved",
    deploymentId: "billing.default",
    requestedByKind: "service",
    requestedBy: { instanceId: "svc-1" },
    contractId: contract.id,
    contractDigest: digestContractManifest(contract),
    contract,
    state: "approved",
    createdAt: "2026-05-07T00:00:00.000Z",
    decidedAt: "2026-05-07T00:30:00.000Z",
    decidedBy: { type: "user", id: "admin" },
    decisionReason: null,
    delta: EMPTY_BOUNDARY,
  });
  const handler = createAuthEnvelopesApproveRequestHandler({
    contracts: createTestContracts([{
      digest: "platform-digest",
      contract: dependencyContract(),
    }]),
    contractStorage,
    deploymentEnvelopeStorage: envelopes,
    deploymentResourceBindingStorage: resources,
    envelopeExpansionRequestStorage: requests,
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { requestId: "request-approved" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(envelopes.putCount, 0);
});

Deno.test("Auth.EnvelopeExpansions.Reject rejects pending request", async () => {
  const contract = serviceContract();
  const requests = new InMemoryEnvelopeExpansionRequestStorage();
  requests.seed({
    requestId: "request-1",
    deploymentId: "billing.default",
    requestedByKind: "service",
    requestedBy: { instanceId: "svc-1" },
    contractId: contract.id,
    contractDigest: digestContractManifest(contract),
    contract,
    state: "pending",
    createdAt: "2026-05-07T00:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    delta: EMPTY_BOUNDARY,
  });
  const handler = createAuthEnvelopeExpansionsRejectHandler({
    envelopeExpansionRequestStorage: requests,
    now: () => new Date("2026-05-07T01:00:00.000Z"),
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { requestId: "request-1", reason: "not needed" },
    context: adminContext,
  });

  if (result.isErr()) throw result.error;
  const value = mustTake(result);
  if (Result.isErr(value)) throw value.error;
  assertEquals(value.request.state, "rejected");
  assertEquals(value.request.contract, {
    id: contract.id,
    digest: digestContractManifest(contract),
    redacted: true,
    format: contract.format,
    displayName: contract.displayName,
    description: contract.description,
    kind: contract.kind,
  });
  assertEquals(value.request.decisionReason, "not needed");
  assertEquals((await requests.get("request-1"))?.state, "rejected");
});

Deno.test("Auth.EnvelopeExpansions.Reject rejects terminal requests", async () => {
  const contract = serviceContract();
  const requests = new InMemoryEnvelopeExpansionRequestStorage();
  requests.seed({
    requestId: "request-rejected",
    deploymentId: "billing.default",
    requestedByKind: "service",
    requestedBy: { instanceId: "svc-1" },
    contractId: contract.id,
    contractDigest: digestContractManifest(contract),
    contract,
    state: "rejected",
    createdAt: "2026-05-07T00:00:00.000Z",
    decidedAt: "2026-05-07T00:30:00.000Z",
    decidedBy: { type: "user", id: "admin" },
    decisionReason: null,
    delta: EMPTY_BOUNDARY,
  });
  const handler = createAuthEnvelopeExpansionsRejectHandler({
    envelopeExpansionRequestStorage: requests,
    now: () => new Date("2026-05-07T01:00:00.000Z"),
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: { requestId: "request-rejected", reason: "not needed" },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals((await requests.get("request-rejected"))?.state, "rejected");
});

Deno.test("Auth.Envelopes.Expand rejects expected digest mismatch", async () => {
  const { handler, envelopes, resources } = makeDeps();
  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract: serviceContract(),
      expectedDigest: "wrong-digest",
    },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(envelopes.putCount, 0);
  assertEquals(resources.putCount, 0);
});

Deno.test("Auth.Envelopes.Expand rejects invalid contract", async () => {
  const { handler, envelopes } = makeDeps();
  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract: { id: "missing-format" },
      expectedDigest: "digest-a",
    },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(envelopes.putCount, 0);
});

Deno.test("Auth.Envelopes.Expand provisions and stores resource delta bindings", async () => {
  const contract = resourceContract();
  let provisionCount = 0;
  const { handler, resources } = makeDeps({
    provisionResourceBindings: async () => {
      provisionCount += 1;
      return {
        kv: { cache: { bucket: "svc_cache", history: 2, ttlMs: 1000 } },
        store: {
          uploads: { name: "svc_uploads", ttlMs: 2000, maxTotalBytes: 100000 },
        },
        jobs: {
          namespace: "billing_jobs",
          workStream: "JOBS_WORK",
          queues: {
            reconcile: {
              queueType: "reconcile",
              publishPrefix: "trellis.jobs.billing.reconcile",
              workSubject: "trellis.work.billing.reconcile",
              consumerName: "billing-reconcile",
              payload: { schema: "Empty" },
              maxDeliver: 3,
              backoffMs: [5000],
              ackWaitMs: 300000,
              progress: true,
              logs: true,
              dlq: true,
              concurrency: 1,
            },
          },
        },
      };
    },
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract,
      expectedDigest: digestContractManifest(contract),
    },
    context: adminContext,
  });

  if (result.isErr()) throw result.error;
  assertEquals(provisionCount, 1);
  assertEquals(
    resources.list().map((binding) => [binding.kind, binding.alias]),
    [
      ["jobs", "reconcile"],
      ["kv", "cache"],
      ["store", "uploads"],
    ],
  );
  const value = mustTake(result);
  assertEquals(value.resourceBindings.length, 3);
});

Deno.test("Auth.Envelopes.Expand repairs missing bindings for existing envelope resources", async () => {
  const contract = resourceContract();
  let provisionCount = 0;
  const { handler, resources } = makeDeps({
    envelope: makeEnvelope({
      contracts: [],
      surfaces: [],
      capabilities: [],
      resources: [
        { kind: "jobs", alias: "reconcile", required: true },
        { kind: "kv", alias: "cache", required: true },
        { kind: "store", alias: "uploads", required: true },
      ],
    }),
    provisionResourceBindings: async () => {
      provisionCount += 1;
      return {
        kv: { cache: { bucket: "svc_cache", history: 2, ttlMs: 1000 } },
        store: {
          uploads: { name: "svc_uploads", ttlMs: 2000, maxTotalBytes: 100000 },
        },
        jobs: {
          namespace: "billing_jobs",
          workStream: "JOBS_WORK",
          queues: {
            reconcile: {
              queueType: "reconcile",
              publishPrefix: "trellis.jobs.billing.reconcile",
              workSubject: "trellis.work.billing.reconcile",
              consumerName: "billing-reconcile",
              payload: { schema: "Empty" },
              maxDeliver: 3,
              backoffMs: [5000],
              ackWaitMs: 300000,
              progress: true,
              logs: true,
              dlq: true,
              concurrency: 1,
            },
          },
        },
      };
    },
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract,
      expectedDigest: digestContractManifest(contract),
    },
    context: adminContext,
  });

  if (result.isErr()) throw result.error;
  assertEquals(provisionCount, 1);
  assertEquals(
    resources.list().map((binding) => [binding.kind, binding.alias]),
    [
      ["jobs", "reconcile"],
      ["kv", "cache"],
      ["store", "uploads"],
    ],
  );
  const value = mustTake(result);
  assertEquals(value.resourceBindings.length, 3);
  assertEquals(value.delta.resources, []);
});

Deno.test("Auth.Envelopes.Expand rejects missing non-transfer resource bindings", async () => {
  const contract = resourceContract();
  const { handler, envelopes, resources } = makeDeps({
    provisionResourceBindings: async () => ({
      kv: { cache: { bucket: "svc_cache", history: 2, ttlMs: 1000 } },
    }),
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract,
      expectedDigest: digestContractManifest(contract),
    },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(envelopes.putCount, 0);
  assertEquals(resources.list(), []);
});

Deno.test("Auth.Envelopes.Expand reuses stored internal resource names when reprovisioning", async () => {
  const contract = {
    ...resourceContract(),
    resources: {
      ...resourceContract().resources,
      store: {
        uploads: {
          ...resourceContract().resources!.store!.uploads,
          maxObjectBytes: 512,
        },
      },
    },
  } as TrellisContractV1;
  let provisioningOptions: ResourceProvisioningOptions | undefined;
  const { handler, resources } = makeDeps({
    provisionResourceBindings: async (options) => {
      provisioningOptions = options;
      return {
        kv: {
          cache: {
            bucket: options.existingResourceNames?.kv?.cache ?? "new_kv",
            history: 2,
            ttlMs: 1000,
          },
        },
        store: {
          uploads: {
            name: options.existingResourceNames?.store?.uploads ?? "new_store",
            ttlMs: 2000,
            maxObjectBytes: 512,
            maxTotalBytes: 100000,
          },
        },
        jobs: {
          namespace: options.existingResourceNames?.jobs?.namespace ??
            "billing_jobs",
          workStream: "JOBS_WORK",
          queues: {
            reconcile: {
              queueType: "reconcile",
              publishPrefix: options.existingResourceNames?.jobs?.queues
                ?.reconcile?.publishPrefix ??
                "trellis.jobs.billing.reconcile",
              workSubject:
                options.existingResourceNames?.jobs?.queues?.reconcile
                  ?.workSubject ?? "trellis.work.billing.reconcile",
              consumerName: options.existingResourceNames?.jobs?.queues
                ?.reconcile?.consumerName ?? "billing-reconcile",
              payload: { schema: "Empty" },
              maxDeliver: 3,
              backoffMs: [5000],
              ackWaitMs: 300000,
              progress: true,
              logs: true,
              dlq: true,
              concurrency: 1,
            },
          },
        },
      };
    },
  });
  resources.seed({
    deploymentId: "billing.default",
    kind: "kv",
    alias: "cache",
    binding: { bucket: "tr_kv_existing", history: 1, ttlMs: 1000 },
    limits: null,
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
  });
  resources.seed({
    deploymentId: "billing.default",
    kind: "store",
    alias: "uploads",
    binding: {
      name: "tr_obj_existing",
      ttlMs: 2000,
      maxObjectBytes: 128,
      maxTotalBytes: 100000,
    },
    limits: null,
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
  });
  resources.seed({
    deploymentId: "billing.default",
    kind: "jobs",
    alias: "reconcile",
    binding: {
      namespace: "tr_jobs_existing",
      workStream: "JOBS_WORK",
      queueType: "reconcile",
      publishPrefix: "trellis.jobs.tr_jobs_existing.tr_jq_existing",
      workSubject: "trellis.work.tr_jobs_existing.tr_jq_existing",
      consumerName: "tr_jobs_existing_tr_jq_existing",
      payload: { schema: "Empty" },
      maxDeliver: 1,
      backoffMs: [5000],
      ackWaitMs: 300000,
      progress: true,
      logs: true,
      dlq: true,
      concurrency: 1,
    },
    limits: null,
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract,
      expectedDigest: digestContractManifest(contract),
    },
    context: adminContext,
  });

  if (result.isErr()) throw result.error;
  assertEquals(
    provisioningOptions?.existingResourceNames?.kv?.cache,
    "tr_kv_existing",
  );
  assertEquals(
    provisioningOptions?.existingResourceNames?.store?.uploads,
    "tr_obj_existing",
  );
  assertEquals(
    provisioningOptions?.existingResourceNames?.jobs?.namespace,
    "tr_jobs_existing",
  );
  assertEquals(
    provisioningOptions?.existingResourceNames?.jobs?.queues?.reconcile
      ?.publishPrefix,
    "trellis.jobs.tr_jobs_existing.tr_jq_existing",
  );
  assertEquals(
    provisioningOptions?.existingResourceNames?.jobs?.queues?.reconcile
      ?.workSubject,
    "trellis.work.tr_jobs_existing.tr_jq_existing",
  );
  assertEquals(
    provisioningOptions?.existingResourceNames?.jobs?.queues?.reconcile
      ?.consumerName,
    "tr_jobs_existing_tr_jq_existing",
  );
  assertEquals(
    resources.list().find((binding) => binding.kind === "kv")?.binding.bucket,
    "tr_kv_existing",
  );
  assertEquals(
    resources.list().find((binding) => binding.kind === "store")?.binding.name,
    "tr_obj_existing",
  );
  assertEquals(
    resources.list().find((binding) => binding.kind === "store")?.binding
      .maxObjectBytes,
    512,
  );
  const jobsBinding = resources.list().find((binding) =>
    binding.kind === "jobs"
  )?.binding;
  assertEquals(jobsBinding?.namespace, "tr_jobs_existing");
  assertEquals(
    jobsBinding?.publishPrefix,
    "trellis.jobs.tr_jobs_existing.tr_jq_existing",
  );
  assertEquals(
    jobsBinding?.workSubject,
    "trellis.work.tr_jobs_existing.tr_jq_existing",
  );
  assertEquals(jobsBinding?.consumerName, "tr_jobs_existing_tr_jq_existing");
  assertEquals(jobsBinding?.maxDeliver, 3);
});

Deno.test("Auth.Envelopes.Expand rewrites stale event consumer bindings", async () => {
  const contract = eventConsumerServiceContract();
  let provisioningOptions: ResourceProvisioningOptions | undefined;
  const { handler, resources } = makeDeps({
    provisionResourceBindings: async (options) => {
      provisioningOptions = options;
      return {
        eventConsumers: {
          ingest: {
            stream: "trellis",
            consumerName: options.existingResourceNames?.eventConsumers
              ?.ingest ?? "billing-ingest",
            filterSubjects: ["events.v1.platform.Changed"],
            replay: "new",
            ordering: "strict",
            concurrency: 1,
            ackWaitMs: 300000,
            maxDeliver: 6,
            backoffMs: [5000, 30000, 120000, 600000, 1800000],
          },
        },
      };
    },
  });
  resources.seed({
    deploymentId: "billing.default",
    kind: "event-consumer",
    alias: "ingest",
    binding: {
      stream: "trellis",
      consumerName: "billing-ingest-existing",
      filterSubjects: ["events.v1.platform.LegacyChanged"],
      replay: "new",
      ordering: "strict",
      concurrency: 1,
      ackWaitMs: 300000,
      maxDeliver: 6,
      backoffMs: [5000, 30000, 120000, 600000, 1800000],
    },
    limits: null,
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract,
      expectedDigest: digestContractManifest(contract),
    },
    context: adminContext,
  });

  if (result.isErr()) throw result.error;
  assertEquals(
    provisioningOptions?.existingResourceNames?.eventConsumers?.ingest,
    "billing-ingest-existing",
  );
  const binding = resources.list().find((record) =>
    record.kind === "event-consumer"
  )?.binding;
  assertEquals(binding?.consumerName, "billing-ingest-existing");
  assertEquals(binding?.filterSubjects, ["events.v1.platform.Changed"]);
});

Deno.test("Auth.Envelopes.Expand rejects missing optional resource bindings", async () => {
  const contract: TrellisContractV1 = {
    ...resourceContract(),
    resources: {
      kv: {
        ...resourceContract().resources?.kv,
        optionalCache: {
          purpose: "Optional cache entries",
          schema: { schema: "Empty" },
          required: false,
        },
      },
      store: {
        ...resourceContract().resources?.store,
        optionalUploads: {
          purpose: "Optional uploaded files",
          required: false,
        },
      },
    },
  };
  const { handler, resources } = makeDeps({
    provisionResourceBindings: async () => ({
      kv: { cache: { bucket: "svc_cache", history: 2, ttlMs: 1000 } },
      store: {
        uploads: { name: "svc_uploads", ttlMs: 2000, maxTotalBytes: 100000 },
      },
      jobs: {
        namespace: "billing_jobs",
        workStream: "JOBS_WORK",
        queues: {
          reconcile: {
            queueType: "reconcile",
            publishPrefix: "trellis.jobs.billing.reconcile",
            workSubject: "trellis.work.billing.reconcile",
            consumerName: "billing-reconcile",
            payload: { schema: "Empty" },
            maxDeliver: 3,
            backoffMs: [5000],
            ackWaitMs: 300000,
            progress: true,
            logs: true,
            dlq: true,
            concurrency: 1,
          },
        },
      },
    }),
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      contract,
      expectedDigest: digestContractManifest(contract),
    },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(resources.list(), []);
});

Deno.test("Auth.Envelopes.Expand is idempotent for repeated expansion", async () => {
  const contract = serviceContract();
  const { handler, envelopes } = makeDeps();
  const input = {
    deploymentId: "billing.default",
    contract,
    expectedDigest: digestContractManifest(contract),
  };

  const first = await handler({ input, context: adminContext });
  if (first.isErr()) throw first.error;
  const second = await handler({ input, context: adminContext });
  if (second.isErr()) throw second.error;

  assertEquals(envelopes.putCount, 1);
  const value = mustTake(second);
  assertEquals(value.delta, EMPTY_BOUNDARY);
});

Deno.test("Auth.Envelopes.Changes.Preview reports shrink impact without mutating", async () => {
  const envelopes = new InMemoryDeploymentEnvelopeStorage();
  envelopes.seed(makeEnvelope(expandedBoundary()));
  envelopes.seed({
    ...makeEnvelope({
      contracts: [{ contractId: "acme.platform@v1", required: true }],
      surfaces: [],
      capabilities: ["platform.read"],
      resources: [],
    }),
    deploymentId: "cli.identity",
    kind: "cli",
  });
  const resources = new InMemoryDeploymentResourceBindingStorage();
  resources.seed({
    deploymentId: "billing.default",
    kind: "kv",
    alias: "cache",
    binding: { bucket: "svc_cache", history: 2, ttlMs: 1000 },
    limits: null,
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
  });
  const identityEnvelopes = new InMemoryIdentityEnvelopeStorage();
  identityEnvelopes.seed({
    identityEnvelopeId: "identity-envelope-1",
    userTrellisId: "github.123",
    origin: "github",
    id: "123",
    identityAnchor: {
      kind: "web",
      contractId: "acme.billing@v1",
      origin: "https://billing.example",
    },
    answer: "approved",
    answeredAt: new Date("2026-05-07T00:00:00.000Z"),
    updatedAt: new Date("2026-05-07T00:00:00.000Z"),
    approvalEvidence: {
      contractDigest: digestContractManifest(serviceContract()),
      contractId: "acme.billing@v1",
      displayName: "Billing",
      description: "Billing app",
      participantKind: "app",
      capabilities: {},
    },
    publishSubjects: [],
    subscribeSubjects: [],
  });
  const requests = new InMemoryEnvelopeExpansionRequestStorage();
  requests.seed({
    requestId: "request-1",
    deploymentId: "billing.default",
    requestedByKind: "service",
    requestedBy: { instanceId: "instance-1" },
    contractId: "acme.platform@v1",
    contractDigest: "platform-digest",
    contract: dependencyContract(),
    state: "pending",
    createdAt: "2026-05-07T00:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    delta: {
      contracts: [{ contractId: "acme.platform@v1", required: true }],
      surfaces: [],
      capabilities: ["platform.read"],
      resources: [],
    },
  });
  const sessions = new InMemorySessionStorage();
  sessions.seed("session-key-1", makeServiceSession());
  const handler = createAuthEnvelopesChangesPreviewHandler({
    contracts: createTestContracts([
      {
        digest: "platform-digest",
        contract: dependencyContract(),
      },
      {
        digest: digestContractManifest(serviceContract()),
        contract: serviceContract(),
      },
    ]),
    deploymentEnvelopeStorage: envelopes,
    deploymentResourceBindingStorage: resources,
    identityEnvelopeStorage: identityEnvelopes,
    envelopeExpansionRequestStorage: requests,
    sessionStorage: sessions,
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      proposedBoundary: shrunkBoundary(),
    },
    context: adminContext,
  });

  if (result.isErr()) throw result.error;
  const value = mustTake(result);
  assertEquals(envelopes.putCount, 0);
  assertEquals(value.impact.removed.contracts, [
    { contractId: "acme.platform@v1", required: true },
  ]);
  assertEquals(
    value.impact.impactedSessions.map((session) => session.sessionKey),
    [
      "session-key-1",
    ],
  );
  assertEquals(value.impact.impactedServiceInstances.length, 1);
  assertEquals(
    value.impact.impactedIdentityEnvelopes.map((envelope) =>
      envelope.identityEnvelopeId
    ),
    ["identity-envelope-1"],
  );
  assertEquals(
    value.impact.impactedPendingRequests.map((request) => request.requestId),
    [
      "request-1",
    ],
  );
  assertEquals(value.impact.orphanedResources, [{
    kind: "kv",
    alias: "cache",
  }]);
});

Deno.test("Auth.Envelopes.Changes.Preview fails closed for unknown session contract boundaries", async () => {
  const envelopes = new InMemoryDeploymentEnvelopeStorage();
  envelopes.seed(makeEnvelope(expandedBoundary()));
  const sessions = new InMemorySessionStorage();
  sessions.seed("session-key-1", makeServiceSession());
  const handler = createAuthEnvelopesChangesPreviewHandler({
    contracts: createTestContracts(),
    deploymentEnvelopeStorage: envelopes,
    deploymentResourceBindingStorage:
      new InMemoryDeploymentResourceBindingStorage(),
    sessionStorage: sessions,
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      proposedBoundary: shrunkBoundary(),
    },
    context: adminContext,
  });

  assert(result.isErr());
});

Deno.test("Auth.Envelopes.Changes.Preview uses known digest fallback boundaries", async () => {
  const envelopes = new InMemoryDeploymentEnvelopeStorage();
  envelopes.seed(makeEnvelope(expandedBoundary()));
  const sessions = new InMemorySessionStorage();
  const contract = serviceContract();
  sessions.seed("session-key-1", makeServiceSession(contract));
  const handler = createAuthEnvelopesChangesPreviewHandler({
    contracts: createTestContracts([{
      digest: digestContractManifest(contract),
      contract,
    }, {
      digest: "platform-digest",
      contract: dependencyContract(),
    }]),
    deploymentEnvelopeStorage: envelopes,
    deploymentResourceBindingStorage:
      new InMemoryDeploymentResourceBindingStorage(),
    sessionStorage: sessions,
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      proposedBoundary: shrunkBoundary(),
    },
    context: adminContext,
  });

  if (result.isErr()) throw result.error;
  const value = mustTake(result);
  assertEquals(
    value.impact.impactedSessions.map((session) => session.sessionKey),
    ["session-key-1"],
  );
  assertEquals(value.impact.impactedSessions[0]?.missing, {
    contracts: [{ contractId: "acme.platform@v1", required: true }],
    surfaces: [{
      contractId: "acme.billing@v1",
      kind: "rpc",
      name: "Charge",
      action: "call",
      required: true,
    }, {
      contractId: "acme.platform@v1",
      kind: "rpc",
      name: "Read",
      action: "call",
      required: true,
    }],
    capabilities: ["platform.read"],
    resources: [],
  });
});

Deno.test("Auth.Envelopes.Shrink rejects proposed boundaries that add authority", async () => {
  const envelopes = new InMemoryDeploymentEnvelopeStorage();
  envelopes.seed(makeEnvelope(shrunkBoundary()));
  const handler = createAuthEnvelopesShrinkHandler({
    contracts: createTestContracts(),
    deploymentEnvelopeStorage: envelopes,
    deploymentResourceBindingStorage:
      new InMemoryDeploymentResourceBindingStorage(),
    sessionStorage: new InMemorySessionStorage(),
    logger: { trace: () => {} },
  });

  const result = await handler({
    input: {
      deploymentId: "billing.default",
      proposedBoundary: expandedBoundary(),
      confirm: true,
    },
    context: adminContext,
  });

  assert(result.isErr());
  assertEquals(envelopes.putCount, 0);
});

Deno.test("Auth.Envelopes.Shrink requires confirmation, revokes impacted sessions, and retains resources", async () => {
  const envelopes = new InMemoryDeploymentEnvelopeStorage();
  envelopes.seed(makeEnvelope(expandedBoundary()));
  const resources = new InMemoryDeploymentResourceBindingStorage();
  resources.seed({
    deploymentId: "billing.default",
    kind: "kv",
    alias: "cache",
    binding: { bucket: "svc_cache", history: 2, ttlMs: 1000 },
    limits: null,
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
  });
  const contract = serviceContract();
  const sessions = new InMemorySessionStorage();
  sessions.seed("session-key-1", makeServiceSession());
  const history = new InMemoryEnvelopeHistoryStorage();
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const handler = createAuthEnvelopesShrinkHandler({
    contracts: createTestContracts([{
      digest: digestContractManifest(contract),
      contract,
    }, {
      digest: "platform-digest",
      contract: dependencyContract(),
    }]),
    deploymentEnvelopeStorage: envelopes,
    envelopeHistoryStorage: history,
    deploymentResourceBindingStorage: resources,
    envelopeExpansionRequestStorage:
      new InMemoryEnvelopeExpansionRequestStorage(),
    sessionStorage: sessions,
    kick: async (serverId, clientId) => {
      kicked.push({ serverId, clientId });
    },
    revokeSessionRuntimeAccess: async (sessionKey) => {
      await sessions.deleteBySessionKey(sessionKey);
      kicked.push({ serverId: "server-a", clientId: 7 });
    },
    now: () => new Date("2026-05-07T01:00:00.000Z"),
    logger: { trace: () => {} },
  });

  const rejected = await handler({
    input: {
      deploymentId: "billing.default",
      proposedBoundary: shrunkBoundary(),
      confirm: false,
    },
    context: adminContext,
  });
  assert(rejected.isErr());
  assertEquals(envelopes.putCount, 0);

  const applied = await handler({
    input: {
      deploymentId: "billing.default",
      proposedBoundary: shrunkBoundary(),
      confirm: true,
    },
    context: adminContext,
  });

  if (applied.isErr()) throw applied.error;
  const value = mustTake(applied);
  assertEquals(value.envelope.boundary, shrunkBoundary());
  assertEquals(value.retainedResources, [{ kind: "kv", alias: "cache" }]);
  assertEquals(
    resources.list().map((binding) => [binding.kind, binding.alias]),
    [["kv", "cache"]],
  );
  assertEquals(sessions.deleted, ["session-key-1"]);
  assertEquals(kicked, [{ serverId: "server-a", clientId: 7 }]);
  assertEquals(history.records.length, 1);
  assertEquals(history.records[0]?.action, "revoke");
  assertEquals(history.records[0]?.scopeId, "billing.default");
  assertEquals(history.records[0]?.delta, {
    contracts: [{ contractId: "acme.platform@v1", required: true }],
    surfaces: [{
      contractId: "acme.platform@v1",
      kind: "rpc",
      name: "Read",
      action: "call",
      required: true,
    }],
    capabilities: ["platform.read"],
    resources: [{ kind: "kv", alias: "cache", required: true }],
  });
  assertEquals(
    history.records[0]?.resultingUpdatedAt,
    value.envelope.updatedAt,
  );
  assertEquals(history.records[0]?.actor, { type: "user", id: "admin" });
});
