import { Hono } from "@hono/hono";
import { assertEquals } from "@std/assert";
import { createAuth } from "@qlever-llc/trellis/auth";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";

import { createTestContracts } from "../../catalog/test_contracts.ts";
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

async function validatedContract(contract: TrellisContractV1) {
  return await createTestContracts().validateContract(contract);
}

async function contractBoundary(
  contracts: ReturnType<typeof createTestContracts>,
  contract: TrellisContractV1,
): Promise<EnvelopeBoundary> {
  const analysis = await analyzeContractEnvelopeBoundary(contracts, contract);
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
  contracts.addKnownTestContract({
    digest: expanded.digest,
    contract: expanded.contract,
  });

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
          evidence.push(record);
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
      },
      storePresentedContract: async ({ contract, digest }) => {
        storedContracts.push({ digest, contractId: contract.id });
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

Deno.test("POST /bootstrap/service reconnects after accepted expansion", async () => {
  const setup = await createApp();
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
