import { Hono } from "@hono/hono";
import { assertEquals } from "@std/assert";
import {
  deriveWorkloadIdentity,
  signWorkloadWaitRequest,
} from "@qlever-llc/trellis/auth";

import {
  createWorkloadBootstrapHandler,
  verifyWorkloadBootstrapIdentityProof,
} from "./workload.ts";

const TEST_IAT = 1_700_000_000;
const TEST_ROOT_SECRET = new Uint8Array(32).fill(7);
const TEST_INVALID_PUBLIC_IDENTITY_KEY = "A".repeat(43);

function createApp(args: {
  instance?: {
    instanceId: string;
    publicIdentityKey: string;
    profileId: string;
    state: "registered" | "activated" | "revoked" | "disabled";
    createdAt: string | Date;
    activatedAt: string | Date | null;
    revokedAt: string | Date | null;
  } | null;
  activation?: {
    instanceId: string;
    publicIdentityKey: string;
    profileId: string;
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  } | null;
  profile?: {
    profileId: string;
    contractId: string;
    allowedDigests: string[];
    disabled: boolean;
  } | null;
  nowSeconds?: number;
}) {
  const app = new Hono();
  app.post(
    "/bootstrap/workload",
    createWorkloadBootstrapHandler({
      natsServers: ["nats://127.0.0.1:4222"],
      sentinel: { jwt: "jwt", seed: "seed" },
      loadWorkloadInstance: async () => args.instance ?? null,
      loadWorkloadActivation: async () => args.activation ?? null,
      loadWorkloadProfile: async () => args.profile ?? null,
      verifyIdentityProof: verifyWorkloadBootstrapIdentityProof,
      nowSeconds: () => args.nowSeconds ?? TEST_IAT,
    }),
  );
  return app;
}

async function createSignedRequest(contractDigest: string) {
  const identity = await deriveWorkloadIdentity(TEST_ROOT_SECRET);
  const signed = await signWorkloadWaitRequest({
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

Deno.test("POST /bootstrap/workload returns runtime connect info when workload is activated", async () => {
  const request = await createSignedRequest("digest-a");
  const app = createApp({
    instance: {
      instanceId: "wrk_1",
      publicIdentityKey: request.publicIdentityKey,
      profileId: "reader.default",
      state: "activated",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:01:00.000Z"),
      revokedAt: null,
    },
    activation: {
      instanceId: "wrk_1",
      publicIdentityKey: request.publicIdentityKey,
      profileId: "reader.default",
      state: "activated",
      activatedAt: "2026-01-01T00:01:00.000Z",
      revokedAt: null,
    },
    profile: {
      profileId: "reader.default",
      contractId: "example.workload@v1",
      allowedDigests: ["digest-a"],
      disabled: false,
    },
  });

  const response = await app.request("http://trellis/bootstrap/workload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "ready",
    connectInfo: {
      instanceId: "wrk_1",
      profileId: "reader.default",
      contractId: "example.workload@v1",
      contractDigest: "digest-a",
      transport: {
        natsServers: ["nats://127.0.0.1:4222"],
        sentinel: { jwt: "jwt", seed: "seed" },
      },
      auth: {
        mode: "workload_identity",
        iatSkewSeconds: 30,
      },
    },
  });
});

Deno.test("POST /bootstrap/workload returns activation_required when activation is missing", async () => {
  const request = await createSignedRequest("digest-a");
  const app = createApp({
    instance: {
      instanceId: "wrk_1",
      publicIdentityKey: request.publicIdentityKey,
      profileId: "reader.default",
      state: "registered",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedAt: null,
      revokedAt: null,
    },
    activation: null,
    profile: {
      profileId: "reader.default",
      contractId: "example.workload@v1",
      allowedDigests: ["digest-a"],
      disabled: false,
    },
  });

  const response = await app.request("http://trellis/bootstrap/workload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { status: "activation_required" });
});

Deno.test("POST /bootstrap/workload returns not_ready for revoked activations", async () => {
  const request = await createSignedRequest("digest-a");
  const app = createApp({
    instance: {
      instanceId: "wrk_1",
      publicIdentityKey: request.publicIdentityKey,
      profileId: "reader.default",
      state: "revoked",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:01:00.000Z"),
      revokedAt: new Date("2026-01-01T00:02:00.000Z"),
    },
    activation: {
      instanceId: "wrk_1",
      publicIdentityKey: request.publicIdentityKey,
      profileId: "reader.default",
      state: "revoked",
      activatedAt: "2026-01-01T00:01:00.000Z",
      revokedAt: "2026-01-01T00:02:00.000Z",
    },
    profile: {
      profileId: "reader.default",
      contractId: "example.workload@v1",
      allowedDigests: ["digest-a"],
      disabled: false,
    },
  });

  const response = await app.request("http://trellis/bootstrap/workload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "not_ready",
    reason: "workload_activation_revoked",
  });
});

Deno.test("POST /bootstrap/workload rejects invalid signatures", async () => {
  const app = createApp({
    instance: null,
    activation: null,
    profile: null,
  });

  const response = await app.request("http://trellis/bootstrap/workload", {
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
