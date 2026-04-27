import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import { AsyncResult } from "@qlever-llc/result";
import type {
  OperationEvent,
  OperationSnapshot,
  TerminalOperation,
} from "../operations.ts";

import {
  type AuthActivateDeviceInput,
  type AuthActivateDeviceOperation,
  type AuthActivateDeviceOutput,
  type AuthActivateDeviceProgress,
  type AuthListDeviceActivationsInput,
  type AuthListDeviceActivationsOutput,
  type AuthRevokeDeviceActivationInput,
  type AuthRevokeDeviceActivationResponse,
  buildDeviceActivationPayload,
  buildDeviceWaitProofInput,
  createDeviceActivationClient,
  createDeviceNatsAuthToken,
  deriveDeviceConfirmationCode,
  deriveDeviceIdentity,
  type DeviceActivationTransport,
  encodeDeviceActivationPayload,
  getDeviceConnectInfo,
  type GetDeviceConnectInfoOutput,
  parseDeviceActivationPayload,
  signDeviceWaitRequest,
  startDeviceActivationRequest,
  verifyDeviceConfirmationCode,
  verifyDeviceWaitSignature,
  waitForDeviceActivation,
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
    globalThis.fetch = (async (_input, _init) =>
      new Response(
        JSON.stringify({
          flowId: "flow_123",
          instanceId: "dev_123",
          deploymentId: "reader.default",
          activationUrl:
            "https://trellis.example.com/_trellis/portal/devices/activate?flowId=flow_123",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )) as typeof fetch;

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
      "https://trellis.example.com/_trellis/portal/devices/activate?flowId=flow_123",
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
    contractDigest: "digest-a",
    iat: 123,
  });

  assertEquals(waitRequest.publicIdentityKey, identity.publicIdentityKey);
  assertEquals(waitRequest.nonce, "nonce_123");
  assertEquals(waitRequest.contractDigest, "digest-a");
  assertEquals(waitRequest.iat, 123);
  assert(waitRequest.sig.length > 0);
  assert(await verifyDeviceWaitSignature(waitRequest));
  assertFalse(
    await verifyDeviceWaitSignature({
      ...waitRequest,
      contractDigest: "digest-b",
    }),
  );

  const confirmationCode = await deriveDeviceConfirmationCode({
    activationKey: identity.activationKey,
    publicIdentityKey: identity.publicIdentityKey,
    nonce: "nonce_123",
  });
  assertEquals(confirmationCode.length, 8);
  assert(
    await verifyDeviceConfirmationCode({
      activationKey: identity.activationKey,
      publicIdentityKey: identity.publicIdentityKey,
      nonce: "nonce_123",
      confirmationCode: confirmationCode.toLowerCase(),
    }),
  );

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
    contractDigest: "digest-a",
    iat: 456,
  });

  assert(await verifyDeviceWaitSignature(waitRequest));

  const publicKey = await importEd25519PublicKeyFromBase64url(
    identity.publicIdentityKey,
  );
  const proofInput = buildDeviceWaitProofInput(
    identity.publicIdentityKey,
    waitRequest.nonce,
    waitRequest.iat,
    waitRequest.contractDigest,
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
    globalThis.fetch =
      ((_input: URL | Request | string, _init?: RequestInit) => {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "activated",
              activatedAt: "2026-04-08T12:00:00Z",
              connectInfo: {
                instanceId: "dev_123",
                deploymentId: "reader.default",
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
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }) as typeof fetch;

    const activated = await waitForDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      publicIdentityKey: identity.publicIdentityKey,
      nonce: "nonce_123",
      identitySeed: identity.identitySeed,
      contractDigest: "digest-a",
    });
    assertEquals(activated.status, "activated");

    globalThis.fetch =
      ((_input: URL | Request | string, _init?: RequestInit) => {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "ready",
              connectInfo: {
                instanceId: "dev_123",
                deploymentId: "reader.default",
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
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
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
    globalThis.fetch =
      ((_input: URL | Request | string, _init?: RequestInit) => {
        calls += 1;
        const body = calls === 1 ? { status: "pending" } : {
          status: "rejected",
          reason: "policy_denied",
        };
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }) as typeof fetch;

    await assertRejects(
      () =>
        waitForDeviceActivation({
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

    globalThis.fetch =
      ((_input: URL | Request | string, _init?: RequestInit) => {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              reason: "contract_digest_not_allowed",
            }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }) as typeof fetch;

    await assertRejects(
      () =>
        waitForDeviceActivation({
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
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: "activated",
            activatedAt: "2026-04-08T12:00:00Z",
            connectInfo: {
              instanceId: "dev_123",
              deploymentId: "reader.default",
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
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
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

Deno.test("device activation wait backs off after rate limiting", async () => {
  const originalFetch = globalThis.fetch;
  const identity = await deriveDeviceIdentity(new Uint8Array(32).fill(7));
  let calls = 0;

  try {
    globalThis.fetch = ((_: URL | Request | string, _init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(
          new Response("Too many requests", { status: 429 }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: "activated",
            activatedAt: "2026-04-08T12:00:00Z",
            connectInfo: {
              instanceId: "dev_123",
              deploymentId: "reader.default",
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
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
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
  const calls: Array<
    { kind: "operation" | "request"; method: string; input: unknown }
  > = [];
  function operation(method: "Auth.ActivateDevice") {
    return {
      input(input: AuthActivateDeviceInput) {
        calls.push({ kind: "operation", method, input });
        return {
          start(): AsyncResult<AuthActivateDeviceOperation, never> {
            return AsyncResult.ok({
              id: "op_123",
              service: "trellis",
              operation: method,
              get() {
                return AsyncResult.ok(
                  {
                    id: "op_123",
                    service: "trellis",
                    operation: method,
                    revision: 1,
                    state: "completed",
                    createdAt: "2026-04-08T11:55:00Z",
                    updatedAt: "2026-04-08T12:00:00Z",
                    completedAt: "2026-04-08T12:00:00Z",
                    output: {
                      status: "activated",
                      instanceId: "dev_123",
                      deploymentId: "reader.default",
                      activatedAt: "2026-04-08T12:00:00Z",
                    },
                  } satisfies OperationSnapshot<
                    unknown,
                    AuthActivateDeviceOutput
                  >,
                );
              },
              wait() {
                return AsyncResult.ok(
                  {
                    id: "op_123",
                    service: "trellis",
                    operation: method,
                    revision: 1,
                    state: "completed",
                    createdAt: "2026-04-08T11:55:00Z",
                    updatedAt: "2026-04-08T12:00:00Z",
                    completedAt: "2026-04-08T12:00:00Z",
                    output: {
                      status: "activated",
                      instanceId: "dev_123",
                      deploymentId: "reader.default",
                      activatedAt: "2026-04-08T12:00:00Z",
                    },
                  } satisfies TerminalOperation<
                    AuthActivateDeviceProgress,
                    AuthActivateDeviceOutput
                  >,
                );
              },
              watch() {
                return AsyncResult.ok((async function* (): AsyncIterable<
                  OperationEvent<
                    AuthActivateDeviceProgress,
                    AuthActivateDeviceOutput
                  >
                > {
                  yield {
                    type: "progress" as const,
                    progress: {
                      status: "pending_review" as const,
                      reviewId: "dar_123",
                      instanceId: "dev_123",
                      deploymentId: "reader.default",
                      requestedAt: "2026-04-08T11:55:00Z",
                    },
                    snapshot: {
                      id: "op_123",
                      service: "trellis",
                      operation: method,
                      revision: 1,
                      state: "running" as const,
                      createdAt: "2026-04-08T11:55:00Z",
                      updatedAt: "2026-04-08T11:55:00Z",
                      progress: {
                        status: "pending_review" as const,
                        reviewId: "dar_123",
                        instanceId: "dev_123",
                        deploymentId: "reader.default",
                        requestedAt: "2026-04-08T11:55:00Z",
                      },
                    },
                  };
                })());
              },
            });
          },
        };
      },
    };
  }
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
  function request(
    method: string,
    input: unknown,
  ): AsyncResult<unknown, never> {
    calls.push({ kind: "request", method, input });
    switch (method) {
      case "Auth.ListDeviceActivations":
        return AsyncResult.ok({ activations: [] });
      case "Auth.RevokeDeviceActivation":
        return AsyncResult.ok({ success: true });
      case "Auth.GetDeviceConnectInfo":
        return AsyncResult.ok({
          status: "ready",
          connectInfo: {
            instanceId: "dev_123",
            deploymentId: "reader.default",
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
    operation,
    request,
  };
  const client = createDeviceActivationClient(transport);

  const activation = await client.activateDevice({ flowId: "flow_123" });
  assertEquals(activation.id, "op_123");

  const watch = await activation.watch().orThrow();
  const watchEvents = [] as Array<{
    type: string;
    progress?: AuthActivateDeviceProgress;
  }>;
  for await (const event of watch) {
    watchEvents.push({
      type: event.type,
      ...(event.type === "progress" ? { progress: event.progress } : {}),
    });
  }
  assertEquals(watchEvents, [{
    type: "progress",
    progress: {
      status: "pending_review",
      reviewId: "dar_123",
      instanceId: "dev_123",
      deploymentId: "reader.default",
      requestedAt: "2026-04-08T11:55:00Z",
    },
  }]);

  const pendingStatus = await activation.wait().orThrow();
  if (pendingStatus.output?.status !== "activated") {
    throw new Error(
      `Expected activated output, received ${
        pendingStatus.output?.status ?? "missing"
      }`,
    );
  }
  assertEquals(pendingStatus.output, {
    status: "activated",
    instanceId: "dev_123",
    deploymentId: "reader.default",
    activatedAt: "2026-04-08T12:00:00Z",
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
        deploymentId: "reader.default",
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

  assertEquals(calls.map((entry) => [entry.kind, entry.method]), [
    ["operation", "Auth.ActivateDevice"],
    ["request", "Auth.ListDeviceActivations"],
    ["request", "Auth.RevokeDeviceActivation"],
    ["request", "Auth.GetDeviceConnectInfo"],
  ]);
});
