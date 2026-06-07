import {
  headers as natsHeaders,
  jwtAuthenticator,
  type MsgHdrs,
  type NatsConnection,
  type Subscription,
} from "@nats-io/nats-core";
import {
  type KVError,
  type StoreError,
  type StoreWaitOptions,
  TypedKV,
  TypedStore,
  TypedStoreEntry,
} from "../index.ts";
import { sdk as trellisAuth } from "../sdk/auth.ts";
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
} from "../auth.ts";
import {
  ContractResourceBindingsSchema,
  type InferSchemaType,
} from "../contracts.ts";
import type { TrellisAPI } from "../contracts.ts";
import type { TrellisContractV1 } from "../contract_support/mod.ts";
import type {
  ContractEventConsumers,
  ContractJobsMetadata,
  ContractKvMetadata,
} from "../contract_support/mod.ts";
import {
  CONTRACT_JOBS_METADATA,
  CONTRACT_KV_METADATA,
} from "../contract_support/mod.ts";
import {
  AsyncResult,
  type BaseError,
  isErr,
  type MaybeAsync,
  Result,
} from "@qlever-llc/result";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  type HealthCheckFn,
  ServiceHealth,
  type ServiceHealthCheck,
  type ServiceHealthInfo,
} from "./health.ts";
import { mountStandardHealthRpc } from "./health_rpc.ts";
import type { EventDesc, RPCDesc } from "../contracts.ts";
import type {
  AcceptedOperation,
  ActiveEventFacade,
  ActiveEventPublishFacade,
  EventListenerContext,
  EventOpts,
  FeedEventOf,
  FeedInputOf,
  FeedRegistration as RootFeedRegistration,
  HandlerTrellis,
  OperationHandlerContext,
  OperationOutputOf,
  OperationProgressOf,
  OperationRegistration as RootOperationRegistration,
  OperationRuntimeHandle,
  OperationTransferContextOf,
  PreparedTrellisEvent,
  RpcHandlerContext,
  RpcHandlerErrorOf,
} from "../trellis.ts";
import {
  annotateHandlerBoundaryError,
  createTrellisInternal,
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
  DEFAULT_SERVICE_RUNTIME_WAIT_ON_FIRST_CONNECT,
  loadDefaultRuntimeTransport,
  selectRuntimeTransportServers,
} from "../runtime_transport.ts";
import { serverLogger } from "../server_logger.ts";
import {
  TransferError,
  TransportError,
  UnexpectedError,
  ValidationError,
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
  type JobContext as InternalJobContext,
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

type ResourceBindingEventConsumer = {
  stream: string;
  consumerName: string;
  filterSubjects: string[];
  replay: "new" | "all";
  ordering: "strict";
  concurrency: number;
  ackWaitMs: number;
  maxDeliver: number;
  backoffMs: number[];
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
  requestId?: string;
  planId?: string;
  deploymentId?: string;
  issueId?: string;
  activeContractDigest?: string;
  dependencyAlias?: string;
  dependencyContractId?: string;
  dependencySurface?: string;
  dependencyReason?: string;
  dependencyKey?: string;
  dependencyMessage?: string;
};

const DEFAULT_BOOTSTRAP_PENDING_RETRY_MS = 5_000;
const MAX_BOOTSTRAP_PENDING_RETRY_MS = 60_000;
const DEFAULT_BOOTSTRAP_UNAVAILABLE_INITIAL_RETRY_MS = 1_000;
const MAX_BOOTSTRAP_UNAVAILABLE_RETRY_MS = 30_000;

function dependencyWaitLogMessage(failure: ServiceBootstrapFailure): string {
  if (failure.dependencyMessage) {
    return `Service contract activation pending; ${failure.dependencyMessage}`;
  }
  if (failure.dependencyContractId) {
    const dependency = failure.dependencyAlias
      ? `dependency '${failure.dependencyAlias}' (${failure.dependencyContractId})`
      : `dependency ${failure.dependencyContractId}`;
    if (failure.dependencyReason === "dependency_not_active") {
      return `Service contract activation pending; waiting for ${dependency} to have an active running implementation`;
    }
    if (failure.dependencyReason === "unknown") {
      return `Service contract activation pending; waiting for ${dependency} to be installed or approved`;
    }
    if (failure.dependencyKey) {
      return `Service contract activation pending; waiting for ${dependency} to provide required ${
        failure.dependencySurface ?? "surface"
      } '${failure.dependencyKey}'`;
    }
    return `Service contract activation pending; waiting for ${dependency}`;
  }
  return failure.message ??
    "Service contract activation pending; waiting for dependency closure";
}

type RpcMethodName<TA extends TrellisAPI> = keyof TA["rpc"] & string;
type RpcMethodInput<TA extends TrellisAPI, M extends RpcMethodName<TA>> =
  InferSchemaType<TA["rpc"][M]["input"]>;
type RpcMethodOutput<TA extends TrellisAPI, M extends RpcMethodName<TA>> =
  InferSchemaType<TA["rpc"][M]["output"]>;
type TrellisServiceRuntimeCreateOpts<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI | undefined = TOwnedApi,
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

function surfaceGroupName(key: string): string {
  return lowerCamelIdent(key.split(".")[0] ?? key);
}

function surfaceLeafName(key: string): string {
  const parts = key.split(".");
  parts.shift();
  return lowerCamelIdent(parts.length === 0 ? key : parts.join("."));
}

function lowerCamelIdent(value: string): string {
  const pascal = value
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
  return pascal.length === 0 ? "_" : pascal[0]!.toLowerCase() + pascal.slice(1);
}

function addSurfaceLeaf<TLeaf>(
  surface: Record<string, Record<string, TLeaf>>,
  key: string,
  leaf: TLeaf,
): void {
  const group = surfaceGroupName(key);
  surface[group] ??= {};
  surface[group][surfaceLeafName(key)] = leaf;
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
  eventConsumers?: Record<string, ResourceBindingEventConsumer>;
};

const storeHandleConstructorToken: unique symbol = Symbol(
  "StoreHandle.constructorToken",
);

const trellisServiceConstructorToken: unique symbol = Symbol(
  "TrellisService.constructorToken",
);

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
    "Accept the pending deployment authority plan or re-run authority reconciliation so Trellis records current permissions and resource bindings for this instance key.";
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bootstrapRetryDelayMs(response: Response): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter === null) return DEFAULT_BOOTSTRAP_PENDING_RETRY_MS;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, MAX_BOOTSTRAP_PENDING_RETRY_MS);
  }

  const retryAt = Date.parse(retryAfter);
  if (Number.isNaN(retryAt)) return DEFAULT_BOOTSTRAP_PENDING_RETRY_MS;
  return Math.min(
    Math.max(0, retryAt - Date.now()),
    MAX_BOOTSTRAP_PENDING_RETRY_MS,
  );
}

function bootstrapUnavailableRetryDelayMs(attempt: number): number {
  const exponent = Math.min(attempt, 10);
  return Math.min(
    DEFAULT_BOOTSTRAP_UNAVAILABLE_INITIAL_RETRY_MS * 2 ** exponent,
    MAX_BOOTSTRAP_UNAVAILABLE_RETRY_MS,
  );
}

class ServiceBootstrapEndpointUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Service bootstrap endpoint is unavailable.", { cause });
    this.name = "ServiceBootstrapEndpointUnavailableError";
  }
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
  bootstrapUrl: URL;
  contractId: string;
  contractDigest: string;
  contract?: TrellisContractV1;
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
  const body = JSON.stringify({
    sessionKey: args.auth.sessionKey,
    contractId: args.contractId,
    contractDigest: args.contractDigest,
    ...(args.contract ? { contract: args.contract } : {}),
    iat,
    sig: await args.auth.natsConnectSigForIat(iat, args.contractDigest),
  });
  let response: Response;
  try {
    response = await fetch(args.bootstrapUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } catch (cause) {
    throw new ServiceBootstrapEndpointUnavailableError(cause);
  }
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
  serviceName: string;
  contractId: string;
  contractDigest: string;
  contract?: TrellisContractV1;
  auth: SessionAuth;
  log: LoggerLike;
}): Promise<ServiceBootstrapResponse> {
  const bootstrapUrl = new URL("/bootstrap/service", args.trellisUrl);
  let includeContract = false;
  let unavailableAttempt = 0;
  const loggedPendingRequests = new Set<string>();
  while (true) {
    let settled: Awaited<ReturnType<typeof fetchServiceBootstrapInfoOnce>>;
    try {
      settled = await fetchServiceBootstrapInfoOnce({
        ...args,
        bootstrapUrl,
        contract: includeContract ? args.contract : undefined,
      });
      unavailableAttempt = 0;
    } catch (cause) {
      if (!(cause instanceof ServiceBootstrapEndpointUnavailableError)) {
        throw cause;
      }

      const retryDelayMs = bootstrapUnavailableRetryDelayMs(unavailableAttempt);
      unavailableAttempt += 1;
      args.log.warn(
        {
          service: args.serviceName,
          trellisUrl: args.trellisUrl,
          contractId: args.contractId,
          contractDigest: args.contractDigest,
          attempt: unavailableAttempt,
          retryDelayMs,
          causeMessage: getErrorCauseMessage(cause.cause),
        },
        "Service bootstrap endpoint unavailable; retrying",
      );
      await delay(retryDelayMs);
      continue;
    }

    if (
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
        continue;
      }
      if (
        failure.reason === "manifest_required" && args.contract !== undefined
      ) {
        includeContract = true;
        continue;
      }
      if (
        failure.reason === "authority_update_required" ||
        failure.reason === "authority_migration_required" ||
        failure.reason === "authority_reconciliation_pending"
      ) {
        const retryDelayMs = bootstrapRetryDelayMs(settled.response);
        const pendingKey = failure.planId ?? failure.requestId ??
          `${failure.deploymentId ?? "unknown"}:${args.contractDigest}`;
        if (!loggedPendingRequests.has(pendingKey)) {
          loggedPendingRequests.add(pendingKey);
          args.log.info(
            {
              service: args.serviceName,
              deploymentId: failure.deploymentId,
              planId: failure.planId,
              contractId: args.contractId,
              contractDigest: args.contractDigest,
              retryDelayMs,
            },
            failure.message ??
              "Service deployment authority pending; waiting for approval or reconciliation",
          );
        }
        await delay(retryDelayMs);
        includeContract = true;
        continue;
      }
      if (failure.reason === "contract_activation_pending") {
        const retryDelayMs = bootstrapRetryDelayMs(settled.response);
        const pendingKey = failure.requestId ??
          `${failure.deploymentId ?? "unknown"}:${args.contractDigest}`;
        if (!loggedPendingRequests.has(pendingKey)) {
          loggedPendingRequests.add(pendingKey);
          args.log.info(
            {
              service: args.serviceName,
              deploymentId: failure.deploymentId,
              requestId: failure.requestId,
              contractId: args.contractId,
              contractDigest: args.contractDigest,
              dependencyAlias: failure.dependencyAlias,
              dependencyContractId: failure.dependencyContractId,
              dependencySurface: failure.dependencySurface,
              dependencyReason: failure.dependencyReason,
              dependencyKey: failure.dependencyKey,
              retryDelayMs,
            },
            dependencyWaitLogMessage(failure),
          );
        }
        await delay(retryDelayMs);
        includeContract = true;
        continue;
      }
      if (failure.reason === "contract_catalog_issue") {
        const retryDelayMs = bootstrapRetryDelayMs(settled.response);
        const pendingKey = failure.issueId ??
          `${failure.activeContractDigest ?? "unknown"}:${args.contractDigest}`;
        if (!loggedPendingRequests.has(pendingKey)) {
          loggedPendingRequests.add(pendingKey);
          args.log.info(
            {
              service: args.serviceName,
              deploymentId: failure.deploymentId,
              issueId: failure.issueId,
              activeContractDigest: failure.activeContractDigest,
              contractId: args.contractId,
              contractDigest: args.contractDigest,
              retryDelayMs,
            },
            "Service contract catalog issue pending; waiting for admin resolution",
          );
        }
        await delay(retryDelayMs);
        includeContract = true;
        continue;
      }
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

    if (!settled.response.ok) {
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
}

export class StoreHandle {
  readonly binding: ResourceBindingStore;
  readonly #nc: NatsConnection;

  constructor(
    nc: NatsConnection,
    binding: ResourceBindingStore,
    token: typeof storeHandleConstructorToken,
  ) {
    if (token !== storeHandleConstructorToken) {
      throw new TypeError(
        "StoreHandle instances are created by TrellisService",
      );
    }
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
  TTrellisApi extends TrellisAPI | undefined = TOwnedApi,
> = {
  trellisUrl: string;
  contract: ServiceContract<TOwnedApi, TTrellisApi>;
  name: string;
  sessionKeySeed: string;
  server?: TrellisServiceServerOpts;
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

export type ServiceContract<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI | undefined,
  TJobs extends ContractJobsMetadata = {},
  TKv extends ContractKvMetadata = ContractKvMetadata,
> = {
  CONTRACT_ID: string;
  CONTRACT_DIGEST: string;
  CONTRACT: TrellisContractV1;
  API: {
    owned: TOwnedApi;
    trellis?: TTrellisApi;
  };
  readonly [CONTRACT_JOBS_METADATA]?: TJobs;
  readonly [CONTRACT_KV_METADATA]?: TKv;
};

type ContractOwnedApi<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata
  >,
> = TContract["API"]["owned"];

type ContractTrellisApi<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata
  >,
> = NonNullable<TContract["API"]["trellis"]> extends TrellisAPI
  ? NonNullable<TContract["API"]["trellis"]>
  : ContractOwnedApi<TContract>;

type ContractJobsOf<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata,
    ContractKvMetadata
  >,
> = NonNullable<TContract[typeof CONTRACT_JOBS_METADATA]>;

type ContractKvOf<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata,
    ContractKvMetadata
  >,
> = NonNullable<TContract[typeof CONTRACT_KV_METADATA]>;

type ContractJobName<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata
  >,
> = keyof ContractJobsOf<TContract> & string;

type ContractEventName<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata
  >,
> = ServiceEventName<ContractTrellisApi<TContract>>;

type ContractFeedName<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata
  >,
> = keyof ContractOwnedApi<TContract>["feeds"] & string;

type ContractOperationName<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata
  >,
> = keyof ContractOwnedApi<TContract>["operations"] & string;

type ContractJobPayload<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata
  >,
  TJob extends ContractJobName<TContract>,
> = ContractJobsOf<TContract>[TJob]["payload"];

type ContractJobResult<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata
  >,
  TJob extends ContractJobName<TContract>,
> = ContractJobsOf<TContract>[TJob]["result"];

/** Arguments passed to a typed Trellis service job handler. */
export type JobArgs<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata,
    ContractKvMetadata
  >,
  TJob extends ContractJobName<TContract>,
  TDeps = undefined,
> = {
  job: PublicActiveJob<
    ContractJobPayload<TContract, TJob>,
    ContractJobResult<TContract, TJob>
  >;
  client: Trellis<
    ContractTrellisApi<TContract>,
    ContractKvOf<TContract>,
    ContractJobsOf<TContract>
  >;
} & WithDeps<TDeps>;

/** Result returned by a typed Trellis service job handler. */
export type JobResult<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata,
    ContractKvMetadata
  >,
  TJob extends ContractJobName<TContract>,
> = Result<ContractJobResult<TContract, TJob>, BaseError>;

type WithDeps<TDeps> = [TDeps] extends [undefined] ? {} : { deps: TDeps };

/** Typed RPC handler function for an extracted Trellis service handler. */
export type RpcHandler<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata,
    ContractKvMetadata
  >,
  M extends RpcMethodName<ContractOwnedApi<TContract>>,
  TDeps = undefined,
> = ({
  input,
  context,
  client,
}: {
  input: RpcMethodInput<ContractOwnedApi<TContract>, M>;
  context: RpcHandlerContext;
  client: Trellis<
    ContractTrellisApi<TContract>,
    ContractKvOf<TContract>,
    ContractJobsOf<TContract>
  >;
} & WithDeps<TDeps>) =>
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

/** Typed event listener function for an extracted Trellis service listener. */
export type ServiceEventHandler<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata,
    ContractKvMetadata
  >,
  E extends ContractEventName<TContract>,
  TDeps = undefined,
> = (
  args: {
    event: ServiceEventOf<ContractTrellisApi<TContract>, E>;
    context: EventListenerContext;
    client: Trellis<
      ContractTrellisApi<TContract>,
      ContractKvOf<TContract>,
      ContractJobsOf<TContract>
    >;
  } & WithDeps<TDeps>,
) => MaybeAsync<void, BaseError>;

/** Typed feed handler function for an extracted Trellis service handler. */
export type FeedHandler<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata,
    ContractKvMetadata
  >,
  F extends ContractFeedName<TContract>,
  TDeps = undefined,
> = (
  context: {
    input: FeedInputOf<ContractOwnedApi<TContract>, F>;
    caller: unknown;
    signal: AbortSignal;
    emit(
      event: FeedEventOf<ContractOwnedApi<TContract>, F>,
    ): AsyncResult<void, ValidationError | UnexpectedError>;
    client: Trellis<
      ContractTrellisApi<TContract>,
      ContractKvOf<TContract>,
      ContractJobsOf<TContract>
    >;
  } & WithDeps<TDeps>,
) => unknown | Promise<unknown>;

/** Typed job handler function for an extracted Trellis service job handler. */
export type JobHandler<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata,
    ContractKvMetadata
  >,
  TJob extends ContractJobName<TContract>,
  TDeps = undefined,
> = (args: JobArgs<TContract, TJob, TDeps>) => Promise<
  JobResult<TContract, TJob>
>;

/** Typed operation handler function for an extracted Trellis service handler. */
export type OperationHandler<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata,
    ContractKvMetadata
  >,
  O extends ContractOperationName<TContract>,
  TDeps = undefined,
> = (
  args:
    & OperationHandlerContext<
      InferSchemaType<ContractOwnedApi<TContract>["operations"][O]["input"]>,
      OperationProgressOf<ContractOwnedApi<TContract>, O>,
      OperationOutputOf<ContractOwnedApi<TContract>, O>,
      OperationTransferContextOf<ContractOwnedApi<TContract>, O>
    >
    & {
      client: Trellis<
        ContractTrellisApi<TContract>,
        ContractKvOf<TContract>,
        ContractJobsOf<TContract>
      >;
    }
    & WithDeps<TDeps>,
) => unknown | Promise<unknown>;

/** Typed health info function for an extracted bound service health handler. */
export type HealthInfoHandler<TDeps = undefined> = (
  args: WithDeps<TDeps>,
) => ServiceHealthInfo | undefined | Promise<ServiceHealthInfo | undefined>;

/** Typed health check function for an extracted bound service health handler. */
export type HealthCheckHandler<TDeps = undefined> = (
  args: WithDeps<TDeps>,
) => ServiceHealthCheck | Promise<ServiceHealthCheck>;

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
      client: Trellis<TTrellisApi, TKv, TJobs>;
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

type ServiceEventName<TA extends TrellisAPI> = keyof TA["events"] & string;
type ServiceEventOf<
  TA extends TrellisAPI,
  E extends ServiceEventName<TA>,
> = TA["events"][E] extends EventDesc<infer TEvent> ? InferSchemaType<TEvent>
  : never;
type ServiceEventPayloadOf<
  TA extends TrellisAPI,
  E extends ServiceEventName<TA>,
> = Omit<ServiceEventOf<TA, E>, "header">;

type BoundEventHandleFn<
  TEventApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
  E extends ServiceEventName<TEventApi>,
  TKv extends ContractKvMetadata,
  TJobs extends ContractJobsMetadata,
  TDeps,
> = (args: {
  event: ServiceEventOf<TEventApi, E>;
  context: EventListenerContext;
  client: Trellis<TTrellisApi, TKv, TJobs>;
  deps: TDeps;
}) => MaybeAsync<void, BaseError>;

type BoundActiveEventFacade<
  TEventApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
  TKv extends ContractKvMetadata,
  TJobs extends ContractJobsMetadata,
  TDeps,
> = {
  readonly [TGroup in SurfaceGroupName<ServiceEventName<TEventApi>>]: {
    readonly [
      E in SurfaceKeysForGroup<
        ServiceEventName<TEventApi>,
        TGroup
      > as SurfaceLeafName<E>
    ]: {
      prepare(
        event: ServiceEventPayloadOf<TEventApi, E>,
      ): Result<
        PreparedTrellisEvent<ServiceEventPayloadOf<TEventApi, E>>,
        ValidationError | UnexpectedError
      >;
      publish(
        event: ServiceEventPayloadOf<TEventApi, E>,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
      listen(
        handler: BoundEventHandleFn<
          TEventApi,
          TTrellisApi,
          E,
          TKv,
          TJobs,
          TDeps
        >,
        subjectData?: Record<string, unknown>,
        opts?: EventOpts,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
    };
  };
};

type BoundRpcHandleFn<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
  M extends RpcMethodName<TOwnedApi>,
  TKv extends ContractKvMetadata,
  TJobs extends ContractJobsMetadata,
  TDeps,
> = (args: {
  input: RpcMethodInput<TOwnedApi, M>;
  context: RpcHandlerContext;
  client: Trellis<TTrellisApi, TKv, TJobs>;
  deps: TDeps;
}) =>
  | Promise<
    Result<RpcMethodOutput<TOwnedApi, M>, RpcHandlerErrorOf<TOwnedApi, M>>
  >
  | Result<RpcMethodOutput<TOwnedApi, M>, RpcHandlerErrorOf<TOwnedApi, M>>;

type BoundFeedHandleFn<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
  F extends keyof TOwnedApi["feeds"] & string,
  TKv extends ContractKvMetadata,
  TJobs extends ContractJobsMetadata,
  TDeps,
> = (context: {
  input: FeedInputOf<TOwnedApi, F>;
  caller: unknown;
  signal: AbortSignal;
  emit(
    event: FeedEventOf<TOwnedApi, F>,
  ): AsyncResult<void, ValidationError | UnexpectedError>;
  client: Trellis<TTrellisApi, TKv, TJobs>;
  deps: TDeps;
}) => unknown | Promise<unknown>;

type BoundOperationHandleFn<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
  O extends keyof TOwnedApi["operations"] & string,
  TKv extends ContractKvMetadata,
  TJobs extends ContractJobsMetadata,
  TDeps,
> =
  & ((
    handler: (
      context:
        & OperationHandlerContext<
          InferSchemaType<TOwnedApi["operations"][O]["input"]>,
          OperationProgressOf<TOwnedApi, O>,
          OperationOutputOf<TOwnedApi, O>,
          OperationTransferContextOf<TOwnedApi, O>
        >
        & {
          client: Trellis<TTrellisApi, TKv, TJobs>;
          deps: TDeps;
        },
    ) => unknown | Promise<unknown>,
  ) => Promise<void>)
  & Pick<
    OperationHandleFn<TOwnedApi, TTrellisApi, O, TKv, TJobs>,
    "accept" | "control"
  >;

type BoundTypedServiceHandleFacade<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
  TKv extends ContractKvMetadata,
  TJobs extends ContractJobsMetadata,
  TDeps,
> = {
  readonly rpc: {
    readonly [TGroup in SurfaceGroupName<RpcMethodName<TOwnedApi>>]: {
      readonly [
        M in SurfaceKeysForGroup<
          RpcMethodName<TOwnedApi>,
          TGroup
        > as SurfaceLeafName<M>
      ]: (
        handler: BoundRpcHandleFn<TOwnedApi, TTrellisApi, M, TKv, TJobs, TDeps>,
      ) => Promise<void>;
    };
  };
  readonly feed: {
    readonly [TGroup in SurfaceGroupName<keyof TOwnedApi["feeds"] & string>]: {
      readonly [
        F in SurfaceKeysForGroup<
          keyof TOwnedApi["feeds"] & string,
          TGroup
        > as SurfaceLeafName<F>
      ]: (
        handler: BoundFeedHandleFn<
          TOwnedApi,
          TTrellisApi,
          F,
          TKv,
          TJobs,
          TDeps
        >,
      ) => Promise<void>;
    };
  };
  readonly operation: {
    readonly [
      TGroup in SurfaceGroupName<keyof TOwnedApi["operations"] & string>
    ]: {
      readonly [
        O in SurfaceKeysForGroup<
          keyof TOwnedApi["operations"] & string,
          TGroup
        > as SurfaceLeafName<O>
      ]: BoundOperationHandleFn<TOwnedApi, TTrellisApi, O, TKv, TJobs, TDeps>;
    };
  };
};

type BoundJobQueue<
  TPayload,
  TResult,
  TTrellisApi extends TrellisAPI,
  TKv extends ContractKvMetadata,
  TJobs extends ContractJobsMetadata,
  TDeps,
> = {
  create(payload: TPayload): AsyncResult<JobRef<TPayload, TResult>, BaseError>;
  handle(
    handler: (args: {
      job: PublicActiveJob<TPayload, TResult>;
      client: Trellis<TTrellisApi, TKv, TJobs>;
      deps: TDeps;
    }) => Promise<Result<TResult, BaseError>>,
  ): void;
};

type BoundJobsFacadeOf<
  TJobs extends ContractJobsMetadata,
  TTrellisApi extends TrellisAPI,
  TKv extends ContractKvMetadata,
  TDeps,
> = {
  [K in keyof TJobs]: BoundJobQueue<
    TJobs[K]["payload"],
    TJobs[K]["result"],
    TTrellisApi,
    TKv,
    TJobs,
    TDeps
  >;
};

type BoundServiceHealth<TDeps> = Omit<ServiceHealth, "add" | "setInfo"> & {
  setInfo(info: ServiceHealthInfo | HealthInfoHandler<TDeps>): void;
  add(
    name: string,
    check: HealthCheckHandler<TDeps>,
  ): () => void;
};

/** Service wrapper returned by `TrellisService.with(deps)`. */
export type BoundTrellisService<
  TOwnedApi extends TrellisAPI = TrellisAPI,
  TTrellisApi extends TrellisAPI = TOwnedApi,
  TJobs extends ContractJobsMetadata = {},
  TKv extends ContractKvMetadata = ContractKvMetadata,
  TDeps = unknown,
> =
  & Pick<
    TrellisService<TOwnedApi, TTrellisApi, TJobs, TKv>,
    | "name"
    | "auth"
    | "nc"
    | "kv"
    | "store"
    | "connection"
    | "createTransfer"
    | "completeOperation"
    | "wait"
    | "stop"
  >
  & {
    readonly event: BoundActiveEventFacade<
      TTrellisApi,
      TTrellisApi,
      TKv,
      TJobs,
      TDeps
    >;
    readonly health: BoundServiceHealth<TDeps>;
    readonly jobs: BoundJobsFacadeOf<TJobs, TTrellisApi, TKv, TDeps>;
    readonly handle: BoundTypedServiceHandleFacade<
      TOwnedApi,
      TTrellisApi,
      TKv,
      TJobs,
      TDeps
    >;
    /** Returns a new bound wrapper that injects the provided dependencies. */
    with<TNextDeps>(deps: TNextDeps): BoundTrellisService<
      TOwnedApi,
      TTrellisApi,
      TJobs,
      TKv,
      TNextDeps
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

type ServiceHandleOperationLeaf =
  & ((handler: (context: unknown) => unknown) => Promise<void>)
  & {
    accept(
      args: { sessionKey: string },
    ): AsyncResult<AcceptedOperation, UnexpectedError>;
    control(
      operationId: string,
    ): AsyncResult<OperationRuntimeHandle, BaseError>;
  };

type ServiceHandleFacade = {
  readonly rpc: Record<
    string,
    Record<string, (handler: (args: unknown) => unknown) => Promise<void>>
  >;
  readonly feed: Record<
    string,
    Record<string, (handler: (args: unknown) => unknown) => Promise<void>>
  >;
  readonly operation: Record<
    string,
    Record<string, ServiceHandleOperationLeaf>
  >;
};

type ServiceEventPublishLeaf = {
  prepare(
    event: Record<string, unknown>,
  ): ReturnType<HandlerTrellis<TrellisAPI>["prepare"]>;
  publish(
    event: Record<string, unknown>,
  ): ReturnType<HandlerTrellis<TrellisAPI>["publish"]>;
};

type ServiceEventLeaf = ServiceEventPublishLeaf & {
  listen(
    handler: (
      event: unknown,
      context: EventListenerContext,
    ) => MaybeAsync<void, BaseError>,
    subjectData?: Record<string, unknown>,
    opts?: EventOpts,
  ): AsyncResult<void, ValidationError | UnexpectedError>;
};

type BoundServiceEventLeaf<TDeps> = ServiceEventPublishLeaf & {
  listen(
    handler: (args: {
      event: unknown;
      context: EventListenerContext;
      client: unknown;
      deps: TDeps;
    }) => MaybeAsync<void, BaseError>,
    subjectData?: Record<string, unknown>,
    opts?: EventOpts,
  ): AsyncResult<void, ValidationError | UnexpectedError>;
};

function createServiceEventPublishFacade<TA extends TrellisAPI>(outbound: {
  readonly api: TA;
  prepare(
    event: string,
    data: Record<string, unknown>,
  ): ReturnType<HandlerTrellis<TA>["prepare"]>;
  publish(
    event: string,
    data: Record<string, unknown>,
  ): ReturnType<HandlerTrellis<TA>["publish"]>;
}): ActiveEventPublishFacade<TA> {
  const surface: Record<string, Record<string, ServiceEventPublishLeaf>> = {};
  for (const event of Object.keys(outbound.api.events ?? {})) {
    addSurfaceLeaf(surface, event, {
      prepare: (payload) => outbound.prepare(event, payload),
      publish: (payload) => outbound.publish(event, payload),
    });
  }
  return surface as ActiveEventPublishFacade<TA>;
}

type PascalSurfaceName<T extends string> = T extends
  `${infer Head}.${infer Tail}`
  ? `${Capitalize<Head>}${PascalSurfaceName<Tail>}`
  : Capitalize<T>;
type LowerCamelSurfaceName<T extends string> = Uncapitalize<
  PascalSurfaceName<T>
>;
type SurfaceGroupName<T extends string> = T extends `${infer Head}.${string}`
  ? LowerCamelSurfaceName<Head>
  : LowerCamelSurfaceName<T>;
type SurfaceLeafName<T extends string> = T extends `${string}.${infer Tail}`
  ? LowerCamelSurfaceName<Tail>
  : LowerCamelSurfaceName<T>;
type SurfaceKeysForGroup<TKeys extends string, TGroup extends string> =
  TKeys extends string ? SurfaceGroupName<TKeys> extends TGroup ? TKeys : never
    : never;

type TypedServiceHandleFacade<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
  TKv extends ContractKvMetadata,
  TJobs extends ContractJobsMetadata,
> = {
  readonly rpc: {
    readonly [TGroup in SurfaceGroupName<RpcMethodName<TOwnedApi>>]: {
      readonly [
        M in SurfaceKeysForGroup<
          RpcMethodName<TOwnedApi>,
          TGroup
        > as SurfaceLeafName<M>
      ]: (
        handler: RpcHandleFn<TOwnedApi, TTrellisApi, M, TKv, TJobs>,
      ) => Promise<void>;
    };
  };
  readonly feed: {
    readonly [TGroup in SurfaceGroupName<keyof TOwnedApi["feeds"] & string>]: {
      readonly [
        F in SurfaceKeysForGroup<
          keyof TOwnedApi["feeds"] & string,
          TGroup
        > as SurfaceLeafName<F>
      ]: (
        handler: FeedHandleFn<TOwnedApi, TTrellisApi, F, TKv, TJobs>,
      ) => Promise<void>;
    };
  };
  readonly operation: {
    readonly [
      TGroup in SurfaceGroupName<keyof TOwnedApi["operations"] & string>
    ]: {
      readonly [
        O in SurfaceKeysForGroup<
          keyof TOwnedApi["operations"] & string,
          TGroup
        > as SurfaceLeafName<O>
      ]: OperationHandleFn<
        TOwnedApi,
        TTrellisApi,
        O,
        TKv,
        TJobs
      >;
    };
  };
};

type RpcHandleFn<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
  M extends RpcMethodName<TOwnedApi>,
  TKv extends ContractKvMetadata,
  TJobs extends ContractJobsMetadata,
> = (args: {
  input: RpcMethodInput<TOwnedApi, M>;
  context: RpcHandlerContext;
  client: Trellis<TTrellisApi, TKv, TJobs>;
}) =>
  | Promise<
    Result<RpcMethodOutput<TOwnedApi, M>, RpcHandlerErrorOf<TOwnedApi, M>>
  >
  | Result<RpcMethodOutput<TOwnedApi, M>, RpcHandlerErrorOf<TOwnedApi, M>>;

type FeedHandleFn<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
  F extends keyof TOwnedApi["feeds"] & string,
  TKv extends ContractKvMetadata,
  TJobs extends ContractJobsMetadata,
> = (context: {
  input: FeedInputOf<TOwnedApi, F>;
  caller: unknown;
  signal: AbortSignal;
  emit(
    event: FeedEventOf<TOwnedApi, F>,
  ): AsyncResult<void, ValidationError | UnexpectedError>;
  client: Trellis<TTrellisApi, TKv, TJobs>;
}) => unknown | Promise<unknown>;

type OperationHandleFn<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
  O extends keyof TOwnedApi["operations"] & string,
  TKv extends ContractKvMetadata,
  TJobs extends ContractJobsMetadata,
> =
  & ((
    handler: (
      context:
        & OperationHandlerContext<
          InferSchemaType<TOwnedApi["operations"][O]["input"]>,
          OperationProgressOf<TOwnedApi, O>,
          OperationOutputOf<TOwnedApi, O>,
          OperationTransferContextOf<TOwnedApi, O>
        >
        & { client: Trellis<TTrellisApi, TKv, TJobs> },
    ) => unknown | Promise<unknown>,
  ) => Promise<void>)
  & {
    accept(args: { sessionKey: string }): AsyncResult<
      AcceptedOperation<
        OperationProgressOf<TOwnedApi, O>,
        OperationOutputOf<TOwnedApi, O>
      >,
      UnexpectedError
    >;
    control(operationId: string): AsyncResult<
      OperationRuntimeHandle<
        OperationProgressOf<TOwnedApi, O>,
        OperationOutputOf<TOwnedApi, O>
      >,
      BaseError
    >;
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
  /**
   * Loads an existing operation by id and returns a service-side control handle.
   * The operation must belong to this service and registration name.
   */
  control(
    operationId: string,
  ): AsyncResult<
    OperationRuntimeHandle<
      OperationProgressOf<TOwnedApi, O>,
      OperationOutputOf<TOwnedApi, O>
    >,
    BaseError
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
        & { client: Trellis<TTrellisApi, TKv, TJobs> },
    ) => unknown | Promise<unknown>,
  ): Promise<void>;
};

export type FeedRegistration<
  TOwnedApi extends TrellisAPI,
  F extends keyof TOwnedApi["feeds"] & string,
> = RootFeedRegistration<FeedInputOf<TOwnedApi, F>, FeedEventOf<TOwnedApi, F>>;

export type TrellisServiceConnectArgs<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
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
  contractEventConsumers?: ContractEventConsumers;
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
      contractId: args.contractId,
      contractDigest: args.contractDigest,
      connection,
      transferSupport: {
        openOperationTransfer: (transferArgs) =>
          getTransfer().createOperationUpload(transferArgs),
      },
      version: args.server.version,
    },
  );

  const outbound = createTrellisInternal<TTrellisApi>(
    args.name,
    args.nc,
    { sessionKey: args.auth.sessionKey, sign: args.auth.sign },
    {
      log: resolvedLog,
      timeout: args.server.timeout,
      stream: args.server.stream,
      noResponderRetry: args.server.noResponderRetry,
      api: runtimeApi,
      contractId: args.contractId,
      contractDigest: args.contractDigest,
      eventConsumers: {
        metadata: args.contractEventConsumers,
        bindings: args.bindings.eventConsumers,
      },
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
    rpc: outbound.rpc,
    event: createServiceEventPublishFacade(outbound),
    feed: outbound.feed,
    operation: outbound.operation,
    request: outbound.request.bind(outbound),
    prepare: (event, data) => outbound.prepare(event, data),
    publish: (event, data) => outbound.publish(event, data),
    publishPrepared: (event) => outbound.publishPrepared(event),
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
        new StoreHandle(args.nc, binding, storeHandleConstructorToken),
      ]),
    ),
  });

  const service = new TrellisService<TOwnedApi, TTrellisApi, TJobs, TKv>(
    args.name,
    args.auth,
    args.nc,
    server,
    outbound.event,
    handlerTrellis,
    kv,
    args.contractJobs,
    args.bindings,
    operationTransfer,
    health,
    stopHealthPublishing,
    connection,
    trellisServiceConstructorToken,
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

function serializeJobHandlerError(error: BaseError): string {
  try {
    return JSON.stringify(error.toSerializable());
  } catch {
    return error.message;
  }
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

function jobLifecycleKey(
  service: string,
  jobType: string,
  jobId: string,
): string {
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

function headersFromJobContext(context: InternalJobContext): MsgHdrs {
  const headers = natsHeaders();
  headers.set("request-id", context.requestId);
  headers.set("traceparent", context.traceparent);
  if (context.tracestate) {
    headers.set("tracestate", context.tracestate);
  }
  return headers;
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
          if (
            !event || !subjectMatchesLifecycleEvent(
              msg.subject,
              queueBinding,
              event,
            )
          ) {
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
      const error = toUnexpectedError(
        new Error("job lifecycle tracker stopped"),
      );
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
      get: () =>
        AsyncResult.ok(
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
            context: current.context,
            tries: current.tries,
            error: "cancelled",
            timestamp: new Date().toISOString(),
          };

          try {
            args.nc.publish(
              `${args.queueBinding.publishPrefix}.${args.seed.id}.cancelled`,
              new TextEncoder().encode(JSON.stringify(event)),
              { headers: headersFromJobContext(event.context) },
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
  contractId?: string;
  contractDigest?: string;
  nc: NatsConnection;
  contractJobs: TJobs;
  client: Trellis<TTrellisApi, TKv, TJobs>;
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
              client: args.client,
            }),
        );
      },
    } satisfies JobQueue<unknown, unknown, TTrellisApi, TKv, TJobs>;
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
                  job.context(),
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

                const jobErrorContext = {
                  jobType: queueType,
                  requestId: job.context().requestId,
                  service: args.serviceName,
                  contractId: args.contractId,
                  contractDigest: args.contractDigest,
                  traceId: job.context().traceId,
                };

                let handled: unknown | Result<never, BaseError>;
                try {
                  handled = (await handler(publicJob)).take();
                } catch (cause) {
                  const annotatedError = annotateHandlerBoundaryError(
                    cause,
                    jobErrorContext,
                  );
                  throw InternalJobProcessError.failed(
                    serializeJobHandlerError(annotatedError),
                  );
                }
                if (isErr(handled)) {
                  const annotatedError = annotateHandlerBoundaryError(
                    handled.error,
                    jobErrorContext,
                  );
                  throw InternalJobProcessError.failed(
                    serializeJobHandlerError(annotatedError),
                  );
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

function createBoundJobsFacade<
  TJobs extends ContractJobsMetadata,
  TTrellisApi extends TrellisAPI,
  TKv extends ContractKvMetadata,
  TDeps,
>(args: {
  jobs: JobsFacadeOf<TJobs, TTrellisApi, TKv>;
  deps: TDeps;
}): BoundJobsFacadeOf<TJobs, TTrellisApi, TKv, TDeps> {
  const boundJobs: Record<string, unknown> = {};
  const jobs = args.jobs as Record<
    string,
    JobQueue<unknown, unknown, TTrellisApi, TKv, TJobs>
  >;

  for (const queueType of Object.keys(jobs)) {
    const queue = jobs[queueType];
    if (!queue) continue;
    boundJobs[queueType] = {
      create: (payload) => queue.create(payload),
      handle: (handler) =>
        queue.handle(({ job, client }) =>
          handler({
            job,
            client,
            deps: args.deps,
          })
        ),
    } satisfies BoundJobQueue<
      unknown,
      unknown,
      TTrellisApi,
      TKv,
      TJobs,
      TDeps
    >;
  }

  return boundJobs as BoundJobsFacadeOf<TJobs, TTrellisApi, TKv, TDeps>;
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
  readonly #handlerTrellis: Trellis<TTrellisApi, TKv, TJobs>;
  /** Event lifecycle surface for service startup listeners and publishers. */
  readonly event: ActiveEventFacade<TTrellisApi>;
  readonly kv: ServiceKvFacade<TKv>;
  readonly store: Record<string, StoreHandle>;
  readonly jobs: JobsFacadeOf<TJobs, TTrellisApi, TKv>;
  readonly health: ServiceHealth;
  readonly handle: TypedServiceHandleFacade<TOwnedApi, TTrellisApi, TKv, TJobs>;
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
    event: ActiveEventFacade<TTrellisApi>,
    handlerTrellis: Trellis<TTrellisApi, TKv, TJobs>,
    kv: ServiceKvFacade<TKv>,
    contractJobs: TJobs,
    bindings: ResourceBindings,
    operationTransfer: ServiceTransfer,
    health: ServiceHealth,
    stopHealthPublishing: () => Promise<void>,
    connection: TrellisConnection,
    token: typeof trellisServiceConstructorToken,
  ) {
    if (token !== trellisServiceConstructorToken) {
      throw new TypeError("TrellisService instances are created by connect()");
    }
    const storeBindings = bindings.store ?? {};

    this.name = name;
    this.auth = auth;
    this.nc = nc;
    this.#server = server;
    Object.defineProperty(this, "server", {
      value: server,
      enumerable: false,
    });
    this.#handlerTrellis = handlerTrellis;
    this.event = event;
    this.kv = kv;
    this.store = Object.fromEntries(
      Object.entries(storeBindings).map((
        [alias, binding],
      ) => [alias, new StoreHandle(nc, binding, storeHandleConstructorToken)]),
    );
    this.#operationTransfer = operationTransfer;
    const jobs = createJobsFacade<TJobs, TTrellisApi, TKv>({
      serviceName: name,
      contractId: health.contractId,
      contractDigest: health.contractDigest,
      nc,
      contractJobs,
      client: handlerTrellis,
      jobsBinding: bindings.jobs,
      workStream: bindings.jobs?.workStream,
    });
    this.jobs = jobs;
    this.#managedJobWorkers = jobs[MANAGED_JOB_WORKERS];
    this.health = health;
    this.handle = this.#createHandleFacade() as TypedServiceHandleFacade<
      TOwnedApi,
      TTrellisApi,
      TKv,
      TJobs
    >;
    this.connection = connection;
    this.#stopHealthPublishing = stopHealthPublishing;
  }

  /**
   * Returns a service wrapper that injects application dependencies into
   * service-owned handler argument objects as `args.deps`.
   */
  with<TDeps>(
    deps: TDeps,
  ): BoundTrellisService<TOwnedApi, TTrellisApi, TJobs, TKv, TDeps> {
    return {
      name: this.name,
      auth: this.auth,
      nc: this.nc,
      event: this.#createBoundEventFacade(deps),
      kv: this.kv,
      store: this.store,
      jobs: createBoundJobsFacade({ jobs: this.jobs, deps }),
      health: this.#createBoundHealth(deps),
      handle: this.#createBoundHandleFacade(deps),
      connection: this.connection,
      createTransfer: (args) => this.createTransfer(args),
      completeOperation: (operationId, output) =>
        this.completeOperation(operationId, output),
      wait: () => this.wait(),
      stop: () => this.stop(),
      with: (nextDeps) => this.with(nextDeps),
    };
  }

  #createBoundHealth<TDeps>(deps: TDeps): BoundServiceHealth<TDeps> {
    const health = this.health;
    return {
      serviceName: health.serviceName,
      kind: health.kind,
      instanceId: health.instanceId,
      contractId: health.contractId,
      contractDigest: health.contractDigest,
      startedAt: health.startedAt,
      publishIntervalMs: health.publishIntervalMs,
      setInfo(info) {
        if (typeof info !== "function") {
          health.setInfo(info);
          return;
        }

        health.setInfo(() => info({ deps }));
      },
      add(name, check) {
        return health.add(name, () => check({ deps }));
      },
      checks: () => health.checks(),
      response: () => health.response(),
      heartbeat: () => health.heartbeat(),
    };
  }

  #createBoundEventFacade<TDeps>(
    deps: TDeps,
  ): BoundActiveEventFacade<TTrellisApi, TTrellisApi, TKv, TJobs, TDeps> {
    const event = {} as BoundActiveEventFacade<
      TTrellisApi,
      TTrellisApi,
      TKv,
      TJobs,
      TDeps
    >;
    const source = this.event as Record<
      string,
      Record<string, ServiceEventLeaf>
    >;
    for (const [groupName, leaves] of Object.entries(source)) {
      const group: Record<string, BoundServiceEventLeaf<TDeps>> = {};
      for (const [leafName, leaf] of Object.entries(leaves)) {
        group[leafName] = {
          prepare: (payload) => leaf.prepare(payload),
          publish: (payload) => leaf.publish(payload),
          listen: (handler, subjectData, opts) =>
            leaf.listen(
              (payload, context) =>
                handler({
                  event: payload,
                  context,
                  client: this.#handlerTrellis,
                  deps,
                }),
              subjectData,
              opts,
            ),
        };
      }
      Object.defineProperty(event, groupName, {
        value: group,
        enumerable: true,
        configurable: true,
      });
    }

    return event;
  }

  #createHandleFacade(): ServiceHandleFacade {
    const rpc: ServiceHandleFacade["rpc"] = {};
    for (const method of Object.keys(this.#server.api.rpc ?? {})) {
      addSurfaceLeaf(rpc, method, (handler) =>
        this.#server.mountRuntime(
          method,
          async ({ input, context }) =>
            await Promise.resolve(
              (handler as (
                args: unknown,
              ) =>
                | Promise<Result<unknown, BaseError>>
                | Result<unknown, BaseError>)({
                  input,
                  context,
                  client: this.#handlerTrellis,
                }),
            ),
        ));
    }

    const feed: ServiceHandleFacade["feed"] = {};
    for (const feedName of Object.keys(this.#server.api.feeds ?? {})) {
      addSurfaceLeaf(
        feed,
        feedName,
        (handler) =>
          this.#server.feedHandle(feedName).handle((context) =>
            (handler as (args: unknown) => unknown | Promise<unknown>)({
              ...context,
              client: this.#handlerTrellis,
            })
          ),
      );
    }

    const operation: Record<
      string,
      Record<string, ServiceHandleOperationLeaf>
    > = {};
    for (
      const operationName of Object.keys(this.#server.api.operations ?? {})
    ) {
      const registration = this.#operation(
        operationName as keyof TOwnedApi["operations"] & string,
      );
      const leaf = Object.assign(
        (handler: (context: unknown) => unknown) =>
          registration.handle((context) =>
            handler({
              ...context,
              client: this.#handlerTrellis,
            })
          ),
        {
          accept: (args: { sessionKey: string }) => registration.accept(args),
          control: (operationId: string) => registration.control(operationId),
        },
      ) as ServiceHandleOperationLeaf;
      addSurfaceLeaf(operation, operationName, leaf);
    }

    return { rpc, feed, operation };
  }

  #createBoundHandleFacade<TDeps>(
    deps: TDeps,
  ): BoundTypedServiceHandleFacade<TOwnedApi, TTrellisApi, TKv, TJobs, TDeps> {
    const rpc: ServiceHandleFacade["rpc"] = {};
    for (const method of Object.keys(this.#server.api.rpc ?? {})) {
      addSurfaceLeaf(rpc, method, (handler) =>
        this.#server.mountRuntime(
          method,
          async ({ input, context }) =>
            await Promise.resolve(
              (handler as (
                args: unknown,
              ) =>
                | Promise<Result<unknown, BaseError>>
                | Result<unknown, BaseError>)({
                  input,
                  context,
                  client: this.#handlerTrellis,
                  deps,
                }),
            ),
        ));
    }

    const feed: ServiceHandleFacade["feed"] = {};
    for (const feedName of Object.keys(this.#server.api.feeds ?? {})) {
      addSurfaceLeaf(
        feed,
        feedName,
        (handler) =>
          this.#server.feedHandle(feedName).handle((context) =>
            (handler as (args: unknown) => unknown | Promise<unknown>)({
              ...context,
              client: this.#handlerTrellis,
              deps,
            })
          ),
      );
    }

    const operation: Record<
      string,
      Record<string, ServiceHandleOperationLeaf>
    > = {};
    for (
      const operationName of Object.keys(this.#server.api.operations ?? {})
    ) {
      const registration = this.#operation(
        operationName as keyof TOwnedApi["operations"] & string,
      );
      const leaf = Object.assign(
        (handler: (context: unknown) => unknown) =>
          registration.handle((context) =>
            handler({
              ...context,
              client: this.#handlerTrellis,
              deps,
            })
          ),
        {
          accept: (args: { sessionKey: string }) => registration.accept(args),
          control: (operationId: string) => registration.control(operationId),
        },
      ) as ServiceHandleOperationLeaf;
      addSurfaceLeaf(operation, operationName, leaf);
    }

    return { rpc, feed, operation } as BoundTypedServiceHandleFacade<
      TOwnedApi,
      TTrellisApi,
      TKv,
      TJobs,
      TDeps
    >;
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
  ): AsyncResult<unknown, BaseError> {
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
      TrellisAPI | undefined,
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
        const bootstrapLog = resolveServiceLogger(args.server?.log);
        const bootstrap = await fetchServiceBootstrapInfo({
          trellisUrl: args.trellisUrl,
          serviceName: args.name,
          contractId: args.contract.CONTRACT_ID,
          contractDigest: args.contract.CONTRACT_DIGEST,
          contract: args.contract.CONTRACT,
          auth,
          log: bootstrapLog,
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
            waitOnFirstConnect: DEFAULT_SERVICE_RUNTIME_WAIT_ON_FIRST_CONNECT,
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
          const server = args.contract.API.trellis
            ? {
              ...(args.server ?? {}),
              api: args.contract.API.owned,
              trellisApi: args.contract.API.trellis as TTrellisApi,
            }
            : {
              ...(args.server ?? {}),
              api: args.contract.API.owned,
            };

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
              contractEventConsumers: args.contract.CONTRACT.eventConsumers,
              server,
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

  #operation<O extends keyof TOwnedApi["operations"] & string>(
    operation: O,
  ): OperationRegistration<TOwnedApi, TTrellisApi, O, TKv, TJobs> {
    const registration = this.#server.operationHandle(
      operation,
    ) as RootOperationRegistration<
      InferSchemaType<TOwnedApi["operations"][O]["input"]>,
      OperationProgressOf<TOwnedApi, O>,
      OperationOutputOf<TOwnedApi, O>,
      OperationTransferContextOf<TOwnedApi, O>
    >;

    return {
      accept: (args) => registration.accept(args),
      control: (operationId) => registration.control(operationId),
      handle: (
        handler: (
          args:
            & OperationHandlerContext<
              InferSchemaType<TOwnedApi["operations"][O]["input"]>,
              OperationProgressOf<TOwnedApi, O>,
              OperationOutputOf<TOwnedApi, O>,
              OperationTransferContextOf<TOwnedApi, O>
            >
            & { client: Trellis<TTrellisApi, TKv, TJobs> },
        ) => unknown | Promise<unknown>,
      ) =>
        registration.handle((context) =>
          handler({
            ...context,
            client: this.#handlerTrellis,
          })
        ),
    };
  }
}
