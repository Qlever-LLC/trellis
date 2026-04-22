import { jwtAuthenticator, type NatsConnection } from "@nats-io/nats-core";
import { Kvm } from "@nats-io/kv";
import {
  type KVError,
  type OperationRegistration as RootOperationRegistration,
  type StoreError,
  type StoreWaitOptions,
  Trellis as RootTrellis,
  TypedKV,
  TypedStore,
  TypedStoreEntry,
} from "@qlever-llc/trellis";
import {
  API as TRELLIS_CORE_API,
  type TrellisBindingsGetOutput,
  type TrellisCatalogOutput,
} from "@qlever-llc/trellis-sdk/core";
import { auth as trellisAuth } from "@qlever-llc/trellis-sdk/auth";
import { TrellisServer, type TrellisServerFor } from "../server.ts";
import {
  createAuth,
  estimateMidpointClockOffsetMs,
  type SentinelCreds,
  SentinelCredsSchema,
  type TrellisAuth as SessionAuth,
} from "@qlever-llc/trellis/auth";
import {
  ContractResourceBindingsSchema,
  type InferSchemaType,
} from "@qlever-llc/trellis/contracts";
import type { TrellisAPI } from "@qlever-llc/trellis/contracts";
import type { ContractJobsMetadata } from "../contract_support/mod.ts";
import { CONTRACT_JOBS_METADATA } from "../contract_support/mod.ts";
import { AsyncResult, type BaseError, isErr, Result } from "@qlever-llc/result";
import { type TSchema, Type } from "typebox";
import { Value } from "typebox/value";
import { type HealthCheckFn, ServiceHealth } from "./health.ts";
import { mountStandardHealthRpc } from "./health_rpc.ts";
import type { RPCDesc } from "@qlever-llc/trellis/contracts";
import type {
  AcceptedOperation,
  HandlerTrellis,
  OperationHandlerContext,
  OperationOutputOf,
  OperationProgressOf,
  OperationTransferContextOf,
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
import { UnexpectedError } from "../errors/index.ts";
import {
  ActiveJob as PublicActiveJob,
  type JobIdentity,
  type JobLogEntry,
  type JobProgress,
  JobRef,
  type JobSnapshot,
  JobWorkerHostAdapter,
  type TerminalJob,
} from "../jobs.ts";
import {
  JobManager as InternalJobManager,
  JobProcessError as InternalJobProcessError,
} from "./internal_jobs/job-manager.ts";
import { startNatsWorkerHostFromBinding } from "./internal_jobs/runtime-worker.ts";
import type { ActiveJob as InternalActiveJob } from "./internal_jobs/active-job.ts";
import type { Job as InternalJob } from "./internal_jobs/types.ts";

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
  jobsStateBucket?: string;
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
  serverNow: number;
  connectInfo: ServiceBootstrapConnectInfo;
  binding: {
    contractId: string;
    digest: string;
    resources: ResourceBindings;
  };
};

type ServiceBootstrapFailure = {
  reason: string;
  message?: string;
  serverNow?: number;
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

function normalizeNatsError(error: Error): Record<string, unknown> {
  const record = error as Error & {
    operation?: unknown;
    subject?: unknown;
    queue?: unknown;
  };

  return {
    name: error.name,
    message: error.message,
    ...(typeof record.operation === "string"
      ? { operation: record.operation }
      : {}),
    ...(typeof record.subject === "string" ? { subject: record.subject } : {}),
    ...(typeof record.queue === "string" ? { queue: record.queue } : {}),
  };
}

function normalizeNatsStatus(status: unknown): Record<string, unknown> {
  if (!status || typeof status !== "object") {
    return { status };
  }

  const record = status as Record<string, unknown>;
  return {
    ...(typeof record.type === "string" ? { type: record.type } : {}),
    ...(record.error instanceof Error
      ? { error: normalizeNatsError(record.error) }
      : {}),
    ...(typeof record.data === "string" ? { data: record.data } : {}),
    ...(record.data && typeof record.data === "object"
      ? { data: record.data }
      : {}),
  };
}

function getServiceNatsLifecycleLog(status: unknown): {
  level: "info" | "warn" | "error";
  message: string;
} | null {
  if (!status || typeof status !== "object") {
    return null;
  }

  switch ((status as { type?: unknown }).type) {
    case "disconnect":
      return {
        level: "warn",
        message: "Service disconnected from NATS",
      };
    case "reconnecting":
      return {
        level: "warn",
        message: "Service attempting NATS reconnect",
      };
    case "forceReconnect":
      return {
        level: "warn",
        message: "Service forcing NATS reconnect",
      };
    case "reconnect":
      return {
        level: "info",
        message: "Service reconnected to NATS",
      };
    case "staleConnection":
      return {
        level: "warn",
        message: "Service NATS connection became stale",
      };
    case "error":
      return {
        level: "error",
        message: "Service NATS error",
      };
    default:
      return null;
  }
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

          const lifecycleLog = getServiceNatsLifecycleLog(status);
          if (!lifecycleLog) {
            continue;
          }

          args.log[lifecycleLog.level](
            {
              service: args.name,
              connection: normalizeNatsStatus(status),
            },
            lifecycleLog.message,
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
  serverNow: Type.Integer(),
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
  message: Type.Optional(Type.String({ minLength: 1 })),
  serverNow: Type.Optional(Type.Integer()),
}, { additionalProperties: true });

async function fetchServiceBootstrapInfoOnce(args: {
  trellisUrl: string;
  contractId: string;
  contractDigest: string;
  auth: SessionAuth;
}): Promise<{
  response: Response;
  responseText: string;
  payload: unknown;
  requestStartedAtMs: number;
  responseReceivedAtMs: number;
}> {
  const requestStartedAtMs = Date.now();
  const iat = args.auth.currentIat();
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
  const responseReceivedAtMs = Date.now();

  const responseText = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = undefined;
  }
  return {
    response,
    responseText,
    payload,
    requestStartedAtMs,
    responseReceivedAtMs,
  };
}

async function fetchServiceBootstrapInfo(args: {
  trellisUrl: string;
  contractId: string;
  contractDigest: string;
  auth: SessionAuth;
}): Promise<ServiceBootstrapResponse> {
  let settled = await fetchServiceBootstrapInfoOnce(args);
  if (
    !settled.response.ok &&
    settled.payload !== undefined &&
    Value.Check(ServiceBootstrapFailureSchema, settled.payload)
  ) {
    const failure = settled.payload as ServiceBootstrapFailure;
    if (
      failure.reason === "iat_out_of_range" &&
      typeof failure.serverNow === "number"
    ) {
      args.auth.setServerClockOffsetMs(
        estimateMidpointClockOffsetMs({
          requestStartedAtMs: settled.requestStartedAtMs,
          responseReceivedAtMs: settled.responseReceivedAtMs,
          serverNowSeconds: failure.serverNow,
        }),
      );
      settled = await fetchServiceBootstrapInfoOnce(args);
    }
  }

  if (!settled.response.ok) {
    if (
      settled.payload !== undefined &&
      Value.Check(ServiceBootstrapFailureSchema, settled.payload)
    ) {
      const failure = settled.payload as ServiceBootstrapFailure;
      throw new Error(
        `Service bootstrap failed: ${failure.message ?? failure.reason}`,
      );
    }
    const detail = settled.responseText.trim();
    throw new Error(
      detail.length > 0
        ? `Service bootstrap failed with HTTP ${settled.response.status}: ${detail}`
        : `Service bootstrap failed with HTTP ${settled.response.status}`,
    );
  }

  if (settled.payload === undefined) {
    throw new Error(
      `Service bootstrap returned invalid JSON: ${
        settled.responseText.trim() || "<empty body>"
      }`,
    );
  }

  const ready = Value.Parse(
    ServiceBootstrapReadySchema,
    settled.payload,
  ) as ServiceBootstrapResponse;
  args.auth.setServerClockOffsetMs(
    estimateMidpointClockOffsetMs({
      requestStartedAtMs: settled.requestStartedAtMs,
      responseReceivedAtMs: settled.responseReceivedAtMs,
      serverNowSeconds: ready.serverNow,
    }),
  );

  return ready;
}

export class KVHandle {
  readonly binding: ResourceBindingKV;
  readonly #nc: NatsConnection;

  constructor(nc: NatsConnection, binding: ResourceBindingKV) {
    this.#nc = nc;
    this.binding = binding;
  }

  open<S extends TSchema>(schema: S): AsyncResult<TypedKV<S>, KVError> {
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

  open(): AsyncResult<TypedStore, StoreError> {
    return TypedStore.open(this.#nc, this.binding.name, {
      ttlMs: this.binding.ttlMs,
      maxObjectBytes: this.binding.maxObjectBytes,
      maxTotalBytes: this.binding.maxTotalBytes,
      bindOnly: true,
    });
  }

  /**
   * Waits for a staged object to appear in the bound store and returns its entry.
   */
  waitFor(
    key: string,
    options: StoreWaitOptions = {},
  ): AsyncResult<TypedStoreEntry, StoreError> {
    return this.open().andThen((store) => store.waitFor(key, options));
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
  & Omit<RootTrellis<TTrellisApi>, "mount">
  & {
    mount<M extends RpcMethodName<TOwnedApi>>(
      method: M,
      fn: ({
        input,
        context,
        trellis,
      }: {
        input: RpcMethodInput<TOwnedApi, M>;
        context: RpcHandlerContext;
        trellis: Trellis<TTrellisApi>;
      }) =>
        | Promise<
          Result<RpcMethodOutput<TOwnedApi, M>, RpcHandlerErrorOf<TOwnedApi, M>>
        >
        | Result<
          RpcMethodOutput<TOwnedApi, M>,
          RpcHandlerErrorOf<TOwnedApi, M>
        >,
    ): Promise<void>;
  };

type ServiceHandlerResources = {
  kv: Record<string, KVHandle>;
  store: Record<string, StoreHandle>;
};

export type Trellis<TTrellisApi extends TrellisAPI> =
  & HandlerTrellis<TTrellisApi>
  & ServiceHandlerResources;

type RequestOpts = {
  timeout?: number;
};

export type ServiceContract<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
  TJobs extends ContractJobsMetadata = {},
> = {
  CONTRACT_ID: string;
  CONTRACT_DIGEST: string;
  API: {
    owned: TOwnedApi;
    trellis: TTrellisApi;
  };
  readonly [CONTRACT_JOBS_METADATA]?: TJobs;
};

type ContractOwnedApi<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI,
    ContractJobsMetadata
  >,
> = TContract["API"]["owned"];

type ContractTrellisApi<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI,
    ContractJobsMetadata
  >,
> = TContract["API"]["trellis"];

type ContractJobsOf<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI,
    ContractJobsMetadata
  >,
> = NonNullable<TContract[typeof CONTRACT_JOBS_METADATA]>;

type ContractJobName<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI,
    ContractJobsMetadata
  >,
> = keyof ContractJobsOf<TContract> & string;

type ContractOperationName<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI,
    ContractJobsMetadata
  >,
> = keyof ContractOwnedApi<TContract>["operations"] & string;

type ContractJobPayload<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI,
    ContractJobsMetadata
  >,
  TJob extends ContractJobName<TContract>,
> = ContractJobsOf<TContract>[TJob]["payload"];

type ContractJobResult<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI,
    ContractJobsMetadata
  >,
  TJob extends ContractJobName<TContract>,
> = ContractJobsOf<TContract>[TJob]["result"];

export type RpcHandler<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI,
    ContractJobsMetadata
  >,
  M extends RpcMethodName<ContractOwnedApi<TContract>>,
> = ({
  input,
  context,
  trellis,
}: {
  input: RpcMethodInput<ContractOwnedApi<TContract>, M>;
  context: RpcHandlerContext;
  trellis: Trellis<ContractTrellisApi<TContract>>;
}) =>
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

export type JobHandler<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI,
    ContractJobsMetadata
  >,
  TJob extends ContractJobName<TContract>,
> = ({
  job,
  trellis,
}: {
  job: PublicActiveJob<ContractJobPayload<TContract, TJob>, ContractJobResult<TContract, TJob>>;
  trellis: Trellis<ContractTrellisApi<TContract>>;
}) => Promise<Result<ContractJobResult<TContract, TJob>, BaseError>>;

export type OperationHandler<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI,
    ContractJobsMetadata
  >,
  O extends ContractOperationName<TContract>,
> = (
  args:
    & OperationHandlerContext<
      InferSchemaType<ContractOwnedApi<TContract>["operations"][O]["input"]>,
      OperationProgressOf<ContractOwnedApi<TContract>, O>,
      OperationOutputOf<ContractOwnedApi<TContract>, O>,
      OperationTransferContextOf<ContractOwnedApi<TContract>, O>
    >
    & {
      trellis: Trellis<ContractTrellisApi<TContract>>;
    },
) => unknown | Promise<unknown>;

export type JobQueue<
  TPayload,
  TResult,
  TTrellisApi extends TrellisAPI,
> = {
  create(payload: TPayload): AsyncResult<JobRef<TPayload, TResult>, BaseError>;
  handle(
    handler: (args: {
      job: PublicActiveJob<TPayload, TResult>;
      trellis: Trellis<TTrellisApi>;
    }) => Promise<Result<TResult, BaseError>>,
  ): AsyncResult<void, BaseError>;
};

export type JobsFacadeOf<
  TJobs extends ContractJobsMetadata,
  TTrellisApi extends TrellisAPI,
> = {
  [K in keyof TJobs]: JobQueue<TJobs[K]["payload"], TJobs[K]["result"], TTrellisApi>;
} & {
  startWorkers(opts?: {
    queues?: readonly string[];
    instanceId?: string;
    version?: string;
  }): AsyncResult<JobWorkerHostAdapter, BaseError>;
};

export type OperationRegistration<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
  O extends keyof TOwnedApi["operations"] & string,
> = {
  accept(args: {
    sessionKey: string;
  }): AsyncResult<
    AcceptedOperation<
      OperationProgressOf<TOwnedApi, O>,
      OperationOutputOf<TOwnedApi, O>
    >,
    UnexpectedError
  >;
  handle(
    handler: (
      args:
        & OperationHandlerContext<
          InferSchemaType<TOwnedApi["operations"][O]["input"]>,
          OperationProgressOf<TOwnedApi, O>,
          OperationOutputOf<TOwnedApi, O>,
          OperationTransferContextOf<TOwnedApi, O>
        >
        & { trellis: Trellis<TTrellisApi> },
    ) => unknown | Promise<unknown>,
  ): Promise<void>;
};

export type TrellisServiceConnectArgs<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI,
    ContractJobsMetadata
  >,
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
  TJobs extends ContractJobsMetadata = {},
>(args: {
  name: string;
  auth: SessionAuth;
  nc: NatsConnection;
  contractId?: string;
  contractDigest?: string;
  contractJobs: TJobs;
  server: TrellisServerCreateOpts<TOwnedApi, TTrellisApi>;
  bindings: ResourceBindings;
}): Promise<TrellisService<TOwnedApi, TTrellisApi, TJobs>> {
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
      transferSupport: {
        openOperationTransfer: (transferArgs) =>
          getTransfer().createOperationUpload(transferArgs),
      },
      version: args.server.version,
    },
  );

  const outbound = new RootTrellis<TTrellisApi>(
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

  const handlerTrellis: Trellis<TTrellisApi> = {
    request: (method, input, opts) => outbound.request(method, input, opts),
    publish: (event, data) => outbound.publish(event, data),
    event: (event, subjectData, fn, opts) =>
      outbound.event(
        event,
        subjectData,
        fn as (message: unknown) => ReturnType<typeof fn>,
        opts,
      ),
    operation: (operation) => outbound.operation(operation),
    get kv() {
      return getHandlerResources().kv;
    },
    get store() {
      return getHandlerResources().store;
    },
  };

  const trellis: ServiceTrellis<TOwnedApi, TTrellisApi> = Object.assign(
    outbound,
    {
      mount: <M extends RpcMethodName<TOwnedApi>>(
        method: M,
        fn: ({
          input,
          context,
          trellis,
        }: {
          input: RpcMethodInput<TOwnedApi, M>;
          context: RpcHandlerContext;
          trellis: Trellis<TTrellisApi>;
        }) =>
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
          async ({ input, context }) =>
            await Promise.resolve(
              fn({
                input: input as RpcMethodInput<TOwnedApi, M>,
                context,
                trellis: handlerTrellis,
              }),
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
    (currentApi.events as Record<string, unknown> | undefined)
      ?.["Health.Heartbeat"],
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
        ) => AsyncResult<void, BaseError>
      )("Health.Heartbeat", heartbeat as Record<string, unknown>);
      const value = published.take();
      if (isErr(value)) {
        resolvedLog.warn(
          { error: value.error },
          "Failed to publish health heartbeat",
        );
      }
    } catch (error) {
      resolvedLog.warn(
        { error },
        "Failed to build or publish health heartbeat",
      );
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

  const operationTransfer = new ServiceTransfer({
    name: args.name,
    nc: args.nc,
    auth: args.auth,
    stores: Object.fromEntries(
      Object.entries(args.bindings.store ?? {}).map(([alias, binding]) => [
        alias,
        new StoreHandle(args.nc, binding),
      ]),
    ),
  });

  const service = new TrellisService<TOwnedApi, TTrellisApi, TJobs>(
    args.name,
    args.auth,
    args.nc,
    server,
    trellis,
    handlerTrellis,
    args.contractJobs,
    args.bindings,
    operationTransfer,
    health,
    stopHealthPublishing,
    stopConnectionLogging,
  );
  handlerResources = { kv: service.kv, store: service.store };
  transfer = operationTransfer;
  return service;
}

type RegisteredJobHandler<TPayload, TResult> = (
  job: PublicActiveJob<TPayload, TResult>,
) => Promise<Result<TResult, BaseError>>;

function toUnexpectedError(cause: unknown): UnexpectedError {
  return cause instanceof UnexpectedError
    ? cause
    : new UnexpectedError({ cause });
}

function okVoid(): Result<void, never> {
  return Result.ok(undefined);
}

function wrapVoidTask(task: () => Promise<void>): AsyncResult<void, BaseError> {
  return AsyncResult.from((async () => {
    try {
      await task();
      return okVoid();
    } catch (cause) {
      return Result.err(toUnexpectedError(cause));
    }
  })());
}

function isTerminalJobState(
  state: string,
): state is TerminalJob<unknown, unknown>["state"] {
  return state === "completed" || state === "failed" || state === "cancelled" ||
    state === "expired" || state === "dead" || state === "dismissed";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readProjectedJob<TPayload, TResult>(
  nc: NatsConnection,
  jobsStateBucket: string,
  jobId: string,
): AsyncResult<JobSnapshot<TPayload, TResult> | null, BaseError> {
  return AsyncResult.from((async () => {
    try {
      const kv = await new Kvm(nc).open(jobsStateBucket);
      const entry = await kv.get(jobId);
      if (!entry) {
        return Result.ok(null);
      }
      return Result.ok(entry.json() as JobSnapshot<TPayload, TResult>);
    } catch (cause) {
      return Result.err(toUnexpectedError(cause));
    }
  })());
}

function createJobRef<TPayload, TResult>(args: {
  nc: NatsConnection;
  queueType: string;
  jobsBinding: ResourceBindingJobs;
  queueBinding: ResourceBindingJobsQueue;
  seed: JobSnapshot<TPayload, TResult>;
}): JobRef<TPayload, TResult> {
  const projectedStateUnavailable = (): UnexpectedError =>
    toUnexpectedError(
      new Error(
        `Projected job state is unavailable for queue '${args.queueType}'. ` +
          "Re-bootstrap this service so Trellis provides jobs state bindings before using wait() or cancel().",
      ),
    );

  const readLatest = (): AsyncResult<
    JobSnapshot<TPayload, TResult> | null,
    BaseError
  > => {
    if (!args.jobsBinding.jobsStateBucket) {
      return AsyncResult.ok(null);
    }
    return readProjectedJob<TPayload, TResult>(
      args.nc,
      args.jobsBinding.jobsStateBucket,
      args.seed.id,
    );
  };

  return new JobRef<TPayload, TResult>(
    {
      id: args.seed.id,
      service: args.seed.service,
      jobType: args.queueType,
    },
    {
      get: () =>
        AsyncResult.from((async () => {
          const latest = await readLatest().take();
          if (isErr(latest)) {
            return Result.err(latest.error);
          }
          return Result.ok(latest ?? args.seed);
        })()),
      wait: () =>
        AsyncResult.from((async () => {
          if (!args.jobsBinding.jobsStateBucket) {
            return Result.err(projectedStateUnavailable());
          }
          for (;;) {
            const latest = await readLatest().take();
            if (isErr(latest)) {
              return Result.err(latest.error);
            }
            const snapshot = latest ?? args.seed;
            if (isTerminalJobState(snapshot.state)) {
              return Result.ok(snapshot as TerminalJob<TPayload, TResult>);
            }
            await sleep(250);
          }
        })()),
      cancel: () =>
        AsyncResult.from((async () => {
          if (!args.jobsBinding.jobsStateBucket) {
            return Result.err(projectedStateUnavailable());
          }
          const latest = await readLatest().take();
          if (isErr(latest)) {
            return Result.err(latest.error);
          }
          const snapshot = latest ?? args.seed;
          if (isTerminalJobState(snapshot.state)) {
            return Result.ok(snapshot);
          }

          try {
            args.nc.publish(
              `${args.queueBinding.publishPrefix}.${args.seed.id}.cancelled`,
              new TextEncoder().encode(JSON.stringify({
                jobId: args.seed.id,
                service: snapshot.service,
                jobType: args.queueType,
                eventType: "cancelled",
                state: "cancelled",
                previousState: snapshot.state,
                tries: snapshot.tries,
                error: "cancelled",
                timestamp: new Date().toISOString(),
              })),
            );
          } catch (cause) {
            return Result.err(toUnexpectedError(cause));
          }

          for (;;) {
            const refreshed = await readLatest().take();
            if (isErr(refreshed)) {
              return Result.err(refreshed.error);
            }
            const current = refreshed ?? snapshot;
            if (
              current.state === "cancelled" || isTerminalJobState(current.state)
            ) {
              return Result.ok(current);
            }
            await sleep(250);
          }
        })()),
    },
  );
}

function createNoopJobWorkerHost(): JobWorkerHostAdapter {
  return new JobWorkerHostAdapter({
    stop: () => AsyncResult.ok(undefined),
    join: () => AsyncResult.ok(undefined),
  });
}

function createJobsFacade<
  TJobs extends ContractJobsMetadata,
  TTrellisApi extends TrellisAPI,
>(args: {
  serviceName: string;
  nc: NatsConnection;
  contractJobs: TJobs;
  trellis: Trellis<TTrellisApi>;
  jobsBinding?: ResourceBindingJobs;
  workStream?: string;
}): JobsFacadeOf<TJobs, TTrellisApi> {
  const handlers = new Map<string, RegisteredJobHandler<unknown, unknown>>();
  const jobsFacade: Record<string, unknown> = {};

  for (const queueType of Object.keys(args.contractJobs ?? {})) {
    jobsFacade[queueType] = {
      create: (payload) =>
        AsyncResult.from((async () => {
          try {
            const jobsBinding = args.jobsBinding;
            if (!jobsBinding) {
              return Result.err(
                toUnexpectedError(new Error("Jobs bindings are unavailable")),
              );
            }
            const queueBinding = jobsBinding.queues[queueType];
            if (!queueBinding) {
              return Result.err(toUnexpectedError(
                new Error(
                  `Jobs binding for queue '${queueType}' is unavailable`,
                ),
              ));
            }

            const manager = new InternalJobManager<unknown, unknown>({
              nc: args.nc,
              jobs: jobsBinding,
            });
            const created = await manager.create(queueType, payload);
            return Result.ok(createJobRef({
              nc: args.nc,
              queueType,
              jobsBinding,
              queueBinding,
              seed: created as JobSnapshot<unknown, unknown>,
            }));
          } catch (cause) {
            return Result.err(toUnexpectedError(cause));
          }
        })()),
      handle: (handler) =>
        AsyncResult.from((async () => {
          if (handlers.has(queueType)) {
            return Result.err(toUnexpectedError(
              new Error(
                `Job handler for queue '${queueType}' is already registered`,
              ),
            ));
          }
          handlers.set(
            queueType,
            async (job) => await handler({
              job,
              trellis: args.trellis as Trellis<TTrellisApi>,
            }),
          );
          return okVoid();
        })()),
    } satisfies JobQueue<unknown, unknown, TTrellisApi>;
  }

  jobsFacade.startWorkers = (opts?: {
    queues?: readonly string[];
    instanceId?: string;
    version?: string;
  }) =>
    AsyncResult.from((async () => {
      const selectedQueues = opts?.queues
        ? [...opts.queues]
        : [...handlers.keys()];
      if (selectedQueues.length === 0) {
        return Result.ok(createNoopJobWorkerHost());
      }

      if (!args.jobsBinding || !args.workStream) {
        return Result.err(toUnexpectedError(
          new Error(
            "Jobs infrastructure bindings are unavailable for this service",
          ),
        ));
      }

      const jobsBinding = args.jobsBinding;
      const workStream = args.workStream;

      const hosts = [] as Array<{ stop(): Promise<void> }>;
      for (const queueType of selectedQueues) {
        const queueBinding = jobsBinding.queues[queueType];
        if (!queueBinding) {
          return Result.err(
            toUnexpectedError(new Error(`Unknown jobs queue '${queueType}'`)),
          );
        }
        const handler = handlers.get(queueType);
        if (!handler) {
          return Result.err(toUnexpectedError(
            new Error(`No job handler registered for queue '${queueType}'`),
          ));
        }

        const manager = new InternalJobManager<unknown, unknown>({
          nc: args.nc,
          jobs: jobsBinding,
        });
        const host = await startNatsWorkerHostFromBinding<unknown>({
          jobs: jobsBinding,
          workStream,
        }, {
          nats: args.nc,
          instanceId: opts?.instanceId ?? `${args.serviceName}-worker`,
          queueTypes: [queueType],
          manager,
          version: opts?.version,
          handler: async (job: InternalActiveJob<unknown, unknown>) => {
            const publicJob = new PublicActiveJob(
              createJobRef({
                nc: args.nc,
                queueType,
                jobsBinding,
                queueBinding,
                seed: job.job() as JobSnapshot<unknown, unknown>,
              }),
              job.job().payload,
              () => job.isCancelled(),
              {
                heartbeat: () => wrapVoidTask(() => job.heartbeat()),
                progress: (value: JobProgress) =>
                  wrapVoidTask(() => job.updateProgress(value)),
                log: (entry: JobLogEntry) =>
                  wrapVoidTask(() => job.log(entry.level, entry.message)),
                redeliveryCount: job.redeliveryCount(),
              },
            );

            const handled = await handler(publicJob);
            if (isErr(handled)) {
              throw InternalJobProcessError.failed(handled.error.message);
            }
            return handled;
          },
        });
        hosts.push(host);
      }

      return Result.ok(
        new JobWorkerHostAdapter({
          stop: () =>
            wrapVoidTask(async () => {
              for (const host of hosts) {
                await host.stop();
              }
            }),
          join: () => AsyncResult.ok(undefined),
        }),
      );
    })());

  return jobsFacade as JobsFacadeOf<TJobs, TTrellisApi>;
}

export class TrellisService<
  TOwnedApi extends TrellisAPI = TrellisAPI,
  TTrellisApi extends TrellisAPI = TOwnedApi,
  TJobs extends ContractJobsMetadata = {},
> {
  readonly name: string;
  readonly auth: SessionAuth;
  readonly nc: NatsConnection;
  readonly server: TrellisServerFor<TOwnedApi & TTrellisApi>;
  readonly operations: TrellisServerFor<TOwnedApi & TTrellisApi>["operations"];
  readonly trellis: ServiceTrellis<TOwnedApi, TTrellisApi>;
  readonly #handlerTrellis: Trellis<TTrellisApi>;
  readonly kv: Record<string, KVHandle>;
  readonly store: Record<string, StoreHandle>;
  readonly streams: Record<string, ResourceBindingStream>;
  readonly jobs: JobsFacadeOf<TJobs, TTrellisApi>;
  readonly health: ServiceHealth;
  readonly #operationTransfer: ServiceTransfer;
  readonly #stopHealthPublishing: () => Promise<void>;
  readonly #stopConnectionLogging: () => void;

  constructor(
    name: string,
    auth: SessionAuth,
    nc: NatsConnection,
    server: TrellisServerFor<TOwnedApi & TTrellisApi>,
    trellis: ServiceTrellis<TOwnedApi, TTrellisApi>,
    handlerTrellis: Trellis<TTrellisApi>,
    contractJobs: TJobs,
    bindings: ResourceBindings,
    operationTransfer: ServiceTransfer,
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
    this.#handlerTrellis = handlerTrellis;
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
    this.#operationTransfer = operationTransfer;
    this.streams = streamBindings;
    this.jobs = createJobsFacade<TJobs, TTrellisApi>({
      serviceName: name,
      nc,
      contractJobs,
      trellis: handlerTrellis,
      jobsBinding: bindings.jobs,
      workStream: bindings.streams?.jobsWork?.name,
    });
    this.health = health;
    this.#stopHealthPublishing = stopHealthPublishing;
    this.#stopConnectionLogging = stopConnectionLogging;
  }

  static async connect<
    TContract extends ServiceContract<
      TrellisAPI,
      TrellisAPI,
      ContractJobsMetadata
    >,
  >(
    args: TrellisServiceConnectArgs<TContract>,
    deps?: Partial<TrellisServiceRuntimeDeps>,
  ): Promise<
    TrellisService<
      ContractOwnedApi<TContract>,
      ContractTrellisApi<TContract>,
      ContractJobsOf<TContract>
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
    const { authenticator: authTokenAuthenticator, inboxPrefix } = await auth
      .natsConnectOptions();
    const nc = await runtimeDeps.connect({
      servers: selectRuntimeTransportServers(bootstrap.connectInfo.transports),
      inboxPrefix,
      authenticator: [
        authTokenAuthenticator,
        jwtAuthenticator(
          bootstrap.connectInfo.transport.sentinel.jwt,
          new TextEncoder().encode(
            bootstrap.connectInfo.transport.sentinel.seed,
          ),
        ),
      ],
    });

    return await createConnectedService<
      TOwnedApi,
      TTrellisApi,
      ContractJobsOf<TContract>
    >({
      name: args.name,
      auth,
      nc,
      contractId: args.contract.CONTRACT_ID,
      contractDigest: args.contract.CONTRACT_DIGEST,
      contractJobs:
        (args.contract[CONTRACT_JOBS_METADATA] ?? {}) as ContractJobsOf<
          TContract
        >,
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

    const { authenticator: authTokenAuthenticator, inboxPrefix } = await auth
      .natsConnectOptions();

    const nc = await connectFn({
      servers: opts.nats.servers,
      inboxPrefix,
      authenticator: [authTokenAuthenticator, authenticator],
      ...(opts.nats.options ?? {}),
    } as NatsConnectOpts);

    let bindings: ResourceBindings = { kv: {}, store: {}, streams: {} };

    if (opts.contractId && opts.contractDigest) {
      const resolvedLog = resolveServiceLogger(opts.server.log);
      const runtimeApi = (opts.server.trellisApi ?? opts.server.api) as
        & TOwnedApi
        & TTrellisApi;
      const outbound = new RootTrellis<TTrellisApi>(
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
      contractJobs: {},
      server: opts.server,
      bindings,
    });
  }

  async stop(): Promise<void> {
    this.#stopConnectionLogging();
    await this.#stopHealthPublishing();
    await this.#operationTransfer.stop();
    await this.server.stop();
  }

  request<M extends RpcMethodName<TTrellisApi>>(
    method: M,
    input: RpcMethodInput<TTrellisApi, M>,
    opts?: RequestOpts,
  ): AsyncResult<
    RpcMethodOutput<TTrellisApi, M>,
    RpcRequestErrorOf<TTrellisApi, M>
  > {
    return this.trellis.request(
      method as never,
      input as never,
      opts,
    ) as AsyncResult<
      RpcMethodOutput<TTrellisApi, M>,
      RpcRequestErrorOf<TTrellisApi, M>
    >;
  }

  operation<O extends keyof TOwnedApi["operations"] & string>(
    operation: O,
  ): OperationRegistration<TOwnedApi, TTrellisApi, O> {
    const registration = this.server.operation(operation) as RootOperationRegistration<
      InferSchemaType<TOwnedApi["operations"][O]["input"]>,
      OperationProgressOf<TOwnedApi, O>,
      OperationOutputOf<TOwnedApi, O>,
      OperationTransferContextOf<TOwnedApi, O>
    >;

    return {
      accept: (args) => registration.accept(args),
      handle: (
        handler: (
          args:
            & OperationHandlerContext<
              InferSchemaType<TOwnedApi["operations"][O]["input"]>,
              OperationProgressOf<TOwnedApi, O>,
              OperationOutputOf<TOwnedApi, O>,
              OperationTransferContextOf<TOwnedApi, O>
            >
            & { trellis: Trellis<TTrellisApi> },
        ) => unknown | Promise<unknown>,
      ) =>
        registration.handle((context) => handler({
          ...context,
          trellis: this.#handlerTrellis,
        })),
    };
  }
}
