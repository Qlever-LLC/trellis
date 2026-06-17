import {
  headers as natsHeaders,
  jwtAuthenticator,
  type MsgHdrs,
  type NatsConnection,
  type Subscription,
} from "@nats-io/nats-core";
import type { KVError, StoreError } from "../errors/index.ts";
import { TypedKV } from "../kv.ts";
import {
  type StoreWaitOptions,
  TypedStore,
  TypedStoreEntry,
} from "../store.ts";
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
  type ServiceHealthCheckFn,
  type ServiceHealthInfoFn,
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
  OperationHandlerErrorOf,
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
  JobNotEnqueuedError,
  type JobProgress,
  JobRef,
  type JobSnapshot,
  type JobSubmitOutcome,
  JobWorkerHostAdapter,
  type TerminalJob,
} from "../jobs.ts";
import {
  JobManager as InternalJobManager,
  JobProcessError as InternalJobProcessError,
} from "./internal_jobs/job-manager.ts";
import { startNatsWorkerHostFromBinding } from "./internal_jobs/runtime-worker.ts";
import {
  createNatsJobKeyCoordinator,
  normalizeJobKeyPolicy,
} from "./internal_jobs/key-coordinator.ts";
import type {
  JobKeyConcurrencyBinding,
  JobQueuePolicyBinding,
} from "./internal_jobs/key-coordinator.ts";
import type {
  JobsBinding,
  JobsQueueBinding,
} from "./internal_jobs/bindings.ts";
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
import { initTelemetry } from "../telemetry/init.ts";
import {
  defaultSqlOutboxTables,
  OutboxDispatcher,
  type OutboxDispatcherOptions,
  type OutboxMessage,
  type SqlDialect,
  type SqlExecutor,
  SqlOutboxRepository,
  type SqlOutboxTables,
} from "../service/outbox_inbox.ts";

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
  keyConcurrency?: JobKeyConcurrencyBinding;
  queue?: JobQueuePolicyBinding;
};

type ResourceBindingJobs = {
  namespace: string;
  workStream?: string;
  queues: Record<string, ResourceBindingJobsQueue>;
};

function normalizeResourceJobsBinding(
  binding: ResourceBindingJobs,
): JobsBinding {
  const queues: Record<string, JobsQueueBinding> = {};
  for (const [name, queue] of Object.entries(binding.queues)) {
    const baseQueue = baseJobsQueueBinding(queue);
    if (!queue.keyConcurrency) {
      queues[name] = {
        ...baseQueue,
        ...(queue.queue ? { queue: normalizeQueuePolicy(queue.queue) } : {}),
      };
      continue;
    }

    const policy = normalizeJobKeyPolicy({
      keyConcurrency: queue.keyConcurrency,
      queue: queue.queue,
    });
    queues[name] = {
      ...baseQueue,
      keyConcurrency: {
        key: policy.key,
        maxActive: policy.maxActive,
        heartbeatIntervalMs: policy.heartbeatIntervalMs,
        heartbeatTtlMs: policy.heartbeatTtlMs,
        stalePolicy: policy.stalePolicy,
      },
      queue: policy.queue,
    };
  }
  return { namespace: binding.namespace, queues };
}

function baseJobsQueueBinding(
  queue: ResourceBindingJobsQueue,
): Omit<JobsQueueBinding, "keyConcurrency" | "queue"> {
  return {
    queueType: queue.queueType,
    publishPrefix: queue.publishPrefix,
    workSubject: queue.workSubject,
    consumerName: queue.consumerName,
    payload: queue.payload,
    ...(queue.result ? { result: queue.result } : {}),
    maxDeliver: queue.maxDeliver,
    backoffMs: queue.backoffMs,
    ackWaitMs: queue.ackWaitMs,
    ...(queue.defaultDeadlineMs !== undefined
      ? { defaultDeadlineMs: queue.defaultDeadlineMs }
      : {}),
    progress: queue.progress,
    logs: queue.logs,
    dlq: queue.dlq,
    concurrency: queue.concurrency,
  };
}

function normalizeQueuePolicy(
  queue: JobQueuePolicyBinding,
): JobsQueueBinding["queue"] {
  return {
    maxQueuedPerKey: queue.maxQueuedPerKey ?? 0,
    whenFull: queue.whenFull ?? "reject",
  };
}

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
  return import(specifier) as Promise<TModule>;
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
    initTelemetry,
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

function automaticTelemetryEnabled(
  telemetry: TrellisServiceConnectTelemetryOpts | undefined,
): boolean {
  return telemetry !== false && telemetry?.enabled !== false;
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

export abstract class StoreHandle {
  abstract readonly binding: ResourceBindingStore;

  abstract open(): AsyncResult<TypedStore, StoreError>;

  /**
   * Waits for a staged object to appear in the bound store and returns its entry.
   */
  abstract waitFor(
    key: string,
    options?: StoreWaitOptions,
  ): AsyncResult<TypedStoreEntry, StoreError>;
}

class InternalStoreHandle extends StoreHandle {
  readonly binding: ResourceBindingStore;
  readonly #nc: NatsConnection;

  constructor(
    nc: NatsConnection,
    binding: ResourceBindingStore,
    token: typeof storeHandleConstructorToken,
  ) {
    super();
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
  /**
   * Controls automatic telemetry initialization for this service connection.
   * Enabled by default; pass `false` or `{ enabled: false }` to disable it.
   */
  telemetry?: TrellisServiceConnectTelemetryOpts;
  server?: TrellisServiceServerOpts;
};

/** Controls automatic telemetry initialization for `TrellisService.connect()`. */
export type TrellisServiceConnectTelemetryOpts = false | {
  /** Whether automatic telemetry initialization is enabled. Defaults to `true`. */
  enabled?: boolean;
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

type ContractEventName<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata
  >,
> = ServiceEventName<ContractTrellisApi<TContract>>;

type ContractOperationName<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata
  >,
> = keyof ContractOwnedApi<TContract>["operations"] & string;

/** Typed RPC handler function for an extracted Trellis service handler. */
export type RpcHandler<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata,
    ContractKvMetadata
  >,
  M extends RpcMethodName<ContractOwnedApi<TContract>>,
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

/** Typed event listener function for an extracted Trellis service listener. */
export type ServiceEventHandler<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata,
    ContractKvMetadata
  >,
  E extends ContractEventName<TContract>,
> = (
  args: {
    event: ServiceEventOf<ContractTrellisApi<TContract>, E>;
    context: EventListenerContext;
    client: Trellis<
      ContractTrellisApi<TContract>,
      ContractKvOf<TContract>,
      ContractJobsOf<TContract>
    >;
  },
) => MaybeAsync<void, BaseError>;

/** Typed operation handler function for an extracted Trellis service handler. */
export type OperationHandler<
  TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
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
      OperationTransferContextOf<ContractOwnedApi<TContract>, O>,
      OperationHandlerErrorOf<ContractOwnedApi<TContract>, O>
    >
    & {
      client: Trellis<
        ContractTrellisApi<TContract>,
        ContractKvOf<TContract>,
        ContractJobsOf<TContract>
      >;
    },
) => unknown | Promise<unknown>;

/** Typed health info function for an extracted service health handler. */
export type HealthInfoHandler = ServiceHealthInfoFn;

/** Typed health check function for an extracted service health handler. */
export type HealthCheckHandler = ServiceHealthCheckFn;

export type JobQueue<
  TPayload,
  TResult,
  TTrellisApi extends TrellisAPI,
  TKv extends ContractKvMetadata = ContractKvMetadata,
  TJobs extends ContractJobsMetadata = {},
> = {
  create(payload: TPayload): AsyncResult<JobRef<TPayload, TResult>, BaseError>;
  submit(
    payload: TPayload,
  ): AsyncResult<JobSubmitOutcome<TPayload, TResult>, BaseError>;
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
> = ServiceEventOf<TA, E> & Record<string, unknown>;

/** Runs SQL outbox work inside a caller-owned service database transaction. */
export type SqlOutboxTransactionRunner<TTx> = <TResult>(
  work: (context: { tx: TTx; executor: SqlExecutor }) =>
    | Promise<TResult>
    | TResult,
) => Promise<TResult>;

/** Options shared by all Trellis SQL outbox service bindings. */
export type TrellisServiceSqlOutboxCommonOptions = {
  /** SQL dialect used by the Trellis helper tables. */
  readonly dialect: SqlDialect;
  /** Optional Trellis helper-table names; omitted names use Trellis defaults. */
  readonly tables?: Partial<SqlOutboxTables>;
  /** Optional process-local dispatcher tuning. */
  readonly dispatcher?: OutboxDispatcherOptions;
};

/** Options for binding a Trellis service to generic caller-owned SQL storage. */
export type TrellisServiceSqlOutboxExecutorOptions<TTx> =
  & TrellisServiceSqlOutboxCommonOptions
  & {
    /** Non-transactional executor used by the process-local dispatcher. */
    readonly executor: SqlExecutor;
    /** Service-owned transaction runner for handler-scoped work. */
    readonly transaction: SqlOutboxTransactionRunner<TTx>;
  };

/** Options for binding a Trellis service to caller-owned SQL outbox storage. */
export type TrellisServiceSqlOutboxOptions<TTx> =
  TrellisServiceSqlOutboxExecutorOptions<TTx>;

/** Typed transaction-scoped event facade that enqueues prepared events. */
export type SqlOutboxEventEnqueueFacade<
  TEventApi extends TrellisAPI = TrellisAPI,
> = {
  readonly [TGroup in SurfaceGroupName<ServiceEventName<TEventApi>>]: {
    readonly [
      E in SurfaceKeysForGroup<
        ServiceEventName<TEventApi>,
        TGroup
      > as SurfaceLeafName<E>
    ]: {
      enqueue(
        event: ServiceEventPayloadOf<TEventApi, E>,
      ): AsyncResult<OutboxMessage, ValidationError | UnexpectedError>;
    };
  };
};

/** Context supplied to `outbox.transaction(...)` work callbacks. */
export type SqlOutboxTransactionContext<
  TTx,
  TEventApi extends TrellisAPI = TrellisAPI,
> = {
  /** Service-owned transaction object supplied by the configured runner. */
  readonly tx: TTx;
  /** Transaction-scoped typed event enqueue facade. */
  readonly event: SqlOutboxEventEnqueueFacade<TEventApi>;
};

/** Startup-created SQL outbox dependency for transactional event enqueue. */
export type SqlOutbox<
  TTx,
  TEventApi extends TrellisAPI = TrellisAPI,
> = {
  /**
   * Runs service DB work and typed event enqueue operations in one SQL
   * transaction, notifying the dispatcher once after a successful commit.
   */
  transaction<TResult>(
    work: (context: SqlOutboxTransactionContext<TTx, TEventApi>) =>
      | Promise<TResult>
      | TResult,
  ): AsyncResult<TResult, ValidationError | UnexpectedError>;
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
    ): AsyncResult<
      AcceptedOperation<unknown, unknown, BaseError>,
      UnexpectedError
    >;
    control(
      operationId: string,
    ): AsyncResult<
      OperationRuntimeHandle<unknown, unknown, BaseError>,
      BaseError
    >;
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
          OperationTransferContextOf<TOwnedApi, O>,
          OperationHandlerErrorOf<TOwnedApi, O>
        >
        & { client: Trellis<TTrellisApi, TKv, TJobs> },
    ) => unknown | Promise<unknown>,
  ) => Promise<void>)
  & {
    accept(args: { sessionKey: string }): AsyncResult<
      AcceptedOperation<
        OperationProgressOf<TOwnedApi, O>,
        OperationOutputOf<TOwnedApi, O>,
        OperationHandlerErrorOf<TOwnedApi, O>
      >,
      UnexpectedError
    >;
    control(operationId: string): AsyncResult<
      OperationRuntimeHandle<
        OperationProgressOf<TOwnedApi, O>,
        OperationOutputOf<TOwnedApi, O>,
        OperationHandlerErrorOf<TOwnedApi, O>
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
      OperationOutputOf<TOwnedApi, O>,
      OperationHandlerErrorOf<TOwnedApi, O>
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
      OperationOutputOf<TOwnedApi, O>,
      OperationHandlerErrorOf<TOwnedApi, O>
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
          OperationTransferContextOf<TOwnedApi, O>,
          OperationHandlerErrorOf<TOwnedApi, O>
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
  /**
   * Controls automatic telemetry initialization for this service connection.
   * Enabled by default; pass `false` or `{ enabled: false }` to disable it.
   */
  telemetry?: TrellisServiceConnectTelemetryOpts;
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

/**
 * @internal Shared by Trellis-owned service bootstrap paths.
 */
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
    stopEventListeners: () => outbound.stopEventListeners(),
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
        new InternalStoreHandle(args.nc, binding, storeHandleConstructorToken),
      ]),
    ),
  });

  const service = Reflect.construct(TrellisService, [
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
  ]) as TrellisService<TOwnedApi, TTrellisApi, TJobs, TKv>;
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

function resolveSqlOutboxTables(
  tables: Partial<SqlOutboxTables> | undefined,
): SqlOutboxTables {
  return {
    outbox: tables?.outbox ?? defaultSqlOutboxTables.outbox,
    inbox: tables?.inbox ?? defaultSqlOutboxTables.inbox,
  };
}

function createSqlOutboxBaseExecutor<TTx>(
  options: TrellisServiceSqlOutboxOptions<TTx>,
): SqlExecutor {
  return options.executor;
}

function createSqlOutboxTransactionRunner<TTx>(
  options: TrellisServiceSqlOutboxOptions<TTx>,
): SqlOutboxTransactionRunner<TTx> {
  return options.transaction;
}

type SqlOutboxEventEnqueueLeaf = {
  enqueue(
    event: Record<string, unknown>,
  ): AsyncResult<OutboxMessage, ValidationError | UnexpectedError>;
};

function createSqlOutboxEventEnqueueFacade<TEventApi extends TrellisAPI>(args: {
  event: ActiveEventFacade<TEventApi>;
  repository: SqlOutboxRepository;
  onEnqueued(): void;
}): SqlOutboxEventEnqueueFacade<TEventApi> {
  const facade: Record<string, Record<string, SqlOutboxEventEnqueueLeaf>> = {};
  const source = args.event as Record<
    string,
    Record<string, ServiceEventLeaf>
  >;

  for (const [groupName, leaves] of Object.entries(source)) {
    const group: Record<string, SqlOutboxEventEnqueueLeaf> = {};
    for (const [leafName, leaf] of Object.entries(leaves)) {
      group[leafName] = {
        enqueue: (payload) =>
          AsyncResult.from((async () => {
            const prepared = leaf.prepare(payload).take();
            if (isErr(prepared)) return Result.err(prepared.error);
            try {
              const message = await args.repository.enqueue(prepared);
              args.onEnqueued();
              return Result.ok(message);
            } catch (cause) {
              return Result.err(toUnexpectedError(cause));
            }
          })()),
      };
    }
    Object.defineProperty(facade, groupName, {
      value: group,
      enumerable: true,
      configurable: true,
    });
  }

  return facade as SqlOutboxEventEnqueueFacade<TEventApi>;
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
    state === "expired" || state === "skipped" || state === "stale" ||
    state === "dead" || state === "dismissed";
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
    case "skipped":
    case "stale":
    case "staleCompletionIgnored":
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
  jobsBinding: JobsBinding;
  queueBinding: JobsQueueBinding;
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
  const keyCoordinator = createNatsJobKeyCoordinator(args.nc);
  const jobsBinding = args.jobsBinding
    ? normalizeResourceJobsBinding(args.jobsBinding)
    : undefined;
  let activeHost: JobWorkerHostAdapter | undefined;
  let startupPromise:
    | Promise<Result<JobWorkerHostAdapter, BaseError>>
    | undefined;
  let stopPromise: Promise<Result<void, BaseError>> | undefined;

  for (const queueType of Object.keys(args.contractJobs ?? {})) {
    const queueBinding = jobsBinding?.queues[queueType];
    if (queueBinding) lifecycle.watch(queueBinding);

    jobsFacade[queueType] = {
      create: (payload) =>
        AsyncResult.from((async () => {
          try {
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
              keyCoordinator,
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
            if (cause instanceof JobNotEnqueuedError) {
              return Result.err(cause);
            }
            return Result.err(toUnexpectedError(cause));
          }
        })()),
      submit: (payload) =>
        AsyncResult.from((async () => {
          try {
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
              keyCoordinator,
            });
            await args.nc.flush();
            const outcome = await manager.submit(queueType, payload);
            if (outcome.kind === "accepted") {
              return Result.ok({
                kind: "accepted",
                key: outcome.key,
                ref: createJobRef({
                  nc: args.nc,
                  queueType,
                  jobsBinding,
                  queueBinding,
                  seed: outcome.job as JobSnapshot<unknown, unknown>,
                  lifecycle,
                }),
              });
            }
            if (outcome.kind === "replaced") {
              return Result.ok({
                kind: "replaced",
                key: outcome.key,
                replaced: outcome.replaced,
                ref: createJobRef({
                  nc: args.nc,
                  queueType,
                  jobsBinding,
                  queueBinding,
                  seed: outcome.job as JobSnapshot<unknown, unknown>,
                  lifecycle,
                }),
              });
            }
            return Result.ok(outcome);
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

        if (!jobsBinding || !args.workStream) {
          return Result.err(toUnexpectedError(
            new Error(
              "Jobs infrastructure bindings are unavailable for this service",
            ),
          ));
        }

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
              keyCoordinator,
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

/**
 * Connects a service with caller-supplied runtime dependencies for tests and
 * Trellis-owned internals. This helper is intentionally not re-exported from
 * public package subpaths.
 *
 * @internal
 */
export function connectTrellisServiceWithRuntimeDeps<
  const TContract extends ServiceContract<
    TrellisAPI,
    TrellisAPI | undefined,
    ContractJobsMetadata,
    ContractKvMetadata
  >,
>(
  args: TrellisServiceConnectArgs<TContract>,
  deps: Partial<TrellisServiceRuntimeDeps>,
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
      if (automaticTelemetryEnabled(args.telemetry)) {
        runtimeDeps.initTelemetry?.(args.name);
      }
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
      const { authenticator: authTokenAuthenticator, inboxPrefix } = await auth
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

export class TrellisService<
  TOwnedApi extends TrellisAPI = TrellisAPI,
  TTrellisApi extends TrellisAPI = TOwnedApi,
  TJobs extends ContractJobsMetadata = {},
  TKv extends ContractKvMetadata = ContractKvMetadata,
> {
  readonly name: string;
  readonly auth: SessionAuth;
  readonly #server: TrellisServiceRuntimeFor<TOwnedApi & TTrellisApi>;
  readonly #nc: NatsConnection;
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
  readonly #ownedOutboxDispatchers = new Set<OutboxDispatcher>();
  #waitPromise?: Promise<void>;
  #stopPromise?: Promise<void>;

  private constructor(
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
    this.#nc = nc;
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
      ) => [
        alias,
        new InternalStoreHandle(nc, binding, storeHandleConstructorToken),
      ]),
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
   * Creates an explicit SQL outbox helper for service-owned transactions.
   * Services should create this at startup and close over it in handlers.
   */
  createSqlOutbox<TTx>(
    options: TrellisServiceSqlOutboxExecutorOptions<TTx>,
  ): SqlOutbox<TTx, TTrellisApi> {
    const binding = this.#createSqlOutboxBinding(options);
    return this.#createSqlOutbox(binding);
  }

  /** Publishes a prepared event through the service runtime connection. */
  publishPrepared(
    event: PreparedTrellisEvent,
  ): AsyncResult<void, UnexpectedError> {
    return this.#handlerTrellis.publishPrepared(event);
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

  #createSqlOutboxBinding<TTx>(
    options: TrellisServiceSqlOutboxOptions<TTx>,
  ): {
    readonly dialect: SqlDialect;
    readonly tables: SqlOutboxTables;
    readonly transaction: SqlOutboxTransactionRunner<TTx>;
    readonly dispatcher: OutboxDispatcher;
  } {
    const tables = resolveSqlOutboxTables(options.tables);
    const executor = createSqlOutboxBaseExecutor(options);
    const repository = new SqlOutboxRepository(
      executor,
      options.dialect,
      tables,
    );
    const dispatcher = new OutboxDispatcher(
      repository,
      this.#handlerTrellis,
      options.dispatcher,
    );
    this.#ownedOutboxDispatchers.add(dispatcher);
    return {
      dialect: options.dialect,
      tables,
      transaction: createSqlOutboxTransactionRunner(options),
      dispatcher,
    };
  }

  #createSqlOutbox<TTx>(binding: {
    readonly dialect: SqlDialect;
    readonly tables: SqlOutboxTables;
    readonly transaction: SqlOutboxTransactionRunner<TTx>;
    readonly dispatcher: OutboxDispatcher;
  }): SqlOutbox<TTx, TTrellisApi> {
    return {
      transaction: <TResult>(
        work: (
          context: SqlOutboxTransactionContext<TTx, TTrellisApi>,
        ) => Promise<TResult> | TResult,
      ) =>
        AsyncResult.from((() => {
          let enqueued = 0;
          const toResultError = (
            cause: unknown,
          ): Result<TResult, ValidationError | UnexpectedError> => {
            if (
              cause instanceof ValidationError ||
              cause instanceof UnexpectedError
            ) {
              return Result.err(cause);
            }
            return Result.err(toUnexpectedError(cause));
          };
          let transaction: Promise<TResult>;
          try {
            transaction = binding.transaction<TResult>(({ tx, executor }) => {
              const repository = new SqlOutboxRepository(
                executor,
                binding.dialect,
                binding.tables,
              );
              const event = createSqlOutboxEventEnqueueFacade({
                event: this.event,
                repository,
                onEnqueued: () => {
                  enqueued += 1;
                },
              });
              return work({ tx, event });
            });
          } catch (cause) {
            return Promise.resolve(toResultError(cause));
          }
          return transaction.then((result) => {
            if (enqueued > 0) binding.dispatcher.notify();
            return Result.ok(result);
          }, toResultError);
        })()),
    };
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
  ): AsyncResult<
    TrellisService<
      ContractOwnedApi<TContract>,
      ContractTrellisApi<TContract>,
      ContractJobsOf<TContract>,
      ContractKvOf<TContract>
    >,
    TransportError | UnexpectedError
  > {
    return connectTrellisServiceWithRuntimeDeps(args, {});
  }

  async wait(): Promise<void> {
    this.#waitPromise ??= (async () => {
      try {
        await this.#managedJobWorkers.start().orThrow();
        const closed = await this.#nc.closed();
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
      this.#handlerTrellis.stopEventListeners();
      for (const dispatcher of this.#ownedOutboxDispatchers) {
        dispatcher.stop();
      }
      this.#ownedOutboxDispatchers.clear();

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
            this.connection.setStatus({
              kind: this.connection.status.kind,
              phase: "closed",
              observedAt: new Date(),
              transport: { name: "nats" },
            });
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
      OperationTransferContextOf<TOwnedApi, O>,
      BaseError
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
              OperationTransferContextOf<TOwnedApi, O>,
              BaseError
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
