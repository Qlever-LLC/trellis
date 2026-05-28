import { Hono } from "@hono/hono";
import { assertEquals } from "@std/assert";
import { createAuth } from "@qlever-llc/trellis/auth";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";

import { createTestContracts } from "../../catalog/test_contracts.ts";
import type { ContractEntry } from "../../catalog/uses.ts";
import { analyzeContractEnvelopeBoundary } from "../boundary_analysis.ts";
import { computeEnvelopeDelta } from "../envelope_decision.ts";
import type {
  DeploymentEnvelope,
  DeploymentResourceBinding,
  EnvelopeBoundary,
  EnvelopeExpansionRequest,
  ImplementationOffer,
} from "../schemas.ts";
import { createServiceBootstrapHandler } from "./service.ts";

const TEST_SEED = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TEST_IAT = 1_700_000_000;
const TEST_NOW = "2026-01-01T00:00:00.000Z";

const EMPTY_BOUNDARY: EnvelopeBoundary = {
  contracts: [],
  surfaces: [],
  capabilities: [],
  resources: [],
};

type ContractWithEventConsumers = TrellisContractV1 & {
  eventConsumers?: Record<string, unknown>;
};

function mergeBoundaries(...boundaries: EnvelopeBoundary[]): EnvelopeBoundary {
  return computeEnvelopeDelta(EMPTY_BOUNDARY, {
    contracts: boundaries.flatMap((boundary) => boundary.contracts),
    surfaces: boundaries.flatMap((boundary) => boundary.surfaces),
    capabilities: boundaries.flatMap((boundary) => boundary.capabilities),
    resources: boundaries.flatMap((boundary) => boundary.resources),
  });
}

function baseContract(): TrellisContractV1 {
  return {
    format: "trellis.contract.v1",
    id: "svc.example@v1",
    displayName: "Example Service",
    description: "Example service contract",
    kind: "service",
    schemas: {
      Empty: { type: "object" },
      CacheEntry: { type: "object" },
    },
    capabilities: {
      "svc.call": {
        displayName: "Call service",
        description: "Call service RPCs.",
      },
    },
    rpc: {
      Query: {
        version: "v1",
        subject: "rpc.v1.svc.Query",
        input: { schema: "Empty" },
        output: { schema: "Empty" },
        capabilities: { call: ["svc.call"] },
      },
    },
    resources: {
      kv: {
        cache: {
          purpose: "Store cache entries",
          schema: { schema: "CacheEntry" },
        },
      },
    },
  };
}

function expandedContract(): TrellisContractV1 {
  return {
    ...baseContract(),
    resources: {
      kv: {
        cache: {
          purpose: "Store cache entries",
          schema: { schema: "CacheEntry" },
        },
        secondary: {
          purpose: "Store secondary entries",
          schema: { schema: "CacheEntry" },
        },
      },
    },
  };
}

function compatibleMetadataContract(): TrellisContractV1 {
  return {
    ...baseContract(),
    description: "Example service contract with updated metadata",
  };
}

function incompatibleSchemaContract(): TrellisContractV1 {
  return {
    ...baseContract(),
    schemas: {
      Empty: { type: "string" },
      CacheEntry: { type: "object" },
    },
  };
}

function jobsContract(): TrellisContractV1 {
  return {
    ...baseContract(),
    resources: {},
    jobs: {
      process: {
        payload: { schema: "CacheEntry" },
        result: { schema: "Empty" },
        maxDeliver: 3,
      },
    },
  };
}

function dependencyContract(): TrellisContractV1 {
  return {
    format: "trellis.contract.v1",
    id: "dep.example@v1",
    displayName: "Dependency Service",
    description: "Dependency service contract",
    kind: "service",
    schemas: { Empty: { type: "object" } },
    capabilities: {
      "dep.read": {
        displayName: "Read dependency",
        description: "Call dependency read RPCs.",
      },
    },
    rpc: {
      Read: {
        version: "v1",
        subject: "rpc.v1.dep.Read",
        input: { schema: "Empty" },
        output: { schema: "Empty" },
        capabilities: { call: ["dep.read"] },
      },
    },
  };
}

function eventDependencyContract(): TrellisContractV1 {
  return {
    ...dependencyContract(),
    rpc: {},
    schemas: {
      Empty: { type: "object", properties: { id: { type: "string" } } },
    },
    events: {
      Changed: {
        version: "v1",
        subject: "events.v1.dep.Changed.{/id}",
        params: ["/id"],
        event: { schema: "Empty" },
      },
      Synced: {
        version: "v1",
        subject: "events.v1.dep.Synced.{/id}",
        params: ["/id"],
        event: { schema: "Empty" },
      },
    },
  };
}

function eventConsumerContract(): TrellisContractV1 {
  const contract: ContractWithEventConsumers = {
    ...baseContract(),
    resources: {},
    uses: {
      required: {
        dep: {
          contract: "dep.example@v1",
          events: { subscribe: ["Changed", "Synced"] },
        },
      },
    },
    eventConsumers: {
      ingest: {
        events: [
          { use: "dep", event: "Changed" },
          { use: "dep", event: "Synced" },
        ],
      },
    },
  };
  return contract;
}

function serviceUsingDependencyContract(): TrellisContractV1 {
  return {
    ...baseContract(),
    uses: {
      required: {
        dep: {
          contract: "dep.example@v1",
          rpc: { call: ["Read"] },
        },
      },
    },
  };
}

function serviceUsingMissingDependencyOperationContract(): TrellisContractV1 {
  return {
    ...baseContract(),
    uses: {
      required: {
        dep: {
          contract: "dep.example@v1",
          operations: { call: ["Start"] },
        },
      },
    },
  };
}

async function validatedContract(contract: TrellisContractV1) {
  return await createTestContracts().validateContract(contract);
}

function serviceOffer(
  contract: Awaited<ReturnType<typeof validatedContract>>,
  overrides: Partial<ImplementationOffer> = {},
): ImplementationOffer {
  const now = overrides.acceptedAt ?? TEST_NOW;
  const deploymentId = overrides.deploymentId ?? "deployment_1";
  const instanceId = overrides.instanceId ?? "svc_1";
  return {
    offerId: overrides.offerId ?? JSON.stringify([
      "service",
      deploymentId,
      instanceId,
      contract.contract.id,
      contract.digest,
    ]),
    deploymentKind: "service",
    deploymentId,
    instanceId,
    contractId: contract.contract.id,
    contractDigest: contract.digest,
    lineageKey: JSON.stringify(["service", deploymentId, contract.contract.id]),
    status: "accepted",
    liveness: "healthy",
    firstOfferedAt: overrides.firstOfferedAt ?? now,
    acceptedAt: now,
    lastRefreshedAt: overrides.lastRefreshedAt ?? now,
    staleAt: overrides.staleAt ?? null,
    expiresAt: overrides.expiresAt ?? null,
    ...overrides,
  };
}

function kvBinding(alias: string): DeploymentResourceBinding {
  return {
    deploymentId: "deployment_1",
    kind: "kv",
    alias,
    binding: { bucket: `bucket_${alias}`, history: 1, ttlMs: 0 },
    limits: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
  };
}

function jobsBindingRecord(
  alias: string,
  binding: Record<string, unknown>,
): DeploymentResourceBinding {
  return {
    deploymentId: "deployment_1",
    kind: "jobs",
    alias,
    binding,
    limits: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
  };
}

function eventConsumerBindingRecord(
  alias: string,
  binding: Record<string, unknown>,
): DeploymentResourceBinding {
  return {
    deploymentId: "deployment_1",
    kind: "event-consumer",
    alias,
    binding,
    limits: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
  };
}

async function contractBoundary(
  contracts: ReturnType<typeof createTestContracts>,
  contract: TrellisContractV1,
  options?: { dependencyResolution?: "active" | "activeOrApproved" | "known" },
): Promise<EnvelopeBoundary> {
  const analysis = await analyzeContractEnvelopeBoundary(
    contracts,
    contract,
    options,
  );
  return mergeBoundaries(analysis.required, analysis.contributedAvailability);
}

async function createApp(args: {
  envelopeBoundary?: EnvelopeBoundary;
  deploymentDisabled?: boolean;
  envelopeDisabled?: boolean;
  instanceDisabled?: boolean;
  nowSeconds?: number;
  initialOffers?: ImplementationOffer[];
  initialExpansionRequests?: EnvelopeExpansionRequest[];
  initialBindings?: DeploymentResourceBinding[];
  knownContracts?: ContractEntry[];
  knownExpandedContract?: boolean;
  contractCompatibilityMode?: "strict" | "mutable-dev";
} = {}) {
  const auth = await createAuth({ sessionKeySeed: TEST_SEED });
  const contract = await validatedContract(baseContract());
  const expanded = await validatedContract(expandedContract());
  const contracts = createTestContracts();
  contracts.addKnownTestContract({
    digest: contract.digest,
    contract: contract.contract,
  });
  if (args.knownExpandedContract ?? true) {
    contracts.addKnownTestContract({
      digest: expanded.digest,
      contract: expanded.contract,
    });
  }
  for (const entry of args.knownContracts ?? []) {
    contracts.addKnownTestContract(entry);
  }

  const envelope: DeploymentEnvelope = {
    deploymentId: "deployment_1",
    kind: "service",
    disabled: args.envelopeDisabled ?? false,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
    boundary: args.envelopeBoundary ?? await contractBoundary(
      contracts,
      contract.contract,
    ),
  };
  const services: Array<{
    resourceBindings?: Record<string, unknown>;
    capabilities: string[];
  }> = [];
  const offers = [...(args.initialOffers ?? [])];
  const bindings = [...(args.initialBindings ?? [])];
  const expansionRequests: EnvelopeExpansionRequest[] = [
    ...(args.initialExpansionRequests ?? []),
  ];
  const storedContracts: Array<{ digest: string; contractId: string }> = [];
  const putExpansions: Array<{
    envelope: DeploymentEnvelope;
    delta: EnvelopeBoundary;
    resourceBindings: DeploymentResourceBinding[];
  }> = [];

  const app = new Hono();
  app.post(
    "/bootstrap/service",
    createServiceBootstrapHandler({
      contracts,
      transports: {
        native: { natsServers: ["nats://127.0.0.1:4222"] },
        websocket: { natsServers: ["ws://localhost:8080"] },
      },
      sentinel: { jwt: "jwt", seed: "seed" },
      loadServiceInstance: async (instanceKey) => {
        if (instanceKey !== auth.sessionKey) return null;
        return {
          instanceId: "svc_1",
          deploymentId: "deployment_1",
          instanceKey: auth.sessionKey,
          disabled: args.instanceDisabled ?? false,
          capabilities: ["service"],
          createdAt: TEST_NOW,
        };
      },
      saveServiceInstance: async (service) => {
        services.push(service);
      },
      loadServiceDeployment: async () => ({
        deploymentId: "deployment_1",
        namespaces: [],
        disabled: args.deploymentDisabled ?? false,
        contractCompatibilityMode: args.contractCompatibilityMode ?? "strict",
      }),
      deploymentEnvelopeStorage: {
        get: async () => envelope,
        putExpansion: async (record) => {
          putExpansions.push(record);
          for (const binding of record.resourceBindings) {
            const index = bindings.findIndex((stored) =>
              stored.deploymentId === binding.deploymentId &&
              stored.kind === binding.kind && stored.alias === binding.alias
            );
            if (index >= 0) bindings[index] = binding;
            else bindings.push(binding);
          }
        },
      },
      deploymentResourceBindingStorage: {
        get: async (_deploymentId, kind, alias) =>
          bindings.find((binding) =>
            binding.kind === kind && binding.alias === alias
          ),
        put: async (binding) => {
          bindings.push(binding);
        },
        listByDeployment: async () => bindings,
      },
      implementationOfferStorage: {
        get: async (offerId) =>
          offers.find((offer) => offer.offerId === offerId),
        put: async (offer) => {
          const index = offers.findIndex((stored) =>
            stored.offerId === offer.offerId
          );
          if (index >= 0) offers[index] = offer;
          else offers.push(offer);
        },
        latestAcceptedByLineage: async (lineageKey) => {
          return offers
            .filter((offer) =>
              offer.lineageKey === lineageKey && offer.status === "accepted"
            )
            .sort((left, right) =>
              right.acceptedAt!.localeCompare(left.acceptedAt!) ||
              right.lastRefreshedAt.localeCompare(left.lastRefreshedAt) ||
              left.offerId.localeCompare(right.offerId)
            )[0];
        },
      },
      envelopeExpansionRequestStorage: {
        putPending: async (request) => {
          const existing = expansionRequests.find((stored) =>
            stored.state === "pending" &&
            stored.deploymentId === request.deploymentId &&
            stored.contractId === request.contractId &&
            stored.contractDigest === request.contractDigest
          );
          if (existing) return existing;
          expansionRequests.push(request);
          return request;
        },
        latestApprovedByContractId: async (contractId) => {
          return expansionRequests
            .filter((request) =>
              request.contractId === contractId && request.state === "approved"
            )
            .sort((left, right) =>
              (right.decidedAt ?? "").localeCompare(left.decidedAt ?? "") ||
              right.createdAt.localeCompare(left.createdAt) ||
              right.requestId.localeCompare(left.requestId)
            )[0];
        },
      },
      storePresentedContract: async ({ contract, digest }) => {
        storedContracts.push({ digest, contractId: contract.id });
        contracts.addKnownTestContract({ digest, contract });
      },
      verifyIdentityProof: async ({ sessionKey, iat, contractDigest, sig }) =>
        sessionKey === auth.sessionKey &&
        sig === await auth.natsConnectSigForIat(iat, contractDigest),
      nowSeconds: () => args.nowSeconds ?? TEST_IAT,
      now: () => new Date(TEST_NOW),
      createExpansionRequestId: () => "req_1",
    }),
  );

  async function bootstrap(input: {
    contractId: string;
    contractDigest: string;
    contract?: TrellisContractV1;
    sigDigest?: string;
    iat?: number;
  }) {
    const iat = input.iat ?? TEST_IAT;
    const sigDigest = input.sigDigest ?? input.contractDigest;
    return await app.request("http://trellis/bootstrap/service", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionKey: auth.sessionKey,
        contractId: input.contractId,
        contractDigest: input.contractDigest,
        ...(input.contract ? { contract: input.contract } : {}),
        iat,
        sig: await auth.natsConnectSigForIat(iat, sigDigest),
      }),
    });
  }

  return {
    app,
    auth,
    contracts,
    contract,
    expanded,
    envelope,
    services,
    offers,
    bindings,
    expansionRequests,
    storedContracts,
    putExpansions,
    bootstrap,
  };
}

Deno.test("POST /bootstrap/service accepts first start when contract fits envelope", async () => {
  const setup = await createApp({ initialBindings: [kvBinding("cache")] });

  const response = await setup.bootstrap({
    contractId: setup.contract.contract.id,
    contractDigest: setup.contract.digest,
    contract: setup.contract.contract,
  });

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.status, "ready");
  assertEquals(body.binding.resources, {
    kv: { cache: { bucket: "bucket_cache", history: 1, ttlMs: 0 } },
  });
  assertEquals(setup.offers.length, 1);
  assertEquals(setup.offers[0]?.status, "accepted");
  assertEquals(setup.offers[0]?.contractDigest, setup.contract.digest);
  assertEquals(setup.offers[0]?.staleAt, null);
  assertEquals(setup.bindings.length, 1);
  assertEquals(setup.storedContracts, [{
    digest: setup.contract.digest,
    contractId: setup.contract.contract.id,
  }]);
});

Deno.test("POST /bootstrap/service accepts new contract within envelope", async () => {
  const setup = await createApp({
    initialBindings: [kvBinding("cache"), kvBinding("secondary")],
  });
  setup.envelope.boundary = await contractBoundary(
    setup.contracts,
    setup.expanded.contract,
  );

  const response = await setup.bootstrap({
    contractId: setup.expanded.contract.id,
    contractDigest: setup.expanded.digest,
    contract: setup.expanded.contract,
  });

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.connectInfo.contractDigest, setup.expanded.digest);
  assertEquals(body.binding.resources, {
    kv: {
      cache: { bucket: "bucket_cache", history: 1, ttlMs: 0 },
      secondary: { bucket: "bucket_secondary", history: 1, ttlMs: 0 },
    },
  });
});

Deno.test("POST /bootstrap/service accepts different same-contract digest when boundary fits", async () => {
  const oldContract = await validatedContract(baseContract());
  const newContract = await validatedContract(expandedContract());
  const setup = await createApp({
    initialOffers: [
      serviceOffer(oldContract, { acceptedAt: "2026-01-01T00:00:00.000Z" }),
      serviceOffer(newContract, { acceptedAt: "2026-01-01T00:00:01.000Z" }),
    ],
    initialBindings: [kvBinding("cache")],
  });
  setup.contracts.setActiveTestDigests([newContract.digest]);

  const response = await setup.bootstrap({
    contractId: oldContract.contract.id,
    contractDigest: oldContract.digest,
    contract: oldContract.contract,
  });

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.status, "ready");
  assertEquals(body.connectInfo.contractDigest, oldContract.digest);
  assertEquals(body.reason, undefined);
  assertEquals(body.activeContractDigest, undefined);
  assertEquals(
    setup.offers.some((offer) => offer.contractDigest === oldContract.digest),
    true,
  );
});

Deno.test("POST /bootstrap/service rejects incompatible same-contract digest replacement in strict mode", async () => {
  const current = await validatedContract(baseContract());
  const replacement = await validatedContract(incompatibleSchemaContract());
  const setup = await createApp({
    initialOffers: [serviceOffer(current)],
  });

  const response = await setup.bootstrap({
    contractId: replacement.contract.id,
    contractDigest: replacement.digest,
    contract: replacement.contract,
  });

  assertEquals(response.status, 409);
  const body = await response.json();
  assertEquals(body.reason, "contract_compatibility_violation");
  assertEquals(body.compatibilityMode, "strict");
  assertEquals(setup.services.length, 0);
});

Deno.test("POST /bootstrap/service accepts incompatible same-contract digest replacement in mutable-dev mode", async () => {
  const current = await validatedContract(baseContract());
  const replacement = await validatedContract(incompatibleSchemaContract());
  const setup = await createApp({
    initialOffers: [serviceOffer(current)],
    initialBindings: [kvBinding("cache")],
    contractCompatibilityMode: "mutable-dev",
  });

  const response = await setup.bootstrap({
    contractId: replacement.contract.id,
    contractDigest: replacement.digest,
    contract: replacement.contract,
  });

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.status, "ready");
  assertEquals(body.connectInfo.contractDigest, replacement.digest);
  assertEquals(setup.offers.at(-1)?.contractDigest, replacement.digest);
});

Deno.test("POST /bootstrap/service accepts compatible same-contract digest replacement in strict mode", async () => {
  const current = await validatedContract(baseContract());
  const replacement = await validatedContract(compatibleMetadataContract());
  const setup = await createApp({
    initialOffers: [serviceOffer(current)],
    initialBindings: [kvBinding("cache")],
  });

  const response = await setup.bootstrap({
    contractId: replacement.contract.id,
    contractDigest: replacement.digest,
    contract: replacement.contract,
  });

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.status, "ready");
  assertEquals(body.connectInfo.contractDigest, replacement.digest);
  assertEquals(setup.offers.at(-1)?.contractDigest, replacement.digest);
});

Deno.test("POST /bootstrap/service accepts older digest when it remains effective", async () => {
  const oldContract = await validatedContract(baseContract());
  const newContract = await validatedContract(expandedContract());
  const setup = await createApp({
    initialOffers: [
      serviceOffer(oldContract, { acceptedAt: "2026-01-01T00:00:00.000Z" }),
      serviceOffer(newContract, { acceptedAt: "2026-01-01T00:00:01.000Z" }),
    ],
    initialBindings: [kvBinding("cache")],
  });
  setup.contracts.setActiveTestDigests([oldContract.digest]);

  const response = await setup.bootstrap({
    contractId: oldContract.contract.id,
    contractDigest: oldContract.digest,
    contract: oldContract.contract,
  });

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.status, "ready");
  assertEquals(body.connectInfo.contractDigest, oldContract.digest);
  assertEquals(
    setup.offers.some((offer) => offer.contractDigest === oldContract.digest),
    true,
  );
});

Deno.test("POST /bootstrap/service creates pending request when envelope does not fit", async () => {
  const setup = await createApp();

  const response = await setup.bootstrap({
    contractId: setup.expanded.contract.id,
    contractDigest: setup.expanded.digest,
    contract: setup.expanded.contract,
  });

  assertEquals(response.status, 202);
  const body = await response.json();
  assertEquals(body.reason, "envelope_expansion_required");
  assertEquals(body.requestId, "req_1");
  assertEquals(setup.expansionRequests.length, 1);
  assertEquals(setup.expansionRequests[0]?.state, "pending");
  assertEquals(setup.services.length, 0);
  assertEquals(setup.offers.length, 0);
});

Deno.test("POST /bootstrap/service plans expansion through known inactive required dependency", async () => {
  const dependency = await validatedContract(dependencyContract());
  const service = await validatedContract(serviceUsingDependencyContract());
  const setup = await createApp({
    knownContracts: [{
      digest: dependency.digest,
      contract: dependency.contract,
    }],
  });

  const response = await setup.bootstrap({
    contractId: service.contract.id,
    contractDigest: service.digest,
    contract: service.contract,
  });

  assertEquals(response.status, 202);
  const body = await response.json();
  assertEquals(body.reason, "envelope_expansion_required");
  assertEquals(setup.expansionRequests.length, 1);
  assertEquals(setup.expansionRequests[0]?.delta.contracts, [
    { contractId: "dep.example@v1", required: true },
  ]);
  assertEquals(setup.expansionRequests[0]?.delta.surfaces, [{
    contractId: "dep.example@v1",
    kind: "rpc",
    name: "Read",
    action: "call",
    required: true,
  }]);
  assertEquals(setup.expansionRequests[0]?.delta.capabilities, ["dep.read"]);
  assertEquals(setup.services.length, 0);
});

Deno.test("POST /bootstrap/service waits when known dependency is missing a required surface", async () => {
  const dependency = await validatedContract(dependencyContract());
  const service = await validatedContract(
    serviceUsingMissingDependencyOperationContract(),
  );
  const setup = await createApp({
    knownContracts: [{
      digest: dependency.digest,
      contract: dependency.contract,
    }],
  });

  const response = await setup.bootstrap({
    contractId: service.contract.id,
    contractDigest: service.digest,
    contract: service.contract,
  });

  assertEquals(response.status, 202);
  const body = await response.json();
  assertEquals(body.reason, "contract_activation_pending");
  assertEquals(body.dependencyAlias, "dep");
  assertEquals(body.dependencyContractId, "dep.example@v1");
  assertEquals(body.dependencySurface, "operation");
  assertEquals(body.dependencyReason, "missing");
  assertEquals(body.dependencyKey, "Start");
  assertEquals(
    body.message,
    `Service contract '${service.contract.id}' digest '${service.digest}' is waiting for dependency 'dep' (dep.example@v1) to provide required operation 'Start'.`,
  );
  assertEquals(setup.expansionRequests.length, 0);
  assertEquals(setup.services.length, 0);
});

Deno.test("POST /bootstrap/service stores pending contract when required dependency is unknown", async () => {
  const service = await validatedContract(serviceUsingDependencyContract());
  const setup = await createApp();

  const response = await setup.bootstrap({
    contractId: service.contract.id,
    contractDigest: service.digest,
    contract: service.contract,
  });

  assertEquals(response.status, 202);
  const body = await response.json();
  assertEquals(body.reason, "envelope_expansion_required");
  assertEquals(setup.expansionRequests.length, 1);
  assertEquals(setup.expansionRequests[0]?.delta.contracts, [
    { contractId: "dep.example@v1", required: true },
  ]);
  assertEquals(setup.expansionRequests[0]?.delta.surfaces, []);
  assertEquals(setup.expansionRequests[0]?.delta.capabilities, []);
  assertEquals(
    setup.storedContracts.some((stored) =>
      stored.digest === service.digest &&
      stored.contractId === service.contract.id
    ),
    true,
  );
  assertEquals(setup.services.length, 0);
});

Deno.test("POST /bootstrap/service resolves required dependency capabilities from known manifests", async () => {
  const dependency = await validatedContract(dependencyContract());
  const service = await validatedContract(serviceUsingDependencyContract());
  const contracts = createTestContracts();
  contracts.addKnownTestContract({
    digest: dependency.digest,
    contract: dependency.contract,
  });
  const setup = await createApp({
    knownContracts: [{
      digest: dependency.digest,
      contract: dependency.contract,
    }],
    envelopeBoundary: await contractBoundary(
      contracts,
      service.contract,
      { dependencyResolution: "known" },
    ),
  });

  const response = await setup.bootstrap({
    contractId: service.contract.id,
    contractDigest: service.digest,
    contract: service.contract,
  });

  assertEquals(response.status, 202);
  const body = await response.json();
  assertEquals(body.reason, "contract_activation_pending");
  assertEquals(body.dependencyReason, "dependency_not_active");
  assertEquals(
    body.message,
    `Service contract '${service.contract.id}' digest '${service.digest}' is waiting for dependency 'dep' (dep.example@v1) to have an active running implementation.`,
  );
  assertEquals(setup.offers.length, 0);
  assertEquals(setup.bindings.length, 0);
});

Deno.test("POST /bootstrap/service accepts latest approved dependency when no active offer exists", async () => {
  const dependency = await validatedContract(dependencyContract());
  const service = await validatedContract(serviceUsingDependencyContract());
  const contracts = createTestContracts();
  contracts.addKnownTestContract({
    digest: dependency.digest,
    contract: dependency.contract,
  });
  const setup = await createApp({
    initialBindings: [kvBinding("cache")],
    envelopeBoundary: await contractBoundary(
      contracts,
      service.contract,
      { dependencyResolution: "known" },
    ),
    initialExpansionRequests: [{
      requestId: "approved-dep",
      deploymentId: "dep-deployment",
      requestedByKind: "service",
      requestedBy: { instanceId: "dep-svc" },
      contractId: dependency.contract.id,
      contractDigest: dependency.digest,
      contract: dependency.contract,
      state: "approved",
      createdAt: "2025-12-31T23:00:00.000Z",
      decidedAt: "2025-12-31T23:01:00.000Z",
      decidedBy: { type: "user", id: "admin" },
      decisionReason: null,
      delta: EMPTY_BOUNDARY,
    }],
  });

  const response = await setup.bootstrap({
    contractId: service.contract.id,
    contractDigest: service.digest,
    contract: service.contract,
  });

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.status, "ready");
  assertEquals(setup.offers.length, 1);
  assertEquals(setup.services.length, 1);
});

Deno.test("POST /bootstrap/service reuses pending request for the same contract digest", async () => {
  const setup = await createApp();

  const first = await setup.bootstrap({
    contractId: setup.expanded.contract.id,
    contractDigest: setup.expanded.digest,
    contract: setup.expanded.contract,
  });
  const second = await setup.bootstrap({
    contractId: setup.expanded.contract.id,
    contractDigest: setup.expanded.digest,
    contract: setup.expanded.contract,
  });

  assertEquals(first.status, 202);
  assertEquals(second.status, 202);
  assertEquals((await first.json()).requestId, "req_1");
  assertEquals((await second.json()).requestId, "req_1");
  assertEquals(setup.expansionRequests.length, 1);
});

Deno.test("POST /bootstrap/service reports presented contract validation details", async () => {
  const setup = await createApp();
  const invalidContract: TrellisContractV1 = {
    ...baseContract(),
    resources: {
      kv: {
        cache: {
          purpose: "Store cache entries",
          schema: { schema: "MissingSchema" },
        },
      },
    },
  };

  const response = await setup.bootstrap({
    contractId: invalidContract.id,
    contractDigest: "invalid_digest",
    contract: invalidContract,
  });

  assertEquals(response.status, 409);
  const body = await response.json();
  assertEquals(body.reason, "presented_contract_invalid");
  assertEquals(
    body.contractError,
    "resources.kv 'cache': unknown schema 'MissingSchema'",
  );
  assertEquals(
    body.message,
    "Presented contract manifest is invalid: resources.kv 'cache': unknown schema 'MissingSchema'",
  );
  assertEquals(setup.expansionRequests.length, 0);
});

Deno.test("POST /bootstrap/service treats incompatible known dependency manifests as unresolved", async () => {
  const firstDependency = await validatedContract(dependencyContract());
  const incompatibleDependencyContract = dependencyContract();
  incompatibleDependencyContract.schemas = { Empty: { type: "string" } };
  const secondDependency = await validatedContract(
    incompatibleDependencyContract,
  );
  const service = await validatedContract(serviceUsingDependencyContract());
  const setup = await createApp({
    knownContracts: [firstDependency, secondDependency],
  });

  const response = await setup.bootstrap({
    contractId: service.contract.id,
    contractDigest: service.digest,
    contract: service.contract,
  });

  assertEquals(response.status, 202);
  const body = await response.json();
  assertEquals(body.reason, "envelope_expansion_required");
  assertEquals(body.delta.contracts, [{
    contractId: "dep.example@v1",
    required: true,
  }]);
  assertEquals(setup.expansionRequests.length, 1);
});

Deno.test("POST /bootstrap/service reconnects after accepted expansion from global contract storage", async () => {
  const setup = await createApp({
    knownExpandedContract: false,
    initialBindings: [kvBinding("cache"), kvBinding("secondary")],
  });
  const first = await setup.bootstrap({
    contractId: setup.expanded.contract.id,
    contractDigest: setup.expanded.digest,
    contract: setup.expanded.contract,
  });
  assertEquals(first.status, 202);
  setup.envelope.boundary = await contractBoundary(
    setup.contracts,
    setup.expanded.contract,
  );

  const second = await setup.bootstrap({
    contractId: setup.expanded.contract.id,
    contractDigest: setup.expanded.digest,
  });

  assertEquals(second.status, 200);
  assertEquals((await second.json()).status, "ready");
  assertEquals(setup.storedContracts, [{
    digest: setup.expanded.digest,
    contractId: setup.expanded.contract.id,
  }]);
});

Deno.test("POST /bootstrap/service does not resolve omitted manifests from implementation offers", async () => {
  const expanded = await validatedContract(expandedContract());
  const setup = await createApp({
    knownExpandedContract: false,
    initialOffers: [serviceOffer(expanded)],
  });
  setup.envelope.boundary = await contractBoundary(
    setup.contracts,
    setup.expanded.contract,
  );

  const response = await setup.bootstrap({
    contractId: setup.expanded.contract.id,
    contractDigest: setup.expanded.digest,
  });

  assertEquals(response.status, 409);
  assertEquals((await response.json()).reason, "manifest_required");
});

Deno.test("POST /bootstrap/service returns stored resource bindings", async () => {
  const contract = await validatedContract(baseContract());
  const binding: DeploymentResourceBinding = {
    deploymentId: "deployment_1",
    kind: "kv",
    alias: "cache",
    binding: { bucket: "stored_cache", history: 1, ttlMs: 0 },
    limits: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
  };
  const setup = await createApp({ initialBindings: [binding] });

  const response = await setup.bootstrap({
    contractId: contract.contract.id,
    contractDigest: contract.digest,
    contract: contract.contract,
  });

  assertEquals(response.status, 200);
  assertEquals((await response.json()).binding.resources, {
    kv: { cache: binding.binding },
  });
});

Deno.test("POST /bootstrap/service returns jobs bindings in contract resource shape", async () => {
  const contract = await validatedContract(jobsContract());
  const jobsBinding = {
    namespace: "deployment_1_jobs",
    workStream: "JOBS_WORK",
    queues: {
      process: {
        queueType: "process",
        publishPrefix: "trellis.jobs.deployment_1_jobs.process",
        workSubject: "trellis.work.deployment_1_jobs.process",
        consumerName: "deployment-1-process",
        payload: { schema: "CacheEntry" },
        result: { schema: "Empty" },
        maxDeliver: 3,
        backoffMs: [5000, 30000, 120000, 600000, 1800000],
        ackWaitMs: 300000,
        progress: true,
        logs: true,
        dlq: true,
        concurrency: 1,
      },
    },
  };
  const setup = await createApp({
    initialBindings: [
      jobsBindingRecord("process", {
        namespace: jobsBinding.namespace,
        workStream: jobsBinding.workStream,
        ...jobsBinding.queues.process,
      }),
    ],
  });
  setup.envelope.boundary = await contractBoundary(
    setup.contracts,
    contract.contract,
  );

  const response = await setup.bootstrap({
    contractId: contract.contract.id,
    contractDigest: contract.digest,
    contract: contract.contract,
  });

  assertEquals(response.status, 200);
  const expected = { jobs: jobsBinding };
  assertEquals((await response.json()).binding.resources, expected);
  assertEquals(setup.services[0]?.resourceBindings, expected);
});

Deno.test("POST /bootstrap/service returns event consumer bindings", async () => {
  const contract = await validatedContract(eventConsumerContract());
  const dependency = await validatedContract(eventDependencyContract());
  const binding = {
    stream: "trellis",
    consumerName: "svc_deployment_1_svc_example_ingest_abcd",
    filterSubjects: ["events.v1.dep.Changed.*", "events.v1.dep.Synced.*"],
    replay: "new" as const,
    ordering: "strict" as const,
    concurrency: 1,
    ackWaitMs: 300000,
    maxDeliver: 6,
    backoffMs: [5000, 30000, 120000, 600000, 1800000],
  };
  const setup = await createApp({
    knownContracts: [
      { digest: dependency.digest, contract: dependency.contract },
      { digest: contract.digest, contract: contract.contract },
    ],
    initialBindings: [eventConsumerBindingRecord("ingest", binding)],
  });
  setup.contracts.activateTestContract({
    digest: dependency.digest,
    contract: dependency.contract,
  });
  setup.envelope.boundary = await contractBoundary(
    setup.contracts,
    contract.contract,
    { dependencyResolution: "known" },
  );

  const response = await setup.bootstrap({
    contractId: contract.contract.id,
    contractDigest: contract.digest,
    contract: contract.contract,
  });

  assertEquals(response.status, 200);
  const expected = { eventConsumers: { ingest: binding } };
  assertEquals((await response.json()).binding.resources, expected);
  assertEquals(setup.services[0]?.resourceBindings, expected);
  assertEquals(setup.bindings.map((stored) => stored.kind), [
    "event-consumer",
  ]);
});

Deno.test("POST /bootstrap/service returns independent event consumer groups", async () => {
  const contract = await validatedContract({
    ...eventConsumerContract(),
    eventConsumers: {
      ingest: { events: [{ use: "dep", event: "Changed" }] },
      audit: { events: [{ use: "dep", event: "Changed" }] },
    },
  } as ContractWithEventConsumers);
  const dependency = await validatedContract(eventDependencyContract());
  const auditBinding = {
    stream: "trellis",
    consumerName: "audit-consumer",
    filterSubjects: ["events.v1.dep.Changed.*"],
    replay: "new",
    ordering: "strict",
    concurrency: 1,
    ackWaitMs: 300000,
    maxDeliver: 6,
    backoffMs: [5000, 30000, 120000, 600000, 1800000],
  };
  const ingestBinding = {
    stream: "trellis",
    consumerName: "ingest-consumer",
    filterSubjects: ["events.v1.dep.Changed.*"],
    replay: "new",
    ordering: "strict",
    concurrency: 1,
    ackWaitMs: 300000,
    maxDeliver: 6,
    backoffMs: [5000, 30000, 120000, 600000, 1800000],
  };
  const setup = await createApp({
    knownContracts: [
      { digest: dependency.digest, contract: dependency.contract },
      { digest: contract.digest, contract: contract.contract },
    ],
    initialBindings: [
      eventConsumerBindingRecord("audit", auditBinding),
      eventConsumerBindingRecord("ingest", ingestBinding),
    ],
  });
  setup.contracts.activateTestContract({
    digest: dependency.digest,
    contract: dependency.contract,
  });
  setup.envelope.boundary = await contractBoundary(
    setup.contracts,
    contract.contract,
    { dependencyResolution: "known" },
  );

  const response = await setup.bootstrap({
    contractId: contract.contract.id,
    contractDigest: contract.digest,
    contract: contract.contract,
  });

  assertEquals(response.status, 200);
  assertEquals(setup.bindings.map((stored) => stored.alias), [
    "audit",
    "ingest",
  ]);
});

Deno.test("POST /bootstrap/service rejects missing stored resource bindings", async () => {
  const setup = await createApp({
    envelopeBoundary: await contractBoundary(
      createTestContracts(),
      baseContract(),
    ),
  });

  const response = await setup.bootstrap({
    contractId: setup.contract.contract.id,
    contractDigest: setup.contract.digest,
    contract: setup.contract.contract,
  });

  assertEquals(response.status, 409);
  assertEquals((await response.json()).reason, "resource_binding_missing");
  assertEquals(setup.services.length, 0);
});

Deno.test("POST /bootstrap/service rejects missing optional resource bindings", async () => {
  const contract = await validatedContract({
    ...baseContract(),
    resources: {
      kv: {
        cache: {
          purpose: "Store cache entries",
          schema: { schema: "CacheEntry" },
          required: true,
        },
        optionalCache: {
          purpose: "Store optional cache entries",
          schema: { schema: "CacheEntry" },
          required: false,
        },
      },
    },
  });
  const setup = await createApp({
    envelopeBoundary: mergeBoundaries(
      await contractBoundary(createTestContracts(), contract.contract),
      {
        ...EMPTY_BOUNDARY,
        resources: [{ kind: "kv", alias: "optionalCache", required: false }],
      },
    ),
    knownContracts: [{ digest: contract.digest, contract: contract.contract }],
    initialBindings: [kvBinding("cache")],
  });

  const response = await setup.bootstrap({
    contractId: contract.contract.id,
    contractDigest: contract.digest,
    contract: contract.contract,
  });

  assertEquals(response.status, 409);
  assertEquals((await response.json()).reason, "resource_binding_missing");
  assertEquals(setup.bindings, [kvBinding("cache")]);
});

Deno.test("POST /bootstrap/service rejects stale KV resource bindings", async () => {
  const setup = await createApp({
    initialBindings: [{
      ...kvBinding("cache"),
      binding: { bucket: "bucket_cache", history: 2, ttlMs: 0 },
    }],
  });

  const response = await setup.bootstrap({
    contractId: setup.contract.contract.id,
    contractDigest: setup.contract.digest,
    contract: setup.contract.contract,
  });

  assertEquals(response.status, 409);
  const body = await response.json();
  assertEquals(body.reason, "resource_binding_mismatch");
  assertEquals(body.mismatchedResourceBindings, ["kv\u001fcache"]);
  assertEquals(setup.services.length, 0);
});

Deno.test("POST /bootstrap/service rejects stale store resource bindings", async () => {
  const contract = await validatedContract({
    ...baseContract(),
    resources: {
      store: {
        objects: {
          purpose: "Store objects",
          ttlMs: 60000,
          maxTotalBytes: 1000,
          maxObjectBytes: 500,
        },
      },
    },
  });
  const setup = await createApp({
    knownContracts: [{ digest: contract.digest, contract: contract.contract }],
    envelopeBoundary: await contractBoundary(
      createTestContracts(),
      contract.contract,
    ),
    initialBindings: [{
      deploymentId: "deployment_1",
      kind: "store",
      alias: "objects",
      binding: {
        name: "objects",
        ttlMs: 60000,
        maxTotalBytes: 1000,
        maxObjectBytes: 250,
      },
      limits: null,
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    }],
  });

  const response = await setup.bootstrap({
    contractId: contract.contract.id,
    contractDigest: contract.digest,
    contract: contract.contract,
  });

  assertEquals(response.status, 409);
  const body = await response.json();
  assertEquals(body.reason, "resource_binding_mismatch");
  assertEquals(body.mismatchedResourceBindings, ["store\u001fobjects"]);
  assertEquals(setup.services.length, 0);
});

Deno.test("POST /bootstrap/service rejects stale jobs bindings", async () => {
  const contract = await validatedContract(jobsContract());
  const setup = await createApp({
    envelopeBoundary: await contractBoundary(
      createTestContracts(),
      contract.contract,
    ),
    initialBindings: [
      jobsBindingRecord("process", {
        namespace: "deployment_1_jobs",
        workStream: "JOBS_WORK",
        queueType: "process",
        publishPrefix: "trellis.jobs.deployment_1_jobs.process",
        workSubject: "trellis.work.deployment_1_jobs.process",
        consumerName: "deployment-1-process",
        payload: { schema: "CacheEntry" },
        result: { schema: "Empty" },
        maxDeliver: 4,
        backoffMs: [1000, 5000],
        ackWaitMs: 30000,
        progress: true,
        logs: true,
        dlq: true,
        concurrency: 2,
      }),
    ],
  });

  const response = await setup.bootstrap({
    contractId: contract.contract.id,
    contractDigest: contract.digest,
    contract: contract.contract,
  });

  assertEquals(response.status, 409);
  const body = await response.json();
  assertEquals(body.reason, "resource_binding_mismatch");
  assertEquals(body.mismatchedResourceBindings, ["jobs\u001fprocess"]);
  assertEquals(setup.services.length, 0);
});

Deno.test("POST /bootstrap/service rejects stale event consumer bindings", async () => {
  const contract = await validatedContract(eventConsumerContract());
  const dependency = await validatedContract(eventDependencyContract());
  const contracts = createTestContracts();
  contracts.addKnownTestContract({
    digest: dependency.digest,
    contract: dependency.contract,
  });
  const setup = await createApp({
    knownContracts: [
      { digest: dependency.digest, contract: dependency.contract },
      { digest: contract.digest, contract: contract.contract },
    ],
    envelopeBoundary: await contractBoundary(contracts, contract.contract, {
      dependencyResolution: "known",
    }),
    initialBindings: [eventConsumerBindingRecord("ingest", {
      stream: "trellis",
      consumerName: "svc_deployment_1_svc_example_ingest_abcd",
      filterSubjects: ["events.v1.dep.Changed.*"],
      replay: "new",
      ordering: "strict",
      concurrency: 1,
      ackWaitMs: 300000,
      maxDeliver: 5,
      backoffMs: [5000, 30000, 120000, 600000],
    })],
  });
  setup.contracts.activateTestContract({
    digest: dependency.digest,
    contract: dependency.contract,
  });

  const response = await setup.bootstrap({
    contractId: contract.contract.id,
    contractDigest: contract.digest,
    contract: contract.contract,
  });

  assertEquals(response.status, 409);
  const body = await response.json();
  assertEquals(body.reason, "resource_binding_mismatch");
  assertEquals(body.mismatchedResourceBindings, ["event-consumer\u001fingest"]);
  assertEquals(setup.services.length, 0);
});

Deno.test("POST /bootstrap/service rejects disabled deployments", async () => {
  const { contract, bootstrap } = await createApp({ deploymentDisabled: true });

  const response = await bootstrap({
    contractId: contract.contract.id,
    contractDigest: contract.digest,
    contract: contract.contract,
  });

  assertEquals(response.status, 403);
  assertEquals((await response.json()).reason, "service_deployment_disabled");
});

Deno.test("POST /bootstrap/service rejects disabled instances", async () => {
  const { contract, bootstrap } = await createApp({ instanceDisabled: true });

  const response = await bootstrap({
    contractId: contract.contract.id,
    contractDigest: contract.digest,
    contract: contract.contract,
  });

  assertEquals(response.status, 403);
  assertEquals((await response.json()).reason, "service_disabled");
});

Deno.test("POST /bootstrap/service rejects bad proof", async () => {
  const { contract, bootstrap } = await createApp();

  const response = await bootstrap({
    contractId: contract.contract.id,
    contractDigest: contract.digest,
    contract: contract.contract,
    sigDigest: "wrong_digest",
  });

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { reason: "invalid_signature" });
});

Deno.test("POST /bootstrap/service rejects stale identity proofs", async () => {
  const { contract, bootstrap } = await createApp({
    nowSeconds: TEST_IAT + 31,
  });

  const response = await bootstrap({
    contractId: contract.contract.id,
    contractDigest: contract.digest,
    contract: contract.contract,
  });

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    reason: "iat_out_of_range",
    serverNow: TEST_IAT + 31,
  });
});
