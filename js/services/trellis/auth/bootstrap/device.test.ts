import { Hono } from "@hono/hono";
import { assertEquals } from "@std/assert";
import {
  deriveDeviceIdentity,
  signDeviceWaitRequest,
} from "@qlever-llc/trellis/auth";

import {
  createDeviceBootstrapHandler,
  verifyDeviceBootstrapIdentityProof,
} from "./device.ts";

const TEST_IAT = 1_700_000_000;
const TEST_ROOT_SECRET = new Uint8Array(32).fill(7);
const TEST_INVALID_PUBLIC_IDENTITY_KEY = "A".repeat(43);

function createApp(args: {
  instance?: {
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    state: "registered" | "activated" | "revoked" | "disabled";
    createdAt: string | Date;
    activatedAt: string | Date | null;
    revokedAt: string | Date | null;
  } | null;
  activation?: {
    instanceId: string;
    publicIdentityKey: string;
    deploymentId: string;
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  } | null;
  deployment?: {
    deploymentId: string;
    appliedContracts: Array<{ contractId: string; allowedDigests: string[] }>;
    disabled: boolean;
  } | null;
  nowSeconds?: number;
}) {
  const app = new Hono();
  app.post(
    "/bootstrap/device",
    createDeviceBootstrapHandler({
      transports: {
        native: { natsServers: ["nats://127.0.0.1:4222"] },
        websocket: { natsServers: ["ws://localhost:8080"] },
      },
      sentinel: { jwt: "jwt", seed: "seed" },
      loadDeviceInstance: async () => args.instance ?? null,
      loadDeviceActivation: async () => args.activation ?? null,
      loadDeviceDeployment: async () => args.deployment ?? null,
      saveDeviceInstance: async () => {},
      refreshActiveContracts: async () => {},
      verifyIdentityProof: verifyDeviceBootstrapIdentityProof,
      nowSeconds: () => args.nowSeconds ?? TEST_IAT,
    }),
  );
  return app;
}

async function createSignedRequest(contractDigest: string) {
  const identity = await deriveDeviceIdentity(TEST_ROOT_SECRET);
  const signed = await signDeviceWaitRequest({
    publicIdentityKey: identity.publicIdentityKey,
    nonce: "connect-info",
    identitySeed: identity.identitySeed,
    contractDigest,
    iat: TEST_IAT,
  });
  return {
    publicIdentityKey: signed.publicIdentityKey,
    contractDigest: contractDigest,
    iat: signed.iat,
    sig: signed.sig,
  };
}

Deno.test("POST /bootstrap/device returns runtime connect info when device is activated", async () => {
  const request = await createSignedRequest("digest-a");
  const app = createApp({
    instance: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "activated",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:01:00.000Z"),
      revokedAt: null,
    },
    activation: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "activated",
      activatedAt: "2026-01-01T00:01:00.000Z",
      revokedAt: null,
    },
    deployment: {
      deploymentId: "reader.default",
      appliedContracts: [{
        contractId: "example.device@v1",
        allowedDigests: ["digest-a"],
      }],
      disabled: false,
    },
  });

  const response = await app.request("http://trellis/bootstrap/device", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "ready",
    connectInfo: {
      instanceId: "dev_1",
      deploymentId: "reader.default",
      contractId: "example.device@v1",
      contractDigest: "digest-a",
      transports: {
        native: { natsServers: ["nats://127.0.0.1:4222"] },
        websocket: { natsServers: ["ws://localhost:8080"] },
      },
      transport: {
        sentinel: { jwt: "jwt", seed: "seed" },
      },
      auth: {
        mode: "device_identity",
        iatSkewSeconds: 30,
      },
    },
  });
});

Deno.test("POST /bootstrap/device returns activation_required when activation is missing", async () => {
  const request = await createSignedRequest("digest-a");
  const app = createApp({
    instance: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "registered",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedAt: null,
      revokedAt: null,
    },
    activation: null,
    deployment: {
      deploymentId: "reader.default",
      appliedContracts: [{
        contractId: "example.device@v1",
        allowedDigests: ["digest-a"],
      }],
      disabled: false,
    },
  });

  const response = await app.request("http://trellis/bootstrap/device", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { status: "activation_required" });
});

Deno.test("POST /bootstrap/device returns not_ready for revoked activations", async () => {
  const request = await createSignedRequest("digest-a");
  const app = createApp({
    instance: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "revoked",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:01:00.000Z"),
      revokedAt: new Date("2026-01-01T00:02:00.000Z"),
    },
    activation: {
      instanceId: "dev_1",
      publicIdentityKey: request.publicIdentityKey,
      deploymentId: "reader.default",
      state: "revoked",
      activatedAt: "2026-01-01T00:01:00.000Z",
      revokedAt: "2026-01-01T00:02:00.000Z",
    },
    deployment: {
      deploymentId: "reader.default",
      appliedContracts: [{
        contractId: "example.device@v1",
        allowedDigests: ["digest-a"],
      }],
      disabled: false,
    },
  });

  const response = await app.request("http://trellis/bootstrap/device", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "not_ready",
    reason: "device_activation_revoked",
  });
});

Deno.test("POST /bootstrap/device rejects invalid signatures", async () => {
  const app = createApp({
    instance: null,
    activation: null,
    deployment: null,
  });

  const response = await app.request("http://trellis/bootstrap/device", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicIdentityKey: TEST_INVALID_PUBLIC_IDENTITY_KEY,
      contractDigest: "digest-a",
      iat: TEST_IAT,
      sig: "A".repeat(86),
    }),
  });

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { reason: "invalid_signature" });
});

Deno.test("POST /bootstrap/device returns serverNow when bootstrap proof iat is out of range", async () => {
  const request = await createSignedRequest("digest-a");
  const app = createApp({
    instance: null,
    activation: null,
    deployment: null,
    nowSeconds: TEST_IAT + 31,
  });

  const response = await app.request("http://trellis/bootstrap/device", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    reason: "iat_out_of_range",
    serverNow: TEST_IAT + 31,
  });
});
