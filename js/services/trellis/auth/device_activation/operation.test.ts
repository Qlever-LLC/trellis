import { assert, assertEquals } from "@std/assert";
import { AsyncResult, isErr } from "@qlever-llc/result";

import { createResolveDeviceUserAuthoritiesHandler } from "./operation.ts";
import type { Config } from "../../config.ts";
import { createTestContracts } from "../../catalog/test_contracts.ts";

type ResolveDeviceUserAuthoritiesDeps = Parameters<
  typeof createResolveDeviceUserAuthoritiesHandler
>[0];
type ResolveDeviceUserAuthoritiesContext = Parameters<
  ReturnType<typeof createResolveDeviceUserAuthoritiesHandler>
>[0];
type ReviewRecord = Parameters<
  ResolveDeviceUserAuthoritiesDeps["deviceActivationReviewStorage"]["put"]
>[0];
type ActivationRecord = Parameters<
  ResolveDeviceUserAuthoritiesDeps["deviceActivationStorage"]["put"]
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
    jetstream: { replicas: 1 },
    trellis: { credsPath: "" },
    auth: { credsPath: "" },
    system: { credsPath: "" },
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
  expiresAtMs: number;
  existingReview?: ReviewRecord;
  activation?: ActivationRecord;
  reviews?: ReviewRecord[];
  publishes?: Array<{ event: string; payload: unknown }>;
  reviewMode?: "none" | "required";
  reviewReads?: Array<ReviewRecord | undefined>;
  activationReads?: Array<ActivationRecord | undefined>;
}): ResolveDeviceUserAuthoritiesDeps {
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
    contracts: createTestContracts(),
    deviceActivationReviewStorage: {
      getByFlowId: async () => {
        args.reviewReads?.push(review);
        return review;
      },
      put: async (record) => {
        review = record;
        args.reviews?.push(record);
      },
    },
    deviceActivationStorage: {
      get: async () => {
        args.activationReads?.push(activation);
        return activation;
      },
      put: async (record) => {
        activation = record;
      },
    },
    deviceDeploymentStorage: {
      get: async () => ({
        deploymentId: "reader.default",
        reviewMode: args.reviewMode ?? "required",
        disabled: false,
      }),
    },
    deploymentEnvelopeStorage: {
      get: async () => undefined,
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
    trellis: {
      publish: (event, payload) => {
        args.publishes?.push({ event, payload });
        return AsyncResult.ok(undefined);
      },
    },
    config,
    reviewWaitTiming: {
      now: args.now,
    },
  };
}

function operationContext(
  progress: unknown[],
): ResolveDeviceUserAuthoritiesContext {
  return {
    input: { flowId: "flow_1" },
    caller: { type: "user", origin: "github", id: "user_1" },
    op: {
      id: "op_activate_1",
      started: async () => {},
      progress: async (value) => {
        progress.push(value);
      },
      defer: () => ({ kind: "deferred" as const }),
    },
  };
}

Deno.test("Auth.DeviceUserAuthorities.Resolve pending review stores source operation id", async () => {
  let nowMs = baseTimeMs;
  const reviews: ReviewRecord[] = [];
  const progress: unknown[] = [];
  const deps = makeDeps({
    now: () => nowMs,
    expiresAtMs: baseTimeMs + 1,
    reviews,
  });

  const result = await createResolveDeviceUserAuthoritiesHandler(deps)(
    operationContext(progress),
  );

  assertEquals(result, { kind: "deferred" });
  assertEquals(reviews.length, 1);
  assertEquals(reviews[0].operationId, "op_activate_1");
});

Deno.test("Auth.DeviceUserAuthorities.Resolve publishes requested before review requested", async () => {
  const publishes: Array<{ event: string; payload: unknown }> = [];
  const progress: unknown[] = [];
  const deps = makeDeps({
    now: () => baseTimeMs,
    expiresAtMs: baseTimeMs + 60_000,
    publishes,
  });

  const result = await createResolveDeviceUserAuthoritiesHandler(deps)(
    operationContext(progress),
  );

  assertEquals(result, { kind: "deferred" });
  assertEquals(publishes.map((entry) => entry.event), [
    "Auth.DeviceUserAuthorities.Requested",
    "Auth.DeviceUserAuthorities.ReviewRequested",
  ]);
  assertEquals(publishes[0].payload, {
    flowId: "flow_1",
    instanceId: "dev_1",
    publicIdentityKey: "pub_1",
    deploymentId: "reader.default",
    requestedAt: new Date(baseTimeMs).toISOString(),
    requestedBy: { origin: "github", id: "user_1" },
  });
});

Deno.test("Auth.DeviceUserAuthorities.Resolve pending review records progress without local polling", async () => {
  const progress: unknown[] = [];
  const activationReads: Array<ActivationRecord | undefined> = [];
  const deps = makeDeps({
    now: () => baseTimeMs,
    expiresAtMs: baseTimeMs + 60_000,
    activationReads,
  });

  const result = await createResolveDeviceUserAuthoritiesHandler(deps)(
    operationContext(progress),
  );

  assertEquals(result, { kind: "deferred" });
  assertEquals(progress.length, 1);
  assertEquals(activationReads.length, 1);
});

Deno.test("Auth.DeviceUserAuthorities.Resolve existing pending review records progress without local polling", async () => {
  const progress: unknown[] = [];
  const publishes: Array<{ event: string; payload: unknown }> = [];
  const review: ReviewRecord = {
    reviewId: "dar_1",
    operationId: "op_activate_1",
    flowId: "flow_1",
    instanceId: "dev_1",
    publicIdentityKey: "pub_1",
    deploymentId: "reader.default",
    requestedBy: { origin: "github", id: "user_1" },
    state: "pending",
    requestedAt: new Date(baseTimeMs).toISOString(),
    decidedAt: null,
  };
  const activationReads: Array<ActivationRecord | undefined> = [];
  const deps = makeDeps({
    now: () => baseTimeMs,
    expiresAtMs: baseTimeMs + 60_000,
    existingReview: review,
    activationReads,
    publishes,
  });

  const result = await createResolveDeviceUserAuthoritiesHandler(deps)(
    operationContext(progress),
  );

  assertEquals(result, { kind: "deferred" });
  assertEquals(progress, [{
    status: "pending_review",
    reviewId: "dar_1",
    instanceId: "dev_1",
    deploymentId: "reader.default",
    requestedAt: new Date(baseTimeMs).toISOString(),
  }]);
  assertEquals(activationReads.length, 1);
  assertEquals(publishes, []);
});

Deno.test("Auth.DeviceUserAuthorities.Resolve activates immediately when review is not required", async () => {
  const progress: unknown[] = [];
  const publishes: Array<{ event: string; payload: unknown }> = [];
  const deps = makeDeps({
    now: () => baseTimeMs,
    expiresAtMs: baseTimeMs + 60_000,
    reviewMode: "none",
    publishes,
  });

  const result = await createResolveDeviceUserAuthoritiesHandler(deps)(
    operationContext(progress),
  );

  assert("take" in result);
  const value = result.take();
  if (isErr(value)) throw value.error;
  assert(value.status === "activated");
  assertEquals(value.instanceId, "dev_1");
  assertEquals(value.deploymentId, "reader.default");
  assertEquals(progress, []);
  assertEquals(publishes.map((entry) => entry.event), [
    "Auth.DeviceUserAuthorities.Requested",
    "Auth.DeviceUserAuthorities.Resolved",
  ]);
  assertEquals(publishes[1].payload, {
    instanceId: "dev_1",
    publicIdentityKey: "pub_1",
    deploymentId: "reader.default",
    resolvedAt: value.activatedAt,
    resolvedBy: { origin: "github", id: "user_1" },
    flowId: "flow_1",
  });
});

Deno.test("Auth.DeviceUserAuthorities.Resolve publishes activation for already-approved review", async () => {
  const progress: unknown[] = [];
  const publishes: Array<{ event: string; payload: unknown }> = [];
  const deps = makeDeps({
    now: () => baseTimeMs,
    expiresAtMs: baseTimeMs + 60_000,
    existingReview: {
      reviewId: "dar_1",
      operationId: "op_activate_1",
      flowId: "flow_1",
      instanceId: "dev_1",
      publicIdentityKey: "pub_1",
      deploymentId: "reader.default",
      requestedBy: { origin: "github", id: "user_1" },
      state: "approved",
      requestedAt: new Date(baseTimeMs).toISOString(),
      decidedAt: new Date(baseTimeMs + 1_000).toISOString(),
    },
    publishes,
  });

  const result = await createResolveDeviceUserAuthoritiesHandler(deps)(
    operationContext(progress),
  );

  assert("take" in result);
  const value = result.take();
  if (isErr(value)) throw value.error;
  assert(value.status === "activated");
  assertEquals(publishes.map((entry) => entry.event), [
    "Auth.DeviceUserAuthorities.Resolved",
  ]);
  assertEquals(publishes[0].payload, {
    instanceId: "dev_1",
    publicIdentityKey: "pub_1",
    deploymentId: "reader.default",
    resolvedAt: value.activatedAt,
    resolvedBy: { origin: "github", id: "user_1" },
    flowId: "flow_1",
    reviewId: "dar_1",
  });
});

Deno.test("Auth.DeviceUserAuthorities.Resolve returns already-terminal rejected review", async () => {
  const progress: unknown[] = [];
  const publishes: Array<{ event: string; payload: unknown }> = [];
  const deps = makeDeps({
    now: () => baseTimeMs,
    expiresAtMs: baseTimeMs + 60_000,
    existingReview: {
      reviewId: "dar_1",
      operationId: "op_activate_1",
      flowId: "flow_1",
      instanceId: "dev_1",
      publicIdentityKey: "pub_1",
      deploymentId: "reader.default",
      requestedBy: { origin: "github", id: "user_1" },
      state: "rejected",
      requestedAt: new Date(baseTimeMs).toISOString(),
      decidedAt: new Date(baseTimeMs + 1_000).toISOString(),
      reason: "not expected",
    },
    publishes,
  });

  const result = await createResolveDeviceUserAuthoritiesHandler(deps)(
    operationContext(progress),
  );

  assert("take" in result);
  const value = result.take();
  if (isErr(value)) throw value.error;
  assertEquals(value, { status: "rejected", reason: "not expected" });
  assertEquals(progress, []);
  assertEquals(publishes, []);
});
