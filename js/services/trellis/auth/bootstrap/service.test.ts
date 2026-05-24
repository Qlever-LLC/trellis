import { Hono } from "@hono/hono";
import { assertEquals } from "@std/assert";
import { createAuth } from "@qlever-llc/trellis/auth";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";

import { createTestContracts } from "../../catalog/test_contracts.ts";
import type { ContractEntry } from "../../catalog/uses.ts";
import type { ContractResourceBindings } from "../../catalog/resources.ts";
import { analyzeContractEnvelopeBoundary } from "../boundary_analysis.ts";
import { computeEnvelopeDelta } from "../envelope_decision.ts";
import type {
  DeploymentContractEvidence,
  DeploymentEnvelope,
  DeploymentResourceBinding,
  EnvelopeBoundary,
  EnvelopeExpansionRequest,
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

async function contractBoundary(
  contracts: ReturnType<typeof createTestContracts>,
  contract: TrellisContractV1,
  options?: { dependencyResolution?: "active" | "known" },
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
  initialEvidence?: DeploymentContractEvidence[];
  initialBindings?: DeploymentResourceBinding[];
  knownContracts?: ContractEntry[];
  knownExpandedContract?: boolean;
  provisionResourceBindings?: (
    contract: TrellisContractV1,
  ) => Promise<ContractResourceBindings>;
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
    currentContractId?: string;
    currentContractDigest?: string;
    resourceBindings?: Record<string, unknown>;
    capabilities: string[];
  }> = [];
  const evidence = [...(args.initialEvidence ?? [])];
  const bindings = [...(args.initialBindings ?? [])];
  const expansionRequests: EnvelopeExpansionRequest[] = [];
  const storedContracts: Array<{ digest: string; contractId: string }> = [];
  const putExpansions: Array<{
    envelope: DeploymentEnvelope;
    delta: EnvelopeBoundary;
    resourceBindings: DeploymentResourceBinding[];
    contractEvidence: DeploymentContractEvidence;
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
          const index = evidence.findIndex((stored) =>
            stored.deploymentId === record.contractEvidence.deploymentId &&
            stored.contractDigest === record.contractEvidence.contractDigest
          );
          if (index >= 0) evidence[index] = record.contractEvidence;
          else evidence.push(record.contractEvidence);
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
      deploymentContractEvidenceStorage: {
        get: async (_deploymentId, digest) =>
          evidence.find((record) => record.contractDigest === digest),
        put: async (record) => {
          const index = evidence.findIndex((stored) =>
            stored.deploymentId === record.deploymentId &&
            stored.contractDigest === record.contractDigest
          );
          if (index >= 0) evidence[index] = record;
          else evidence.push(record);
        },
        listByDeployment: async (deploymentId) =>
          evidence.filter((record) => record.deploymentId === deploymentId),
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
      },
      storePresentedContract: async ({ contract, digest }) => {
        storedContracts.push({ digest, contractId: contract.id });
        contracts.addKnownTestContract({ digest, contract });
      },
      verifyIdentityProof: async ({ sessionKey, iat, contractDigest, sig }) =>
        sessionKey === auth.sessionKey &&
        sig === await auth.natsConnectSigForIat(iat, contractDigest),
      provisionResourceBindings: async (_nats, provisioned) =>
        args.provisionResourceBindings
          ? await args.provisionResourceBindings(provisioned)
          : {
            kv: Object.fromEntries(
              Object.keys(provisioned.resources?.kv ?? {}).map((alias) => [
                alias,
                { bucket: `bucket_${alias}`, history: 1, ttlMs: 0 },
              ]),
            ),
          },
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
    evidence,
    bindings,
    expansionRequests,
    storedContracts,
    putExpansions,
    bootstrap,
  };
}

Deno.test("POST /bootstrap/service accepts first start when contract fits envelope", async () => {
  const { contract, bootstrap, services, evidence, bindings, storedContracts } =
    await createApp();

  const response = await bootstrap({
    contractId: contract.contract.id,
    contractDigest: contract.digest,
    contract: contract.contract,
  });

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.status, "ready");
  assertEquals(body.binding.resources, {
    kv: { cache: { bucket: "bucket_cache", history: 1, ttlMs: 0 } },
  });
  assertEquals(services[0]?.currentContractDigest, contract.digest);
  assertEquals(evidence.length, 1);
  assertEquals(bindings.length, 1);
  assertEquals(storedContracts, [{
    digest: contract.digest,
    contractId: contract.contract.id,
  }]);
});

Deno.test("POST /bootstrap/service accepts new contract within envelope", async () => {
  const setup = await createApp();
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

Deno.test("POST /bootstrap/service rejects stale same-contract digest", async () => {
  const oldContract = await validatedContract(baseContract());
  const newContract = await validatedContract(expandedContract());
  const setup = await createApp({
    initialEvidence: [
      {
        deploymentId: "deployment_1",
        contractId: oldContract.contract.id,
        contractDigest: oldContract.digest,
        contract: oldContract.contract,
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
      },
      {
        deploymentId: "deployment_1",
        contractId: newContract.contract.id,
        contractDigest: newContract.digest,
        contract: newContract.contract,
        firstSeenAt: "2026-01-01T00:00:01.000Z",
        lastSeenAt: "2026-01-01T00:00:01.000Z",
      },
    ],
  });
  setup.contracts.setActiveTestDigests([newContract.digest]);

  const response = await setup.bootstrap({
    contractId: oldContract.contract.id,
    contractDigest: oldContract.digest,
    contract: oldContract.contract,
  });

  assertEquals(response.status, 409);
  const body = await response.json();
  assertEquals(body.reason, "contract_catalog_issue");
  assertEquals(body.activeContractDigest, newContract.digest);
  assertEquals(setup.services, []);
  assertEquals(setup.evidence.length, 2);
});

Deno.test("POST /bootstrap/service records same-contract proposal as forced update", async () => {
  const oldContract = await validatedContract(baseContract());
  const newContract = await validatedContract(expandedContract());
  const setup = await createApp({
    envelopeBoundary: await contractBoundary(
      createTestContracts(),
      newContract.contract,
    ),
    initialEvidence: [
      {
        deploymentId: "deployment_1",
        contractId: oldContract.contract.id,
        contractDigest: oldContract.digest,
        contract: oldContract.contract,
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
      },
      {
        deploymentId: "deployment_1",
        contractId: newContract.contract.id,
        contractDigest: newContract.digest,
        contract: newContract.contract,
        firstSeenAt: "2026-01-01T00:00:01.000Z",
        lastSeenAt: "2026-01-01T00:00:01.000Z",
        ignoredAt: "2026-01-01T00:00:02.000Z",
        ignoredBy: { userId: "admin" },
        ignoreReason: "test repair",
      },
    ],
  });
  setup.contracts.setActiveTestDigests([oldContract.digest]);

  const response = await setup.bootstrap({
    contractId: newContract.contract.id,
    contractDigest: newContract.digest,
    contract: newContract.contract,
  });

  assertEquals(response.status, 409);
  const body = await response.json();
  assertEquals(body.reason, "contract_catalog_issue");
  assertEquals(body.activeContractDigest, oldContract.digest);
  assertEquals(setup.services, []);
  assertEquals(setup.evidence.length, 2);
  assertEquals(setup.evidence[1]?.ignoredAt, undefined);
});

Deno.test("POST /bootstrap/service clears legacy quarantine metadata on reconnect", async () => {
  const contract = await validatedContract(expandedContract());
  const setup = await createApp({
    envelopeBoundary: await contractBoundary(
      createTestContracts(),
      contract.contract,
    ),
    initialEvidence: [
      {
        deploymentId: "deployment_1",
        contractId: contract.contract.id,
        contractDigest: contract.digest,
        contract: contract.contract,
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
        ignoredAt: "2026-01-01T00:00:01.000Z",
        ignoredBy: { userId: "admin" },
        ignoreReason: "test repair",
      },
    ],
  });
  setup.contracts.setActiveTestDigests([contract.digest]);

  const response = await setup.bootstrap({
    contractId: contract.contract.id,
    contractDigest: contract.digest,
    contract: contract.contract,
  });

  assertEquals(response.status, 200);
  assertEquals(setup.evidence.length, 1);
  assertEquals(setup.evidence[0]?.ignoredAt, undefined);
  assertEquals(setup.evidence[0]?.ignoredBy, undefined);
  assertEquals(setup.evidence[0]?.ignoreReason, undefined);
});

Deno.test("POST /bootstrap/service accepts older digest when it remains effective", async () => {
  const oldContract = await validatedContract(baseContract());
  const newContract = await validatedContract(expandedContract());
  const setup = await createApp({
    initialEvidence: [
      {
        deploymentId: "deployment_1",
        contractId: oldContract.contract.id,
        contractDigest: oldContract.digest,
        contract: oldContract.contract,
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
      },
      {
        deploymentId: "deployment_1",
        contractId: newContract.contract.id,
        contractDigest: newContract.digest,
        contract: newContract.contract,
        firstSeenAt: "2026-01-01T00:00:01.000Z",
        lastSeenAt: "2026-01-01T00:00:01.000Z",
      },
    ],
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
  assertEquals(setup.services[0]?.currentContractDigest, oldContract.digest);
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

Deno.test("POST /bootstrap/service does not become ready when required dependency is inactive", async () => {
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
  assertEquals(setup.services.length, 0);
  assertEquals(setup.evidence.length, 0);
  assertEquals(setup.bindings.length, 0);
  assertEquals(setup.putExpansions.length, 0);
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
  const setup = await createApp({ knownExpandedContract: false });
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

Deno.test("POST /bootstrap/service does not resolve omitted manifests from deployment evidence", async () => {
  const expanded = await validatedContract(expandedContract());
  const setup = await createApp({
    knownExpandedContract: false,
    initialEvidence: [{
      deploymentId: "deployment_1",
      contractId: expanded.contract.id,
      contractDigest: expanded.digest,
      contract: expanded.contract,
      firstSeenAt: TEST_NOW,
      lastSeenAt: TEST_NOW,
    }],
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
    binding: { bucket: "stored_cache", history: 3, ttlMs: 60000 },
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

Deno.test("POST /bootstrap/service stores jobs bindings in contract resource shape", async () => {
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
        backoffMs: [1000, 5000],
        ackWaitMs: 30000,
        defaultDeadlineMs: 60000,
        progress: true,
        logs: true,
        dlq: true,
        concurrency: 2,
      },
    },
  };
  const setup = await createApp({
    provisionResourceBindings: async () => ({ jobs: jobsBinding }),
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

Deno.test("POST /bootstrap/service rejects when provisioning misses a requested resource binding", async () => {
  const setup = await createApp({
    envelopeBoundary: await contractBoundary(
      createTestContracts(),
      baseContract(),
    ),
    provisionResourceBindings: async () => ({ kv: {} }),
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

Deno.test("POST /bootstrap/service accepts missing optional resource bindings", async () => {
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
    provisionResourceBindings: async () => ({
      kv: { cache: { bucket: "bucket_cache", history: 1, ttlMs: 0 } },
    }),
  });

  const response = await setup.bootstrap({
    contractId: contract.contract.id,
    contractDigest: contract.digest,
    contract: contract.contract,
  });

  assertEquals(response.status, 200);
  assertEquals((await response.json()).binding.resources, {
    kv: { cache: { bucket: "bucket_cache", history: 1, ttlMs: 0 } },
  });
  assertEquals(setup.bindings.map((binding) => binding.alias), ["cache"]);
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
