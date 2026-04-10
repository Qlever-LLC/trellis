import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";

import {
  buildWorkloadWaitProofInput,
  buildWorkloadActivationPayload,
  buildWorkloadActivationUrl,
  createWorkloadNatsAuthToken,
  createWorkloadActivationClient,
  deriveWorkloadConfirmationCode,
  deriveWorkloadIdentity,
  encodeWorkloadActivationPayload,
  getWorkloadConnectInfo,
  parseWorkloadActivationPayload,
  signWorkloadWaitRequest,
  verifyWorkloadWaitSignature,
  verifyWorkloadConfirmationCode,
  waitForWorkloadActivation,
  type AuthActivateWorkloadInput,
  type AuthActivateWorkloadOutput,
  type AuthGetWorkloadActivationStatusInput,
  type AuthGetWorkloadActivationStatusOutput,
  type AuthListWorkloadActivationsInput,
  type AuthListWorkloadActivationsOutput,
  type AuthRevokeWorkloadActivationInput,
  type AuthRevokeWorkloadActivationResponse,
  type GetWorkloadConnectInfoOutput,
  type WorkloadActivationTransport,
} from "./workload_activation.ts";
import { importEd25519PublicKeyFromBase64url } from "./keys.ts";
import { base64urlDecode, sha256, toArrayBuffer } from "./utils.ts";

function okResult<T>(value: T) {
  return {
    take: () => value,
  };
}

Deno.test("workload activation payload helpers round-trip encoded payloads", async () => {
  const identity = await deriveWorkloadIdentity(new Uint8Array(32).fill(7));
  const payload = await buildWorkloadActivationPayload({
    activationKey: identity.activationKey,
    publicIdentityKey: identity.publicIdentityKey,
    nonce: "nonce_123",
  });

  const encoded = encodeWorkloadActivationPayload(payload);
  assertEquals(parseWorkloadActivationPayload(encoded), payload);

  const url = buildWorkloadActivationUrl({
    trellisUrl: "https://trellis.example.com/base",
    payload,
  });
  assertEquals(
    url,
    `https://trellis.example.com/auth/workloads/activate?payload=${encodeURIComponent(encoded)}`,
  );
});

Deno.test("workload wait helpers sign requests and verify confirmation codes", async () => {
  const identity = await deriveWorkloadIdentity(new Uint8Array(32).fill(9));
  const waitRequest = await signWorkloadWaitRequest({
    publicIdentityKey: identity.publicIdentityKey,
    nonce: "nonce_123",
    identitySeed: identity.identitySeed,
    iat: 123,
  });

  assertEquals(waitRequest.publicIdentityKey, identity.publicIdentityKey);
  assertEquals(waitRequest.nonce, "nonce_123");
  assertEquals(waitRequest.iat, 123);
  assert(waitRequest.sig.length > 0);

  const confirmationCode = await deriveWorkloadConfirmationCode({
    activationKey: identity.activationKey,
    publicIdentityKey: identity.publicIdentityKey,
    nonce: "nonce_123",
  });
  assertEquals(confirmationCode.length, 8);
  assert(await verifyWorkloadConfirmationCode({
    activationKey: identity.activationKey,
    publicIdentityKey: identity.publicIdentityKey,
    nonce: "nonce_123",
    confirmationCode: confirmationCode.toLowerCase(),
  }));

  const natsAuthToken = await createWorkloadNatsAuthToken({
    publicIdentityKey: identity.publicIdentityKey,
    identitySeed: identity.identitySeed,
    contractDigest: "digest-a",
    iat: 456,
  });
  assertEquals(natsAuthToken.sessionKey, identity.publicIdentityKey);
  assertEquals(natsAuthToken.iat, 456);
  assertEquals(natsAuthToken.contractDigest, "digest-a");
  assert(natsAuthToken.sig.length > 0);
});

Deno.test("workload wait signatures are computed over the hashed proof input", async () => {
  const identity = await deriveWorkloadIdentity(new Uint8Array(32).fill(11));
  const waitRequest = await signWorkloadWaitRequest({
    publicIdentityKey: identity.publicIdentityKey,
    nonce: "nonce_456",
    identitySeed: identity.identitySeed,
    iat: 456,
  });

  assert(await verifyWorkloadWaitSignature(waitRequest));

  const publicKey = await importEd25519PublicKeyFromBase64url(identity.publicIdentityKey);
  const proofInput = buildWorkloadWaitProofInput(
    identity.publicIdentityKey,
    waitRequest.nonce,
    waitRequest.iat,
  );
  const hashedProofInput = await sha256(proofInput);
  const signature = base64urlDecode(waitRequest.sig);

  assert(
    await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      toArrayBuffer(signature),
      toArrayBuffer(hashedProofInput),
    ),
  );
  assertFalse(
    await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      toArrayBuffer(signature),
      toArrayBuffer(proofInput),
    ),
  );
});

Deno.test("workload activation wait and connect-info helpers parse responses", async () => {
  const originalFetch = globalThis.fetch;
  const identity = await deriveWorkloadIdentity(new Uint8Array(32).fill(5));

  try {
    globalThis.fetch = ((_input: URL | Request | string, _init?: RequestInit) => {
      return Promise.resolve(new Response(JSON.stringify({
        status: "activated",
        activatedAt: "2026-04-08T12:00:00Z",
        connectInfo: {
          instanceId: "wrk_123",
          profileId: "reader.default",
          contractId: "acme.reader@v1",
          contractDigest: "digest-a",
          transport: {
            natsServers: ["nats://127.0.0.1:4222"],
            sentinel: { jwt: "jwt", seed: "seed" },
          },
          auth: { mode: "workload_identity", iatSkewSeconds: 30 },
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }) as typeof fetch;

    const activated = await waitForWorkloadActivation({
      trellisUrl: "https://trellis.example.com",
      publicIdentityKey: identity.publicIdentityKey,
      nonce: "nonce_123",
      identitySeed: identity.identitySeed,
      contractDigest: "digest-a",
    });
    assertEquals(activated.status, "activated");

    globalThis.fetch = ((_input: URL | Request | string, _init?: RequestInit) => {
      return Promise.resolve(new Response(JSON.stringify({
        status: "ready",
        connectInfo: {
          instanceId: "wrk_123",
          profileId: "reader.default",
          contractId: "acme.reader@v1",
          contractDigest: "digest-a",
          transport: {
            natsServers: ["nats://127.0.0.1:4222"],
            sentinel: { jwt: "jwt", seed: "seed" },
          },
          auth: { mode: "workload_identity", iatSkewSeconds: 30 },
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }) as typeof fetch;

    const connectInfo = await getWorkloadConnectInfo({
      trellisUrl: "https://trellis.example.com",
      publicIdentityKey: identity.publicIdentityKey,
      identitySeed: identity.identitySeed,
      contractDigest: "digest-a",
      iat: 123,
    });
    assertEquals(connectInfo.status, "ready");

    let calls = 0;
    globalThis.fetch = ((_input: URL | Request | string, _init?: RequestInit) => {
      calls += 1;
      const body = calls === 1 ? { status: "pending" } : {
        status: "rejected",
        reason: "policy_denied",
      };
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }) as typeof fetch;

    await assertRejects(
      () => waitForWorkloadActivation({
        trellisUrl: "https://trellis.example.com",
        publicIdentityKey: identity.publicIdentityKey,
        nonce: "nonce_123",
        identitySeed: identity.identitySeed,
        contractDigest: "digest-a",
        pollIntervalMs: 0,
      }),
      Error,
      "workload activation rejected: policy_denied",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("workload activation client wrappers hide method strings", async () => {
  const requests: Array<{ method: string; input: unknown }> = [];
  function requestOrThrow(
    method: "Auth.ActivateWorkload",
    input: AuthActivateWorkloadInput,
    _opts?: unknown,
  ): Promise<AuthActivateWorkloadOutput>;
  function requestOrThrow(
    method: "Auth.GetWorkloadActivationStatus",
    input: AuthGetWorkloadActivationStatusInput,
    _opts?: unknown,
  ): Promise<AuthGetWorkloadActivationStatusOutput>;
  function requestOrThrow(
    method: "Auth.ListWorkloadActivations",
    input: AuthListWorkloadActivationsInput,
    _opts?: unknown,
  ): Promise<AuthListWorkloadActivationsOutput>;
  function requestOrThrow(
    method: "Auth.RevokeWorkloadActivation",
    input: AuthRevokeWorkloadActivationInput,
    _opts?: unknown,
  ): Promise<AuthRevokeWorkloadActivationResponse>;
  function requestOrThrow(
    method: "Auth.GetWorkloadConnectInfo",
    input: Record<string, unknown>,
    _opts?: unknown,
  ): Promise<GetWorkloadConnectInfoOutput>;
  async function requestOrThrow(method: string, input: unknown): Promise<unknown> {
    requests.push({ method, input });
    switch (method) {
      case "Auth.ActivateWorkload":
        return {
          status: "activated",
          instanceId: "wrk_123",
          profileId: "reader.default",
          activatedAt: "2026-04-08T12:00:00Z",
        };
      case "Auth.GetWorkloadActivationStatus":
        return {
          status: "pending_review",
          reviewId: "war_123",
          instanceId: "wrk_123",
          profileId: "reader.default",
          requestedAt: "2026-04-08T11:55:00Z",
        };
      case "Auth.ListWorkloadActivations":
        return { activations: [] };
      case "Auth.RevokeWorkloadActivation":
        return { success: true };
      case "Auth.GetWorkloadConnectInfo":
        return {
          status: "ready",
          connectInfo: {
            instanceId: "wrk_123",
            profileId: "reader.default",
            contractId: "acme.reader@v1",
            contractDigest: "digest-a",
            transport: {
              natsServers: ["nats://127.0.0.1:4222"],
              sentinel: { jwt: "jwt", seed: "seed" },
            },
            auth: { mode: "workload_identity", iatSkewSeconds: 30 },
          },
        };
      default:
        throw new Error(`Unexpected method ${method}`);
    }
  }

  const transport: WorkloadActivationTransport = {
    requestOrThrow,
  };
  const client = createWorkloadActivationClient(transport);

  assertEquals(
    await client.activateWorkload({ handoffId: "wah_123" }),
    {
      status: "activated",
      instanceId: "wrk_123",
      profileId: "reader.default",
      activatedAt: "2026-04-08T12:00:00Z",
    },
  );
  assertEquals(
    await client.getWorkloadActivationStatus({ handoffId: "wah_123" }),
    {
      status: "pending_review",
      reviewId: "war_123",
      instanceId: "wrk_123",
      profileId: "reader.default",
      requestedAt: "2026-04-08T11:55:00Z",
    },
  );
  assertEquals((await client.listWorkloadActivations()).activations, []);
  assertEquals(
    await client.revokeWorkloadActivation({ instanceId: "wrk_123" }),
    { success: true },
  );
  assertEquals(
    await client.getWorkloadConnectInfo({
      publicIdentityKey: "A".repeat(43),
      contractDigest: "digest-a",
      iat: 123,
      sig: "proof",
    }),
    {
      status: "ready",
      connectInfo: {
        instanceId: "wrk_123",
        profileId: "reader.default",
        contractId: "acme.reader@v1",
        contractDigest: "digest-a",
        transport: {
          natsServers: ["nats://127.0.0.1:4222"],
          sentinel: { jwt: "jwt", seed: "seed" },
        },
        auth: { mode: "workload_identity", iatSkewSeconds: 30 },
      },
    },
  );

  assertEquals(requests.map((entry) => entry.method), [
    "Auth.ActivateWorkload",
    "Auth.GetWorkloadActivationStatus",
    "Auth.ListWorkloadActivations",
    "Auth.RevokeWorkloadActivation",
    "Auth.GetWorkloadConnectInfo",
  ]);
});
