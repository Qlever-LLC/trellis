import {
  jwtAuthenticator,
  type NatsConnection,
  type Subscription,
} from "@nats-io/nats-core";
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
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import {
  TrellisServiceRuntime,
  type TrellisServiceRuntimeFor,
} from "../server.ts";
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
import type {
  ContractJobsMetadata,
  ContractKvMetadata,
} from "../contract_support/mod.ts";
import {
  CONTRACT_JOBS_METADATA,
  CONTRACT_KV_METADATA,
} from "../contract_support/mod.ts";
import { AsyncResult, type BaseError, isErr, Result } from "@qlever-llc/result";
import { Type } from "typebox";
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
import {
  DEFAULT_RUNTIME_MAX_RECONNECT_ATTEMPTS,
  loadDefaultRuntimeTransport,
  selectRuntimeTransportServers,
} from "../runtime_transport.ts";
import { serverLogger } from "../server_logger.ts";
import {
  TransferError,
  TransportError,
  UnexpectedError,
} from "../errors/index.ts";
import type { ReceiveTransferGrant } from "../transfer.ts";
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
import {
  type Job as InternalJob,
  type JobEvent as InternalJobEvent,
  JobEventSchema,
} from "./internal_jobs/types.ts";
import {
  observeNatsTrellisConnection,
  type TrellisConnection,
} from "../connection.ts";

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
  workStream?: string;
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

type TrellisServiceRuntimeCreateOpts<
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

export type ResourceBindings = {
  kv: Record<string, ResourceBindingKV>;
  store: Record<string, ResourceBindingStore>;
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
    "Re-run the service deployment apply or instance provisioning flow so Trellis records the allowed digest, permissions, and resource bindings for this instance key.";
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
    connect: (
      { servers, token, authenticator, inboxPrefix, ...extraOptions },
    ) =>
      transport.connect({
        servers,
        ...extraOptions,
        ...(token ? { token } : {}),
        ...(authenticator ? { authenticator: authenticator as never } : {}),
        ...(inboxPrefix ? { inboxPrefix } : {}),
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
      sig: await args.auth.natsConnectSigForIat(iat, args.contractDigest),
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
      throw new TransportError({
        code: "trellis.bootstrap.failed",
        message: `Service bootstrap failed: ${
          failure.message ?? failure.reason
        }`,
        hint:
          "Retry the connection. If it keeps failing, check Trellis bootstrap availability and contract activation.",
        context: {
          trellisUrl: args.trellisUrl,
          contractId: args.contractId,
          contractDigest: args.contractDigest,
          status: settled.response.status,
          reason: failure.reason,
        },
      });
    }
    const detail = settled.responseText.trim();
    throw new TransportError({
      code: "trellis.bootstrap.failed",
      message: detail.length > 0
        ? `Service bootstrap failed with HTTP ${settled.response.status}: ${detail}`
        : `Service bootstrap failed with HTTP ${settled.response.status}`,
      hint:
        "Retry the connection. If it keeps failing, check Trellis bootstrap availability.",
      context: {
        trellisUrl: args.trellisUrl,
        contractId: args.contractId,
        contractDigest: args.contractDigest,
        status: settled.response.status,
      },
    });
  }

  if (settled.payload === undefined) {
    throw new TransportError({
      code: "trellis.bootstrap.invalid_response",
      message: `Service bootstrap returned invalid JSON: ${
        settled.responseText.trim() || "<empty body>"
      }`,
      hint:
        "Retry the connection. If it keeps happening, check the Trellis deployment.",
      context: {
        trellisUrl: args.trellisUrl,
        contractId: args.contractId,
        contractDigest: args.contractDigest,
      },
    });
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

async function openServiceKvBindings<TKv extends ContractKvMetadata>(args: {
  nc: NatsConnection;
  bindings: Record<string, ResourceBindingKV>;
  contractKv: TKv;
}): Promise<ServiceKvFacade<TKv>> {
  for (const alias of Object.keys(args.bindings)) {
    if (!args.contractKv[alias]) {
      throw new Error(
        `KV binding '${alias}' is missing contract schema metadata`,
      );
    }
  }

  const entries = await Promise.all(
    Object.entries(args.contractKv).map(async ([alias, metadata]) => {
      const binding = args.bindings[alias];
      if (!binding) {
        if (!metadata.required) {
          return [alias, undefined] as const;
        }
        throw new Error(`Required KV binding '${alias}' is unavailable`);
      }

      const store = await TypedKV.open(
        args.nc,
        binding.bucket,
        metadata.schema,
        {
          history: binding.history,
          ttl: binding.ttlMs,
          maxValueBytes: binding.maxValueBytes,
          bindOnly: true,
        },
      ).orThrow();

      return [alias, store] as const;
    }),
  );

  return Object.fromEntries(entries) as ServiceKvFacade<TKv>;
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

  server: TrellisServiceRuntimeCreateOpts<TOwnedApi, TTrellisApi>;
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
  TKv extends ContractKvMetadata = ContractKvMetadata,
  TJobs extends ContractJobsMetadata = {},
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
        trellis: Trellis<TTrellisApi, TKv, TJobs>;
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

type ServiceKvFacade<TKv extends ContractKvMetadata> = {
  [K in keyof TKv]: TKv[K]["required"] extends false
    ? TypedKV<TKv[K]["schema"]> | undefined
    : TypedKV<TKv[K]["schema"]>;
};

type ServiceHandlerResources<
  TKv extends ContractKvMetadata,
  TJobs extends ContractJobsMetadata,
  TTrellisApi extends TrellisAPI,
> = {
  kv: ServiceKvFacade<TKv>;
  store: Record<string, StoreHandle>;
  jobs: JobsFacadeOf<TJobs, TTrellisApi, TKv>;
};

export type Trellis<
  TTrellisApi extends TrellisAPI,
  TKv extends ContractKvMetadata = ContractKvMetadata,
  TJobs extends ContractJobsMetadata = {},
> =
  & HandlerTrellis<TTrellisApi>
  & ServiceHandlerResources<TKv, TJobs, TTrellisApi>;

type RequestOpts = {
  timeout?: number;
};

export type ServiceContract<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
  TJobs extends ContractJobsMetadata = {},
  TKv extends ContractKvMetadata = ContractKvMetadata,
> = {
  CONTRACT_ID: string;
  CONTRACT_DIGEST: string;
  API: {
    owned: TOwnedApi;
    trellis: TTrellisApi;
  };
  readonly [CONTRACT_JOBS_METADATA]?: TJobs;
  readonly [CONTRACT_KV_METADATA]?: TKv;
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
    ContractJobsMetadata,
    ContractKvMetadata
  >,
> = NonNullable<TContract[typeof CONTRACT_JOBS_METADATA]>;

type ContractKvOf<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI,
    ContractJobsMetadata,
    ContractKvMetadata
  >,
> = NonNullable<TContract[typeof CONTRACT_KV_METADATA]>;

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

/** Arguments passed to a typed Trellis service job handler. */
export type JobArgs<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI,
    ContractJobsMetadata,
    ContractKvMetadata
  >,
  TJob extends ContractJobName<TContract>,
> = {
  job: PublicActiveJob<
    ContractJobPayload<TContract, TJob>,
    ContractJobResult<TContract, TJob>
  >;
  trellis: Trellis<
    ContractTrellisApi<TContract>,
    ContractKvOf<TContract>,
    ContractJobsOf<TContract>
  >;
};

/** Result returned by a typed Trellis service job handler. */
export type JobResult<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI,
    ContractJobsMetadata,
    ContractKvMetadata
  >,
  TJob extends ContractJobName<TContract>,
> = Result<ContractJobResult<TContract, TJob>, BaseError>;

export type RpcHandler<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI,
    ContractJobsMetadata,
    ContractKvMetadata
  >,
  M extends RpcMethodName<ContractOwnedApi<TContract>>,
> = ({
  input,
  context,
  trellis,
}: {
  input: RpcMethodInput<ContractOwnedApi<TContract>, M>;
  context: RpcHandlerContext;
  trellis: Trellis<
    ContractTrellisApi<TContract>,
    ContractKvOf<TContract>,
    ContractJobsOf<TContract>
  >;
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
    ContractJobsMetadata,
    ContractKvMetadata
  >,
  TJob extends ContractJobName<TContract>,
> = (args: JobArgs<TContract, TJob>) => Promise<JobResult<TContract, TJob>>;

export type OperationHandler<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI,
    ContractJobsMetadata,
    ContractKvMetadata
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
      trellis: Trellis<
        ContractTrellisApi<TContract>,
        ContractKvOf<TContract>,
        ContractJobsOf<TContract>
      >;
    },
) => unknown | Promise<unknown>;

export type JobQueue<
  TPayload,
  TResult,
  TTrellisApi extends TrellisAPI,
  TKv extends ContractKvMetadata = ContractKvMetadata,
  TJobs extends ContractJobsMetadata = {},
> = {
  create(payload: TPayload): AsyncResult<JobRef<TPayload, TResult>, BaseError>;
  handle(
    handler: (args: {
      job: PublicActiveJob<TPayload, TResult>;
      trellis: Trellis<TTrellisApi, TKv, TJobs>;
    }) => Promise<Result<TResult, BaseError>>,
  ): void;
};

export type JobsFacadeOf<
  TJobs extends ContractJobsMetadata,
  TTrellisApi extends TrellisAPI,
  TKv extends ContractKvMetadata = ContractKvMetadata,
> = {
  [K in keyof TJobs]: JobQueue<
    TJobs[K]["payload"],
    TJobs[K]["result"],
    TTrellisApi,
    TKv,
    TJobs
  >;
};

const MANAGED_JOB_WORKERS = Symbol("trellis.managedJobWorkers");

type ManagedJobWorkers = {
  start(): AsyncResult<JobWorkerHostAdapter, BaseError>;
  stop(): AsyncResult<void, BaseError>;
};

type ManagedJobsFacade<
  TJobs extends ContractJobsMetadata,
  TTrellisApi extends TrellisAPI,
  TKv extends ContractKvMetadata = ContractKvMetadata,
> = JobsFacadeOf<TJobs, TTrellisApi, TKv> & {
  [MANAGED_JOB_WORKERS]: ManagedJobWorkers;
};

export type OperationRegistration<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
  O extends keyof TOwnedApi["operations"] & string,
  TKv extends ContractKvMetadata = ContractKvMetadata,
  TJobs extends ContractJobsMetadata = {},
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
        & { trellis: Trellis<TTrellisApi, TKv, TJobs> },
    ) => unknown | Promise<unknown>,
  ): Promise<void>;
};

export type TrellisServiceConnectArgs<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI,
    ContractJobsMetadata,
    ContractKvMetadata
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
  TKv extends ContractKvMetadata = {},
> = TrellisServiceRuntimeConnectOpts<TOwnedApi, TTrellisApi> & {
  contractId?: string;
  contractDigest: string;
  contractKv?: TKv;
};

export async function createConnectedService<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
  TJobs extends ContractJobsMetadata = {},
  TKv extends ContractKvMetadata = ContractKvMetadata,
>(args: {
  name: string;
  auth: SessionAuth;
  nc: NatsConnection;
  contractId?: string;
  contractDigest?: string;
  contractJobs: TJobs;
  contractKv: TKv;
  server: TrellisServiceRuntimeCreateOpts<TOwnedApi, TTrellisApi>;
  bindings: ResourceBindings;
}): Promise<TrellisService<TOwnedApi, TTrellisApi, TJobs, TKv>> {
  const resolvedLog = resolveServiceLogger(args.server.log);
  const connection = observeNatsTrellisConnection({
    kind: "service",
    nc: args.nc,
    log: false,
    lifecycleLog: {
      log: resolvedLog,
      context: { service: args.name },
    },
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
  } as TOwnedApi & TTrellisApi;

  const server = TrellisServiceRuntime.create(
    args.name,
    args.nc,
    { sessionKey: args.auth.sessionKey, sign: args.auth.sign },
    {
      log: resolvedLog,
      timeout: args.server.timeout,
      stream: args.server.stream,
      noResponderRetry: args.server.noResponderRetry,
      api: runtimeApi,
      connection,
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
      connection,
    },
  );

  let transfer: ServiceTransfer | undefined;
  const getTransfer = (): ServiceTransfer => {
    if (!transfer) {
      throw new Error("service transfer helper accessed before initialization");
    }
    return transfer;
  };
  let handlerResources:
    | ServiceHandlerResources<TKv, TJobs, TTrellisApi>
    | undefined;
  const getHandlerResources = (): ServiceHandlerResources<
    TKv,
    TJobs,
    TTrellisApi
  > => {
    if (!handlerResources) {
      throw new Error(
        "service resource handles accessed before initialization",
      );
    }
    return handlerResources;
  };

  const handlerTrellis: Trellis<TTrellisApi, TKv, TJobs> = {
    request: outbound.request.bind(outbound),
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
    get jobs() {
      return getHandlerResources().jobs;
    },
  };
  const trellis = Object.assign(
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
          trellis: Trellis<TTrellisApi, TKv, TJobs>;
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
        server.mountRuntime(
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
  ) as ServiceTrellis<TOwnedApi, TTrellisApi, TKv, TJobs>;

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

  const kv = await openServiceKvBindings({
    nc: args.nc,
    bindings: args.bindings.kv ?? {},
    contractKv: args.contractKv,
  });

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

  const service = new TrellisService<TOwnedApi, TTrellisApi, TJobs, TKv>(
    args.name,
    args.auth,
    args.nc,
    server,
    trellis,
    handlerTrellis,
    kv,
    args.contractJobs,
    args.bindings,
    operationTransfer,
    health,
    stopHealthPublishing,
    connection,
  );
  handlerResources = {
    kv: service.kv,
    store: service.store,
    jobs: service.jobs,
  };
  transfer = operationTransfer;

  if (heartbeatEventEnabled) {
    await publishHealthHeartbeat();
    healthPublishTimer = setInterval(() => {
      void publishHealthHeartbeat();
    }, health.publishIntervalMs);
    void args.nc.closed().finally(stopHealthPublishing);
  }

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

function isTerminalJobSnapshot<TPayload, TResult>(
  snapshot: JobSnapshot<TPayload, TResult>,
): snapshot is TerminalJob<TPayload, TResult> {
  return isTerminalJobState(snapshot.state);
}

function operationOutputsEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => operationOutputsEqual(value, right[index]));
  }
  if (typeof left === "object") {
    if (Object.getPrototypeOf(left) !== Object.prototype) return false;
    if (Object.getPrototypeOf(right) !== Object.prototype) return false;
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key) =>
        Object.hasOwn(rightRecord, key) &&
        operationOutputsEqual(leftRecord[key], rightRecord[key])
      );
  }
  return false;
}

function parseJobLifecycleEvent<TPayload, TResult>(
  data: Uint8Array,
): InternalJobEvent<TPayload, TResult> | undefined {
  try {
    const decoded = JSON.parse(new TextDecoder().decode(data));
    if (!Value.Check(JobEventSchema, decoded)) {
      return undefined;
    }
    return decoded as InternalJobEvent<TPayload, TResult>;
  } catch {
    return undefined;
  }
}

function jobLifecycleKey(service: string, jobType: string, jobId: string): string {
  return `${service}.${jobType}.${jobId}`;
}

function subjectMatchesLifecycleEvent(
  subject: string,
  queueBinding: ResourceBindingJobsQueue,
  event: InternalJobEvent,
): boolean {
  const prefix = `${queueBinding.publishPrefix}.`;
  if (!subject.startsWith(prefix)) return false;

  const suffix = subject.slice(prefix.length).split(".");
  return suffix.length === 2 && suffix[0] === event.jobId &&
    suffix[1] === event.eventType;
}

function snapshotFromLifecycleEvent<TPayload, TResult>(
  current: JobSnapshot<TPayload, TResult>,
  event: InternalJobEvent<TPayload, TResult>,
): JobSnapshot<TPayload, TResult> {
  if (
    event.service !== current.service || event.jobType !== current.type ||
    event.jobId !== current.id
  ) {
    return current;
  }
  if (isTerminalJobState(current.state)) {
    return current;
  }

  const base: JobSnapshot<TPayload, TResult> = {
    ...current,
    state: event.state,
    updatedAt: event.timestamp,
    tries: event.tries,
    ...(event.maxTries !== undefined ? { maxTries: event.maxTries } : {}),
    ...(event.deadline !== undefined ? { deadline: event.deadline } : {}),
  };

  switch (event.eventType) {
    case "created":
    case "retried":
      return event.payload === undefined ? base : {
        ...base,
        payload: event.payload,
      };
    case "started":
      return { ...base, startedAt: event.timestamp };
    case "progress":
      return event.progress === undefined ? base : {
        ...base,
        progress: event.progress,
      };
    case "logged":
      return event.logs === undefined ? base : {
        ...base,
        logs: [...(current.logs ?? []), ...event.logs],
      };
    case "completed":
      return {
        ...base,
        completedAt: event.timestamp,
        ...(event.result !== undefined ? { result: event.result } : {}),
      };
    case "failed":
    case "cancelled":
    case "expired":
    case "dead":
    case "dismissed":
      return event.error === undefined ? base : {
        ...base,
        lastError: event.error,
      };
  }

  return base;
}

type JobLifecycleWaiter<TPayload, TResult> = {
  resolve(snapshot: TerminalJob<TPayload, TResult>): void;
  reject(cause: BaseError): void;
};

type JobLifecycleTracker = {
  watch(queueBinding: ResourceBindingJobsQueue): void;
  seed<TPayload, TResult>(snapshot: JobSnapshot<TPayload, TResult>): void;
  get<TPayload, TResult>(args: {
    service: string;
    jobType: string;
    id: string;
  }): JobSnapshot<TPayload, TResult> | undefined;
  apply<TPayload, TResult>(
    event: InternalJobEvent<TPayload, TResult>,
  ): JobSnapshot<TPayload, TResult> | undefined;
  wait<TPayload, TResult>(
    snapshot: JobSnapshot<TPayload, TResult>,
  ): Promise<TerminalJob<TPayload, TResult>>;
  stop(): void;
};

function createJobLifecycleTracker(nc: NatsConnection): JobLifecycleTracker {
  const snapshots = new Map<string, JobSnapshot<unknown, unknown>>();
  const waiters = new Map<string, JobLifecycleWaiter<unknown, unknown>[]>();
  const subscriptions = new Map<string, Subscription>();
  let stopped = false;

  const notify = (key: string, snapshot: JobSnapshot<unknown, unknown>) => {
    if (!isTerminalJobSnapshot(snapshot)) return;
    const pending = waiters.get(key) ?? [];
    waiters.delete(key);
    for (const waiter of pending) waiter.resolve(snapshot);
  };

  const apply = <TPayload, TResult>(
    event: InternalJobEvent<TPayload, TResult>,
  ): JobSnapshot<TPayload, TResult> | undefined => {
    const key = jobLifecycleKey(event.service, event.jobType, event.jobId);
    const current = snapshots.get(key) as
      | JobSnapshot<TPayload, TResult>
      | undefined;
    if (!current) return undefined;

    const next = snapshotFromLifecycleEvent(current, event);
    snapshots.set(key, next as JobSnapshot<unknown, unknown>);
    notify(key, next as JobSnapshot<unknown, unknown>);
    return next;
  };

  return {
    watch(queueBinding) {
      if (subscriptions.has(queueBinding.publishPrefix)) return;

      const subscription = nc.subscribe(`${queueBinding.publishPrefix}.*.*`);
      subscriptions.set(queueBinding.publishPrefix, subscription);
      void (async () => {
        for await (const msg of subscription) {
          const event = parseJobLifecycleEvent(msg.data);
          if (!event || !subjectMatchesLifecycleEvent(
            msg.subject,
            queueBinding,
            event,
          )) {
            continue;
          }
          apply(event);
        }
      })();
    },
    seed<TPayload, TResult>(snapshot: JobSnapshot<TPayload, TResult>) {
      const key = jobLifecycleKey(snapshot.service, snapshot.type, snapshot.id);
      const current = snapshots.get(key) as
        | JobSnapshot<TPayload, TResult>
        | undefined;
      if (current && isTerminalJobState(current.state)) return;
      snapshots.set(key, snapshot as JobSnapshot<unknown, unknown>);
      notify(key, snapshot as JobSnapshot<unknown, unknown>);
    },
    get<TPayload, TResult>(args: {
      service: string;
      jobType: string;
      id: string;
    }) {
      const current = snapshots.get(
        jobLifecycleKey(args.service, args.jobType, args.id),
      );
      return current as JobSnapshot<TPayload, TResult> | undefined;
    },
    apply,
    wait<TPayload, TResult>(snapshot: JobSnapshot<TPayload, TResult>) {
      this.seed(snapshot);
      const key = jobLifecycleKey(snapshot.service, snapshot.type, snapshot.id);
      const current = snapshots.get(key) as
        | JobSnapshot<TPayload, TResult>
        | undefined;
      if (current && isTerminalJobSnapshot(current)) {
        return Promise.resolve(current);
      }
      if (stopped) {
        return Promise.reject(toUnexpectedError(
          new Error("job lifecycle tracker stopped"),
        ));
      }

      return new Promise((resolve, reject) => {
        const pending = waiters.get(key) ?? [];
        pending.push({
          resolve: resolve as (snapshot: TerminalJob<unknown, unknown>) => void,
          reject,
        });
        waiters.set(key, pending);
      });
    },
    stop() {
      stopped = true;
      for (const subscription of subscriptions.values()) {
        subscription.unsubscribe();
      }
      subscriptions.clear();
      const error = toUnexpectedError(new Error("job lifecycle tracker stopped"));
      for (const pending of waiters.values()) {
        for (const waiter of pending) waiter.reject(error);
      }
      waiters.clear();
    },
  };
}

function createJobRef<TPayload, TResult>(args: {
  nc: NatsConnection;
  queueType: string;
  jobsBinding: ResourceBindingJobs;
  queueBinding: ResourceBindingJobsQueue;
  seed: JobSnapshot<TPayload, TResult>;
  lifecycle: JobLifecycleTracker;
}): JobRef<TPayload, TResult> {
  args.lifecycle.seed(args.seed);

  return new JobRef<TPayload, TResult>(
    {
      id: args.seed.id,
      service: args.seed.service,
      jobType: args.queueType,
    },
    {
      get: () => AsyncResult.ok(
        args.lifecycle.get<TPayload, TResult>({
          service: args.seed.service,
          jobType: args.queueType,
          id: args.seed.id,
        }) ?? args.seed,
      ),
      wait: () =>
        AsyncResult.from((async () => {
          try {
            return Result.ok(await args.lifecycle.wait(args.seed));
          } catch (cause) {
            return Result.err(toUnexpectedError(cause));
          }
        })()),
      cancel: () =>
        AsyncResult.from((async () => {
          const current = args.lifecycle.get<TPayload, TResult>({
            service: args.seed.service,
            jobType: args.queueType,
            id: args.seed.id,
          }) ?? args.seed;
          if (isTerminalJobState(current.state)) {
            return Result.ok(current);
          }

          const event: InternalJobEvent<TPayload, TResult> = {
            jobId: args.seed.id,
            service: current.service,
            jobType: args.queueType,
            eventType: "cancelled",
            state: "cancelled",
            previousState: current.state,
            tries: current.tries,
            error: "cancelled",
            timestamp: new Date().toISOString(),
          };

          try {
            args.nc.publish(
              `${args.queueBinding.publishPrefix}.${args.seed.id}.cancelled`,
              new TextEncoder().encode(JSON.stringify(event)),
            );
          } catch (cause) {
            return Result.err(toUnexpectedError(cause));
          }

          return Result.ok(args.lifecycle.apply(event) ?? current);
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

async function closeFailedServiceBootstrapConnection(
  nc: NatsConnection,
): Promise<void> {
  if (nc.isClosed()) {
    return;
  }

  try {
    await nc.drain();
  } catch {
    await nc.closed().catch(() => undefined);
  }
}

function createJobsFacade<
  TJobs extends ContractJobsMetadata,
  TTrellisApi extends TrellisAPI,
  TKv extends ContractKvMetadata = ContractKvMetadata,
>(args: {
  serviceName: string;
  nc: NatsConnection;
  contractJobs: TJobs;
  trellis: Trellis<TTrellisApi, TKv, TJobs>;
  jobsBinding?: ResourceBindingJobs;
  workStream?: string;
}): ManagedJobsFacade<TJobs, TTrellisApi, TKv> {
  const handlers = new Map<string, RegisteredJobHandler<unknown, unknown>>();
  const jobsFacade: Record<string, unknown> = {};
  const lifecycle = createJobLifecycleTracker(args.nc);
  let activeHost: JobWorkerHostAdapter | undefined;
  let startupPromise:
    | Promise<Result<JobWorkerHostAdapter, BaseError>>
    | undefined;
  let stopPromise: Promise<Result<void, BaseError>> | undefined;

  for (const queueType of Object.keys(args.contractJobs ?? {})) {
    const queueBinding = args.jobsBinding?.queues[queueType];
    if (queueBinding) lifecycle.watch(queueBinding);

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
            await args.nc.flush();
            const created = await manager.create(queueType, payload);
            return Result.ok(createJobRef({
              nc: args.nc,
              queueType,
              jobsBinding,
              queueBinding,
              seed: created as JobSnapshot<unknown, unknown>,
              lifecycle,
            }));
          } catch (cause) {
            return Result.err(toUnexpectedError(cause));
          }
        })()),
      handle: (handler) => {
        if (handlers.has(queueType)) {
          throw new Error(
            `Job handler for queue '${queueType}' is already registered`,
          );
        }
        if (activeHost || startupPromise) {
          throw new Error(
            `Job handler for queue '${queueType}' cannot be registered after worker startup has begun`,
          );
        }
        handlers.set(
          queueType,
          async (job) =>
            await handler({
              job,
              trellis: args.trellis,
            }),
        );
      },
    } satisfies JobQueue<unknown, unknown, TTrellisApi, TKv>;
  }

  const managedWorkers: ManagedJobWorkers = {
    start: () => {
      if (activeHost) {
        return AsyncResult.ok(activeHost);
      }
      if (startupPromise) {
        return AsyncResult.from(startupPromise);
      }

      startupPromise = (async () => {
        const selectedQueues = [...handlers.keys()];
        if (selectedQueues.length === 0) {
          const host = createNoopJobWorkerHost();
          activeHost = host;
          return Result.ok(host);
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
        try {
          for (const queueType of selectedQueues) {
            const queueBinding = jobsBinding.queues[queueType];
            if (!queueBinding) {
              throw new Error(`Unknown jobs queue '${queueType}'`);
            }
            const handler = handlers.get(queueType);
            if (!handler) {
              throw new Error(
                `No job handler registered for queue '${queueType}'`,
              );
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
              instanceId: `${args.serviceName}-worker`,
              queueTypes: [queueType],
              manager,
              getProjectedJob: async (job) => {
                return lifecycle.get({
                  service: job.service,
                  jobType: job.type,
                  id: job.id,
                });
              },
              handler: async (job: InternalActiveJob<unknown, unknown>) => {
                const publicJob = new PublicActiveJob(
                  createJobRef({
                    nc: args.nc,
                    queueType,
                    jobsBinding,
                    queueBinding,
                    seed: job.job() as JobSnapshot<unknown, unknown>,
                    lifecycle,
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

                const handled = (await handler(publicJob)).take();
                if (isErr(handled)) {
                  throw InternalJobProcessError.failed(handled.error.message);
                }
                return handled;
              },
            });
            hosts.push(host);
          }
        } catch (cause) {
          const stopResults = await Promise.allSettled(
            hosts.map((host) => host.stop()),
          );
          const stopErrors = stopResults
            .filter((result): result is PromiseRejectedResult =>
              result.status === "rejected"
            )
            .map((result) => result.reason);
          if (stopErrors.length > 0) {
            return Result.err(
              toUnexpectedError(new AggregateError([cause, ...stopErrors])),
            );
          }
          return Result.err(toUnexpectedError(cause));
        }

        activeHost = new JobWorkerHostAdapter({
          stop: () =>
            wrapVoidTask(async () => {
              for (const host of hosts) {
                await host.stop();
              }
            }),
          join: () => AsyncResult.ok(undefined),
        });
        return Result.ok(activeHost);
      })().finally(() => {
        startupPromise = undefined;
      });

      return AsyncResult.from(startupPromise);
    },
    stop: () => {
      if (stopPromise) {
        return AsyncResult.from(stopPromise);
      }
      stopPromise = (async () => {
        const startup = startupPromise;
        if (startup) {
          const started = await startup;
          if (isErr(started)) {
            return Result.ok(undefined);
          }
        }
        if (!activeHost) {
          lifecycle.stop();
          return Result.ok(undefined);
        }

        const host = activeHost;
        try {
          return await host.stop();
        } finally {
          lifecycle.stop();
          if (activeHost === host) {
            activeHost = undefined;
          }
          stopPromise = undefined;
        }
      })();

      return AsyncResult.from(stopPromise);
    },
  };

  Object.defineProperty(jobsFacade, MANAGED_JOB_WORKERS, {
    value: managedWorkers,
    enumerable: false,
  });

  return jobsFacade as ManagedJobsFacade<TJobs, TTrellisApi, TKv>;
}

export class TrellisService<
  TOwnedApi extends TrellisAPI = TrellisAPI,
  TTrellisApi extends TrellisAPI = TOwnedApi,
  TJobs extends ContractJobsMetadata = {},
  TKv extends ContractKvMetadata = ContractKvMetadata,
> {
  readonly name: string;
  readonly auth: SessionAuth;
  readonly nc: NatsConnection;
  readonly #server: TrellisServiceRuntimeFor<TOwnedApi & TTrellisApi>;
  readonly trellis: ServiceTrellis<TOwnedApi, TTrellisApi, TKv, TJobs>;
  readonly #handlerTrellis: Trellis<TTrellisApi, TKv, TJobs>;
  readonly kv: ServiceKvFacade<TKv>;
  readonly store: Record<string, StoreHandle>;
  readonly jobs: JobsFacadeOf<TJobs, TTrellisApi, TKv>;
  readonly health: ServiceHealth;
  /** Framework-neutral lifecycle handle for the service runtime connection. */
  readonly connection: TrellisConnection;
  readonly #operationTransfer: ServiceTransfer;
  readonly #stopHealthPublishing: () => Promise<void>;
  readonly #managedJobWorkers: ManagedJobWorkers;
  #waitPromise?: Promise<void>;
  #stopPromise?: Promise<void>;

  constructor(
    name: string,
    auth: SessionAuth,
    nc: NatsConnection,
    server: TrellisServiceRuntimeFor<TOwnedApi & TTrellisApi>,
    trellis: ServiceTrellis<TOwnedApi, TTrellisApi, TKv, TJobs>,
    handlerTrellis: Trellis<TTrellisApi, TKv, TJobs>,
    kv: ServiceKvFacade<TKv>,
    contractJobs: TJobs,
    bindings: ResourceBindings,
    operationTransfer: ServiceTransfer,
    health: ServiceHealth,
    stopHealthPublishing: () => Promise<void>,
    connection: TrellisConnection,
  ) {
    const storeBindings = bindings.store ?? {};

    this.name = name;
    this.auth = auth;
    this.nc = nc;
    this.#server = server;
    Object.defineProperty(this, "server", {
      value: server,
      enumerable: false,
    });
    this.trellis = trellis;
    this.#handlerTrellis = handlerTrellis;
    this.kv = kv;
    this.store = Object.fromEntries(
      Object.entries(storeBindings).map((
        [alias, binding],
      ) => [alias, new StoreHandle(nc, binding)]),
    );
    this.#operationTransfer = operationTransfer;
    const jobs = createJobsFacade<TJobs, TTrellisApi, TKv>({
      serviceName: name,
      nc,
      contractJobs,
      trellis: handlerTrellis,
      jobsBinding: bindings.jobs,
      workStream: bindings.jobs?.workStream,
    });
    this.jobs = jobs;
    this.#managedJobWorkers = jobs[MANAGED_JOB_WORKERS];
    this.health = health;
    this.connection = connection;
    this.#stopHealthPublishing = stopHealthPublishing;
  }

  /**
   * Creates a short-lived receive transfer grant for a caller session.
   */
  createTransfer(args: {
    direction: "receive";
    store: string;
    key: string;
    sessionKey: string;
    expiresInMs?: number;
  }): AsyncResult<ReceiveTransferGrant, TransferError> {
    return AsyncResult.from(
      this.#operationTransfer.initiateDownload({
        store: args.store,
        key: args.key,
        sessionKey: args.sessionKey,
        expiresInMs: args.expiresInMs ?? 60_000,
      }),
    );
  }

  /**
   * Completes an operation from Trellis-owned control-plane code that resolves
   * an operation from a separate RPC handler.
   *
   * @internal
   */
  completeOperation(
    operationId: string,
    output: unknown,
  ): AsyncResult<unknown, UnexpectedError> {
    return AsyncResult.from((async () => {
      const completed = await this.#server.operations.complete(
        operationId,
        output,
      ).take();
      if (!isErr(completed)) return Result.ok(completed);

      const current = await this.#server.operations.get(operationId).take();
      if (!isErr(current) && current.state === "completed") {
        if (!operationOutputsEqual(current.output, output)) {
          return Result.err(
            new UnexpectedError({
              cause: new Error(
                "operation already completed with different output",
              ),
            }),
          );
        }
        return Result.ok(current);
      }

      return Result.err(completed.error);
    })());
  }

  static connect<
    const TContract extends ServiceContract<
      TrellisAPI,
      TrellisAPI,
      ContractJobsMetadata,
      ContractKvMetadata
    >,
  >(
    args: TrellisServiceConnectArgs<TContract>,
    deps?: Partial<TrellisServiceRuntimeDeps>,
  ): AsyncResult<
    TrellisService<
      ContractOwnedApi<TContract>,
      ContractTrellisApi<TContract>,
      ContractJobsOf<TContract>,
      ContractKvOf<TContract>
    >,
    TransportError | UnexpectedError
  > {
    return AsyncResult.from((async () => {
      try {
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
        const { authenticator: authTokenAuthenticator, inboxPrefix } =
          await auth
            .natsConnectOptions({
              contractDigest: args.contract.CONTRACT_DIGEST,
            });

        let nc: NatsConnection;
        try {
          nc = await runtimeDeps.connect({
            servers: selectRuntimeTransportServers(
              bootstrap.connectInfo.transports,
            ),
            maxReconnectAttempts: DEFAULT_RUNTIME_MAX_RECONNECT_ATTEMPTS,
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
        } catch (cause) {
          throw new TransportError({
            code: "trellis.runtime.connect_failed",
            message: "Trellis could not open the service runtime connection.",
            hint:
              "Retry the connection. If it keeps failing, check Trellis transport availability.",
            cause,
            context: {
              trellisUrl: args.trellisUrl,
              contractId: args.contract.CONTRACT_ID,
              contractDigest: args.contract.CONTRACT_DIGEST,
            },
          });
        }

        try {
          return Result.ok(
            await createConnectedService<
              TOwnedApi,
              TTrellisApi,
              ContractJobsOf<TContract>,
              ContractKvOf<TContract>
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
              contractKv:
                (args.contract[CONTRACT_KV_METADATA] ?? {}) as ContractKvOf<
                  TContract
                >,
              server: {
                ...(args.server ?? {}),
                api: args.contract.API.owned,
                trellisApi: args.contract.API.trellis,
              },
              bindings: bootstrap.binding.resources,
            }),
          );
        } catch (cause) {
          await closeFailedServiceBootstrapConnection(nc);
          throw cause;
        }
      } catch (cause) {
        return Result.err(
          cause instanceof TransportError ? cause : toUnexpectedError(cause),
        );
      }
    })());
  }

  /**
   * Starts managed job workers for registered handlers and waits for shutdown.
   */
  async wait(): Promise<void> {
    this.#waitPromise ??= (async () => {
      try {
        await this.#managedJobWorkers.start().orThrow();
        const closed = await this.nc.closed();
        if (closed instanceof Error) {
          throw closed;
        }
      } finally {
        await this.stop();
      }
    })();

    await this.#waitPromise;
  }

  async stop(): Promise<void> {
    this.#stopPromise ??= (async () => {
      this.connection.stopObserving();

      try {
        await this.#stopHealthPublishing();
      } finally {
        try {
          await this.#managedJobWorkers.stop().orThrow();
        } finally {
          try {
            await this.#operationTransfer.stop();
          } finally {
            await this.#server.stop();
          }
        }
      }
    })();

    await this.#stopPromise;
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
  ): OperationRegistration<TOwnedApi, TTrellisApi, O, TKv, TJobs> {
    const registration = this.#server.operation(
      operation,
    ) as RootOperationRegistration<
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
            & { trellis: Trellis<TTrellisApi, TKv, TJobs> },
        ) => unknown | Promise<unknown>,
      ) =>
        registration.handle((context) =>
          handler({
            ...context,
            trellis: this.#handlerTrellis,
          })
        ),
    };
  }
}
