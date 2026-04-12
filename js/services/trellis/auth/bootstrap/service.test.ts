import { Hono } from "@hono/hono";
import { assertEquals } from "@std/assert";
import { createAuth } from "@qlever-llc/trellis/auth";

import { ContractStore } from "../../catalog/store.ts";
import type { ServiceRegistryEntry } from "../../state/schemas/catalog_state.ts";
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
  service?: ServiceRegistryEntry | null;
  nowSeconds?: number;
  activateContract?: boolean;
}) {
  const auth = await createAuth({ sessionKeySeed: TEST_SEED });
  const validated = await createTestContractStore();
  const store = new ContractStore();
  if (args.activateContract !== false) {
    store.activate(validated.digest, validated.contract);
  }
  const app = new Hono();
  app.post("/bootstrap/service", createServiceBootstrapHandler({
    contractStore: store,
    natsServers: ["nats://127.0.0.1:4222"],
    sentinel: { jwt: "jwt", seed: "seed" },
    loadService: async (sessionKey) => {
      if (sessionKey !== auth.sessionKey) return null;
      if (args.service !== undefined) return args.service;
      return {
        displayName: "Example Service",
        active: true,
        capabilities: ["service"],
        namespaces: ["svc"],
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
    },
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
    connectInfo: {
      sessionKey: auth.sessionKey,
      contractId: contract.contract.id,
      contractDigest: contract.digest,
      transport: {
        natsServers: ["nats://127.0.0.1:4222"],
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
  assertEquals(await response.json(), { reason: "iat_out_of_range" });
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
  assertEquals(await response.json(), { reason: "unknown_service" });
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
  assertEquals(await response.json(), { reason: "service_disabled" });
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
  assertEquals(await response.json(), { reason: "contract_not_active" });
});
