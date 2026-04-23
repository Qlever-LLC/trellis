import { assertEquals, assertRejects } from "@std/assert";

import { deriveDeviceConfirmationCode, deriveDeviceIdentity } from "../auth.ts";
import { defineDeviceContract } from "../contract.ts";
import { checkDeviceActivation } from "./deno.ts";

const deviceContract = defineDeviceContract(() => ({
  id: "example.device@v1",
  displayName: "Example Device",
  description: "Test device contract.",
}));

const secondDeviceContract = defineDeviceContract(() => ({
  id: "example.other-device@v1",
  displayName: "Other Device",
  description: "Second test device contract.",
}));

const rootSecretA = new Uint8Array(32).fill(1);
const rootSecretB = new Uint8Array(32).fill(2);

function activationUrl(flowId: string): string {
  return `https://trellis.example.com/_trellis/portal/devices/activate?flowId=${flowId}`;
}

Deno.test("checkDeviceActivation starts activation and persists pending state when activation is required", async () => {
  const stateDir = await Deno.makeTempDir({ prefix: "trellis-device-state-" });
  let bootstrapCalls = 0;
  let activationCalls = 0;

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/device")) {
        bootstrapCalls += 1;
        return Promise.resolve(
          new Response(JSON.stringify({ status: "activation_required" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (url.endsWith("/auth/devices/activate/requests")) {
        activationCalls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              flowId: "flow_123",
              instanceId: "dev_123",
              profileId: "reader.default",
              activationUrl: activationUrl("flow_123"),
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    const status = await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });

    assertEquals(status.status, "activation_required");
    if (status.status !== "activation_required") {
      throw new Error("Expected activation to be required");
    }
    assertEquals(status.activationUrl, activationUrl("flow_123"));
    assertEquals(bootstrapCalls, 1);
    assertEquals(activationCalls, 1);

    const entries = await Array.fromAsync(Deno.readDir(stateDir));
    assertEquals(entries.length, 1);
    const persisted = JSON.parse(
      await Deno.readTextFile(`${stateDir}/${entries[0]?.name}`),
    ) as {
      version: number;
      localState: { status: string; activationUrl: string };
    };
    assertEquals(persisted.version, 1);
    assertEquals(persisted.localState.status, "pending");
    assertEquals(persisted.localState.activationUrl, activationUrl("flow_123"));
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("checkDeviceActivation retries bootstrap once on iat_out_of_range using server time", async () => {
  const stateDir = await Deno.makeTempDir({ prefix: "trellis-device-state-" });
  let bootstrapCalls = 0;
  let activationCalls = 0;

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/device")) {
        bootstrapCalls += 1;
        if (bootstrapCalls === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                reason: "iat_out_of_range",
                serverNow: 1_700_000_120,
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
        }

        return Promise.resolve(
          new Response(JSON.stringify({ status: "activation_required" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (url.endsWith("/auth/devices/activate/requests")) {
        activationCalls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              flowId: "flow_retry",
              instanceId: "dev_123",
              profileId: "reader.default",
              activationUrl: activationUrl("flow_retry"),
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    const status = await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });

    assertEquals(status.status, "activation_required");
    assertEquals(bootstrapCalls, 2);
    assertEquals(activationCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("checkDeviceActivation resumes persisted pending activation and saves activated state after offline confirmation", async () => {
  const stateDir = await Deno.makeTempDir({ prefix: "trellis-device-state-" });
  const identity = await deriveDeviceIdentity(rootSecretA);
  let activationNonce = "";
  let activationCalls = 0;

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: URL | Request | string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/device")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "activation_required" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (url.endsWith("/auth/devices/activate/requests")) {
        activationCalls += 1;
        const request = JSON.parse(String(init?.body ?? "{}")) as {
          payload?: { nonce?: string };
        };
        activationNonce = request.payload?.nonce ?? "";
        return Promise.resolve(
          new Response(
            JSON.stringify({
              flowId: "flow_456",
              instanceId: "dev_123",
              profileId: "reader.default",
              activationUrl: activationUrl("flow_456"),
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      if (url.endsWith("/auth/devices/activate/wait")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "pending" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    const first = await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });
    assertEquals(first.status, "activation_required");
    assertEquals(activationCalls, 1);

    const second = await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });
    assertEquals(second.status, "activation_required");
    if (second.status !== "activation_required") {
      throw new Error("Expected activation to be required");
    }
    assertEquals(second.activationUrl, activationUrl("flow_456"));
    assertEquals(activationCalls, 1);

    const confirmationCode = await deriveDeviceConfirmationCode({
      activationKey: identity.activationKey,
      publicIdentityKey: identity.publicIdentityKey,
      nonce: activationNonce,
    });

    const activated = await second.acceptConfirmationCode(
      confirmationCode.toLowerCase(),
    );
    assertEquals(activated.status, "activated");

    const entries = await Array.fromAsync(Deno.readDir(stateDir));
    const persisted = JSON.parse(
      await Deno.readTextFile(`${stateDir}/${entries[0]?.name}`),
    ) as { localState: { status: string } };
    assertEquals(persisted.localState.status, "activated");
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("checkDeviceActivation retries pending activation status once on iat_out_of_range using server time", async () => {
  const stateDir = await Deno.makeTempDir({ prefix: "trellis-device-state-" });
  let activationCalls = 0;
  let waitCalls = 0;

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/device")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "activation_required" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (url.endsWith("/auth/devices/activate/requests")) {
        activationCalls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              flowId: "flow_wait_retry",
              instanceId: "dev_123",
              profileId: "reader.default",
              activationUrl: activationUrl("flow_wait_retry"),
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      if (url.endsWith("/auth/devices/activate/wait")) {
        waitCalls += 1;
        if (waitCalls === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                reason: "iat_out_of_range",
                serverNow: 1_700_000_120,
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
        }

        return Promise.resolve(
          new Response(JSON.stringify({ status: "pending" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    const first = await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });
    assertEquals(first.status, "activation_required");
    assertEquals(activationCalls, 1);

    const second = await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });
    assertEquals(second.status, "activation_required");
    assertEquals(activationCalls, 1);
    assertEquals(waitCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("checkDeviceActivation waits for online approval and persists activated state", async () => {
  const stateDir = await Deno.makeTempDir({ prefix: "trellis-device-state-" });
  let waitCalls = 0;

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/device")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "activation_required" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (url.endsWith("/auth/devices/activate/requests")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              flowId: "flow_789",
              instanceId: "dev_123",
              profileId: "reader.default",
              activationUrl: activationUrl("flow_789"),
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      if (url.endsWith("/auth/devices/activate/wait")) {
        waitCalls += 1;
        if (waitCalls === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                reason: "iat_out_of_range",
                serverNow: 1_700_000_120,
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "activated",
              activatedAt: "2026-04-22T12:00:00Z",
              connectInfo: {
                instanceId: "dev_123",
                profileId: "reader.default",
                contractId: "example.device@v1",
                contractDigest: deviceContract.CONTRACT_DIGEST,
                transports: {
                  native: {
                    natsServers: ["nats://127.0.0.1:4222"],
                  },
                },
                transport: {
                  sentinel: { jwt: "jwt", seed: "seed" },
                },
                auth: {
                  mode: "device_identity",
                  iatSkewSeconds: 30,
                },
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    const status = await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });
    assertEquals(status.status, "activation_required");
    if (status.status !== "activation_required") {
      throw new Error("Expected activation to be required");
    }

    const activated = await status.waitForOnlineApproval();
    assertEquals(activated.status, "activated");
    assertEquals(waitCalls, 2);

    const entries = await Array.fromAsync(Deno.readDir(stateDir));
    const persisted = JSON.parse(
      await Deno.readTextFile(`${stateDir}/${entries[0]?.name}`),
    ) as { localState: { status: string } };
    assertEquals(persisted.localState.status, "activated");
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("checkDeviceActivation rejects ready bootstrap responses for a different contract", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/device")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "ready",
              connectInfo: {
                instanceId: "dev_123",
                profileId: "reader.default",
                contractId: secondDeviceContract.CONTRACT_ID,
                contractDigest: secondDeviceContract.CONTRACT_DIGEST,
                transports: {
                  native: {
                    natsServers: ["nats://127.0.0.1:4222"],
                  },
                },
                transport: {
                  sentinel: { jwt: "jwt", seed: "seed" },
                },
                auth: {
                  mode: "device_identity",
                  iatSkewSeconds: 30,
                },
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    await assertRejects(
      () =>
        checkDeviceActivation({
          trellisUrl: "https://trellis.example.com",
          contract: deviceContract,
          rootSecret: rootSecretA,
        }),
      Error,
      "Trellis activation status returned connection details for a different contract.",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("checkDeviceActivation returns activated on repeated completion actions without rerunning side effects", async () => {
  const stateDir = await Deno.makeTempDir({ prefix: "trellis-device-state-" });
  const identity = await deriveDeviceIdentity(rootSecretA);
  let activationNonce = "";
  let waitCalls = 0;

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: URL | Request | string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/device")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "activation_required" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (url.endsWith("/auth/devices/activate/requests")) {
        const request = JSON.parse(String(init?.body ?? "{}")) as {
          payload?: { nonce?: string };
        };
        activationNonce = request.payload?.nonce ?? "";
        return Promise.resolve(
          new Response(
            JSON.stringify({
              flowId: "flow_repeat",
              instanceId: "dev_123",
              profileId: "reader.default",
              activationUrl: activationUrl("flow_repeat"),
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      if (url.endsWith("/auth/devices/activate/wait")) {
        waitCalls += 1;
        return Promise.resolve(
          new Response(JSON.stringify({ status: "pending" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    const status = await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });
    assertEquals(status.status, "activation_required");
    if (status.status !== "activation_required") {
      throw new Error("Expected activation to be required");
    }

    const confirmationCode = await deriveDeviceConfirmationCode({
      activationKey: identity.activationKey,
      publicIdentityKey: identity.publicIdentityKey,
      nonce: activationNonce,
    });

    assertEquals(
      await status.acceptConfirmationCode(confirmationCode.toLowerCase()),
      { status: "activated" },
    );
    assertEquals(await status.acceptConfirmationCode("invalid-code"), {
      status: "activated",
    });
    assertEquals(await status.waitForOnlineApproval(), { status: "activated" });
    assertEquals(waitCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("checkDeviceActivation does not report activated if persistence fails during completion", async () => {
  const stateDir = await Deno.makeTempDir({ prefix: "trellis-device-state-" });
  const identity = await deriveDeviceIdentity(rootSecretA);
  let activationNonce = "";

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: URL | Request | string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/device")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "activation_required" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (url.endsWith("/auth/devices/activate/requests")) {
        const request = JSON.parse(String(init?.body ?? "{}")) as {
          payload?: { nonce?: string };
        };
        activationNonce = request.payload?.nonce ?? "";
        return Promise.resolve(
          new Response(
            JSON.stringify({
              flowId: "flow_persist_fail",
              instanceId: "dev_123",
              profileId: "reader.default",
              activationUrl: activationUrl("flow_persist_fail"),
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      if (url.endsWith("/auth/devices/activate/wait")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "activated",
              activatedAt: "2026-04-22T12:00:00Z",
              connectInfo: {
                instanceId: "dev_123",
                profileId: "reader.default",
                contractId: "example.device@v1",
                contractDigest: deviceContract.CONTRACT_DIGEST,
                transports: {
                  native: {
                    natsServers: ["nats://127.0.0.1:4222"],
                  },
                },
                transport: {
                  sentinel: { jwt: "jwt", seed: "seed" },
                },
                auth: {
                  mode: "device_identity",
                  iatSkewSeconds: 30,
                },
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    const status = await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });
    assertEquals(status.status, "activation_required");
    if (status.status !== "activation_required") {
      throw new Error("Expected activation to be required");
    }

    const entries = await Array.fromAsync(Deno.readDir(stateDir));
    const statePath = `${stateDir}/${entries[0]?.name}`;
    await Deno.remove(statePath);
    await Deno.mkdir(statePath);

    const confirmationCode = await deriveDeviceConfirmationCode({
      activationKey: identity.activationKey,
      publicIdentityKey: identity.publicIdentityKey,
      nonce: activationNonce,
    });

    await assertRejects(
      () => status.acceptConfirmationCode(confirmationCode.toLowerCase()),
      Error,
    );
    await assertRejects(() => status.waitForOnlineApproval(), Error);
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("checkDeviceActivation rejects online activation completion for a different contract", async () => {
  const stateDir = await Deno.makeTempDir({ prefix: "trellis-device-state-" });

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/device")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "activation_required" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (url.endsWith("/auth/devices/activate/requests")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              flowId: "flow_wrong_contract",
              instanceId: "dev_123",
              profileId: "reader.default",
              activationUrl: activationUrl("flow_wrong_contract"),
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      if (url.endsWith("/auth/devices/activate/wait")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "activated",
              activatedAt: "2026-04-22T12:00:00Z",
              connectInfo: {
                instanceId: "dev_123",
                profileId: "reader.default",
                contractId: secondDeviceContract.CONTRACT_ID,
                contractDigest: secondDeviceContract.CONTRACT_DIGEST,
                transports: {
                  native: {
                    natsServers: ["nats://127.0.0.1:4222"],
                  },
                },
                transport: {
                  sentinel: { jwt: "jwt", seed: "seed" },
                },
                auth: {
                  mode: "device_identity",
                  iatSkewSeconds: 30,
                },
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    const status = await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });
    assertEquals(status.status, "activation_required");
    if (status.status !== "activation_required") {
      throw new Error("Expected activation to be required");
    }

    await assertRejects(
      () => status.waitForOnlineApproval(),
      Error,
      "Trellis activation status returned connection details for a different contract.",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("checkDeviceActivation returns activated for ready devices and upgrades persisted pending state", async () => {
  const stateDir = await Deno.makeTempDir({ prefix: "trellis-device-state-" });
  let activationCalls = 0;
  let ready = false;

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/device")) {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              ready
                ? {
                  status: "ready",
                  connectInfo: {
                    instanceId: "dev_123",
                    profileId: "reader.default",
                    contractId: "example.device@v1",
                    contractDigest: deviceContract.CONTRACT_DIGEST,
                    transports: {
                      native: {
                        natsServers: ["nats://127.0.0.1:4222"],
                      },
                    },
                    transport: {
                      sentinel: { jwt: "jwt", seed: "seed" },
                    },
                    auth: {
                      mode: "device_identity",
                      iatSkewSeconds: 30,
                    },
                  },
                }
                : { status: "activation_required" },
            ),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      if (url.endsWith("/auth/devices/activate/requests")) {
        activationCalls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              flowId: "flow_ready",
              instanceId: "dev_123",
              profileId: "reader.default",
              activationUrl: activationUrl("flow_ready"),
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    const first = await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });
    assertEquals(first.status, "activation_required");
    assertEquals(activationCalls, 1);

    ready = true;

    const second = await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });
    assertEquals(second.status, "activated");

    const entries = await Array.fromAsync(Deno.readDir(stateDir));
    const persisted = JSON.parse(
      await Deno.readTextFile(`${stateDir}/${entries[0]?.name}`),
    ) as { localState: { status: string } };
    assertEquals(persisted.localState.status, "activated");
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("checkDeviceActivation refreshes stale pending activation when the saved flow was rejected", async () => {
  const stateDir = await Deno.makeTempDir({ prefix: "trellis-device-state-" });
  let activationCalls = 0;

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/device")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "activation_required" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (url.endsWith("/auth/devices/activate/wait")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "rejected",
              reason: "device_flow_expired",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      if (url.endsWith("/auth/devices/activate/requests")) {
        activationCalls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              flowId: activationCalls === 1 ? "flow_old" : "flow_new",
              instanceId: "dev_123",
              profileId: "reader.default",
              activationUrl: activationUrl(
                activationCalls === 1 ? "flow_old" : "flow_new",
              ),
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    const first = await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });
    assertEquals(first.status, "activation_required");
    assertEquals(activationCalls, 1);

    const refreshed = await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });
    assertEquals(refreshed.status, "activation_required");
    if (refreshed.status !== "activation_required") {
      throw new Error("Expected activation to be required");
    }
    assertEquals(refreshed.activationUrl, activationUrl("flow_new"));
    assertEquals(activationCalls, 2);

    const entries = await Array.fromAsync(Deno.readDir(stateDir));
    const persisted = JSON.parse(
      await Deno.readTextFile(`${stateDir}/${entries[0]?.name}`),
    ) as { localState: { status: string; activationUrl: string } };
    assertEquals(persisted.localState.status, "pending");
    assertEquals(persisted.localState.activationUrl, activationUrl("flow_new"));
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("checkDeviceActivation preserves bootstrap not_ready responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/device")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ status: "not_ready", reason: "review_pending" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    const status = await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
    });
    assertEquals(status, { status: "not_ready", reason: "review_pending" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("checkDeviceActivation surfaces pending activation contract digest changes as not_ready", async () => {
  const stateDir = await Deno.makeTempDir({ prefix: "trellis-device-state-" });
  let activationCalls = 0;

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/device")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "activation_required" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (url.endsWith("/auth/devices/activate/requests")) {
        activationCalls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              flowId: "flow_not_ready",
              instanceId: "dev_123",
              profileId: "reader.default",
              activationUrl: activationUrl("flow_not_ready"),
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      if (url.endsWith("/auth/devices/activate/wait")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ reason: "contract_digest_not_allowed" }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    const first = await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });
    assertEquals(first.status, "activation_required");
    assertEquals(activationCalls, 1);

    const second = await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });
    assertEquals(second, {
      status: "not_ready",
      reason: "contract_digest_not_allowed",
    });
    assertEquals(activationCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("checkDeviceActivation keys state files by deployment origin and device identity", async () => {
  const stateDir = await Deno.makeTempDir({ prefix: "trellis-device-state-" });

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/device")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "activation_required" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (url.endsWith("/auth/devices/activate/requests")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              flowId: crypto.randomUUID(),
              instanceId: "dev_123",
              profileId: "reader.default",
              activationUrl: activationUrl("flow_keyed"),
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      if (url.endsWith("/auth/devices/activate/wait")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "pending" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com/bootstrap/device",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });
    await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com/another/path",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });
    await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com/another/path",
      contract: deviceContract,
      rootSecret: rootSecretB,
      stateDir,
    });
    await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com/another/path",
      contract: secondDeviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });
    await checkDeviceActivation({
      trellisUrl: "https://second.example.com/another/path",
      contract: deviceContract,
      rootSecret: rootSecretA,
      stateDir,
    });

    const entries = await Array.fromAsync(Deno.readDir(stateDir));
    assertEquals(entries.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("checkDeviceActivation rejects overridden statePath data for a different device identity", async () => {
  const stateDir = await Deno.makeTempDir({ prefix: "trellis-device-state-" });
  const statePath = `${stateDir}/activation-state.json`;

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/device")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "activation_required" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (url.endsWith("/auth/devices/activate/requests")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              flowId: "flow_shared",
              instanceId: "dev_123",
              profileId: "reader.default",
              activationUrl: activationUrl("flow_shared"),
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
      statePath,
    });

    await assertRejects(
      () =>
        checkDeviceActivation({
          trellisUrl: "https://trellis.example.com",
          contract: deviceContract,
          rootSecret: rootSecretB,
          statePath,
        }),
      Error,
      "Stored Trellis device activation state does not match the provided root secret.",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(stateDir, { recursive: true });
  }
});

Deno.test("checkDeviceActivation rejects overridden statePath data for a different contract digest", async () => {
  const stateDir = await Deno.makeTempDir({ prefix: "trellis-device-state-" });
  const statePath = `${stateDir}/activation-state.json`;

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      if (url.endsWith("/bootstrap/device")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "activation_required" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (url.endsWith("/auth/devices/activate/requests")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              flowId: "flow_contract_shared",
              instanceId: "dev_123",
              profileId: "reader.default",
              activationUrl: activationUrl("flow_contract_shared"),
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    await checkDeviceActivation({
      trellisUrl: "https://trellis.example.com",
      contract: deviceContract,
      rootSecret: rootSecretA,
      statePath,
    });

    await assertRejects(
      () =>
        checkDeviceActivation({
          trellisUrl: "https://trellis.example.com",
          contract: secondDeviceContract,
          rootSecret: rootSecretA,
          statePath,
        }),
      Error,
      "Stored Trellis device activation state does not match the requested contract digest.",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(stateDir, { recursive: true });
  }
});
