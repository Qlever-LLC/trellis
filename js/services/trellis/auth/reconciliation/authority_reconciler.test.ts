import { assertEquals, assertRejects } from "@std/assert";

import type {
  AuthorityPhysicalResourceManager,
} from "../../catalog/resources.ts";
import type {
  DeploymentAuthority,
  DeploymentAuthorityMaterialization,
  DeploymentAuthorityReconciliationStatus,
  DeploymentResourceBinding,
} from "../schemas.ts";
import {
  AuthorityReconciliationError,
  type AuthorityResourceMaterializer,
  createAuthorityReconciler,
  createPhysicalAuthorityResourceMaterializer,
  explicitBindingAuthorityResourceMaterializer,
} from "./authority_reconciler.ts";

type PhysicalCall =
  | { kind: "kv"; name: string; request: Record<string, unknown> }
  | { kind: "store"; name: string; request: Record<string, unknown> }
  | { kind: "jobs-infrastructure" }
  | { kind: "jobs-consumer"; stream: string; queue: Record<string, unknown> }
  | {
    kind: "event-consumer";
    request: Record<string, unknown>;
    consumerName: string;
  }
  | { kind: "delete-kv"; name: string }
  | { kind: "delete-store"; name: string }
  | { kind: "delete-consumer"; stream: string; consumerName: string };

function fakePhysicalManager(
  calls: PhysicalCall[],
): AuthorityPhysicalResourceManager {
  return {
    ensureKvBucket: async (name, request) => {
      calls.push({ kind: "kv", name, request });
      return "created";
    },
    ensureObjectStore: async (name, request) => {
      calls.push({ kind: "store", name, request });
      return "created";
    },
    ensureJobsInfrastructure: async () => {
      calls.push({ kind: "jobs-infrastructure" });
    },
    ensureJobsQueueConsumer: async (stream, queue) => {
      calls.push({ kind: "jobs-consumer", stream, queue });
      return "created";
    },
    ensureEventConsumer: async (request, consumerName) => {
      calls.push({ kind: "event-consumer", request, consumerName });
      return "created";
    },
    deleteKvBucket: async (name) => {
      calls.push({ kind: "delete-kv", name });
    },
    deleteObjectStore: async (name) => {
      calls.push({ kind: "delete-store", name });
    },
    deleteEventConsumer: async (stream, consumerName) => {
      calls.push({ kind: "delete-consumer", stream, consumerName });
    },
  };
}

function authority(
  overrides: Partial<DeploymentAuthority> = {},
): DeploymentAuthority {
  return {
    deploymentId: "svc-a",
    kind: "service",
    disabled: false,
    version: "v1",
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:01.000Z",
    desiredState: {
      needs: [
        { kind: "capability", capability: "auth.session", required: true },
        {
          kind: "surface",
          surface: {
            contractId: "svc@v1",
            kind: "rpc",
            name: "Svc.Call",
            action: "call",
          },
          required: true,
        },
        {
          kind: "resource",
          resource: { kind: "kv", alias: "cache", required: true },
          required: true,
        },
      ],
      capabilities: ["auth.admin"],
      resources: [{ kind: "kv", alias: "cache", required: true }],
      surfaces: [],
    },
    ...overrides,
  };
}

function binding(
  overrides: Partial<DeploymentResourceBinding> = {},
): DeploymentResourceBinding {
  return {
    deploymentId: "svc-a",
    kind: "kv",
    alias: "cache",
    binding: { bucket: "svc-a-cache" },
    limits: null,
    createdAt: "2026-05-07T00:00:02.000Z",
    updatedAt: "2026-05-07T00:00:02.000Z",
    ...overrides,
  };
}

function harness(input: {
  authorities?: DeploymentAuthority[];
  materialized?: DeploymentAuthorityMaterialization[];
  materializer?: AuthorityResourceMaterializer;
  physicalManager?: AuthorityPhysicalResourceManager;
} = {}) {
  const authorities = new Map(
    (input.authorities ?? [authority()]).map((record) => [
      record.deploymentId,
      record,
    ]),
  );
  const materialized = new Map(
    (input.materialized ?? []).map((record) => [record.deploymentId, record]),
  );
  const statuses: DeploymentAuthorityReconciliationStatus[] = [];
  const events: Array<{ state: string; message: string | null }> = [];
  const reconciler = createAuthorityReconciler({
    deploymentAuthorityStorage: {
      get: async (deploymentId) => authorities.get(deploymentId),
      listEnabled: async () =>
        [...authorities.values()].filter((record) => !record.disabled),
    },
    materializedAuthorityStorage: {
      get: async (deploymentId) => materialized.get(deploymentId),
      put: async (record) => {
        materialized.set(record.deploymentId, record);
      },
    },
    authorityReconciliationStorage: {
      getStatus: async (deploymentId) =>
        [...statuses].reverse().find((status) =>
          status.deploymentId === deploymentId
        ),
      putStatus: async (status) => {
        statuses.push(status);
      },
      appendEvent: async (event) => {
        events.push({ state: event.state, message: event.message });
      },
    },
    ...(input.physicalManager
      ? { physicalResources: { manager: input.physicalManager } }
      : {
        resourceMaterializer: input.materializer ?? {
          materialize: async () => [binding()],
        },
      }),
  });
  return { reconciler, materialized, statuses, events };
}

Deno.test("authority reconciler materializes desired authority", async () => {
  const { reconciler, materialized, statuses, events } = harness();

  const result = await reconciler.reconcileDeployment("svc-a", {
    desiredVersion: "v1",
  });

  assertEquals(result.authority.deploymentId, "svc-a");
  assertEquals(result.materializedAuthority.status, "current");
  assertEquals(result.materializedAuthority.desiredVersion, "v1");
  assertEquals(result.materializedAuthority.resourceBindings, [binding()]);
  assertEquals(result.materializedAuthority.grants, [
    { kind: "capability", capability: "auth.admin" },
    { kind: "capability", capability: "auth.session" },
    {
      kind: "surface",
      contractId: "svc@v1",
      surfaceKind: "rpc",
      name: "Svc.Call",
      action: "call",
    },
  ]);
  assertEquals(materialized.get("svc-a"), result.materializedAuthority);
  assertEquals(statuses.map((status) => status.state), [
    "running",
    "succeeded",
  ]);
  assertEquals(events.map((event) => event.state), ["running", "succeeded"]);
});

Deno.test("authority reconciler appends materialized nats grants", async () => {
  const { reconciler } = harness({
    materializer: { materialize: async () => [binding()] },
  });
  const withNats = createAuthorityReconciler({
    deploymentAuthorityStorage: {
      get: async () => authority(),
      listEnabled: async () => [authority()],
    },
    materializedAuthorityStorage: {
      get: async () => undefined,
      put: async () => {},
    },
    authorityReconciliationStorage: {
      getStatus: async () => undefined,
      putStatus: async () => {},
      appendEvent: async () => {},
    },
    resourceMaterializer: { materialize: async () => [binding()] },
    natsGrantMaterializer: {
      materialize: async () => [{
        kind: "nats",
        direction: "subscribe",
        subject: "rpc.v1.Svc.Call",
        surface: {
          contractId: "svc@v1",
          kind: "rpc",
          name: "Svc.Call",
          action: "call",
        },
        requiredCapabilities: [],
        grantSource: "owned-surface",
      }],
    },
  });

  await reconciler.reconcileDeployment("svc-a");
  const result = await withNats.reconcileDeployment("svc-a");

  assertEquals(result.materializedAuthority.grants.at(-1), {
    kind: "nats",
    direction: "subscribe",
    subject: "rpc.v1.Svc.Call",
    surface: {
      contractId: "svc@v1",
      kind: "rpc",
      name: "Svc.Call",
      action: "call",
    },
    requiredCapabilities: [],
    grantSource: "owned-surface",
  });
});

Deno.test("authority reconciler reconciles all enabled authorities", async () => {
  const { reconciler, materialized } = harness({
    authorities: [
      authority({ deploymentId: "svc-a" }),
      authority({ deploymentId: "svc-b", disabled: true }),
    ],
    materializer: {
      materialize: async ({ authority }) => [
        binding({ deploymentId: authority.deploymentId }),
      ],
    },
  });

  const results = await reconciler.reconcileAllEnabled();

  assertEquals(results.map((result) => result.authority.deploymentId), [
    "svc-a",
  ]);
  assertEquals(materialized.has("svc-a"), true);
  assertEquals(materialized.has("svc-b"), false);
});

Deno.test("authority reconciler validates expected desired version", async () => {
  const { reconciler } = harness();

  const error = await assertRejects(
    () => reconciler.reconcileDeployment("svc-a", { desiredVersion: "old" }),
    AuthorityReconciliationError,
  );

  assertEquals(error.code, "desired_version_mismatch");
});

Deno.test("authority reconciler records failed materialization", async () => {
  const existing = binding({ binding: { bucket: "existing" } });
  const { reconciler, materialized, statuses, events } = harness({
    materialized: [{
      deploymentId: "svc-a",
      desiredVersion: "old",
      status: "current",
      resourceBindings: [existing],
      grants: [],
      reconciledAt: "2026-05-07T00:00:01.000Z",
    }],
    materializer: {
      materialize: async () => {
        throw new Error("no physical materializer configured");
      },
    },
  });

  const result = await reconciler.reconcileDeployment("svc-a");

  assertEquals(result.materializedAuthority.status, "failed");
  assertEquals(result.materializedAuthority.resourceBindings, [existing]);
  assertEquals(
    result.materializedAuthority.error,
    "no physical materializer configured",
  );
  assertEquals(materialized.get("svc-a"), result.materializedAuthority);
  assertEquals(statuses.map((status) => status.state), ["running", "failed"]);
  assertEquals(events.map((event) => event.state), ["running", "failed"]);
});

Deno.test("default authority materializer only accepts explicit bindings", async () => {
  const explicit = authority({
    desiredState: {
      needs: [],
      capabilities: [],
      resources: [{
        kind: "kv",
        alias: "cache",
        required: true,
        definition: { binding: { bucket: "explicit-cache" } },
      }],
      surfaces: [],
    },
  });

  const materialized = await explicitBindingAuthorityResourceMaterializer
    .materialize({ authority: explicit, existingBindings: [] });

  assertEquals(materialized[0]?.binding, { bucket: "explicit-cache" });
  await assertRejects(
    () =>
      explicitBindingAuthorityResourceMaterializer.materialize({
        authority: authority(),
        existingBindings: [],
      }),
    Error,
    "definition.binding",
  );
});

Deno.test("physical authority materializer creates desired resource bindings", async () => {
  const calls: PhysicalCall[] = [];
  const materializer = createPhysicalAuthorityResourceMaterializer({
    manager: fakePhysicalManager(calls),
  });
  const desired = authority({
    desiredState: {
      needs: [],
      capabilities: [],
      resources: [
        {
          kind: "kv",
          alias: "cache",
          required: true,
          definition: { history: 3, ttlMs: 1000, maxValueBytes: 2048 },
        },
        {
          kind: "store",
          alias: "files",
          required: true,
          definition: { ttlMs: 2000, maxObjectBytes: 10, maxTotalBytes: 100 },
        },
        {
          kind: "jobs",
          alias: "sync",
          required: true,
          definition: {
            payload: { schema: "SyncPayload" },
            result: { schema: "SyncResult" },
            maxDeliver: 2,
            backoffMs: [100],
            ackWaitMs: 3000,
            concurrency: 4,
          },
        },
        {
          kind: "event-consumer",
          alias: "ingest",
          required: true,
          definition: {
            stream: "trellis",
            filterSubjects: ["events.v1.Partner.Changed.>"],
            replay: "all",
            concurrency: 2,
          },
        },
        { kind: "transfer", alias: "uploads", required: true },
      ],
      surfaces: [],
    },
  });

  const bindings = await materializer.materialize({
    authority: desired,
    existingBindings: [],
  });

  assertEquals(bindings.map((record) => `${record.kind}:${record.alias}`), [
    "event-consumer:ingest",
    "jobs:sync",
    "kv:cache",
    "store:files",
  ]);
  assertEquals(bindings.some((record) => record.kind === "transfer"), false);
  assertEquals(calls.map((call) => call.kind), [
    "event-consumer",
    "jobs-infrastructure",
    "jobs-consumer",
    "kv",
    "store",
  ]);
});

Deno.test("authority reconciler uses configured physical resource manager", async () => {
  const calls: PhysicalCall[] = [];
  const desired = authority({
    desiredState: {
      needs: [],
      capabilities: [],
      resources: [{
        kind: "kv",
        alias: "cache",
        required: true,
        definition: { history: 2 },
      }],
      surfaces: [],
    },
  });
  const { reconciler, materialized } = harness({
    authorities: [desired],
    physicalManager: fakePhysicalManager(calls),
  });

  const result = await reconciler.reconcileDeployment("svc-a");

  assertEquals(result.materializedAuthority.status, "current");
  assertEquals(materialized.get("svc-a")?.resourceBindings[0]?.kind, "kv");
  assertEquals(calls.map((call) => call.kind), ["kv"]);
});

Deno.test("physical authority materializer reuses existing names and deletes removed resources", async () => {
  const calls: PhysicalCall[] = [];
  const existingKv = binding({
    binding: { bucket: "existing-cache", history: 1, ttlMs: 0 },
  });
  const removedStore = binding({
    kind: "store",
    alias: "old-files",
    binding: { name: "old-files-store" },
  });
  const removedJobs = binding({
    kind: "jobs",
    alias: "old-job",
    binding: { workStream: "JOBS_WORK", consumerName: "old_job_consumer" },
  });
  const materializer = createPhysicalAuthorityResourceMaterializer({
    manager: fakePhysicalManager(calls),
  });
  const desired = authority({
    desiredState: {
      needs: [],
      capabilities: [],
      resources: [{
        kind: "kv",
        alias: "cache",
        required: true,
        definition: { history: 2 },
      }],
      surfaces: [],
    },
  });

  const bindings = await materializer.materialize({
    authority: desired,
    existingBindings: [existingKv, removedStore, removedJobs],
  });

  assertEquals(bindings[0]?.binding.bucket, "existing-cache");
  assertEquals(bindings[0]?.createdAt, existingKv.createdAt);
  assertEquals(calls, [
    {
      kind: "kv",
      name: "existing-cache",
      request: {
        history: 2,
        ttlMs: 0,
        required: true,
        alias: "cache",
        purpose: "",
      },
    },
    { kind: "delete-store", name: "old-files-store" },
    {
      kind: "delete-consumer",
      stream: "JOBS_WORK",
      consumerName: "old_job_consumer",
    },
  ]);
});

Deno.test("physical authority materializer rolls back newly created resources on failure", async () => {
  const calls: PhysicalCall[] = [];
  const materializer = createPhysicalAuthorityResourceMaterializer({
    manager: {
      ...fakePhysicalManager(calls),
      ensureObjectStore: async (name, request) => {
        calls.push({ kind: "store", name, request });
        throw new Error("store unavailable");
      },
    },
    provisioning: {
      resourceNameGenerator: (kind) =>
        kind === "kv" ? "named-kv" : `unused-${kind}`,
    },
  });
  const desired = authority({
    desiredState: {
      needs: [],
      capabilities: [],
      resources: [
        {
          kind: "kv",
          alias: "cache",
          required: true,
          definition: { history: 2 },
        },
        {
          kind: "store",
          alias: "files",
          required: true,
          definition: { ttlMs: 0 },
        },
      ],
      surfaces: [],
    },
  });

  await assertRejects(
    () =>
      materializer.materialize({ authority: desired, existingBindings: [] }),
    Error,
    "store unavailable",
  );

  assertEquals(calls, [
    {
      kind: "kv",
      name: "named-kv",
      request: {
        history: 2,
        ttlMs: 0,
        required: true,
        alias: "cache",
        purpose: "",
      },
    },
    {
      kind: "store",
      name: "unused-store",
      request: {
        ttlMs: 0,
        required: true,
        alias: "files",
        purpose: "",
      },
    },
    { kind: "delete-kv", name: "named-kv" },
  ]);
});
