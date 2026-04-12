import {
  jwtAuthenticator,
  type NatsConnection,
} from "@nats-io/nats-core";
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
} from "@qlever-llc/trellis/sdk/core";
import { TrellisServer, type TrellisServerFor } from "@qlever-llc/trellis/server/runtime";
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
import { isErr, type Result } from "@qlever-llc/result";
import type { Logger } from "pino";
import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type { HealthCheckFn } from "./health.ts";
import { mountStandardHealthRpc } from "./health_rpc.ts";
import type { RPCDesc } from "@qlever-llc/trellis/contracts";
import {
  type ResourceBindingJobs,
  type ResourceBindingJobsQueue,
} from "@qlever-llc/trellis-jobs";
import type {
  NatsConnectFn,
  NatsConnectOpts,
  TrellisServiceRuntimeDeps,
} from "./runtime.ts";
import { ServiceTransfer } from "./transfer.ts";

type ExtraNatsConnectOpts = Omit<
  NatsConnectOpts,
  "servers" | "token" | "inboxPrefix" | "authenticator"
>;

type ServiceBootstrapConnectInfo = {
  sessionKey: string;
  contractId: string;
  contractDigest: string;
  transport: {
    natsServers: string[];
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
type RpcMethodInput<TA extends TrellisAPI, M extends RpcMethodName<TA>> = InferSchemaType<TA["rpc"][M]["input"]>;
type RpcMethodOutput<TA extends TrellisAPI, M extends RpcMethodName<TA>> = InferSchemaType<TA["rpc"][M]["output"]>;

type BootstrapTrellisApi = {
  rpc: Pick<typeof TRELLIS_CORE_API.owned.rpc, "Trellis.Catalog" | "Trellis.Bindings.Get">;
  operations: {};
  events: {};
  subjects: {};
};
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

function runtimeImport<TModule>(specifier: string): Promise<TModule> {
  const load = new Function("specifier", "return import(specifier);") as (
    specifier: string,
  ) => Promise<TModule>;
  return load(specifier);
}

async function loadDefaultServiceRuntimeDeps(): Promise<TrellisServiceRuntimeDeps> {
  if ("Deno" in globalThis) {
    const mod = await runtimeImport<{ connect: TrellisServiceRuntimeDeps["connect"] }>(
      "@nats-io/transport-deno",
    );
    return { connect: mod.connect };
  }

  const mod = await runtimeImport<{ connect: TrellisServiceRuntimeDeps["connect"] }>(
    "@nats-io/transport-node",
  );
  return { connect: mod.connect };
}

const ServiceBootstrapReadySchema = Type.Object({
  status: Type.Literal("ready"),
  connectInfo: Type.Object({
    sessionKey: Type.String({ minLength: 1 }),
    contractId: Type.String({ minLength: 1 }),
    contractDigest: Type.String({ minLength: 1 }),
    transport: Type.Object({
      natsServers: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
      sentinel: SentinelCredsSchema,
    }, { additionalProperties: false }),
    auth: Type.Object({
      mode: Type.Literal("service_identity"),
      iatSkewSeconds: Type.Integer({ minimum: 1 }),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  binding: Type.Object({
    contractId: Type.String({ minLength: 1 }),
    digest: Type.String({ minLength: 1 }),
    resources: ContractResourceBindingsSchema,
  }, { additionalProperties: false }),
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

  return Value.Parse(ServiceBootstrapReadySchema, payload) as ServiceBootstrapResponse;
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
  server?: Omit<TrellisServerCreateOpts<TOwnedApi, TTrellisApi>, "api" | "trellisApi">;
};

export type ServiceTrellis<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
> =
  & Omit<Trellis<TTrellisApi>, "mount">
  & Pick<TrellisServerFor<TOwnedApi & TTrellisApi>, "mount">;

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

async function createConnectedService<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI,
>(args: {
  name: string;
  auth: SessionAuth;
  nc: NatsConnection;
  server: TrellisServerCreateOpts<TOwnedApi, TTrellisApi>;
  bindings: ResourceBindings;
}): Promise<TrellisService<TOwnedApi, TTrellisApi>> {
  const runtimeApi = (args.server.trellisApi ?? args.server.api) as TOwnedApi & TTrellisApi;

  const server = TrellisServer.create(
    args.name,
    args.nc,
    { sessionKey: args.auth.sessionKey, sign: args.auth.sign },
    {
      log: args.server.log,
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
      log: args.server.log,
      timeout: args.server.timeout,
      stream: args.server.stream,
      noResponderRetry: args.server.noResponderRetry,
      api: runtimeApi,
    },
  );

  const trellis: ServiceTrellis<TOwnedApi, TTrellisApi> = Object.assign(outbound, {
    mount: server.mount.bind(server),
  });

  await mountStandardHealthRpc(server, {
    checks: args.server.healthChecks,
  });

  return new TrellisService<TOwnedApi, TTrellisApi>(
    args.name,
    args.auth,
    args.nc,
    server,
    trellis,
    args.bindings,
  );
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

  constructor(
    name: string,
    auth: SessionAuth,
    nc: NatsConnection,
    server: TrellisServerFor<TOwnedApi & TTrellisApi>,
    trellis: ServiceTrellis<TOwnedApi, TTrellisApi>,
    bindings: ResourceBindings,
  ) {
    this.name = name;
    this.auth = auth;
    this.nc = nc;
    this.server = server;
    this.operations = server.operations;
    this.trellis = trellis;
    this.kv = Object.fromEntries(
      Object.entries(bindings.kv).map(([alias, binding]) => [alias, new KVHandle(nc, binding)]),
    );
    this.store = Object.fromEntries(
      Object.entries(bindings.store).map(([alias, binding]) => [alias, new StoreHandle(nc, binding)]),
    );
    this.transfer = new ServiceTransfer({
      name,
      nc,
      auth,
      stores: this.store,
    });
    this.streams = bindings.streams;
    this.jobs = bindings.jobs;
  }

  static async connect<
    TOwnedApi extends TrellisAPI = TrellisAPI,
    TTrellisApi extends TrellisAPI = TOwnedApi,
  >(
    args: TrellisServiceConnectOpts<TOwnedApi, TTrellisApi>,
    deps?: Partial<TrellisServiceRuntimeDeps>,
  ): Promise<TrellisService<TOwnedApi, TTrellisApi>> {
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
      servers: bootstrap.connectInfo.transport.natsServers,
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
    opts: TrellisServiceRuntimeConnectOpts<TOwnedApi, TTrellisApi> & {
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

    let bindings: ResourceBindings = { kv: {}, store: {}, streams: {} };

    if (opts.contractId && opts.contractDigest) {
      const runtimeApi = (opts.server.trellisApi ?? opts.server.api) as TOwnedApi & TTrellisApi;
      const outbound = new Trellis<TTrellisApi>(
        name,
        nc,
        { sessionKey: auth.sessionKey, sign: auth.sign },
        {
          log: opts.server.log,
          timeout: opts.server.timeout,
          stream: opts.server.stream,
          noResponderRetry: opts.server.noResponderRetry,
          api: runtimeApi,
        },
      );
      const trellis: ServiceTrellis<TOwnedApi, TTrellisApi> = Object.assign(outbound, {
        mount: () => {
          throw new Error("mount is unavailable during internal bootstrap probing");
        },
      });
      const bootstrapRequest = trellis.request.bind(trellis) as Pick<Trellis<BootstrapTrellisApi>, "request">["request"];
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
          `Service '${name}' received bindings for '${resolved.binding.contractId ?? "unknown"}' (${resolved.binding.digest ?? "unknown"}) ` +
            `while bootstrapping '${opts.contractId}' (${opts.contractDigest}). Re-run the service install or upgrade flow so Trellis records the correct active contract for this session key.`,
        );
      }

      bindings = {
        kv: resolved.binding?.resources?.kv ?? {},
        store: resolved.binding?.resources?.store ?? {},
        streams: resolved.binding?.resources?.streams ?? {},
        ...(resolved.binding?.resources?.jobs ? { jobs: resolved.binding.resources.jobs } : {}),
      };
    }

    return await createConnectedService<TOwnedApi, TTrellisApi>({
      name,
      auth,
      nc,
      server: opts.server,
      bindings,
    });
  }

  async stop(): Promise<void> {
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
      import("@qlever-llc/trellis").RemoteError | import("@qlever-llc/trellis").ValidationError | import("@qlever-llc/trellis").UnexpectedError
    >
  > {
    return this.trellis.request(method as never, input as never, opts) as Promise<
      Result<
        RpcMethodOutput<TTrellisApi, M>,
        import("@qlever-llc/trellis").RemoteError | import("@qlever-llc/trellis").ValidationError | import("@qlever-llc/trellis").UnexpectedError
      >
    >;
  }

  requestOrThrow<M extends RpcMethodName<TTrellisApi>>(
    method: M,
    input: RpcMethodInput<TTrellisApi, M>,
    opts?: RequestOpts,
  ): Promise<RpcMethodOutput<TTrellisApi, M>> {
    return this.trellis.requestOrThrow(method as never, input as never, opts) as Promise<
      RpcMethodOutput<TTrellisApi, M>
    >;
  }

  operation<O extends keyof (TOwnedApi & TTrellisApi)["operations"] & string>(
    operation: O,
  ): OperationRegistration<InferSchemaType<(TOwnedApi & TTrellisApi)["operations"][O]["input"]>> {
    return this.server.operation(operation) as OperationRegistration<
      InferSchemaType<(TOwnedApi & TTrellisApi)["operations"][O]["input"]>
    >;
  }
}
