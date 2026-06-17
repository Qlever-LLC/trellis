import { assertEquals } from "@std/assert";
import type { NatsConnection } from "@nats-io/nats-core";
import { Result } from "@qlever-llc/result";
import { Type } from "typebox";

import {
  type ConnectedTrellisClient,
  defineAppContract,
  defineDeviceContract,
  defineServiceContract,
  type HandlerTrellis,
  type TrellisAPI,
  TrellisClient,
  TrellisDevice,
  type TrellisErrorInstance,
} from "../index.ts";
import { checkDeviceActivation } from "../device/deno.ts";
import { API as CORE_API, type Client as CoreClient } from "../sdk/core.ts";
import type { Client as HealthClient } from "../sdk/health.ts";
import type {
  HandlerClient as HealthHandlerClient,
} from "../../../../generated/packages/jsr/health/client.ts";
import { sdk as jobs } from "../sdk/jobs.ts";
import { TrellisService } from "../service/deno.ts";
import type {
  SqlExecutor,
  TrellisServiceSqlOutboxOptions,
} from "../service/mod.ts";
import { StoreHandle } from "../server/mod.ts";
import {
  type RpcHandlerContext,
  Trellis,
  type TrellisAuth,
  type TrellisOpts,
} from "../trellis.ts";

// @ts-expect-error root package does not expose the raw runtime class.
import type { Trellis as RootTrellis } from "../index.ts";

const selectionSchemas = {
  Empty: Type.Object({}),
  SelectedOutput: Type.Object({ value: Type.String() }),
  HiddenOutput: Type.Object({ hidden: Type.Boolean() }),
} as const;

const selectionContract = defineServiceContract(
  { schemas: selectionSchemas },
  (ref) => ({
    id: "trellis.connect-typing-selection@v1",
    displayName: "Connect Typing Selection Service",
    description: "Expose multiple RPCs for selected-use typing tests.",
    rpc: {
      "Selection.Selected": {
        version: "v1",
        input: ref.schema("Empty"),
        output: ref.schema("SelectedOutput"),
        errors: [],
      },
      "Selection.Hidden": {
        version: "v1",
        input: ref.schema("Empty"),
        output: ref.schema("HiddenOutput"),
        errors: [],
      },
    },
  }),
);

const appUses = {
  required: {
    jobs: jobs.use({
      rpc: { call: ["Jobs.List", "Jobs.ListServices"] },
    }),
    selection: selectionContract.use({
      rpc: { call: ["Selection.Selected"] },
    }),
  },
} as const;

const appContract = defineAppContract(
  {
    schemas: {
      Preferences: Type.Object({ theme: Type.String() }),
    },
  },
  (ref) => ({
    id: "trellis.connect-typing-app@v1",
    displayName: "Connect Typing App",
    description: "Typecheck the public client connect helper.",
    uses: appUses,
    state: {
      preferences: { kind: "value", schema: ref.schema("Preferences") },
    },
  }),
);

const deviceContract = defineDeviceContract(() => ({
  id: "trellis.connect-typing-device@v1",
  displayName: "Connect Typing Device",
  description: "Typecheck the public device connect helper.",
}));

const serviceSchemas = {
  PingInput: Type.Object({ value: Type.String() }),
  PingOutput: Type.Object({ ok: Type.Boolean() }),
  ServiceChanged: Type.Object({
    id: Type.String(),
    value: Type.String(),
  }),
  SyncPayload: Type.Object({ id: Type.String() }),
  SyncResult: Type.Object({ ok: Type.Boolean() }),
  RebuildInput: Type.Object({ id: Type.String() }),
  RebuildProgress: Type.Object({ step: Type.String() }),
  RebuildOutput: Type.Object({ ok: Type.Boolean() }),
} as const;

const serviceCapabilities = {
  sync: {
    displayName: "Sync service data",
    description: "Start service synchronization workflows.",
  },
} as const;

const serviceContract = defineServiceContract(
  { schemas: serviceSchemas },
  (ref) => ({
    id: "trellis.connect-typing-service@v1",
    displayName: "Connect Typing Service",
    description: "Typecheck the public service connect helper.",
    capabilities: serviceCapabilities,
    rpc: {
      "Service.Ping": {
        version: "v1",
        input: ref.schema("PingInput"),
        output: ref.schema("PingOutput"),
        errors: [],
      },
    },
    events: {
      "Service.Changed": {
        version: "v1",
        params: ["/id"],
        event: ref.schema("ServiceChanged"),
      },
    },
    operations: {
      "Service.Rebuild": {
        version: "v1",
        input: ref.schema("RebuildInput"),
        progress: ref.schema("RebuildProgress"),
        output: ref.schema("RebuildOutput"),
        capabilities: { call: ["sync"] },
        cancel: true,
      },
    },
    jobs: {
      sync: {
        payload: ref.schema("SyncPayload"),
        result: ref.schema("SyncResult"),
      },
    },
  }),
);

const generatedStyleOwnedApi = {
  rpc: serviceContract.API.owned.rpc,
  operations: {
    "Service.Rebuild": {
      ...serviceContract.API.owned.operations["Service.Rebuild"],
      progress: serviceContract.API.owned.operations["Service.Rebuild"]
        .progress!,
      output: serviceContract.API.owned.operations["Service.Rebuild"].output!,
      callerCapabilities: ["trellis.connect-typing-service::sync"] as const,
      cancel: true,
    },
  },
  events: serviceContract.API.owned.events,
  feeds: serviceContract.API.owned.feeds,
  subjects: serviceContract.API.owned.subjects,
} satisfies TrellisAPI;

type GeneratedOptionalOperationProgress<TDesc> = TDesc extends {
  progress: infer TProgress;
} ? { progress?: TProgress }
  : { progress?: undefined };
type GeneratedOptionalOperationOutput<TDesc> = TDesc extends {
  output: infer TOutput;
} ? { output?: TOutput }
  : { output?: undefined };
type GeneratedOptionalOperationIO<TDesc> = TDesc extends { input: infer TInput }
  ?
    & Omit<TDesc, "input" | "progress" | "output">
    & {
      input: TInput;
    }
    & GeneratedOptionalOperationProgress<TDesc>
    & GeneratedOptionalOperationOutput<TDesc>
  : TDesc;
type GeneratedOperationApi<TApi> = {
  readonly [K in keyof TApi]: GeneratedOptionalOperationIO<TApi[K]>;
};
type GeneratedOwnedApi = Omit<typeof generatedStyleOwnedApi, "operations"> & {
  operations: GeneratedOperationApi<
    typeof generatedStyleOwnedApi["operations"]
  >;
};
type GeneratedApi = {
  rpc: GeneratedOwnedApi["rpc"];
  operations: GeneratedOwnedApi["operations"];
  events: GeneratedOwnedApi["events"];
  feeds: GeneratedOwnedApi["feeds"];
  subjects: GeneratedOwnedApi["subjects"];
};
type GeneratedHandlerClient = HandlerTrellis<GeneratedApi>;
type GeneratedServicePingHandlerResult = Result<
  { ok: boolean },
  TrellisErrorInstance
>;
type GeneratedServicePingHandler = (
  args: {
    input: { value: string };
    context: RpcHandlerContext;
    client: GeneratedHandlerClient;
  },
) =>
  | GeneratedServicePingHandlerResult
  | Promise<GeneratedServicePingHandlerResult>;

const label = "bound";
const generatedStylePingHandler: GeneratedServicePingHandler = (
  { input, client },
) => {
  const id = `${label}:${input.value}`;
  void client.operation.service.rebuild.start({ id });
  return Result.ok({ ok: id.length > 0 });
};

declare const connectedAppClient: ConnectedTrellisClient<typeof appContract>;
declare const coreClient: CoreClient;
declare const natsConnection: NatsConnection;
declare const sqlExecutor: SqlExecutor;
declare const trellisAuth: TrellisAuth;

async function typecheckClientConnectRequestSurface() {
  const connected = connectedAppClient;
  // @ts-expect-error connected clients do not expose raw NATS handles
  const rawNats = connected.natsConnection;

  const me = await connected.request("Auth.Sessions.Me", {}).orThrow();
  const deviceId: string | undefined = me.device?.deviceId;
  const participantKind: "app" | "agent" | "device" | "service" =
    me.participantKind;
  type ClientMethod = Parameters<typeof connected.request>[0];
  const authMeMethod: ClientMethod = "Auth.Sessions.Me";
  const selectedMethod: ClientMethod = "Selection.Selected";

  const selected = await connected.request("Selection.Selected", {}).orThrow();
  const selectedValue: string = selected.value;
  // @ts-expect-error selected output must be concrete, not any.
  const selectedOutputCheck: number = selected;

  const jobsResult = await connected.request("Jobs.List", { limit: 8 })
    .orThrow();
  const jobCount: number = jobsResult.entries.length;
  // @ts-expect-error generated SDK request output must be concrete, not any.
  const jobsOutputCheck: number = jobsResult;

  const preferences = await connected.state.preferences.get().orThrow();
  if (!("migrationRequired" in preferences) && preferences.found) {
    const theme: string = preferences.entry.value.theme;
    // @ts-expect-error declared state values must preserve schema-derived fields
    const missingField: number = preferences.entry.value.missingField;
    return { authMeMethod, deviceId, missingField, participantKind, theme };
  }
  await connected.state.preferences.put({ theme: "dark" }).orThrow();

  // @ts-expect-error value state stores do not expose map-only list
  const invalidStateList = connected.state.preferences.list;

  // @ts-expect-error undeclared RPC methods must not typecheck
  const invalidMethod: ClientMethod = "Auth.NotDeclared";
  // @ts-expect-error unselected dependency RPCs must not typecheck
  const hiddenMethod: ClientMethod = "Selection.Hidden";
  // @ts-expect-error unselected dependency RPCs must not be callable
  const hiddenResult = connected.request("Selection.Hidden", {});
  // @ts-expect-error unselected generated SDK RPCs must not be callable
  const hiddenJobsResult = connected.request("Jobs.Cancel", { id: "job" });

  return {
    authMeMethod,
    hiddenMethod,
    hiddenResult,
    hiddenJobsResult,
    jobCount,
    jobsOutputCheck,
    deviceId,
    invalidMethod,
    invalidStateList,
    participantKind,
    selectedMethod,
    selectedOutputCheck,
    selectedValue,
    rawNats,
  };
}

async function typecheckTrellisClientConnectRequestSurface() {
  const connected = await TrellisClient.connect({
    trellisUrl: "https://trellis.example",
    contract: appContract,
  }).orThrow();
  // @ts-expect-error connected clients do not expose raw NATS handles
  const rawNats = connected.natsConnection;

  const me = await connected.request("Auth.Sessions.Me", {}).orThrow();
  const participantKind: "app" | "agent" | "device" | "service" =
    me.participantKind;
  const preferences = await connected.state.preferences.get().orThrow();
  if (!("migrationRequired" in preferences) && preferences.found) {
    const theme: string = preferences.entry.value.theme;
    // @ts-expect-error declared state values must preserve schema-derived fields
    const missingField: number = preferences.entry.value.missingField;
    return { missingField, participantKind, theme };
  }

  type ClientMethod = Parameters<typeof connected.request>[0];
  const authMeMethod: ClientMethod = "Auth.Sessions.Me";
  const selectedMethod: ClientMethod = "Selection.Selected";
  const selected = await connected.request("Selection.Selected", {}).orThrow();
  const selectedValue: string = selected.value;
  // @ts-expect-error selected output must be concrete, not any.
  const selectedOutputCheck: number = selected;

  const jobsResult = await connected.request("Jobs.List", { limit: 8 })
    .orThrow();
  const jobCount: number = jobsResult.entries.length;
  // @ts-expect-error generated SDK request output must be concrete, not any.
  const jobsOutputCheck: number = jobsResult;

  // @ts-expect-error undeclared RPC methods must not typecheck
  const invalidMethod: ClientMethod = "Auth.NotDeclared";
  // @ts-expect-error unselected dependency RPCs must not typecheck
  const hiddenMethod: ClientMethod = "Selection.Hidden";
  // @ts-expect-error unselected dependency RPCs must not be callable
  const hiddenResult = connected.request("Selection.Hidden", {});
  // @ts-expect-error unselected generated SDK RPCs must not be callable
  const hiddenJobsResult = connected.request("Jobs.Cancel", { id: "job" });

  return {
    authMeMethod,
    hiddenMethod,
    hiddenResult,
    hiddenJobsResult,
    invalidMethod,
    jobCount,
    jobsOutputCheck,
    participantKind,
    rawNats,
    selectedMethod,
    selectedOutputCheck,
    selectedValue,
  };
}

async function typecheckDeviceConnectRequestSurface() {
  const connected = await TrellisDevice.connect({
    trellisUrl: "https://trellis.example",
    contract: deviceContract,
    rootSecret: new Uint8Array([1]),
  }).orThrow();
  // @ts-expect-error connected devices do not expose raw NATS handles
  const rawNats = connected.natsConnection;

  const me = await connected.request("Auth.Sessions.Me", {}).orThrow();
  const deviceId: string | undefined = me.device?.deviceId;
  const participantKind: "app" | "agent" | "device" | "service" =
    me.participantKind;
  type DeviceMethod = Parameters<typeof connected.request>[0];
  const authMeMethod: DeviceMethod = "Auth.Sessions.Me";

  return { authMeMethod, deviceId, participantKind, rawNats };
}

async function typecheckDeviceActivationSurface() {
  const activation = await checkDeviceActivation({
    trellisUrl: "https://trellis.example",
    contract: deviceContract,
    rootSecret: new Uint8Array([1]),
  });

  if (activation.status === "activation_required") {
    const pendingStatus: "activation_required" = activation.status;
    const activationUrl: string = activation.activationUrl;

    const resumed = await activation.waitForOnlineApproval();
    const activatedStatus: "activated" = resumed.status;

    // @ts-expect-error activation details must stay hidden from callers
    const localState = activation.localState;

    return { pendingStatus, activationUrl, activatedStatus, localState };
  }

  if (activation.status === "not_ready") {
    const reason: string = activation.reason;
    return { reason };
  }

  const activatedStatus: "activated" = activation.status;

  void TrellisDevice.connect({
    trellisUrl: "https://trellis.example",
    contract: deviceContract,
    rootSecret: new Uint8Array([1]),
    // @ts-expect-error callback-based activation was removed from connect
    onActivationRequired: async () => {},
  });

  // @ts-expect-error root TrellisDevice no longer exposes activation helpers
  const startActivation = TrellisDevice.startActivation;

  return { activatedStatus, startActivation };
}

async function typecheckServiceConnectSurface() {
  const service = await TrellisService.connect({
    trellisUrl: "https://trellis.example",
    contract: serviceContract,
    name: "svc",
    sessionKeySeed: "test-session-seed",
    server: {},
  }).orThrow();
  // @ts-expect-error connected services do not expose raw NATS handles
  const rawNats = service.nc;

  await service.event.service.changed.listen(
    () => Result.ok(undefined),
    {},
    { group: "primary" },
  );
  await service.event.service.changed.listen(
    (_event, context) => {
      const subject: string = context.subject;
      return Result.ok(subject.length > 0 ? undefined : undefined);
    },
    {},
    { mode: "ephemeral" },
  );
  await service.handle.rpc.service.ping(({ input, client }) => {
    const value: string = input.value;
    client.event.service.changed.prepare({ id: "one", value });
    void client.event.service.changed.publish({ id: "one", value });
    // @ts-expect-error handler-injected clients cannot subscribe to lifecycle events
    void client.event.service.changed.listen(() => {});
    // @ts-expect-error handler-injected clients cannot use raw event listeners
    void client.listenEvent("Service.Changed", {}, () => {});
    return Result.ok({ ok: true });
  });

  const deps = { label: "bound" };
  await service.handle.rpc.service.ping(({ input, client }) => {
    const value: string = input.value;
    const label: string = deps.label;
    client.event.service.changed.prepare({ id: "one", value: label });
    return Result.ok({ ok: value.length > 0 });
  });
  await service.handle.rpc.service.ping(generatedStylePingHandler);
  await service.event.service.changed.listen(
    (event, context) => {
      const id: string = event.id;
      const subject: string = context.subject;
      const label = deps.label;
      void { id, subject, label };
      return Result.ok(subject.length > 0 ? undefined : undefined);
    },
    {},
    { mode: "ephemeral" },
  );

  return { rawNats, serviceName: service.name };
}

async function typecheckServiceSqlOutboxSurface() {
  const service = await TrellisService.connect({
    trellisUrl: "https://trellis.example",
    contract: serviceContract,
    name: "svc",
    sessionKeySeed: "test-session-seed",
    server: {},
  }).orThrow();
  const sqlOutbox: TrellisServiceSqlOutboxOptions<{ writes: string[] }> = {
    dialect: "sqlite",
    executor: sqlExecutor,
    transaction: async (work) =>
      await work({ tx: { writes: [] }, executor: sqlExecutor }),
  };

  const outbox = service.createSqlOutbox(sqlOutbox);
  const deps = { label: "bound", outbox };

  await service.handle.rpc.service.ping(async ({ input, client }) => {
    await deps.outbox.transaction(async ({ tx, event }) => {
      tx.writes.push(input.value);
      await event.service.changed.enqueue({
        id: "one",
        value: deps.label,
      }).orThrow();
      // @ts-expect-error transaction-scoped enqueue must validate payload shape
      await event.service.changed.enqueue({ id: "missing-value" }).orThrow();
    }).orThrow();

    await deps.outbox.transaction(async ({ tx, event, job }) => {
      tx.writes.push(input.value);
      const submission = await job.sync.create({ id: input.value }).orThrow();

      const id: string = submission.submissionId;
      const jobId: string = submission.jobId;
      const queue: string = submission.queue;
      const mode: "create" | "submit" = submission.mode;

      await job.sync.submit({ id: "other" }).orThrow();

      void { id, jobId, queue, mode };

      // @ts-expect-error bad payload shape
      await job.sync.create({ wrongField: true }).orThrow();
    }).orThrow();

    return Result.ok({ ok: true });
  });
  await service.handle.rpc.service.ping(generatedStylePingHandler);

  await service.event.service.changed.listen(
    async (event, context) => {
      const id: string = event.id;
      const subject: string = context.subject;
      await deps.outbox.transaction(async ({ tx, event }) => {
        tx.writes.push(`${id}:${subject}`);
        await event.service.changed.enqueue({
          id,
          value: deps.label,
        }).orThrow();
      }).orThrow();
      return Result.ok(undefined);
    },
  );

  service.jobs.sync.handle(async ({ job, client }) => {
    const id: string = job.payload.id;
    await deps.outbox.transaction(async ({ tx, event }) => {
      tx.writes.push(id);
      await event.service.changed.enqueue({ id, value: "job" }).orThrow();
    }).orThrow();
    return Result.ok({ ok: true });
  });

  // @ts-expect-error event facade must not expose durable enqueue
  await service.event.service.changed.enqueue({
    id: "one",
    value: "two",
  });

  // @ts-expect-error global event facade must not expose durable enqueue
  await service.event.service.changed.enqueue({ id: "one", value: "two" });

  return service.name;
}

function typecheckGeneratedServiceHandlerClientSurface(
  client: HealthClient,
  handlerClient: HealthHandlerClient,
) {
  void client.event.health.heartbeat.listen(() => Result.ok(undefined));
  const prepare = handlerClient.event.health.heartbeat.prepare;
  const publish = handlerClient.event.health.heartbeat.publish;
  // @ts-expect-error generated handler clients cannot register listeners
  const listen = handlerClient.event.health.heartbeat.listen;

  return { prepare, publish, listen };
}

function typecheckResolvedRuntimeBindingsAreNotPublicAuthoringSurface() {
  const publicOpts: TrellisOpts<typeof serviceContract.API.owned> = {
    api: serviceContract.API.owned,
    // @ts-expect-error resolved event consumer bindings are internal runtime state
    eventConsumers: {},
  };

  new Trellis("client", natsConnection, trellisAuth, {
    api: serviceContract.API.owned,
    // @ts-expect-error public Trellis constructor must not accept resolved bindings
    eventConsumers: {},
  });

  // @ts-expect-error StoreHandle instances are provisioned by TrellisService
  new StoreHandle(natsConnection, { name: "objects", ttlMs: 0 });

  // @ts-expect-error TrellisService instances are created by connect/bootstrap
  new TrellisService();

  TrellisService.connect({
    trellisUrl: "https://trellis.example",
    contract: serviceContract,
    name: "svc",
    sessionKeySeed: "test-session-seed",
    server: {},
    // @ts-expect-error public TrellisService.connect does not expose runtime deps injection
  }, { connect: async () => natsConnection });

  return publicOpts;
}

function typecheckGeneratedCoreInternalRpcSurface() {
  const descriptor = CORE_API.owned.rpc["Trellis.Bindings.Get"];
  const subject: string = descriptor.subject;

  return { coreClient, descriptor, subject };
}

void typecheckClientConnectRequestSurface;
void typecheckTrellisClientConnectRequestSurface;
void typecheckDeviceConnectRequestSurface;
void typecheckDeviceActivationSurface;
void typecheckServiceConnectSurface;
void typecheckServiceSqlOutboxSurface;
void typecheckResolvedRuntimeBindingsAreNotPublicAuthoringSurface;
void typecheckGeneratedCoreInternalRpcSurface;

Deno.test("public connect helpers preserve contract-derived request typing", () => {
  assertEquals(true, true);
});
