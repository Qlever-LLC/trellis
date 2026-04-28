import {
  type Authenticator,
  jwtAuthenticator,
  type NatsConnection,
} from "@nats-io/nats-core";
import {
  AsyncResult,
  type BaseError,
  Result,
  UnexpectedError,
} from "@qlever-llc/result";
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
import {
  correctedIatSeconds,
  estimateMidpointClockOffsetMs,
} from "./auth/time.ts";
import type { TrellisAPI } from "./contracts.ts";
import {
  DEFAULT_RUNTIME_MAX_RECONNECT_ATTEMPTS,
  loadDefaultRuntimeTransport,
  selectRuntimeTransportServers,
} from "./runtime_transport.ts";
import { ServiceHealth } from "./health.ts";
import { type RuntimeStateStoresForContract, Trellis } from "./trellis.ts";
import { logger as noopLogger, type LoggerLike } from "./globals.ts";
import { TransferError, TransportError } from "./errors/index.ts";
import type {
  ReceiveTransferGrant,
  ReceiveTransferHandle,
  SendTransferGrant,
  SendTransferHandle,
} from "./transfer.ts";
import { type StaticDecode, Type } from "typebox";
import { Value } from "typebox/value";
import {
  observeNatsTrellisConnection,
  type TrellisConnection,
} from "./connection.ts";

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

type DeviceRuntime<
  TApi extends TrellisAPI,
  TState extends Record<string, { kind: "value" | "map"; value: unknown }>,
> = Trellis<TApi, "client", TState>;

type RuntimeStateShape = Record<
  string,
  { kind: "value" | "map"; value: unknown }
>;
type BroadStateStore = {
  get(...args: unknown[]): AsyncResult<unknown, BaseError>;
  put(...args: unknown[]): AsyncResult<unknown, BaseError>;
  list(...args: unknown[]): AsyncResult<unknown, BaseError>;
  delete(...args: unknown[]): AsyncResult<unknown, BaseError>;
};
type BroadStateFacade = Record<string, BroadStateStore>;

function deviceConnectResult<T>(
  promise: Promise<T>,
): AsyncResult<T, TransportError | UnexpectedError> {
  return AsyncResult.from(
    promise.then(
      (
        value,
      ): Result<T, TransportError | UnexpectedError> => Result.ok(value),
      (
        cause,
      ): Result<T, TransportError | UnexpectedError> =>
        Result.err(
          cause instanceof TransportError
            ? cause
            : new UnexpectedError({ cause }),
        ),
    ),
  );
}

export type TrellisDeviceConnection<
  TApi extends TrellisAPI = TrellisAPI,
  TState extends Record<string, { kind: "value" | "map"; value: unknown }> = {},
> = {
  readonly request: DeviceRuntime<TApi, TState>["request"];
  readonly publish: DeviceRuntime<TApi, TState>["publish"];
  readonly event: DeviceRuntime<TApi, TState>["event"];
  readonly operation: DeviceRuntime<TApi, TState>["operation"];
  readonly transfer: {
    (grant: SendTransferGrant): SendTransferHandle;
    (grant: ReceiveTransferGrant): ReceiveTransferHandle;
  };
  readonly state: DeviceRuntime<TApi, TState>["state"];
  readonly name: string;
  readonly timeout: number;
  readonly stream: string;
  readonly api: TApi;
  readonly connection: TrellisConnection;
  readonly natsConnection: NatsConnection;
  readonly health: ServiceHealth;
};

type DeviceConnectTransport = {
  connect(options: {
    servers: string | string[];
    token?: string;
    authenticator?: unknown;
    inboxPrefix?: string;
    maxReconnectAttempts?: number;
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

export type TrellisDevicePendingActivationState = {
  status: "pending";
  contractDigest: string;
  publicIdentityKey: string;
  instanceId: string;
  deploymentId: string;
  nonce: string;
  activationUrl: string;
};

export type TrellisDeviceActivatedActivationState = {
  status: "activated";
  contractDigest: string;
  publicIdentityKey: string;
  instanceId: string;
  deploymentId: string;
  nonce: string;
  activationUrl: string;
};

export type TrellisDeviceLocalActivationState =
  | TrellisDevicePendingActivationState
  | TrellisDeviceActivatedActivationState;

export type TrellisDeviceActivationSession<
  TState extends TrellisDeviceLocalActivationState =
    TrellisDeviceLocalActivationState,
> = {
  activationUrl: string;
  localState: TState;
  waitForOnlineApproval(opts?: {
    signal?: AbortSignal;
  }): Promise<TrellisDeviceActivatedActivationState>;
  acceptConfirmationCode(
    code: string,
  ): Promise<TrellisDeviceActivatedActivationState>;
};

export type TrellisDeviceActivationArgs<
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
};

export type TrellisDeviceResumeActivationArgs<
  TApi extends TrellisAPI = TrellisAPI,
  TContract extends DeviceContract<TApi, {
    state?: Readonly<Record<string, unknown>>;
    schemas?: Readonly<Record<string, unknown>>;
  }> = DeviceContract<TApi, {
    state?: Readonly<Record<string, unknown>>;
    schemas?: Readonly<Record<string, unknown>>;
  }>,
> = TrellisDeviceActivationArgs<TApi, TContract> & {
  localState: TrellisDeviceLocalActivationState;
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
};

const DeviceBootstrapReadySchema = Type.Object({
  status: Type.Literal("ready"),
  connectInfo: Type.Object({
    instanceId: Type.String({ minLength: 1 }),
    deploymentId: Type.String({ minLength: 1 }),
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
type DeviceClockOffsetState = {
  serverClockOffsetMs: number;
};

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
  getServerClockOffsetMs: () => number;
}): Authenticator {
  return () => {
    const iat = correctedIatSeconds(
      args.now(),
      args.getServerClockOffsetMs(),
    );
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

function assertBootstrapContractMatches(args: {
  contractId: string;
  contractDigest: string;
  connectInfo: ResolvedDeviceConnectInfo;
}): void {
  if (
    args.connectInfo.contractId !== args.contractId ||
    args.connectInfo.contractDigest !== args.contractDigest
  ) {
    throw createTransportError({
      code: "trellis.bootstrap.contract_mismatch",
      message:
        "Trellis returned connection details for a different device contract.",
      hint:
        "Retry the connection. If it keeps happening, check the requested device contract and Trellis activation state.",
      context: {
        requestedContractId: args.contractId,
        requestedContractDigest: args.contractDigest,
        returnedContractId: args.connectInfo.contractId,
        returnedContractDigest: args.connectInfo.contractDigest,
      },
    });
  }
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

function parseResponseRecord(text: string): Record<string, unknown> | null {
  if (text.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function resolveDeviceLogger(log?: LoggerLike | false): LoggerLike {
  if (log === false) {
    return noopLogger;
  }

  return log ?? noopLogger;
}

async function readResponseReason(response: Response): Promise<string | null> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.reason === "string" && parsed.reason.length > 0) {
      return parsed.reason;
    }
  } catch {
    return text;
  }

  return text;
}

function createActivationRequiredTransportError(
  context?: Record<string, unknown>,
) {
  return createTransportError({
    code: "trellis.bootstrap.activation_required",
    message: "Trellis requires device activation before connecting.",
    hint:
      "Start or resume device activation, then retry the runtime connection after activation completes.",
    context,
  });
}

function createInvalidConfirmationCodeTransportError(
  context?: Record<string, unknown>,
) {
  return createTransportError({
    code: "trellis.device.invalid_confirmation_code",
    message: "The device confirmation code is invalid.",
    hint:
      "Retry with the current confirmation code for this activation, or restart activation if the code is no longer valid.",
    context,
  });
}

function createActivatedLocalState(
  localState: TrellisDeviceLocalActivationState,
): TrellisDeviceActivatedActivationState {
  return {
    ...localState,
    status: "activated",
  };
}

function assertActivationStateMatchesIdentity(args: {
  localState: TrellisDeviceLocalActivationState;
  publicIdentityKey: string;
}): void {
  if (args.localState.publicIdentityKey !== args.publicIdentityKey) {
    throw createTransportError({
      code: "trellis.device.activation_state_mismatch",
      message:
        "Local device activation state does not match the provided root secret.",
      hint:
        "Use the activation state for the same device identity, or start a new activation for this root secret.",
      context: {
        statePublicIdentityKey: args.localState.publicIdentityKey,
        publicIdentityKey: args.publicIdentityKey,
      },
    });
  }
}

function assertActivationStateMatchesContract(args: {
  localState: TrellisDeviceLocalActivationState;
  contractDigest: string;
}): void {
  if (args.localState.contractDigest !== args.contractDigest) {
    throw createTransportError({
      code: "trellis.device.activation_state_contract_mismatch",
      message:
        "Local device activation state does not match the requested device contract.",
      hint:
        "Use activation state for the same device contract, or start activation again for this contract digest.",
      context: {
        stateContractDigest: args.localState.contractDigest,
        contractDigest: args.contractDigest,
      },
    });
  }
}

async function createActivationSession<
  TLocalState extends TrellisDeviceLocalActivationState,
>(args: {
  trellisUrl: string;
  contractDigest: string;
  identity: Awaited<ReturnType<typeof deriveDeviceIdentity>>;
  localState: TLocalState;
}): Promise<TrellisDeviceActivationSession<TLocalState>> {
  assertActivationStateMatchesIdentity({
    localState: args.localState,
    publicIdentityKey: args.identity.publicIdentityKey,
  });
  assertActivationStateMatchesContract({
    localState: args.localState,
    contractDigest: args.contractDigest,
  });

  const activatedState = createActivatedLocalState(args.localState);
  return {
    activationUrl: args.localState.activationUrl,
    localState: args.localState,
    waitForOnlineApproval: async (opts?: { signal?: AbortSignal }) => {
      if (args.localState.status === "activated") {
        return activatedState;
      }

      await waitForDeviceActivation({
        trellisUrl: args.trellisUrl,
        publicIdentityKey: args.identity.publicIdentityKey,
        nonce: args.localState.nonce,
        identitySeed: args.identity.identitySeed,
        contractDigest: args.contractDigest,
        signal: opts?.signal,
      });
      return activatedState;
    },
    acceptConfirmationCode: async (code: string) => {
      if (args.localState.status === "activated") {
        return activatedState;
      }

      const ok = await verifyDeviceConfirmationCode({
        activationKey: args.identity.activationKey,
        publicIdentityKey: args.identity.publicIdentityKey,
        nonce: args.localState.nonce,
        confirmationCode: code,
      });
      if (!ok) {
        throw createInvalidConfirmationCodeTransportError({
          publicIdentityKey: args.identity.publicIdentityKey,
          instanceId: args.localState.instanceId,
          deploymentId: args.localState.deploymentId,
        });
      }
      return activatedState;
    },
  };
}

async function fetchDeviceBootstrap(args: {
  trellisUrl: string;
  publicIdentityKey: string;
  identitySeed: Uint8Array | string;
  contractDigest: string;
  now: () => number;
  offsetState: DeviceClockOffsetState;
}): Promise<DeviceBootstrapResponse> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const requestStartedAtMs = args.now();
    const request = await signDeviceWaitRequest({
      publicIdentityKey: args.publicIdentityKey,
      nonce: "connect-info",
      identitySeed: args.identitySeed,
      contractDigest: args.contractDigest,
      iat: correctedIatSeconds(
        requestStartedAtMs,
        args.offsetState.serverClockOffsetMs,
      ),
    });
    const bootstrapRequest = {
      publicIdentityKey: request.publicIdentityKey,
      contractDigest: request.contractDigest,
      iat: request.iat,
      sig: request.sig,
    };
    const response = await fetch(
      new URL("/auth/devices/connect-info", args.trellisUrl),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bootstrapRequest),
      },
    );
    const responseReceivedAtMs = args.now();
    if (!response.ok) {
      const responseText = await response.text();
      const parsed = parseResponseRecord(responseText);
      const reason = typeof parsed?.reason === "string"
        ? parsed.reason
        : responseText;
      const serverNow = typeof parsed?.serverNow === "number"
        ? parsed.serverNow
        : null;
      if (
        attempt === 0 &&
        response.status === 400 &&
        reason === "iat_out_of_range" &&
        serverNow !== null
      ) {
        args.offsetState.serverClockOffsetMs = estimateMidpointClockOffsetMs({
          requestStartedAtMs,
          responseReceivedAtMs,
          serverNowSeconds: serverNow,
        });
        continue;
      }
      if (
        response.status === 404 &&
        (reason === "unknown_device" || reason === "activation_required")
      ) {
        return { status: "activation_required" };
      }

      throw createTransportError({
        code: "trellis.bootstrap.failed",
        message: "Trellis could not prepare the device session.",
        hint:
          "Retry the connection. If it keeps failing, check Trellis availability and device activation state.",
        context: {
          trellisUrl: args.trellisUrl,
          status: response.status,
          reason,
        },
      });
    }

    const payload = await readJsonResponse(response, {
      code: "trellis.bootstrap.invalid_response",
      message: "Trellis returned an invalid bootstrap response.",
      hint:
        "Retry the connection. If it keeps happening, check the Trellis deployment.",
      context: { trellisUrl: args.trellisUrl },
    });
    if (
      payload && typeof payload === "object" &&
      typeof (payload as { serverNow?: unknown }).serverNow === "number"
    ) {
      args.offsetState.serverClockOffsetMs = estimateMidpointClockOffsetMs({
        requestStartedAtMs,
        responseReceivedAtMs,
        serverNowSeconds: (payload as { serverNow: number }).serverNow,
      });
    }
    if (Value.Check(DeviceBootstrapReadySchema, payload)) return payload;
    if (Value.Check(DeviceBootstrapActivationRequiredSchema, payload)) {
      return payload;
    }
    if (Value.Check(DeviceBootstrapNotReadySchema, payload)) return payload;
    throw createTransportError({
      code: "trellis.bootstrap.invalid_response",
      message: "Trellis returned an invalid bootstrap response.",
      hint:
        "Retry the connection. If it keeps happening, check the Trellis deployment.",
      context: { trellisUrl: args.trellisUrl },
    });
  }

  throw createTransportError({
    code: "trellis.bootstrap.time_sync_failed",
    message: "Trellis could not confirm the device time window.",
    hint:
      "Retry the connection. If it keeps happening, check the device and Trellis clocks.",
    context: { trellisUrl: args.trellisUrl },
  });
}

export async function startDeviceActivationWithDeps<
  TContract extends DeviceContract<TrellisAPI, {
    state?: Readonly<Record<string, unknown>>;
    schemas?: Readonly<Record<string, unknown>>;
  }>,
>(
  args: TrellisDeviceActivationArgs<DeviceContractApi<TContract>, TContract>,
  _deps: Pick<DeviceConnectDeps, "now">,
): Promise<
  TrellisDeviceActivationSession<TrellisDevicePendingActivationState>
> {
  const rootSecret = normalizeRootSecret(args.rootSecret);
  const identity = await deriveDeviceIdentity(rootSecret);
  const nonce = crypto.randomUUID();
  const payload = await buildDeviceActivationPayload({
    activationKey: identity.activationKey,
    publicIdentityKey: identity.publicIdentityKey,
    nonce,
  });
  const activation = await startDeviceActivationRequest({
    trellisUrl: args.trellisUrl,
    payload,
  });

  return await createActivationSession({
    trellisUrl: args.trellisUrl,
    contractDigest: args.contract.CONTRACT_DIGEST,
    identity,
    localState: {
      status: "pending",
      contractDigest: args.contract.CONTRACT_DIGEST,
      publicIdentityKey: identity.publicIdentityKey,
      instanceId: activation.instanceId,
      deploymentId: activation.deploymentId,
      nonce,
      activationUrl: activation.activationUrl,
    },
  });
}

export async function resumeDeviceActivationWithDeps<
  TLocalState extends TrellisDeviceLocalActivationState,
  TContract extends DeviceContract<TrellisAPI, {
    state?: Readonly<Record<string, unknown>>;
    schemas?: Readonly<Record<string, unknown>>;
  }>,
>(
  args:
    & TrellisDeviceResumeActivationArgs<DeviceContractApi<TContract>, TContract>
    & {
      localState: TLocalState;
    },
  _deps: Pick<DeviceConnectDeps, "now">,
): Promise<TrellisDeviceActivationSession<TLocalState>> {
  const rootSecret = normalizeRootSecret(args.rootSecret);
  const identity = await deriveDeviceIdentity(rootSecret);

  return await createActivationSession({
    trellisUrl: args.trellisUrl,
    contractDigest: args.contract.CONTRACT_DIGEST,
    identity,
    localState: args.localState,
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
  const offsetState: DeviceClockOffsetState = { serverClockOffsetMs: 0 };
  const bootstrap = await fetchDeviceBootstrap({
    trellisUrl: args.trellisUrl,
    publicIdentityKey: identity.publicIdentityKey,
    identitySeed: identity.identitySeed,
    contractDigest,
    now: deps.now,
    offsetState,
  });

  if (bootstrap.status === "activation_required") {
    throw createActivationRequiredTransportError({
      publicIdentityKey: identity.publicIdentityKey,
      contractId: args.contract.CONTRACT_ID,
    });
  }

  if (bootstrap.status === "not_ready") {
    throw createTransportError({
      code: "trellis.bootstrap.not_ready",
      message: "Trellis is not ready to connect this device.",
      hint:
        "Wait for the device to be activated and the requested deployment to become available, then try again.",
      context: { reason: bootstrap.reason },
    });
  }

  const connectInfo = bootstrap.connectInfo;
  assertBootstrapContractMatches({
    contractId: args.contract.CONTRACT_ID,
    contractDigest,
    connectInfo,
  });

  const transport = await deps.loadTransport();
  let nc: NatsConnection;
  try {
    nc = await transport.connect({
      servers: selectRuntimeTransportServers(connectInfo.transports),
      maxReconnectAttempts: DEFAULT_RUNTIME_MAX_RECONNECT_ATTEMPTS,
      inboxPrefix: `_INBOX.${identity.publicIdentityKey.slice(0, 16)}`,
      authenticator: [
        createDeviceNatsAuthTokenAuthenticator({
          publicIdentityKey: identity.publicIdentityKey,
          identitySeed: identity.identitySeed,
          contractDigest,
          now: deps.now,
          getServerClockOffsetMs: () => offsetState.serverClockOffsetMs,
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
      hint:
        "Retry the connection. If it keeps failing, check Trellis transport availability.",
      cause,
      context: { contractId: args.contract.CONTRACT_ID },
    });
  }

  const connection = observeNatsTrellisConnection({
    kind: "device",
    nc,
    log: false,
    lifecycleLog: {
      log,
      context: { contractId: args.contract.CONTRACT_ID },
    },
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
      connection,
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
      deploymentId: connectInfo.deploymentId,
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

  return {
    request: trellis.request.bind(trellis),
    publish: trellis.publish.bind(trellis),
    event: trellis.event.bind(trellis),
    operation: trellis.operation.bind(trellis),
    transfer: trellis.transfer.bind(trellis),
    state: trellis.state,
    name: trellis.name,
    timeout: trellis.timeout,
    stream: trellis.stream,
    api: trellis.api,
    connection: trellis.connection,
    natsConnection: trellis.natsConnection,
    health,
  };
}

export const TrellisDevice = {
  connect<
    TContract extends DeviceContract<TrellisAPI, {
      state?: Readonly<Record<string, unknown>>;
      schemas?: Readonly<Record<string, unknown>>;
    }>,
  >(
    args: TrellisDeviceConnectArgs<DeviceContractApi<TContract>, TContract>,
  ) {
    return deviceConnectResult(connectDeviceWithDeps(args, defaultDeps));
  },
};
