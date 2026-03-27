import type { NatsConnection } from "@nats-io/nats-core";
import { type KVError, Trellis, TrellisServer, TypedKV } from "@qlever-llc/trellis";
import { createAuth, type TrellisAuth as SessionAuth } from "@qlever-llc/trellis-auth";
import type { InferSchemaType, TrellisAPI } from "@qlever-llc/trellis-contracts";
import { isErr, type Result } from "@qlever-llc/trellis-result";
import type { Logger } from "pino";
import type { TSchema } from "typebox";
import type { HealthCheckFn } from "./health.ts";
import { mountStandardHealthRpc } from "./health_rpc.ts";
import type {
  NatsConnectFn,
  NatsConnectOpts,
  TrellisServiceRuntimeDeps,
} from "./runtime.ts";

type ExtraNatsConnectOpts = Omit<
  NatsConnectOpts,
  "servers" | "token" | "inboxPrefix" | "authenticator"
>;

type RpcMethodName<TA extends TrellisAPI> = keyof TA["rpc"] & string;
type RpcMethodInput<TA extends TrellisAPI, M extends RpcMethodName<TA>> = InferSchemaType<TA["rpc"][M]["input"]>;
type RpcMethodOutput<TA extends TrellisAPI, M extends RpcMethodName<TA>> = InferSchemaType<TA["rpc"][M]["output"]>;
type TrellisServerCreateOpts<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI = TOwnedApi,
> = {
  log?: Logger;
  timeout?: number;
  stream?: string;
  noResponderRetry?: { maxAttempts?: number; baseDelayMs?: number };
  api: TOwnedApi;
  trellisApi?: TTrellisApi;
  version?: string;
  healthChecks?: Record<string, HealthCheckFn>;
};

export type ResourceBindingKV = {
  bucket: string;
  history: number;
  ttlMs: number;
  maxValueBytes?: number;
};

export type ResourceBindingStream = {
  name: string;
  [key: string]: unknown;
};

export type ResourceBindingJobsQueue = {
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

export type ResourceBindingJobs = {
  namespace: string;
  queues: Record<string, ResourceBindingJobsQueue>;
  registry?: { bucket: string };
};

export type ResourceBindings = {
  kv: Record<string, ResourceBindingKV>;
  streams: Record<string, ResourceBindingStream>;
  jobs?: ResourceBindingJobs;
};

function getErrorCauseMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const context = (error as { context?: Record<string, unknown> }).context;
    if (typeof context?.causeMessage === "string" && context.causeMessage.length > 0) {
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
    "Re-run the service install or upgrade flow so Trellis records the active contract digest, permissions, and resource bindings for this session key.";
  const cause = args.cause ? ` Underlying error: ${getErrorCauseMessage(args.cause)}` : "";
  return new Error(base + cause);
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

export type TrellisServiceConnectOpts<
  TOwnedApi extends TrellisAPI = TrellisAPI,
  TTrellisApi extends TrellisAPI = TOwnedApi,
> = {
  /**
   * Session key seed (base64url Ed25519 private key seed) used to derive the service session key.
   * If you already have a `TrellisAuth` object, pass it via `auth` instead.
   */
  sessionKeySeed?: string;

  /**
   * Pre-created session-key auth (typically from `@qlever-llc/trellis-auth.createAuth`).
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

export type ServiceTrellis<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
> =
  & Omit<Trellis<TTrellisApi>, "mount">
  & Pick<TrellisServer<TOwnedApi>, "mount">;

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

export class TrellisService<
  TOwnedApi extends TrellisAPI = TrellisAPI,
  TTrellisApi extends TrellisAPI = TOwnedApi,
> {
  readonly name: string;
  readonly auth: SessionAuth;
  readonly nc: NatsConnection;
  readonly server: TrellisServer<TOwnedApi>;
  readonly trellis: ServiceTrellis<TOwnedApi, TTrellisApi>;
  readonly kv: Record<string, KVHandle>;
  readonly streams: Record<string, ResourceBindingStream>;
  readonly jobs?: ResourceBindingJobs;

  private constructor(
    name: string,
    auth: SessionAuth,
    nc: NatsConnection,
    server: TrellisServer<TOwnedApi>,
    trellis: ServiceTrellis<TOwnedApi, TTrellisApi>,
    bindings: ResourceBindings,
  ) {
    this.name = name;
    this.auth = auth;
    this.nc = nc;
    this.server = server;
    this.trellis = trellis;
    this.kv = Object.fromEntries(
      Object.entries(bindings.kv).map(([alias, binding]) => [alias, new KVHandle(nc, binding)]),
    );
    this.streams = bindings.streams;
    this.jobs = bindings.jobs;
  }

  static async connect<
    TOwnedApi extends TrellisAPI = TrellisAPI,
    TTrellisApi extends TrellisAPI = TOwnedApi,
  >(
    name: string,
    opts: TrellisServiceConnectOpts<TOwnedApi, TTrellisApi> & {
      contractId?: string;
      contractDigest?: string;
    },
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

    const server = TrellisServer.create<TOwnedApi>(
      name,
      nc,
      { sessionKey: auth.sessionKey, sign: auth.sign },
      {
        log: opts.server.log,
        timeout: opts.server.timeout,
        stream: opts.server.stream,
        noResponderRetry: opts.server.noResponderRetry,
        api: opts.server.api,
        version: opts.server.version,
      },
    );

    const outbound = new Trellis<TTrellisApi>(
      name,
      nc,
      { sessionKey: auth.sessionKey, sign: auth.sign },
      {
        log: opts.server.log,
        timeout: opts.server.timeout,
        stream: opts.server.stream,
        noResponderRetry: opts.server.noResponderRetry,
        api: opts.server.trellisApi ??
          opts.server.api as unknown as TTrellisApi,
      },
    );

    const trellis = Object.assign(outbound, {
      mount: server.mount.bind(server),
    }) as unknown as ServiceTrellis<TOwnedApi, TTrellisApi>;

    await mountStandardHealthRpc(server as any, {
      checks: opts.server.healthChecks,
    });

    let bindings: ResourceBindings = { kv: {}, streams: {} };

    if (opts.contractId && opts.contractDigest) {
      const catalogResult = await trellis.request(
        "Trellis.Catalog" as any,
        {} as any,
      );
      const catalogValue = catalogResult.take();
      if (isErr(catalogValue)) {
        throw bootstrapContractStateError({
          serviceName: name,
          contractId: opts.contractId,
          contractDigest: opts.contractDigest,
          step: "catalog lookup",
          cause: (catalogValue as any).error,
        });
      }
      const catalog = catalogValue as {
        catalog: { contracts: Array<{ digest: string }> };
      };
      const isActive = catalog.catalog.contracts.some(
        (c) => c.digest === opts.contractDigest,
      );
      if (!isActive) {
        throw new Error(
          `Contract ${opts.contractId} (${opts.contractDigest}) is not active. Install it with the trellis CLI first.`,
        );
      }

      const bindingsResult = await trellis.request(
        "Trellis.Bindings.Get" as any,
        { contractId: opts.contractId } as any,
      );
      const bindingsValue = bindingsResult.take();
      if (isErr(bindingsValue)) {
        throw bootstrapContractStateError({
          serviceName: name,
          contractId: opts.contractId,
          contractDigest: opts.contractDigest,
          step: "bindings lookup",
          cause: (bindingsValue as any).error,
        });
      }
      const resolved = bindingsValue as {
        binding?: {
          contractId?: string;
          digest?: string;
            resources?: {
              kv?: Record<string, ResourceBindingKV>;
              streams?: Record<string, ResourceBindingStream>;
              jobs?: ResourceBindingJobs;
            };
          };
      };
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
          `Service '${name}' received bindings for '${resolved.binding.contractId ?? "unknown"}' (${resolved.binding.digest ?? "unknown"}) ` +
            `while bootstrapping '${opts.contractId}' (${opts.contractDigest}). Re-run the service install or upgrade flow so Trellis records the correct active contract for this session key.`,
        );
      }

      bindings = {
        kv: resolved.binding?.resources?.kv ?? {},
        streams: resolved.binding?.resources?.streams ?? {},
        ...(resolved.binding?.resources?.jobs ? { jobs: resolved.binding.resources.jobs } : {}),
      };
    }

    return new TrellisService<TOwnedApi, TTrellisApi>(
      name,
      auth,
      nc,
      server,
      trellis,
      bindings,
    );
  }

  async stop(): Promise<void> {
    await this.server.stop();
  }

  request<M extends RpcMethodName<TTrellisApi>>(
    method: M,
    input: RpcMethodInput<TTrellisApi, M>,
    opts?: RequestOpts,
  ): ReturnType<Trellis<TTrellisApi>["request"]> {
    return this.trellis.request(method, input, opts) as ReturnType<Trellis<TTrellisApi>["request"]>;
  }

  requestOrThrow<M extends RpcMethodName<TTrellisApi>>(
    method: M,
    input: RpcMethodInput<TTrellisApi, M>,
    opts?: RequestOpts,
  ): Promise<RpcMethodOutput<TTrellisApi, M>> {
    return (this.trellis as unknown as {
      requestOrThrow(method: string, input: unknown, opts?: RequestOpts): Promise<unknown>;
    }).requestOrThrow(method, input, opts) as Promise<RpcMethodOutput<TTrellisApi, M>>;
  }
}

export function connectService<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
>(
  contract: ServiceContract<TOwnedApi, TTrellisApi>,
  name: string,
  opts: Omit<TrellisServiceConnectOpts<TOwnedApi, TTrellisApi>, "server"> & {
    server: Omit<
      TrellisServiceConnectOpts<TOwnedApi, TTrellisApi>["server"],
      "api" | "trellisApi"
    >;
  },
  deps: TrellisServiceRuntimeDeps,
): Promise<TrellisService<TOwnedApi, TTrellisApi>> {
  const connectOpts = {
    ...opts,
    contractId: contract.CONTRACT_ID,
    contractDigest: contract.CONTRACT_DIGEST,
    server: {
      ...opts.server,
      api: contract.API.owned,
      trellisApi: contract.API.trellis,
    },
  };

  return TrellisService.connect<TOwnedApi, TTrellisApi>(
    name,
    connectOpts,
    deps,
  );
}
