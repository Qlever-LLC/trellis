import { jwtAuthenticator, type NatsConnection } from "@nats-io/nats-core";
import {
  type KVError,
  type OperationRegistration,
  type StoreError,
  Trellis,
  TypedKV,
  TypedStore,
} from "@qlever-llc/trellis";
import {
  API as TRELLIS_CORE_API,
  type TrellisBindingsGetOutput,
  type TrellisCatalogOutput,
} from "@qlever-llc/trellis-sdk/core";
import { auth as trellisAuth } from "@qlever-llc/trellis-sdk/auth";
import {
  TrellisServer,
  type TrellisServerFor,
} from "../server.ts";
import {
  createAuth,
  type SentinelCreds,
  SentinelCredsSchema,
  type TrellisAuth as SessionAuth,
} from "@qlever-llc/trellis/auth";
import {
  ContractResourceBindingsSchema,
  type InferSchemaType,
} from "@qlever-llc/trellis/contracts";
import type { TrellisAPI } from "@qlever-llc/trellis/contracts";
import { type BaseError, isErr, type Result } from "@qlever-llc/result";
import { type TSchema, Type } from "typebox";
import { Value } from "typebox/value";
import { ServiceHealth, type HealthCheckFn } from "./health.ts";
import { mountStandardHealthRpc } from "./health_rpc.ts";
import type { RPCDesc } from "@qlever-llc/trellis/contracts";
import type {
  HandlerTrellis,
  RpcHandlerContext,
  RpcHandlerErrorOf,
  RpcRequestErrorOf,
} from "../trellis.ts";
import type {
  NatsConnectFn,
  NatsConnectOpts,
  TrellisServiceRuntimeDeps,
} from "./runtime.ts";
import { ServiceTransfer } from "./transfer.ts";
import { logger as noopLogger, type LoggerLike } from "../globals.ts";
import { loadDefaultRuntimeTransport } from "../runtime_transport.ts";
import { selectRuntimeTransportServers } from "../runtime_transport.ts";
import { serverLogger } from "../server_logger.ts";

type ExtraNatsConnectOpts = Omit<
  NatsConnectOpts,
  "servers" | "token" | "inboxPrefix" | "authenticator"
>;

type ResourceBindingJobsQueue = {
  queueType: string;
  publishPrefix: string;
  workSubject: string;
  consumerName: string;
  payload: { schema: string };
  result?: { schema: string };
  maxDeliver: number;
  backoffMs: number[];
  ackWaitMs: number;
  defaultDeadlineMs?: number;
  progress: boolean;
  logs: boolean;
  dlq: boolean;
  concurrency: number;
};

type ResourceBindingJobs = {
  namespace: string;
  queues: Record<string, ResourceBindingJobsQueue>;
};

const ClientTransportEndpointsSchema = Type.Object({
  natsServers: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
});

const ClientTransportsSchema = Type.Object({
  native: Type.Optional(ClientTransportEndpointsSchema),
  websocket: Type.Optional(ClientTransportEndpointsSchema),
});

type ServiceBootstrapConnectInfo = {
  sessionKey: string;
  contractId: string;
  contractDigest: string;
  transports: {
    native?: { natsServers: string[] };
    websocket?: { natsServers: string[] };
  };
  transport: {
    sentinel: SentinelCreds;
  };
  auth: {
    mode: "service_identity";
    iatSkewSeconds: number;
  };
};

type ServiceBootstrapResponse = {
  status: "ready";
  connectInfo: ServiceBootstrapConnectInfo;
  binding: {
    contractId: string;
    digest: string;
    resources: ResourceBindings;
  };
};

type RpcMethodName<TA extends TrellisAPI> = keyof TA["rpc"] & string;
type RpcMethodInput<TA extends TrellisAPI, M extends RpcMethodName<TA>> =
  InferSchemaType<TA["rpc"][M]["input"]>;
type RpcMethodOutput<TA extends TrellisAPI, M extends RpcMethodName<TA>> =
  InferSchemaType<TA["rpc"][M]["output"]>;

type BootstrapTrellisApi = {
  rpc: Pick<
    typeof TRELLIS_CORE_API.owned.rpc,
    "Trellis.Catalog" | "Trellis.Bindings.Get"
  >;
  operations: {};
  events: {};
  subjects: {};
};
type TrellisServerCreateOpts<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI = TOwnedApi,
> = {
  log?: LoggerLike | false;
  timeout?: number;
  stream?: string;
  noResponderRetry?: { maxAttempts?: number; baseDelayMs?: number };
  api: TOwnedApi;
  trellisApi?: TTrellisApi;
  version?: string;
  health?: TrellisServiceHealthOpts;
  healthChecks?: Record<string, HealthCheckFn>;
};

export type TrellisServiceHealthOpts = {
  publishIntervalMs?: number;
};

export type TrellisServiceServerOpts = {
  log?: LoggerLike | false;
  timeout?: number;
  stream?: string;
  noResponderRetry?: { maxAttempts?: number; baseDelayMs?: number };
  health?: TrellisServiceHealthOpts;
  healthChecks?: Record<string, HealthCheckFn>;
};

function resolveServiceLogger(log?: LoggerLike | false): LoggerLike {
  if (log === false) {
    return noopLogger;
  }

  return log ?? serverLogger;
}

function normalizeNatsStatus(status: unknown): Record<string, unknown> {
  if (!status || typeof status !== "object") {
    return { status };
  }

  const record = status as Record<string, unknown>;
  return {
    ...(typeof record.type === "string" ? { type: record.type } : {}),
    ...(typeof record.data === "string" ? { data: record.data } : {}),
    ...(record.data && typeof record.data === "object"
      ? { data: record.data }
      : {}),
  };
}

function isImportantNatsStatus(status: unknown): boolean {
  if (!status || typeof status !== "object") {
    return false;
  }

  const type = (status as { type?: unknown }).type;
  return type === "disconnect" || type === "reconnecting" ||
    type === "forceReconnect" || type === "staleConnection" ||
    type === "reconnect" || type === "error" || type === "close";
}

function startNatsConnectionLogging(args: {
  name: string;
  nc: NatsConnection;
  log: LoggerLike;
}): () => void {
  let stopped = false;
  const statusFn = (args.nc as NatsConnection & {
    status?: () => AsyncIterable<unknown>;
  }).status;

  if (typeof statusFn === "function") {
    void (async () => {
      try {
        for await (const status of statusFn.call(args.nc)) {
          if (stopped) return;

          const logConnectionStatus = isImportantNatsStatus(status)
            ? args.log.info.bind(args.log)
            : args.log.debug.bind(args.log);

          logConnectionStatus(
            {
              service: args.name,
              connection: normalizeNatsStatus(status),
            },
            "Service NATS connection status",
          );
        }
      } catch (error) {
        if (!stopped) {
          args.log.warn(
            { service: args.name, error },
            "Service NATS status watcher failed",
          );
        }
      }
    })();
  }

  void args.nc.closed().then((error: unknown) => {
    if (stopped) return;
    if (error) {
      args.log.error(
        { service: args.name, error },
        "Service NATS connection closed with error",
      );
      return;
    }
    args.log.warn({ service: args.name }, "Service NATS connection closed");
  });

  return () => {
    stopped = true;
  };
}

export type ResourceBindingKV = {
  bucket: string;
  history: number;
  ttlMs: number;
  maxValueBytes?: number;
};

export type ResourceBindingStore = {
  name: string;
  ttlMs: number;
  maxObjectBytes?: number;
  maxTotalBytes?: number;
};

export type ResourceBindingStream = {
  name: string;
  [key: string]: unknown;
};

export type ResourceBindings = {
  kv: Record<string, ResourceBindingKV>;
  store: Record<string, ResourceBindingStore>;
  streams: Record<string, ResourceBindingStream>;
  jobs?: ResourceBindingJobs;
};

function getErrorCauseMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const context = (error as { context?: Record<string, unknown> }).context;
    if (
      typeof context?.causeMessage === "string" &&
      context.causeMessage.length > 0
    ) {
      return context.causeMessage;
    }
  }

  return error instanceof Error ? error.message : String(error);
}

function bootstrapContractStateError(args: {
  serviceName: string;
  contractId: string;
  contractDigest: string;
  step: "catalog lookup" | "bindings lookup";
  cause?: unknown;
}): Error {
  const base =
    `Service '${args.serviceName}' could not bootstrap contract '${args.contractId}' (${args.contractDigest}) during ${args.step}. ` +
    "This usually means Trellis has stale or incomplete state for this service session. " +
    "Re-run the service profile apply or instance provisioning flow so Trellis records the allowed digest, permissions, and resource bindings for this instance key.";
  const cause = args.cause
    ? ` Underlying error: ${getErrorCauseMessage(args.cause)}`
    : "";
  return new Error(base + cause);
}

function runtimeImport<TModule>(specifier: string): Promise<TModule> {
  const load = new Function("specifier", "return import(specifier);") as (
    specifier: string,
  ) => Promise<TModule>;
  return load(specifier);
}

async function loadDefaultServiceRuntimeDeps(): Promise<
  TrellisServiceRuntimeDeps
> {
  const transport = await loadDefaultRuntimeTransport();
  return {
    connect: (opts) =>
      transport.connect({
        servers: opts.servers,
        ...(opts.token ? { token: opts.token } : {}),
        ...(opts.authenticator
          ? { authenticator: opts.authenticator as never }
          : {}),
        ...(opts.inboxPrefix ? { inboxPrefix: opts.inboxPrefix } : {}),
      }),
  };
}

const ServiceBootstrapReadySchema = Type.Object({
  status: Type.Literal("ready"),
  connectInfo: Type.Object({
    sessionKey: Type.String({ minLength: 1 }),
    contractId: Type.String({ minLength: 1 }),
    contractDigest: Type.String({ minLength: 1 }),
    transports: ClientTransportsSchema,
    transport: Type.Object({
      sentinel: SentinelCredsSchema,
    }),
    auth: Type.Object({
      mode: Type.Literal("service_identity"),
      iatSkewSeconds: Type.Integer({ minimum: 1 }),
    }),
  }),
  binding: Type.Object({
    contractId: Type.String({ minLength: 1 }),
    digest: Type.String({ minLength: 1 }),
    resources: ContractResourceBindingsSchema,
  }),
}, { additionalProperties: true });

const ServiceBootstrapFailureSchema = Type.Object({
  reason: Type.String({ minLength: 1 }),
}, { additionalProperties: true });

async function fetchServiceBootstrapInfo(args: {
  trellisUrl: string;
  contractId: string;
  contractDigest: string;
  auth: SessionAuth;
}): Promise<ServiceBootstrapResponse> {
  const iat = Math.floor(Date.now() / 1_000);
  const response = await fetch(new URL("/bootstrap/service", args.trellisUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: args.auth.sessionKey,
      contractId: args.contractId,
      contractDigest: args.contractDigest,
      iat,
      sig: await args.auth.natsConnectSigForIat(iat),
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    if (Value.Check(ServiceBootstrapFailureSchema, payload)) {
      throw new Error(`Service bootstrap failed: ${payload.reason}`);
    }
    throw new Error(`Service bootstrap failed with HTTP ${response.status}`);
  }

  return Value.Parse(
    ServiceBootstrapReadySchema,
    payload,
  ) as ServiceBootstrapResponse;
}

export class KVHandle {
  readonly binding: ResourceBindingKV;
  readonly #nc: NatsConnection;

  constructor(nc: NatsConnection, binding: ResourceBindingKV) {
    this.#nc = nc;
    this.binding = binding;
  }

  open<S extends TSchema>(schema: S): Promise<Result<TypedKV<S>, KVError>> {
    return TypedKV.open(this.#nc, this.binding.bucket, schema, {
      history: this.binding.history,
      ttl: this.binding.ttlMs,
      maxValueBytes: this.binding.maxValueBytes,
      bindOnly: true,
    });
  }
}

export class StoreHandle {
  readonly binding: ResourceBindingStore;
  readonly #nc: NatsConnection;

  constructor(nc: NatsConnection, binding: ResourceBindingStore) {
    this.#nc = nc;
    this.binding = binding;
  }

  open(): Promise<Result<TypedStore, StoreError>> {
    return TypedStore.open(this.#nc, this.binding.name, {
      ttlMs: this.binding.ttlMs,
      maxObjectBytes: this.binding.maxObjectBytes,
      maxTotalBytes: this.binding.maxTotalBytes,
      bindOnly: true,
    });
  }
}

type TrellisServiceRuntimeConnectOpts<
  TOwnedApi extends TrellisAPI = TrellisAPI,
  TTrellisApi extends TrellisAPI = TOwnedApi,
> = {
  /**
   * Session key seed (base64url Ed25519 private key seed) used to derive the service session key.
   * If you already have a `TrellisAuth` object, pass it via `auth` instead.
   */
  sessionKeySeed?: string;

  /**
   * Pre-created session-key auth (typically from `@qlever-llc/trellis/auth.createAuth`).
   * If omitted, `sessionKeySeed` is required.
   */
  auth?: SessionAuth;

  nats: {
    servers: string | string[];

    /**
     * Sentinel creds content (NATS creds file bytes).
     * Provide this OR `sentinelCredsPath` OR `authenticator`.
     */
    sentinelCreds?: Uint8Array;

    /**
     * Path to a sentinel creds file on disk.
     * Provide this OR `sentinelCreds` OR `authenticator`.
     */
    sentinelCredsPath?: string;

    /**
     * Custom NATS authenticator. If provided, sentinel creds are not used.
     */
    authenticator?: NatsConnectOpts["authenticator"];

    /**
     * Additional NATS connection options (reconnect, timeouts, etc).
     * `servers`, `token`, `inboxPrefix`, and `authenticator` are controlled by this helper.
     */
    options?: ExtraNatsConnectOpts;
  };

  server: TrellisServerCreateOpts<TOwnedApi, TTrellisApi>;
};

export type TrellisServiceConnectOpts<
  TOwnedApi extends TrellisAPI = TrellisAPI,
  TTrellisApi extends TrellisAPI = TOwnedApi,
> = {
  trellisUrl: string;
  contract: ServiceContract<TOwnedApi, TTrellisApi>;
  name: string;
  sessionKeySeed: string;
  server?: TrellisServiceServerOpts;
};

export type ServiceTrellis<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
> =
  & Omit<Trellis<TTrellisApi>, "mount">
  & {
    mount<M extends RpcMethodName<TOwnedApi>>(
      method: M,
      fn: (
        input: RpcMethodInput<TOwnedApi, M>,
        context: RpcHandlerContext,
        trellis: ServiceHandlerTrellis<TTrellisApi>,
      ) =>
        | Promise<
          Result<RpcMethodOutput<TOwnedApi, M>, RpcHandlerErrorOf<TOwnedApi, M>>
        >
        | Result<
          RpcMethodOutput<TOwnedApi, M>,
          RpcHandlerErrorOf<TOwnedApi, M>
        >,
    ): Promise<void>;
  };

export type ServiceHandlerTransfer = Pick<
  ServiceTransfer,
  "initiateUpload" | "initiateDownload"
>;

type ServiceHandlerResources = {
  kv: Record<string, KVHandle>;
  store: Record<string, StoreHandle>;
};

export type ServiceHandlerTrellis<TTrellisApi extends TrellisAPI> =
  & HandlerTrellis<TTrellisApi>
  & ServiceHandlerResources
  & {
    transfer: ServiceHandlerTransfer;
  };

type RequestOpts = {
  timeout?: number;
};

export type ServiceContract<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
> = {
  CONTRACT_ID: string;
  CONTRACT_DIGEST: string;
  API: {
    owned: TOwnedApi;
    trellis: TTrellisApi;
  };
};

type ContractOwnedApi<
  TContract extends ServiceContract<TrellisAPI, TrellisAPI>,
> = TContract["API"]["owned"];

type ContractTrellisApi<
  TContract extends ServiceContract<TrellisAPI, TrellisAPI>,
> = TContract["API"]["trellis"];

export type ServiceRpcHandler<
  TContract extends ServiceContract<TrellisAPI, TrellisAPI>,
  M extends RpcMethodName<ContractOwnedApi<TContract>>,
> = (
  input: RpcMethodInput<ContractOwnedApi<TContract>, M>,
  context: RpcHandlerContext,
  service: ServiceHandlerTrellis<ContractTrellisApi<TContract>>,
) =>
  | Promise<
    Result<
      RpcMethodOutput<ContractOwnedApi<TContract>, M>,
      RpcHandlerErrorOf<ContractOwnedApi<TContract>, M>
    >
  >
  | Result<
    RpcMethodOutput<ContractOwnedApi<TContract>, M>,
    RpcHandlerErrorOf<ContractOwnedApi<TContract>, M>
  >;

export type TrellisServiceConnectArgs<
  TContract extends ServiceContract<TrellisAPI, TrellisAPI>,
> = {
  trellisUrl: string;
  contract: TContract;
  name: string;
  sessionKeySeed: string;
  server?: TrellisServiceServerOpts;
};

export type TrellisServiceInternalConnectArgs<
  TOwnedApi extends TrellisAPI = TrellisAPI,
  TTrellisApi extends TrellisAPI = TOwnedApi,
> = TrellisServiceRuntimeConnectOpts<TOwnedApi, TTrellisApi> & {
  contractId?: string;
  contractDigest?: string;
};

async function createConnectedService<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
>(args: {
  name: string;
  auth: SessionAuth;
  nc: NatsConnection;
  contractId?: string;
  contractDigest?: string;
  server: TrellisServerCreateOpts<TOwnedApi, TTrellisApi>;
  bindings: ResourceBindings;
}): Promise<TrellisService<TOwnedApi, TTrellisApi>> {
  const resolvedLog = resolveServiceLogger(args.server.log);
  const stopConnectionLogging = startNatsConnectionLogging({
    name: args.name,
    nc: args.nc,
    log: resolvedLog,
  });
  const currentApi = (args.server.trellisApi ?? args.server.api) as
    & TOwnedApi
    & TTrellisApi;
  const runtimeApi = {
    ...currentApi,
    rpc: {
      ...trellisAuth.API.owned.rpc,
      ...currentApi.rpc,
    },
  } as unknown as TOwnedApi & TTrellisApi;

  const server = TrellisServer.create(
    args.name,
    args.nc,
    { sessionKey: args.auth.sessionKey, sign: args.auth.sign },
    {
      log: resolvedLog,
      timeout: args.server.timeout,
      stream: args.server.stream,
      noResponderRetry: args.server.noResponderRetry,
      api: runtimeApi,
      version: args.server.version,
    },
  );

  const outbound = new Trellis<TTrellisApi>(
    args.name,
    args.nc,
    { sessionKey: args.auth.sessionKey, sign: args.auth.sign },
    {
      log: resolvedLog,
      timeout: args.server.timeout,
      stream: args.server.stream,
      noResponderRetry: args.server.noResponderRetry,
      api: runtimeApi,
    },
  );

  let transfer: ServiceTransfer | undefined;
  const getTransfer = (): ServiceTransfer => {
    if (!transfer) {
      throw new Error("service transfer helper accessed before initialization");
    }
    return transfer;
  };
  let handlerResources: ServiceHandlerResources | undefined;
  const getHandlerResources = (): ServiceHandlerResources => {
    if (!handlerResources) {
      throw new Error(
        "service resource handles accessed before initialization",
      );
    }
    return handlerResources;
  };

  const handlerTransfer: ServiceHandlerTransfer = {
    initiateUpload: (args) => getTransfer().initiateUpload(args),
    initiateDownload: (args) => getTransfer().initiateDownload(args),
  };

  const handlerTrellis: ServiceHandlerTrellis<TTrellisApi> = {
    request: (method, input, opts) => outbound.request(method, input, opts),
    requestOrThrow: (method, input, opts) =>
      outbound.requestOrThrow(method, input, opts),
    publish: (event, data) => outbound.publish(event, data),
    event: (event, subjectData, fn) =>
      outbound.event(
        event,
        subjectData,
        fn as (message: unknown) => ReturnType<typeof fn>,
      ),
    operation: (operation) => outbound.operation(operation),
    get kv() {
      return getHandlerResources().kv;
    },
    get store() {
      return getHandlerResources().store;
    },
    transfer: handlerTransfer,
  };

  const trellis: ServiceTrellis<TOwnedApi, TTrellisApi> = Object.assign(
    outbound,
    {
      mount: <M extends RpcMethodName<TOwnedApi>>(
        method: M,
        fn: (
          input: RpcMethodInput<TOwnedApi, M>,
          context: RpcHandlerContext,
          trellis: ServiceHandlerTrellis<TTrellisApi>,
        ) =>
          | Promise<
            Result<
              RpcMethodOutput<TOwnedApi, M>,
              RpcHandlerErrorOf<TOwnedApi, M>
            >
          >
          | Result<
            RpcMethodOutput<TOwnedApi, M>,
            RpcHandlerErrorOf<TOwnedApi, M>
          >,
      ) =>
        (server as unknown as TrellisServer).mount(
          method as string,
          async (input: unknown, context: RpcHandlerContext) =>
            await Promise.resolve(
              fn(
                input as RpcMethodInput<TOwnedApi, M>,
                context,
                handlerTrellis,
              ),
            ) as Result<unknown, BaseError>,
        ),
    },
  );

  const health = new ServiceHealth({
    serviceName: args.name,
    contractId: args.contractId ?? "unknown",
    contractDigest: args.contractDigest ?? "unknown",
    publishIntervalMs: args.server.health?.publishIntervalMs ?? 30_000,
    checks: args.server.healthChecks,
  });
  health.add("nats", () => ({
    status: args.nc.isClosed() ? "failed" : "ok",
    ...(args.nc.isClosed() ? { summary: "NATS connection closed" } : {}),
  }));

  await mountStandardHealthRpc(server, {
    response: () => health.response(),
  });

  const heartbeatEventEnabled = Boolean(
    (currentApi.events as Record<string, unknown> | undefined)?.["Health.Heartbeat"],
  );
  let healthPublishTimer: ReturnType<typeof setInterval> | undefined;
  let publishingHeartbeat = false;
  const publishHealthHeartbeat = async (): Promise<void> => {
    if (!heartbeatEventEnabled || publishingHeartbeat) {
      return;
    }

    publishingHeartbeat = true;
    try {
      const heartbeat = await health.heartbeat();
      const published = await (
        outbound.publish as (
          event: string,
          data: Record<string, unknown>,
        ) => Promise<Result<void, BaseError>>
      )("Health.Heartbeat", heartbeat as Record<string, unknown>);
      const value = published.take();
      if (isErr(value)) {
        resolvedLog.warn({ error: value.error }, "Failed to publish health heartbeat");
      }
    } catch (error) {
      resolvedLog.warn({ error }, "Failed to build or publish health heartbeat");
    } finally {
      publishingHeartbeat = false;
    }
  };
  const stopHealthPublishing = async (): Promise<void> => {
    if (healthPublishTimer !== undefined) {
      clearInterval(healthPublishTimer);
      healthPublishTimer = undefined;
    }
  };

  if (heartbeatEventEnabled) {
    await publishHealthHeartbeat();
    healthPublishTimer = setInterval(() => {
      void publishHealthHeartbeat();
    }, health.publishIntervalMs);
  }

  const service = new TrellisService<TOwnedApi, TTrellisApi>(
    args.name,
    args.auth,
    args.nc,
    server,
    trellis,
    args.bindings,
    health,
    stopHealthPublishing,
    stopConnectionLogging,
  );
  handlerResources = { kv: service.kv, store: service.store };
  transfer = service.transfer;
  return service;
}

export class TrellisService<
  TOwnedApi extends TrellisAPI = TrellisAPI,
  TTrellisApi extends TrellisAPI = TOwnedApi,
> {
  readonly name: string;
  readonly auth: SessionAuth;
  readonly nc: NatsConnection;
  readonly server: TrellisServerFor<TOwnedApi & TTrellisApi>;
  readonly operations: TrellisServerFor<TOwnedApi & TTrellisApi>["operations"];
  readonly trellis: ServiceTrellis<TOwnedApi, TTrellisApi>;
  readonly transfer: ServiceTransfer;
  readonly kv: Record<string, KVHandle>;
  readonly store: Record<string, StoreHandle>;
  readonly streams: Record<string, ResourceBindingStream>;
  readonly jobs?: ResourceBindingJobs;
  readonly health: ServiceHealth;
  readonly #stopHealthPublishing: () => Promise<void>;
  readonly #stopConnectionLogging: () => void;

  constructor(
    name: string,
    auth: SessionAuth,
    nc: NatsConnection,
    server: TrellisServerFor<TOwnedApi & TTrellisApi>,
    trellis: ServiceTrellis<TOwnedApi, TTrellisApi>,
    bindings: ResourceBindings,
    health: ServiceHealth,
    stopHealthPublishing: () => Promise<void>,
    stopConnectionLogging: () => void,
  ) {
    const kvBindings = bindings.kv ?? {};
    const storeBindings = bindings.store ?? {};
    const streamBindings = bindings.streams ?? {};

    this.name = name;
    this.auth = auth;
    this.nc = nc;
    this.server = server;
    this.operations = server.operations;
    this.trellis = trellis;
    this.kv = Object.fromEntries(
      Object.entries(kvBindings).map((
        [alias, binding],
      ) => [alias, new KVHandle(nc, binding)]),
    );
    this.store = Object.fromEntries(
      Object.entries(storeBindings).map((
        [alias, binding],
      ) => [alias, new StoreHandle(nc, binding)]),
    );
    this.transfer = new ServiceTransfer({
      name,
      nc,
      auth,
      stores: this.store,
    });
    this.streams = streamBindings;
    this.jobs = bindings.jobs;
    this.health = health;
    this.#stopHealthPublishing = stopHealthPublishing;
    this.#stopConnectionLogging = stopConnectionLogging;
  }

  static async connect<
    TContract extends ServiceContract<TrellisAPI, TrellisAPI>,
  >(
    args: TrellisServiceConnectArgs<TContract>,
    deps?: Partial<TrellisServiceRuntimeDeps>,
  ): Promise<
    TrellisService<
      ContractOwnedApi<TContract>,
      ContractTrellisApi<TContract>
    >
  > {
    type TOwnedApi = ContractOwnedApi<TContract>;
    type TTrellisApi = ContractTrellisApi<TContract>;

    const runtimeDeps = {
      ...(await loadDefaultServiceRuntimeDeps()),
      ...deps,
    } satisfies TrellisServiceRuntimeDeps;
    const auth = await createAuth({ sessionKeySeed: args.sessionKeySeed });
    const bootstrap = await fetchServiceBootstrapInfo({
      trellisUrl: args.trellisUrl,
      contractId: args.contract.CONTRACT_ID,
      contractDigest: args.contract.CONTRACT_DIGEST,
      auth,
    });
    const { token, inboxPrefix } = await auth.natsConnectOptions();
    const nc = await runtimeDeps.connect({
      servers: selectRuntimeTransportServers(bootstrap.connectInfo.transports),
      token,
      inboxPrefix,
      authenticator: jwtAuthenticator(
        bootstrap.connectInfo.transport.sentinel.jwt,
        new TextEncoder().encode(bootstrap.connectInfo.transport.sentinel.seed),
      ),
    });

    return await createConnectedService<TOwnedApi, TTrellisApi>({
      name: args.name,
      auth,
      nc,
      contractId: args.contract.CONTRACT_ID,
      contractDigest: args.contract.CONTRACT_DIGEST,
      server: {
        ...(args.server ?? {}),
        api: args.contract.API.owned,
        trellisApi: args.contract.API.trellis,
      },
      bindings: bootstrap.binding.resources,
    });
  }

  static async connectInternal<
    TOwnedApi extends TrellisAPI = TrellisAPI,
    TTrellisApi extends TrellisAPI = TOwnedApi,
  >(
    name: string,
    opts: TrellisServiceInternalConnectArgs<TOwnedApi, TTrellisApi>,
    deps: TrellisServiceRuntimeDeps,
  ): Promise<TrellisService<TOwnedApi, TTrellisApi>> {
    const connectFn = deps.connect;
    const readFileSync = deps.readFileSync;
    const credsAuthenticator = deps.credsAuthenticator;

    const auth = opts.auth ??
      (opts.sessionKeySeed
        ? await createAuth({ sessionKeySeed: opts.sessionKeySeed })
        : undefined);
    if (!auth) {
      throw new Error(
        "TrellisService.connect requires either opts.auth or opts.sessionKeySeed",
      );
    }

    const authenticator = opts.nats.authenticator ??
      (() => {
        if (opts.nats.sentinelCreds) {
          if (!credsAuthenticator) {
            throw new Error(
              "TrellisService.connect requires a runtime creds authenticator when sentinel creds are provided",
            );
          }
          return credsAuthenticator(opts.nats.sentinelCreds);
        }
        if (opts.nats.sentinelCredsPath) {
          if (!credsAuthenticator || !readFileSync) {
            throw new Error(
              "TrellisService.connect requires runtime file and creds adapters when opts.nats.sentinelCredsPath is used",
            );
          }
          return credsAuthenticator(readFileSync(opts.nats.sentinelCredsPath));
        }
        throw new Error(
          "TrellisService.connect requires opts.nats.authenticator, opts.nats.sentinelCreds, or opts.nats.sentinelCredsPath",
        );
      })();

    const { token, inboxPrefix } = await auth.natsConnectOptions();

    const nc = await connectFn({
      servers: opts.nats.servers,
      token,
      inboxPrefix,
      authenticator,
      ...(opts.nats.options ?? {}),
    } as NatsConnectOpts);

    let bindings: ResourceBindings = { kv: {}, store: {}, streams: {} };

    if (opts.contractId && opts.contractDigest) {
      const resolvedLog = resolveServiceLogger(opts.server.log);
      const runtimeApi = (opts.server.trellisApi ?? opts.server.api) as
        & TOwnedApi
        & TTrellisApi;
      const outbound = new Trellis<TTrellisApi>(
        name,
        nc,
        { sessionKey: auth.sessionKey, sign: auth.sign },
        {
          log: resolvedLog,
          timeout: opts.server.timeout,
          stream: opts.server.stream,
          noResponderRetry: opts.server.noResponderRetry,
          api: runtimeApi,
        },
      );
      const trellis: ServiceTrellis<TOwnedApi, TTrellisApi> = Object.assign(
        outbound,
        {
          mount: () => {
            throw new Error(
              "mount is unavailable during internal bootstrap probing",
            );
          },
        },
      );
      const bootstrapRequest = trellis.request.bind(trellis) as Pick<
        Trellis<BootstrapTrellisApi>,
        "request"
      >["request"];
      const catalogResult = await bootstrapRequest("Trellis.Catalog", {});
      const catalogValue = catalogResult.take();
      if (isErr(catalogValue)) {
        throw bootstrapContractStateError({
          serviceName: name,
          contractId: opts.contractId,
          contractDigest: opts.contractDigest,
          step: "catalog lookup",
          cause: catalogValue.error,
        });
      }
      const catalog: TrellisCatalogOutput = catalogValue;
      const isActive = catalog.catalog.contracts.some(
        (c: { digest: string }) => c.digest === opts.contractDigest,
      );
      if (!isActive) {
        throw new Error(
          `Contract ${opts.contractId} (${opts.contractDigest}) is not active. Install it with the trellis CLI first.`,
        );
      }

      const bindingsResult = await bootstrapRequest(
        "Trellis.Bindings.Get",
        { contractId: opts.contractId },
      );
      const bindingsValue = bindingsResult.take();
      if (isErr(bindingsValue)) {
        throw bootstrapContractStateError({
          serviceName: name,
          contractId: opts.contractId,
          contractDigest: opts.contractDigest,
          step: "bindings lookup",
          cause: bindingsValue.error,
        });
      }
      const resolved: TrellisBindingsGetOutput = bindingsValue;
      if (!resolved.binding) {
        throw bootstrapContractStateError({
          serviceName: name,
          contractId: opts.contractId,
          contractDigest: opts.contractDigest,
          step: "bindings lookup",
        });
      }

      if (
        resolved.binding.contractId !== opts.contractId ||
        resolved.binding.digest !== opts.contractDigest
      ) {
        throw new Error(
          `Service '${name}' received bindings for '${
            resolved.binding.contractId ?? "unknown"
          }' (${resolved.binding.digest ?? "unknown"}) ` +
            `while bootstrapping '${opts.contractId}' (${opts.contractDigest}). Re-run the service profile apply or instance provisioning flow so Trellis records the correct active contract for this instance key.`,
        );
      }

      bindings = {
        kv: resolved.binding?.resources?.kv ?? {},
        store: resolved.binding?.resources?.store ?? {},
        streams: resolved.binding?.resources?.streams ?? {},
        ...(resolved.binding?.resources?.jobs
          ? { jobs: resolved.binding.resources.jobs }
          : {}),
      };
    }

    return await createConnectedService<TOwnedApi, TTrellisApi>({
      name,
      auth,
      nc,
      contractId: opts.contractId,
      contractDigest: opts.contractDigest,
      server: opts.server,
      bindings,
    });
  }

  async stop(): Promise<void> {
    this.#stopConnectionLogging();
    await this.#stopHealthPublishing();
    await this.transfer.stop();
    await this.server.stop();
  }

  request<M extends RpcMethodName<TTrellisApi>>(
    method: M,
    input: RpcMethodInput<TTrellisApi, M>,
    opts?: RequestOpts,
  ): Promise<
    Result<
      RpcMethodOutput<TTrellisApi, M>,
      RpcRequestErrorOf<TTrellisApi, M>
    >
  > {
    return this.trellis.request(
      method as never,
      input as never,
      opts,
    ) as Promise<
      Result<
        RpcMethodOutput<TTrellisApi, M>,
        RpcRequestErrorOf<TTrellisApi, M>
      >
    >;
  }

  requestOrThrow<M extends RpcMethodName<TTrellisApi>>(
    method: M,
    input: RpcMethodInput<TTrellisApi, M>,
    opts?: RequestOpts,
  ): Promise<RpcMethodOutput<TTrellisApi, M>> {
    return this.trellis.requestOrThrow(
      method as never,
      input as never,
      opts,
    ) as Promise<
      RpcMethodOutput<TTrellisApi, M>
    >;
  }

  operation<O extends keyof (TOwnedApi & TTrellisApi)["operations"] & string>(
    operation: O,
  ): OperationRegistration<
    InferSchemaType<(TOwnedApi & TTrellisApi)["operations"][O]["input"]>
  > {
    return this.server.operation(operation) as OperationRegistration<
      InferSchemaType<(TOwnedApi & TTrellisApi)["operations"][O]["input"]>
    >;
  }
}
