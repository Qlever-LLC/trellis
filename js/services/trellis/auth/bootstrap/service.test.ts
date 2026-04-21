import { Hono } from "@hono/hono";
import { assertEquals } from "@std/assert";
import { createAuth } from "@qlever-llc/trellis/auth";

import { ContractStore } from "../../catalog/store.ts";
import { createServiceBootstrapHandler } from "./service.ts";

const TEST_SEED = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TEST_IAT = 1_700_000_000;

async function createTestContractStore() {
  const store = new ContractStore();
  const validated = await store.validate({
    format: "trellis.contract.v1",
    id: "svc.example@v1",
    displayName: "Example Service",
    description: "Example service contract",
    kind: "service",
    schemas: {
      JobPayload: { type: "object" },
    },
    jobs: {
      process: {
        payload: { schema: "JobPayload" },
      },
    },
    resources: {
      kv: {
        cache: {
          purpose: "Store cache entries",
        },
      },
    },
  });
  store.activate(validated.digest, validated.contract);
  return validated;
}

async function createApp(args: {
  service?: {
    displayName: string;
    active: boolean;
    capabilities: string[];
    description: string;
    contractId?: string;
    contractDigest?: string;
    resourceBindings?: Record<string, unknown>;
    createdAt: string | Date;
  } | null;
  nowSeconds?: number;
  activateContract?: boolean;
  registerInactiveContract?: boolean;
}) {
  const auth = await createAuth({ sessionKeySeed: TEST_SEED });
  const validated = await createTestContractStore();
  const store = new ContractStore();
  if (args.registerInactiveContract) {
    await store.validate(validated.contract);
  }
  if (args.activateContract !== false) {
    store.activate(validated.digest, validated.contract);
  }
  const app = new Hono();
  app.post("/bootstrap/service", createServiceBootstrapHandler({
    contractStore: store,
    transports: {
      native: { natsServers: ["nats://127.0.0.1:4222"] },
      websocket: { natsServers: ["ws://localhost:8080"] },
    },
    sentinel: { jwt: "jwt", seed: "seed" },
    loadServiceInstance: async (instanceKey) => {
      if (instanceKey !== auth.sessionKey) return null;
      if (args.service === null) return null;
      const service = args.service ?? {
        displayName: "Example Service",
        active: true,
        capabilities: ["service"],
        description: "Example service",
        contractId: validated.contract.id,
        contractDigest: validated.digest,
        resourceBindings: {
          kv: {
            cache: {
              bucket: "svc_cache",
              history: 1,
              ttlMs: 0,
            },
          },
        },
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      };

      return {
        instanceId: "svc_1",
        profileId: "profile_1",
        instanceKey: auth.sessionKey,
        disabled: !service.active,
        currentContractId: service.contractId,
        currentContractDigest: service.contractDigest,
        capabilities: service.capabilities,
        resourceBindings: service.resourceBindings,
        createdAt: service.createdAt,
      };
    },
    saveServiceInstance: async () => {},
    loadServiceProfile: async () => ({
      profileId: "profile_1",
      disabled: false,
      appliedContracts: [{
        contractId: validated.contract.id,
        allowedDigests: [validated.digest],
      }],
    }),
    refreshActiveContracts: async () => {},
    verifyIdentityProof: async ({ sessionKey, iat, sig }) =>
      sessionKey === auth.sessionKey &&
      sig === await auth.natsConnectSigForIat(iat),
    nowSeconds: () => args.nowSeconds ?? TEST_IAT,
  }));
  return { app, auth, contract: validated };
}

Deno.test("POST /bootstrap/service returns runtime bootstrap info and bindings", async () => {
  const { app, auth, contract } = await createApp({});
  const response = await app.request("http://trellis/bootstrap/service", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: auth.sessionKey,
      contractId: contract.contract.id,
      contractDigest: contract.digest,
      iat: TEST_IAT,
      sig: await auth.natsConnectSigForIat(TEST_IAT),
    }),
  });

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "ready",
    serverNow: TEST_IAT,
    connectInfo: {
      sessionKey: auth.sessionKey,
      contractId: contract.contract.id,
      contractDigest: contract.digest,
      transports: {
        native: { natsServers: ["nats://127.0.0.1:4222"] },
        websocket: { natsServers: ["ws://localhost:8080"] },
      },
      transport: {
        sentinel: { jwt: "jwt", seed: "seed" },
      },
      auth: {
        mode: "service_identity",
        iatSkewSeconds: 30,
      },
    },
    contract: {
      id: contract.contract.id,
      digest: contract.digest,
      displayName: contract.contract.displayName,
      description: contract.contract.description,
      jobs: contract.contract.jobs,
      resources: contract.contract.resources,
    },
    binding: {
      contractId: contract.contract.id,
      digest: contract.digest,
      resources: {
        kv: {
          cache: {
            bucket: "svc_cache",
            history: 1,
            ttlMs: 0,
          },
        },
      },
    },
  });
});

Deno.test("POST /bootstrap/service rejects stale identity proofs", async () => {
  const { app, auth, contract } = await createApp({ nowSeconds: TEST_IAT + 31 });
  const response = await app.request("http://trellis/bootstrap/service", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: auth.sessionKey,
      contractId: contract.contract.id,
      contractDigest: contract.digest,
      iat: TEST_IAT,
      sig: await auth.natsConnectSigForIat(TEST_IAT),
    }),
  });

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    reason: "iat_out_of_range",
    serverNow: TEST_IAT + 31,
  });
});

Deno.test("POST /bootstrap/service rejects invalid signatures", async () => {
  const { app, auth, contract } = await createApp({});
  const response = await app.request("http://trellis/bootstrap/service", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: auth.sessionKey,
      contractId: contract.contract.id,
      contractDigest: contract.digest,
      iat: TEST_IAT,
      sig: "A".repeat(86),
    }),
  });

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { reason: "invalid_signature" });
});

Deno.test("POST /bootstrap/service rejects unknown services", async () => {
  const { app, auth, contract } = await createApp({ service: null });
  const response = await app.request("http://trellis/bootstrap/service", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: auth.sessionKey,
      contractId: contract.contract.id,
      contractDigest: contract.digest,
      iat: TEST_IAT,
      sig: await auth.natsConnectSigForIat(TEST_IAT),
    }),
  });

  assertEquals(response.status, 404);
  assertEquals(await response.json(), {
    reason: "unknown_service",
    message:
      `Service instance for session key '${auth.sessionKey}' is not provisioned in Trellis. Provision the instance before starting the service.`,
  });
});

Deno.test("POST /bootstrap/service rejects disabled services", async () => {
  const auth = await createAuth({ sessionKeySeed: TEST_SEED });
  const contract = await createTestContractStore();
  const { app } = await createApp({
    service: {
      displayName: "Example Service",
      active: false,
      capabilities: ["service"],
      description: "Example service",
      contractId: contract.contract.id,
      contractDigest: contract.digest,
      resourceBindings: {},
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  const response = await app.request("http://trellis/bootstrap/service", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: auth.sessionKey,
      contractId: contract.contract.id,
      contractDigest: contract.digest,
      iat: TEST_IAT,
      sig: await auth.natsConnectSigForIat(TEST_IAT),
    }),
  });

  assertEquals(response.status, 403);
  assertEquals(await response.json(), {
    reason: "service_disabled",
    message:
      `Service instance 'svc_1' is disabled in Trellis. Enable the instance or provision a new one before reconnecting.`,
    instanceId: "svc_1",
    profileId: "profile_1",
  });
});

Deno.test("POST /bootstrap/service rejects services with inactive contracts", async () => {
  const { app, auth, contract } = await createApp({ activateContract: false });
  const response = await app.request("http://trellis/bootstrap/service", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: auth.sessionKey,
      contractId: contract.contract.id,
      contractDigest: contract.digest,
      iat: TEST_IAT,
      sig: await auth.natsConnectSigForIat(TEST_IAT),
    }),
  });

  assertEquals(response.status, 409);
  assertEquals(await response.json(), {
    reason: "contract_not_active",
    message:
      `Contract '${contract.contract.id}' digest '${contract.digest}' is allowed for profile 'profile_1' but is not active in Trellis. Re-apply the contract to the profile or restart Trellis if contract state was lost.`,
    instanceId: "svc_1",
    profileId: "profile_1",
    contractId: contract.contract.id,
    contractDigest: contract.digest,
  });
});

Deno.test("POST /bootstrap/service rejects contracts that are present but inactive", async () => {
  const { app, auth, contract } = await createApp({
    activateContract: false,
    registerInactiveContract: true,
  });
  const response = await app.request("http://trellis/bootstrap/service", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: auth.sessionKey,
      contractId: contract.contract.id,
      contractDigest: contract.digest,
      iat: TEST_IAT,
      sig: await auth.natsConnectSigForIat(TEST_IAT),
    }),
  });

  assertEquals(response.status, 409);
  assertEquals(await response.json(), {
    reason: "contract_not_active",
    message:
      `Contract '${contract.contract.id}' digest '${contract.digest}' is allowed for profile 'profile_1' but is not active in Trellis. Re-apply the contract to the profile or restart Trellis if contract state was lost.`,
    instanceId: "svc_1",
    profileId: "profile_1",
    contractId: contract.contract.id,
    contractDigest: contract.digest,
  });
});

Deno.test("POST /bootstrap/service returns actionable mismatch details", async () => {
  const { app, auth, contract } = await createApp({});
  const response = await app.request("http://trellis/bootstrap/service", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: auth.sessionKey,
      contractId: contract.contract.id,
      contractDigest: "other_digest",
      iat: TEST_IAT,
      sig: await auth.natsConnectSigForIat(TEST_IAT),
    }),
  });

  assertEquals(response.status, 409);
  assertEquals(await response.json(), {
    reason: "service_contract_mismatch",
    message:
      `Service instance 'svc_1' under profile 'profile_1' is not allowed to run digest 'other_digest' for contract '${contract.contract.id}'. Allowed digests: ${contract.digest}. Re-apply the current contract to the profile or restart the matching service revision.`,
    instanceId: "svc_1",
    profileId: "profile_1",
    expectedContractId: contract.contract.id,
    expectedContractDigest: "other_digest",
    allowedDigests: [contract.digest],
    currentContractId: contract.contract.id,
    currentContractDigest: contract.digest,
  });
});
