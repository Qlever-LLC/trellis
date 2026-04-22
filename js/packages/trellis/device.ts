import {
  type Authenticator,
  jwtAuthenticator,
  type NatsConnection,
} from "@nats-io/nats-core";
import {
  CONTRACT_STATE_METADATA,
  type ContractStateMetadata,
} from "./contract_support/mod.ts";

import {
  buildDeviceActivationPayload,
  deriveDeviceIdentity,
  signDeviceWaitRequest,
  startDeviceActivationRequest,
  verifyDeviceConfirmationCode,
  waitForDeviceActivation,
} from "./auth/device_activation.ts";
import {
  importEd25519PrivateKeyFromSeedBase64url,
  signEd25519SeedSha256,
} from "./auth/keys.ts";
import {
  base64urlDecode,
  base64urlEncode,
  toArrayBuffer,
} from "./auth/utils.ts";
import type { TrellisAPI } from "./contracts.ts";
import { loadDefaultRuntimeTransport } from "./runtime_transport.ts";
import { selectRuntimeTransportServers } from "./runtime_transport.ts";
import { ServiceHealth } from "./health.ts";
import { type RuntimeStateStoresForContract, Trellis } from "./trellis.ts";
import { logger as noopLogger, type LoggerLike } from "./globals.ts";
import { TransportError } from "./errors/index.ts";
import { type StaticDecode, Type } from "typebox";
import { Value } from "typebox/value";

type DeviceContract<
  TApi extends TrellisAPI = TrellisAPI,
  TContract extends {
    state?: Readonly<Record<string, unknown>>;
    schemas?: Readonly<Record<string, unknown>>;
  } = {
    state?: Readonly<Record<string, unknown>>;
    schemas?: Readonly<Record<string, unknown>>;
  },
> = {
  CONTRACT_ID: string;
  CONTRACT_DIGEST: string;
  CONTRACT: TContract & {
    displayName?: string;
  };
  API: {
    trellis: TApi;
  };
  readonly [CONTRACT_STATE_METADATA]?: ContractStateMetadata;
};

type DeviceContractApi<TContract extends DeviceContract> =
  TContract["API"]["trellis"];

export type TrellisDeviceConnection<
  TApi extends TrellisAPI = TrellisAPI,
  TState extends Record<string, { kind: "value" | "map"; value: unknown }> = {},
> = Trellis<TApi, "client", TState> & {
  health: ServiceHealth;
};

type DeviceConnectTransport = {
  connect(options: {
    servers: string | string[];
    token?: string;
    authenticator?: unknown;
    inboxPrefix?: string;
  }): Promise<NatsConnection>;
};

type DeviceConnectDeps = {
  loadTransport(): Promise<DeviceConnectTransport>;
  now(): number;
};

const ClientTransportEndpointsSchema = Type.Object({
  natsServers: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
});

const ClientTransportsSchema = Type.Object({
  native: Type.Optional(ClientTransportEndpointsSchema),
  websocket: Type.Optional(ClientTransportEndpointsSchema),
});

export type DeviceActivationController = {
  url: string;
  waitForOnlineApproval(opts?: { signal?: AbortSignal }): Promise<void>;
  acceptConfirmationCode(code: string): Promise<void>;
};

export type TrellisDeviceConnectArgs<
  TApi extends TrellisAPI = TrellisAPI,
  TContract extends DeviceContract<TApi, {
    state?: Readonly<Record<string, unknown>>;
    schemas?: Readonly<Record<string, unknown>>;
  }> = DeviceContract<TApi, {
    state?: Readonly<Record<string, unknown>>;
    schemas?: Readonly<Record<string, unknown>>;
  }>,
> = {
  trellisUrl: string;
  contract: TContract;
  rootSecret: Uint8Array | string;
  log?: LoggerLike | false;
  onActivationRequired?(activation: DeviceActivationController): Promise<void>;
};

const DeviceBootstrapReadySchema = Type.Object({
  status: Type.Literal("ready"),
  connectInfo: Type.Object({
    instanceId: Type.String({ minLength: 1 }),
    profileId: Type.String({ minLength: 1 }),
    contractId: Type.String({ minLength: 1 }),
    contractDigest: Type.String({ minLength: 1 }),
    transports: ClientTransportsSchema,
    transport: Type.Object({
      sentinel: Type.Object({
        jwt: Type.String({ minLength: 1 }),
        seed: Type.String({ minLength: 1 }),
      }),
    }),
    auth: Type.Object({
      mode: Type.Literal("device_identity"),
      iatSkewSeconds: Type.Integer({ minimum: 1 }),
    }),
  }),
});

const DeviceBootstrapActivationRequiredSchema = Type.Object({
  status: Type.Literal("activation_required"),
});

const DeviceBootstrapNotReadySchema = Type.Object({
  status: Type.Literal("not_ready"),
  reason: Type.String({ minLength: 1 }),
});

type DeviceBootstrapReady = StaticDecode<typeof DeviceBootstrapReadySchema>;
type DeviceBootstrapActivationRequired = StaticDecode<
  typeof DeviceBootstrapActivationRequiredSchema
>;
type DeviceBootstrapNotReady = StaticDecode<
  typeof DeviceBootstrapNotReadySchema
>;
type DeviceBootstrapResponse =
  | DeviceBootstrapReady
  | DeviceBootstrapActivationRequired
  | DeviceBootstrapNotReady;
type ResolvedDeviceConnectInfo = DeviceBootstrapReady["connectInfo"];

function normalizeRootSecret(rootSecret: Uint8Array | string): Uint8Array {
  if (typeof rootSecret === "string") {
    const decoded = base64urlDecode(rootSecret.trim());
    if (decoded.length === 0) throw new Error("rootSecret must not be empty");
    return decoded;
  }
  if (rootSecret.length === 0) throw new Error("rootSecret must not be empty");
  return rootSecret;
}

async function signIdentityBytes(
  identitySeed: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const privateKey = await importEd25519PrivateKeyFromSeedBase64url(
    base64urlEncode(identitySeed),
  );
  return new Uint8Array(
    await crypto.subtle.sign("Ed25519", privateKey, toArrayBuffer(data)),
  );
}

function createDeviceNatsAuthTokenAuthenticator(args: {
  publicIdentityKey: string;
  identitySeed: Uint8Array;
  contractDigest: string;
  now: () => number;
}): Authenticator {
  return () => {
    const iat = Math.floor(args.now() / 1_000);
    const sig = signEd25519SeedSha256(
      args.identitySeed,
      new TextEncoder().encode(`nats-connect:${iat}`),
    );
    return {
      auth_token: JSON.stringify({
        v: 1,
        sessionKey: args.publicIdentityKey,
        iat,
        sig: base64urlEncode(new Uint8Array(sig)),
        contractDigest: args.contractDigest,
      }),
    };
  };
}

const defaultDeps: DeviceConnectDeps = {
  loadTransport: loadDefaultRuntimeTransport,
  now: () => Date.now(),
};

function transportCauseContext(cause: unknown): Record<string, unknown> {
  if (cause instanceof Error) {
    return { causeName: cause.name, causeMessage: cause.message };
  }

  return { cause: String(cause) };
}

function createTransportError(args: {
  code: string;
  message: string;
  hint: string;
  context?: Record<string, unknown>;
  cause?: unknown;
}): TransportError {
  return new TransportError({
    code: args.code,
    message: args.message,
    hint: args.hint,
    cause: args.cause,
    context: {
      ...(args.context ?? {}),
      ...(args.cause === undefined ? {} : transportCauseContext(args.cause)),
    },
  });
}

async function readJsonResponse(
  response: Response,
  args: {
    code: string;
    message: string;
    hint: string;
    context?: Record<string, unknown>;
  },
): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw createTransportError({
      ...args,
      cause,
    });
  }
}

function activationRequiredError(): Error {
  return new Error(
    "Device activation required but no activation handler was provided",
  );
}

function resolveDeviceLogger(log?: LoggerLike | false): LoggerLike {
  if (log === false) {
    return noopLogger;
  }

  return log ?? noopLogger;
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

function getDeviceNatsLifecycleLog(status: unknown): {
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
        message: "Device disconnected from NATS",
      };
    case "reconnecting":
      return {
        level: "warn",
        message: "Device attempting NATS reconnect",
      };
    case "forceReconnect":
      return {
        level: "warn",
        message: "Device forcing NATS reconnect",
      };
    case "reconnect":
      return {
        level: "info",
        message: "Device reconnected to NATS",
      };
    case "staleConnection":
      return {
        level: "warn",
        message: "Device NATS connection became stale",
      };
    case "error":
      return {
        level: "error",
        message: "Device NATS error",
      };
    default:
      return null;
  }
}

function startDeviceNatsConnectionLogging(args: {
  contractId: string;
  nc: NatsConnection;
  log: LoggerLike;
}): void {
  const statusFn = (args.nc as NatsConnection & {
    status?: () => AsyncIterable<unknown>;
  }).status;

  if (typeof statusFn === "function") {
    void (async () => {
      try {
        for await (const status of statusFn.call(args.nc)) {
          const lifecycleLog = getDeviceNatsLifecycleLog(status);
          if (!lifecycleLog) {
            continue;
          }

          args.log[lifecycleLog.level](
            {
              contractId: args.contractId,
              connection: normalizeNatsStatus(status),
            },
            lifecycleLog.message,
          );
        }
      } catch (error) {
        args.log.warn(
          { contractId: args.contractId, error },
          "Device NATS status watcher failed",
        );
      }
    })();
  }

  void args.nc.closed().then((error: unknown) => {
    if (error) {
      args.log.error(
        { contractId: args.contractId, error },
        "Device NATS connection closed with error",
      );
      return;
    }

    args.log.warn(
      { contractId: args.contractId },
      "Device NATS connection closed",
    );
  });
}

function isConnectInfoUnavailable(error: unknown): boolean {
  if (error instanceof TransportError) {
    const context = error.getContext();
    return context.reason === "unknown_device" || context.reason === "activation_required" ||
      context.status === 404;
  }

  const message = error instanceof Error ? error.message : String(error);
  return message.includes("404") || message.includes("unknown_device") ||
    message.includes("activation_required");
}

async function fetchDeviceBootstrap(args: {
  trellisUrl: string;
  publicIdentityKey: string;
  identitySeed: Uint8Array | string;
  contractDigest: string;
  iat?: number;
}): Promise<DeviceBootstrapResponse> {
  const request = await signDeviceWaitRequest({
    publicIdentityKey: args.publicIdentityKey,
    nonce: "connect-info",
    identitySeed: args.identitySeed,
    contractDigest: args.contractDigest,
    iat: args.iat,
  });
  const bootstrapRequest = {
    publicIdentityKey: request.publicIdentityKey,
    contractDigest: request.contractDigest,
    iat: request.iat,
    sig: request.sig,
  };
  const response = await fetch(new URL("/bootstrap/device", args.trellisUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bootstrapRequest),
  });
  if (!response.ok) {
    const reason = await response.text();
    throw createTransportError({
      code: "trellis.bootstrap.failed",
      message: "Trellis could not prepare the device session.",
      hint: "Retry the connection. If it keeps failing, check Trellis availability and device activation state.",
      context: { trellisUrl: args.trellisUrl, status: response.status, reason },
    });
  }

  const payload = await readJsonResponse(response, {
    code: "trellis.bootstrap.invalid_response",
    message: "Trellis returned an invalid bootstrap response.",
    hint: "Retry the connection. If it keeps happening, check the Trellis deployment.",
    context: { trellisUrl: args.trellisUrl },
  });
  if (Value.Check(DeviceBootstrapReadySchema, payload)) return payload;
  if (Value.Check(DeviceBootstrapActivationRequiredSchema, payload)) {
    return payload;
  }
  if (Value.Check(DeviceBootstrapNotReadySchema, payload)) return payload;
  throw createTransportError({
    code: "trellis.bootstrap.invalid_response",
    message: "Trellis returned an invalid bootstrap response.",
    hint: "Retry the connection. If it keeps happening, check the Trellis deployment.",
    context: { trellisUrl: args.trellisUrl },
  });
}

export async function connectDeviceWithDeps<
  TContract extends DeviceContract<TrellisAPI, {
    state?: Readonly<Record<string, unknown>>;
    schemas?: Readonly<Record<string, unknown>>;
  }>,
>(
  args: TrellisDeviceConnectArgs<DeviceContractApi<TContract>, TContract>,
  deps: DeviceConnectDeps,
): Promise<
  TrellisDeviceConnection<
    DeviceContractApi<TContract>,
    RuntimeStateStoresForContract<TContract>
  >
> {
  const log = resolveDeviceLogger(args.log);
  const rootSecret = normalizeRootSecret(args.rootSecret);
  const identity = await deriveDeviceIdentity(rootSecret);
  const contractDigest = args.contract.CONTRACT_DIGEST;

  let connectInfo: ResolvedDeviceConnectInfo | null = null;

  try {
    const bootstrap = await fetchDeviceBootstrap({
      trellisUrl: args.trellisUrl,
      publicIdentityKey: identity.publicIdentityKey,
      identitySeed: identity.identitySeed,
      contractDigest,
    });
    if (bootstrap.status === "ready") {
      connectInfo = bootstrap.connectInfo;
    } else if (bootstrap.status === "not_ready") {
      throw createTransportError({
        code: "trellis.bootstrap.not_ready",
        message: "Trellis is not ready to connect this device.",
        hint: "Wait for the device to be activated and the requested profile to become available, then try again.",
        context: { reason: bootstrap.reason },
      });
    }
  } catch (error) {
    if (!isConnectInfoUnavailable(error)) throw error;
  }

  if (!connectInfo) {
    if (!args.onActivationRequired) throw activationRequiredError();

    const nonce = crypto.randomUUID();
    const payload = await buildDeviceActivationPayload({
      activationKey: identity.activationKey,
      publicIdentityKey: identity.publicIdentityKey,
      nonce,
    });
    const activationUrl = (await startDeviceActivationRequest({
      trellisUrl: args.trellisUrl,
      payload,
    })).activationUrl;

    let activationCompleted = false;
    let onlineConnectInfo: ResolvedDeviceConnectInfo | null = null;

    await args.onActivationRequired({
      url: activationUrl,
      waitForOnlineApproval: async (opts?: { signal?: AbortSignal }) => {
        if (activationCompleted) return;
        const activation = await waitForDeviceActivation({
          trellisUrl: args.trellisUrl,
          publicIdentityKey: identity.publicIdentityKey,
          nonce,
          identitySeed: identity.identitySeed,
          contractDigest,
          signal: opts?.signal,
        });
        onlineConnectInfo = activation.connectInfo;
        activationCompleted = true;
      },
      acceptConfirmationCode: async (code: string) => {
        if (activationCompleted) return;
        const ok = await verifyDeviceConfirmationCode({
          activationKey: identity.activationKey,
          publicIdentityKey: identity.publicIdentityKey,
          nonce,
          confirmationCode: code,
        });
        if (!ok) {
          throw new Error("Invalid device confirmation code");
        }
        activationCompleted = true;
      },
    });

    if (!activationCompleted) {
      throw new Error("Device activation did not complete");
    }

    if (onlineConnectInfo) {
      connectInfo = onlineConnectInfo;
    } else {
      const bootstrap = await fetchDeviceBootstrap({
        trellisUrl: args.trellisUrl,
        publicIdentityKey: identity.publicIdentityKey,
        identitySeed: identity.identitySeed,
        contractDigest,
      });
      if (bootstrap.status !== "ready") {
        throw createTransportError({
          code: "trellis.bootstrap.not_ready",
          message: "Trellis is not ready to connect this device.",
          hint: "Wait for the device activation to finish, then try again.",
          context: { status: bootstrap.status },
        });
      }
      connectInfo = bootstrap.connectInfo;
    }
  }

  if (!connectInfo) {
    throw createTransportError({
      code: "trellis.runtime.connect_info_missing",
      message: "Trellis did not return the device connection details.",
      hint: "Retry the connection. If it keeps happening, check the Trellis deployment.",
      context: { contractId: args.contract.CONTRACT_ID },
    });
  }

  const transport = await deps.loadTransport();
  let nc: NatsConnection;
  try {
    nc = await transport.connect({
      servers: selectRuntimeTransportServers(connectInfo.transports),
      inboxPrefix: `_INBOX.${identity.publicIdentityKey.slice(0, 16)}`,
      authenticator: [
        createDeviceNatsAuthTokenAuthenticator({
          publicIdentityKey: identity.publicIdentityKey,
          identitySeed: identity.identitySeed,
          contractDigest,
          now: deps.now,
        }),
        jwtAuthenticator(
          connectInfo.transport.sentinel.jwt,
          new TextEncoder().encode(connectInfo.transport.sentinel.seed),
        ),
      ],
    });
  } catch (cause) {
    throw createTransportError({
      code: "trellis.runtime.connect_failed",
      message: "Trellis could not open the device runtime connection.",
      hint: "Retry the connection. If it keeps failing, check Trellis transport availability.",
      cause,
      context: { contractId: args.contract.CONTRACT_ID },
    });
  }

  startDeviceNatsConnectionLogging({
    contractId: args.contract.CONTRACT_ID,
    nc,
    log,
  });

  const trellis = new Trellis<
    DeviceContractApi<TContract>,
    "client",
    RuntimeStateStoresForContract<TContract>
  >(
    args.contract.CONTRACT_ID,
    nc,
    {
      sessionKey: identity.publicIdentityKey,
      sign: (data: Uint8Array) =>
        signIdentityBytes(identity.identitySeed, data),
    },
    {
      log,
      api: args.contract.API.trellis,
      state: args.contract[CONTRACT_STATE_METADATA],
    },
  );

  const health = new ServiceHealth({
    serviceName: args.contract.CONTRACT?.displayName ??
      args.contract.CONTRACT_ID,
    kind: "device",
    instanceId: connectInfo.instanceId,
    contractId: connectInfo.contractId,
    contractDigest: connectInfo.contractDigest,
    publishIntervalMs: 30_000,
  });
  health.setInfo({
    info: {
      profileId: connectInfo.profileId,
    },
  });
  health.add("nats", () => ({
    status: nc.isClosed() ? "failed" : "ok",
    ...(nc.isClosed() ? { summary: "NATS connection closed" } : {}),
  }));

  const heartbeatEventEnabled = Boolean(
    (args.contract.API.trellis.events as Record<string, unknown> | undefined)
      ?.["Health.Heartbeat"],
  );
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let publishingHeartbeat = false;
  const stopHeartbeat = () => {
    if (heartbeatTimer !== undefined) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };
  const publishHeartbeat = async (): Promise<void> => {
    if (!heartbeatEventEnabled || publishingHeartbeat) {
      return;
    }

    publishingHeartbeat = true;
    try {
      const heartbeat = await health.heartbeat();
      await trellis.publish(
        "Health.Heartbeat" as never,
        heartbeat as never,
      );
    } finally {
      publishingHeartbeat = false;
    }
  };

  if (heartbeatEventEnabled) {
    await publishHeartbeat();
    heartbeatTimer = setInterval(() => {
      void publishHeartbeat();
    }, health.publishIntervalMs);
    void nc.closed().finally(stopHeartbeat);
  }

  const connection = trellis as TrellisDeviceConnection<
    DeviceContractApi<TContract>,
    RuntimeStateStoresForContract<TContract>
  >;
  Object.defineProperty(connection, "health", {
    value: health,
    enumerable: true,
    configurable: true,
    writable: false,
  });
  return connection;
}

export const TrellisDevice = {
  connect<
    TContract extends DeviceContract<TrellisAPI, {
      state?: Readonly<Record<string, unknown>>;
      schemas?: Readonly<Record<string, unknown>>;
    }>,
  >(
    args: TrellisDeviceConnectArgs<DeviceContractApi<TContract>, TContract>,
  ): Promise<
    TrellisDeviceConnection<
      DeviceContractApi<TContract>,
      RuntimeStateStoresForContract<TContract>
    >
  > {
    return connectDeviceWithDeps(args, defaultDeps);
  },
};
