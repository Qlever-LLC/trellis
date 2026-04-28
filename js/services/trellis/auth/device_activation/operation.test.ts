import { assert, assertEquals } from "@std/assert";
import { AsyncResult, isErr } from "@qlever-llc/result";

import { createActivateDeviceHandler } from "./operation.ts";
import type { Config } from "../../config.ts";

type ActivateDeviceDeps = Parameters<typeof createActivateDeviceHandler>[0];
type ActivateDeviceContext = Parameters<
  ReturnType<typeof createActivateDeviceHandler>
>[0];
type ReviewRecord = Parameters<
  ActivateDeviceDeps["deviceActivationReviewStorage"]["put"]
>[0];
type ActivationRecord = Parameters<
  ActivateDeviceDeps["deviceActivationStorage"]["put"]
>[0];

const baseTimeMs = Date.parse("2026-01-01T00:00:00.000Z");

const config: Config = {
  logLevel: "info",
  port: 3000,
  instanceName: "Trellis",
  web: { origins: [], allowInsecureOrigins: [] },
  httpRateLimit: { windowMs: 60_000, max: 0 },
  storage: { dbPath: ":memory:" },
  ttlMs: {
    sessions: 1,
    oauth: 1,
    deviceFlow: 1,
    pendingAuth: 1,
    connections: 1,
    natsJwt: 1,
  },
  nats: {
    servers: "nats://127.0.0.1:4222",
    trellis: { credsPath: "" },
    auth: { credsPath: "" },
    sentinelCredsPath: "",
    authCallout: {
      issuer: { nkey: "issuer", signing: "issuer-seed" },
      target: { nkey: "target", signing: "target-seed" },
      sxSeed: "sx-seed",
    },
  },
  sessionKeySeed: "session-seed",
  client: { natsServers: ["ws://127.0.0.1:9222"] },
  oauth: {
    redirectBase: "http://localhost:3000",
    alwaysShowProviderChooser: false,
    providers: {},
  },
};

function makeDeps(args: {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  expiresAtMs: number;
  existingReview?: ReviewRecord;
  activation?: ActivationRecord;
}): ActivateDeviceDeps {
  let review = args.existingReview;
  let activation = args.activation;

  return {
    browserFlowsKV: {
      get: () =>
        AsyncResult.ok({
          value: {
            flowId: "flow_1",
            kind: "device_activation",
            deviceActivation: {
              instanceId: "dev_1",
              deploymentId: "reader.default",
              publicIdentityKey: "pub_1",
              nonce: "nonce_1",
              qrMac: "mac_1",
            },
            createdAt: new Date(baseTimeMs).toISOString(),
            expiresAt: new Date(args.expiresAtMs).toISOString(),
          },
        }),
    },
    deviceActivationReviewStorage: {
      getByFlowId: async () => review,
      put: async (record) => {
        review = record;
      },
    },
    deviceActivationStorage: {
      get: async () => activation,
      put: async (record) => {
        activation = record;
      },
    },
    deviceDeploymentStorage: {
      get: async () => ({
        deploymentId: "reader.default",
        appliedContracts: [{ contractId: "reader@v1", allowedDigests: ["d1"] }],
        reviewMode: "required",
        disabled: false,
      }),
    },
    deviceInstanceStorage: {
      get: async () => ({
        instanceId: "dev_1",
        publicIdentityKey: "pub_1",
        deploymentId: "reader.default",
        state: "registered",
        createdAt: new Date(baseTimeMs).toISOString(),
        activatedAt: null,
        revokedAt: null,
      }),
      put: async () => {},
    },
    deviceProvisioningSecretStorage: { get: async () => undefined },
    logger: { trace: () => {}, warn: () => {} },
    sentinelCreds: { jwt: "jwt", seed: "seed" },
    trellis: { publish: () => AsyncResult.ok(undefined) },
    config,
    reviewWaitTiming: {
      now: args.now,
      sleep: args.sleep,
      pollIntervalMs: 1_000,
    },
  };
}

function operationContext(progress: unknown[]): ActivateDeviceContext {
  return {
    input: { flowId: "flow_1" },
    caller: { type: "user", origin: "github", id: "user_1" },
    op: {
      started: async () => {},
      progress: async (value) => {
        progress.push(value);
      },
    },
  };
}

Deno.test("Auth.ActivateDevice pending review wait is bounded by flow expiry", async () => {
  let nowMs = baseTimeMs;
  const sleeps: number[] = [];
  const progress: unknown[] = [];
  const deps = makeDeps({
    now: () => nowMs,
    expiresAtMs: baseTimeMs + 2_500,
    sleep: async (ms) => {
      sleeps.push(ms);
      nowMs += ms;
    },
  });

  const result = await createActivateDeviceHandler(deps)(
    operationContext(progress),
  );

  assert(!result.isErr());
  assertEquals(result.take(), {
    status: "rejected",
    reason: "device_flow_expired",
  });
  assertEquals(sleeps, [1_000, 1_000, 500]);
  assertEquals(progress.length, 1);
});

Deno.test("Auth.ActivateDevice pending review observes external activation deterministically", async () => {
  let nowMs = baseTimeMs;
  const sleeps: number[] = [];
  const progress: unknown[] = [];
  let activation: ActivationRecord | undefined;
  const review: ReviewRecord = {
    reviewId: "dar_1",
    flowId: "flow_1",
    instanceId: "dev_1",
    publicIdentityKey: "pub_1",
    deploymentId: "reader.default",
    requestedBy: { origin: "github", id: "user_1" },
    state: "pending",
    requestedAt: new Date(baseTimeMs).toISOString(),
    decidedAt: null,
  };
  const deps = makeDeps({
    now: () => nowMs,
    expiresAtMs: baseTimeMs + 10_000,
    existingReview: review,
    sleep: async (ms) => {
      sleeps.push(ms);
      nowMs += ms;
      activation = {
        instanceId: "dev_1",
        publicIdentityKey: "pub_1",
        deploymentId: "reader.default",
        activatedBy: { origin: "github", id: "user_1" },
        state: "activated",
        activatedAt: new Date(nowMs).toISOString(),
        revokedAt: null,
      };
    },
  });
  const depsWithActivation = {
    ...deps,
    deviceActivationStorage: {
      ...deps.deviceActivationStorage,
      get: async () => activation,
    },
  };

  const result = await createActivateDeviceHandler(depsWithActivation)(
    operationContext(progress),
  );

  const value = result.take();
  if (isErr(value)) throw value.error;
  assertEquals(value, {
    status: "activated",
    instanceId: "dev_1",
    deploymentId: "reader.default",
    activatedAt: new Date(baseTimeMs + 1_000).toISOString(),
  });
  assertEquals(sleeps, [1_000]);
  assertEquals(progress, [{
    status: "pending_review",
    reviewId: "dar_1",
    instanceId: "dev_1",
    deploymentId: "reader.default",
    requestedAt: new Date(baseTimeMs).toISOString(),
  }]);
});
