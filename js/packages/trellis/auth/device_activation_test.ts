import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import { AsyncResult } from "@qlever-llc/result";

import {
  buildDeviceActivationPayload,
  buildDeviceWaitProofInput,
  createDeviceActivationClient,
  createDeviceNatsAuthToken,
  deriveDeviceConfirmationCode,
  deriveDeviceIdentity,
  encodeDeviceActivationPayload,
  getDeviceConnectInfo,
  parseDeviceActivationPayload,
  signDeviceWaitRequest,
  startDeviceActivationRequest,
  verifyDeviceConfirmationCode,
  verifyDeviceWaitSignature,
  waitForDeviceActivation,
  type AuthActivateDeviceInput,
  type AuthActivateDeviceOutput,
  type AuthGetDeviceActivationStatusInput,
  type AuthGetDeviceActivationStatusOutput,
  type AuthListDeviceActivationsInput,
  type AuthListDeviceActivationsOutput,
  type AuthRevokeDeviceActivationInput,
  type AuthRevokeDeviceActivationResponse,
  type DeviceActivationTransport,
  type GetDeviceConnectInfoOutput,
} from "./device_activation.ts";
import { importEd25519PublicKeyFromBase64url } from "./keys.ts";
import { base64urlDecode, sha256, toArrayBuffer } from "./utils.ts";

function okResult<T>(value: T) {
  return {
    take: () => value,
  };
}

Deno.test("device activation payload helpers round-trip encoded payloads", async () => {
  const identity = await deriveDeviceIdentity(new Uint8Array(32).fill(7));
  const payload = await buildDeviceActivationPayload({
    activationKey: identity.activationKey,
    publicIdentityKey: identity.publicIdentityKey,
    nonce: "nonce_123",
  });

  const encoded = encodeDeviceActivationPayload(payload);
  assertEquals(parseDeviceActivationPayload(encoded), payload);
});

Deno.test("device activation start requests return short flow URLs", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (_input, _init) => new Response(JSON.stringify({
      flowId: "flow_123",
      instanceId: "dev_123",
      profileId: "reader.default",
      activationUrl: "https://trellis.example.com/_trellis/portal/activate?flowId=flow_123",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    const identity = await deriveDeviceIdentity(new Uint8Array(32).fill(7));
    const payload = await buildDeviceActivationPayload({
      activationKey: identity.activationKey,
      publicIdentityKey: identity.publicIdentityKey,
      nonce: "nonce_123",
    });
    const response = await startDeviceActivationRequest({
      trellisUrl: "https://trellis.example.com/base",
      payload,
    });
    assertEquals(response.flowId, "flow_123");
    assertEquals(
      response.activationUrl,
      "https://trellis.example.com/_trellis/portal/activate?flowId=flow_123",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("device wait helpers sign requests and verify confirmation codes", async () => {
  const identity = await deriveDeviceIdentity(new Uint8Array(32).fill(9));
  const waitRequest = await signDeviceWaitRequest({
    publicIdentityKey: identity.publicIdentityKey,
    nonce: "nonce_123",
    identitySeed: identity.identitySeed,
    iat: 123,
  });

  assertEquals(waitRequest.publicIdentityKey, identity.publicIdentityKey);
  assertEquals(waitRequest.nonce, "nonce_123");
  assertEquals(waitRequest.iat, 123);
  assert(waitRequest.sig.length > 0);

  const confirmationCode = await deriveDeviceConfirmationCode({
    activationKey: identity.activationKey,
    publicIdentityKey: identity.publicIdentityKey,
    nonce: "nonce_123",
  });
  assertEquals(confirmationCode.length, 8);
  assert(await verifyDeviceConfirmationCode({
    activationKey: identity.activationKey,
    publicIdentityKey: identity.publicIdentityKey,
    nonce: "nonce_123",
    confirmationCode: confirmationCode.toLowerCase(),
  }));

  const natsAuthToken = await createDeviceNatsAuthToken({
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

Deno.test("device wait signatures are computed over the hashed proof input", async () => {
  const identity = await deriveDeviceIdentity(new Uint8Array(32).fill(11));
  const waitRequest = await signDeviceWaitRequest({
    publicIdentityKey: identity.publicIdentityKey,
    nonce: "nonce_456",
    identitySeed: identity.identitySeed,
    iat: 456,
  });

  assert(await verifyDeviceWaitSignature(waitRequest));

  const publicKey = await importEd25519PublicKeyFromBase64url(identity.publicIdentityKey);
  const proofInput = buildDeviceWaitProofInput(
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

Deno.test("device activation wait and connect-info helpers parse responses", async () => {
  const originalFetch = globalThis.fetch;
  const identity = await deriveDeviceIdentity(new Uint8Array(32).fill(5));

  try {
    globalThis.fetch = ((_input: URL | Request | string, _init?: RequestInit) => {
      return Promise.resolve(new Response(JSON.stringify({
        status: "activated",
        activatedAt: "2026-04-08T12:00:00Z",
        connectInfo: {
          instanceId: "dev_123",
          profileId: "reader.default",
          contractId: "acme.reader@v1",
          contractDigest: "digest-a",
          transports: {
            native: { natsServers: ["nats://127.0.0.1:4222"] },
          },
          transport: {
            sentinel: { jwt: "jwt", seed: "seed" },
          },
          auth: { mode: "device_identity", iatSkewSeconds: 30 },
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }) as typeof fetch;

    const activated = await waitForDeviceActivation({
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
          instanceId: "dev_123",
          profileId: "reader.default",
          contractId: "acme.reader@v1",
          contractDigest: "digest-a",
          transports: {
            native: { natsServers: ["nats://127.0.0.1:4222"] },
          },
          transport: {
            sentinel: { jwt: "jwt", seed: "seed" },
          },
          auth: { mode: "device_identity", iatSkewSeconds: 30 },
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }) as typeof fetch;

    const connectInfo = await getDeviceConnectInfo({
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
      () => waitForDeviceActivation({
        trellisUrl: "https://trellis.example.com",
        publicIdentityKey: identity.publicIdentityKey,
        nonce: "nonce_123",
        identitySeed: identity.identitySeed,
        contractDigest: "digest-a",
        pollIntervalMs: 0,
      }),
      Error,
      "device activation rejected: policy_denied",
    );

    globalThis.fetch = ((_input: URL | Request | string, _init?: RequestInit) => {
      return Promise.resolve(new Response(JSON.stringify({
        reason: "contract_digest_not_allowed",
      }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }));
    }) as typeof fetch;

    await assertRejects(
      () => waitForDeviceActivation({
        trellisUrl: "https://trellis.example.com",
        publicIdentityKey: identity.publicIdentityKey,
        nonce: "nonce_123",
        identitySeed: identity.identitySeed,
        contractDigest: "digest-a",
        pollIntervalMs: 0,
      }),
      Error,
      "device activation wait failed: 403 contract_digest_not_allowed",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("device activation wait retries transient fetch failures", async () => {
  const originalFetch = globalThis.fetch;
  const identity = await deriveDeviceIdentity(new Uint8Array(32).fill(6));
  let calls = 0;

  try {
    globalThis.fetch = ((_: URL | Request | string, _init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new TypeError("connection refused"));
      }
      return Promise.resolve(new Response(JSON.stringify({
        status: "activated",
        activatedAt: "2026-04-08T12:00:00Z",
        connectInfo: {
          instanceId: "dev_123",
          profileId: "reader.default",
          contractId: "acme.reader@v1",
          contractDigest: "digest-a",
          transports: {
            native: { natsServers: ["nats://127.0.0.1:4222"] },
          },
          transport: {
            sentinel: { jwt: "jwt", seed: "seed" },
          },
          auth: { mode: "device_identity", iatSkewSeconds: 30 },
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }) as typeof fetch;

    const activated = await waitForDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      publicIdentityKey: identity.publicIdentityKey,
      nonce: "nonce_123",
      identitySeed: identity.identitySeed,
      contractDigest: "digest-a",
      pollIntervalMs: 0,
    });

    assertEquals(activated.status, "activated");
    assertEquals(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("device activation client wrappers hide method strings", async () => {
  const requests: Array<{ method: string; input: unknown }> = [];
  function request(
    method: "Auth.ActivateDevice",
    input: AuthActivateDeviceInput,
    _opts?: unknown,
  ): AsyncResult<AuthActivateDeviceOutput, never>;
  function request(
    method: "Auth.GetDeviceActivationStatus",
    input: AuthGetDeviceActivationStatusInput,
    _opts?: unknown,
  ): AsyncResult<AuthGetDeviceActivationStatusOutput, never>;
  function request(
    method: "Auth.ListDeviceActivations",
    input: AuthListDeviceActivationsInput,
    _opts?: unknown,
  ): AsyncResult<AuthListDeviceActivationsOutput, never>;
  function request(
    method: "Auth.RevokeDeviceActivation",
    input: AuthRevokeDeviceActivationInput,
    _opts?: unknown,
  ): AsyncResult<AuthRevokeDeviceActivationResponse, never>;
  function request(
    method: "Auth.GetDeviceConnectInfo",
    input: Record<string, unknown>,
    _opts?: unknown,
  ): AsyncResult<GetDeviceConnectInfoOutput, never>;
  function request(method: string, input: unknown): AsyncResult<unknown, never> {
    requests.push({ method, input });
    switch (method) {
      case "Auth.ActivateDevice":
        return AsyncResult.ok({
          status: "activated",
          instanceId: "dev_123",
          profileId: "reader.default",
          activatedAt: "2026-04-08T12:00:00Z",
        });
      case "Auth.GetDeviceActivationStatus":
        return AsyncResult.ok({
          status: "pending_review",
          reviewId: "dar_123",
          linkRequestId: "link_123",
          instanceId: "dev_123",
          profileId: "reader.default",
          requestedAt: "2026-04-08T11:55:00Z",
        });
      case "Auth.ListDeviceActivations":
        return AsyncResult.ok({ activations: [] });
      case "Auth.RevokeDeviceActivation":
        return AsyncResult.ok({ success: true });
      case "Auth.GetDeviceConnectInfo":
        return AsyncResult.ok({
          status: "ready",
          connectInfo: {
            instanceId: "dev_123",
            profileId: "reader.default",
            contractId: "acme.reader@v1",
            contractDigest: "digest-a",
            transports: {
              native: { natsServers: ["nats://127.0.0.1:4222"] },
            },
            transport: {
              sentinel: { jwt: "jwt", seed: "seed" },
            },
            auth: { mode: "device_identity", iatSkewSeconds: 30 },
          },
        });
      default:
        throw new Error(`Unexpected method ${method}`);
    }
  }

  const transport: DeviceActivationTransport = {
    request,
  };
  const client = createDeviceActivationClient(transport);

  assertEquals(
    await client.activateDevice({ flowId: "flow_123", linkRequestId: "link_123" }),
    {
      status: "activated",
      instanceId: "dev_123",
      profileId: "reader.default",
      activatedAt: "2026-04-08T12:00:00Z",
    },
  );
  const pendingStatus = await client.getDeviceActivationStatus({ flowId: "flow_123" });
  if (pendingStatus.status !== "pending_review") {
    throw new Error(`Expected pending_review status, received ${pendingStatus.status}`);
  }
  assertEquals(pendingStatus.linkRequestId, "link_123");
  assertEquals(pendingStatus, {
    status: "pending_review",
    reviewId: "dar_123",
    linkRequestId: "link_123",
    instanceId: "dev_123",
    profileId: "reader.default",
    requestedAt: "2026-04-08T11:55:00Z",
  });
  assertEquals((await client.listDeviceActivations()).activations, []);
  assertEquals(
    await client.revokeDeviceActivation({ instanceId: "dev_123" }),
    { success: true },
  );
  assertEquals(
    await client.getDeviceConnectInfo({
      publicIdentityKey: "A".repeat(43),
      contractDigest: "digest-a",
      iat: 123,
      sig: "proof",
    }),
    {
      status: "ready",
      connectInfo: {
        instanceId: "dev_123",
        profileId: "reader.default",
        contractId: "acme.reader@v1",
        contractDigest: "digest-a",
        transports: {
          native: { natsServers: ["nats://127.0.0.1:4222"] },
        },
        transport: {
          sentinel: { jwt: "jwt", seed: "seed" },
        },
        auth: { mode: "device_identity", iatSkewSeconds: 30 },
      },
    },
  );

  assertEquals(requests.map((entry) => entry.method), [
    "Auth.ActivateDevice",
    "Auth.GetDeviceActivationStatus",
    "Auth.ListDeviceActivations",
    "Auth.RevokeDeviceActivation",
    "Auth.GetDeviceConnectInfo",
  ]);
});
