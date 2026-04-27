import { dirname, join } from "@std/path";
import type { StaticDecode } from "typebox";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { deriveDeviceIdentity } from "../auth.ts";
import type {
  TrellisDeviceActivatedActivationState,
  TrellisDeviceActivationArgs,
  TrellisDeviceLocalActivationState,
  TrellisDevicePendingActivationState,
} from "../device.ts";
import {
  resumeDeviceActivationWithDeps,
  startDeviceActivationWithDeps,
} from "../device.ts";
import { base64urlDecode, base64urlEncode } from "../auth/utils.ts";
import type { TrellisAPI } from "../contracts.ts";
import { signDeviceWaitRequest } from "../auth/device_activation.ts";

const PendingActivationStateSchema = Type.Object({
  status: Type.Literal("pending"),
  contractDigest: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  instanceId: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  nonce: Type.String({ minLength: 1 }),
  activationUrl: Type.String({ minLength: 1 }),
});

const ActivatedActivationStateSchema = Type.Object({
  status: Type.Literal("activated"),
  contractDigest: Type.String({ minLength: 1 }),
  publicIdentityKey: Type.String({ minLength: 1 }),
  instanceId: Type.String({ minLength: 1 }),
  deploymentId: Type.String({ minLength: 1 }),
  nonce: Type.String({ minLength: 1 }),
  activationUrl: Type.String({ minLength: 1 }),
});

const LocalActivationStateSchema = Type.Union([
  PendingActivationStateSchema,
  ActivatedActivationStateSchema,
]);

const PersistedActivationStateSchema = Type.Object({
  version: Type.Literal(1),
  localState: LocalActivationStateSchema,
});

type PersistedActivationState = StaticDecode<
  typeof PersistedActivationStateSchema
>;

const ClientTransportEndpointsSchema = Type.Object({
  natsServers: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
});

const ClientTransportsSchema = Type.Object({
  native: Type.Optional(ClientTransportEndpointsSchema),
  websocket: Type.Optional(ClientTransportEndpointsSchema),
});

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

const WaitForDeviceActivationPendingSchema = Type.Object({
  status: Type.Literal("pending"),
});

const WaitForDeviceActivationActivatedSchema = Type.Object({
  status: Type.Literal("activated"),
  activatedAt: Type.String({ minLength: 1 }),
  confirmationCode: Type.Optional(Type.String({ minLength: 1 })),
  connectInfo: DeviceBootstrapReadySchema.properties.connectInfo,
});

const WaitForDeviceActivationRejectedSchema = Type.Object({
  status: Type.Literal("rejected"),
  reason: Type.Optional(Type.String({ minLength: 1 })),
});

type DeviceBootstrapResponse =
  | {
    status: "ready";
    connectInfo: StaticDecode<typeof DeviceBootstrapReadySchema>["connectInfo"];
  }
  | { status: "activation_required" }
  | { status: "not_ready"; reason: string };

type DeviceActivationWaitStatus =
  | { status: "pending"; retryAfterMs?: number }
  | {
    status: "activated";
    connectInfo: StaticDecode<typeof DeviceBootstrapReadySchema>["connectInfo"];
  }
  | { status: "not_ready"; reason: string }
  | { status: "rejected"; reason?: string };

type PendingActivationResolution =
  | { status: "pending" }
  | { status: "activated" }
  | { status: "not_ready"; reason: string }
  | { status: "stale" };

const DEFAULT_WAIT_POLL_INTERVAL_MS = 3_000;

type DeviceActivationStateStoreOptions = {
  trellisUrl: string;
  rootSecret: Uint8Array | string;
  contractDigest: string;
  stateDir?: string;
  statePath?: string;
};

type DeviceActivationStateStore = {
  readonly statePath: string;
  load(): Promise<TrellisDeviceLocalActivationState | null>;
  save(state: TrellisDeviceLocalActivationState): Promise<void>;
};

/**
 * Options for the Deno-only device activation status helper.
 */
export type CheckDeviceActivationArgs<
  TApi extends TrellisAPI = TrellisAPI,
  TContract extends {
    CONTRACT_ID: string;
    CONTRACT_DIGEST: string;
    CONTRACT: { displayName?: string };
    API: { trellis: TApi };
  } = {
    CONTRACT_ID: string;
    CONTRACT_DIGEST: string;
    CONTRACT: { displayName?: string };
    API: { trellis: TApi };
  },
> = TrellisDeviceActivationArgs<TApi, TContract> & {
  stateDir?: string;
  statePath?: string;
};

/**
 * Activation status for a device that is already ready to connect.
 */
export type TrellisDeviceActivatedStatus = {
  status: "activated";
};

/**
 * Activation status for a device that cannot proceed yet.
 */
export type TrellisDeviceNotReadyStatus = {
  status: "not_ready";
  reason: string;
};

/**
 * Activation status for a device that still needs activation.
 */
export type TrellisDeviceActivationRequiredStatus = {
  status: "activation_required";
  activationUrl: string;
  waitForOnlineApproval(
    opts?: { signal?: AbortSignal },
  ): Promise<TrellisDeviceActivatedStatus>;
  acceptConfirmationCode(code: string): Promise<TrellisDeviceActivatedStatus>;
};

/**
 * Caller-facing activation status union for Deno device runtimes.
 */
export type TrellisDeviceActivationStatus =
  | TrellisDeviceActivatedStatus
  | TrellisDeviceNotReadyStatus
  | TrellisDeviceActivationRequiredStatus;

function normalizeRootSecret(rootSecret: Uint8Array | string): Uint8Array {
  if (typeof rootSecret === "string") {
    const decoded = base64urlDecode(rootSecret.trim());
    if (decoded.length === 0) {
      throw new Error("rootSecret must not be empty");
    }
    return decoded;
  }

  if (rootSecret.length === 0) {
    throw new Error("rootSecret must not be empty");
  }

  return rootSecret;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound;
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Deno.errors.AlreadyExists;
}

function tempStatePath(statePath: string): string {
  return `${statePath}.tmp-${crypto.randomUUID()}`;
}

function backupStatePath(statePath: string): string {
  return `${statePath}.bak`;
}

function defaultActivationStateDir(): string {
  if (Deno.build.os === "windows") {
    const base = Deno.env.get("LOCALAPPDATA") ?? Deno.env.get("APPDATA");
    if (!base) {
      throw new Error(
        "Could not resolve a default Trellis device state directory: LOCALAPPDATA or APPDATA is not set.",
      );
    }
    return join(base, "Trellis", "device-activation");
  }

  const home = Deno.env.get("HOME");
  if (!home) {
    throw new Error(
      "Could not resolve a default Trellis device state directory: HOME is not set.",
    );
  }

  if (Deno.build.os === "darwin") {
    return join(
      home,
      "Library",
      "Application Support",
      "Trellis",
      "device-activation",
    );
  }

  return join(
    Deno.env.get("XDG_STATE_HOME") ?? join(home, ".local", "state"),
    "trellis",
    "device-activation",
  );
}

async function hashOrigin(origin: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(origin),
  );
  return base64urlEncode(new Uint8Array(digest));
}

async function deriveStoreIdentity(
  args: DeviceActivationStateStoreOptions,
): Promise<{ publicIdentityKey: string }> {
  const identity = await deriveDeviceIdentity(
    normalizeRootSecret(args.rootSecret),
  );
  return {
    publicIdentityKey: identity.publicIdentityKey,
  };
}

function parsePersistedState(text: string): TrellisDeviceLocalActivationState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(
      "Stored Trellis device activation state is not valid JSON.",
      {
        cause,
      },
    );
  }

  if (!Value.Check(PersistedActivationStateSchema, parsed)) {
    throw new Error(
      "Stored Trellis device activation state has an invalid shape.",
    );
  }

  const persisted = Value.Parse(
    PersistedActivationStateSchema,
    parsed,
  ) as PersistedActivationState;
  return persisted.localState;
}

function assertLocalStateMatchesIdentity(args: {
  state: TrellisDeviceLocalActivationState;
  publicIdentityKey: string;
}): void {
  if (args.state.publicIdentityKey !== args.publicIdentityKey) {
    throw new Error(
      "Stored Trellis device activation state does not match the provided root secret.",
    );
  }
}

function assertLocalStateMatchesContract(args: {
  state: TrellisDeviceLocalActivationState;
  contractDigest: string;
}): void {
  if (args.state.contractDigest !== args.contractDigest) {
    throw new Error(
      "Stored Trellis device activation state does not match the requested contract digest.",
    );
  }
}

async function resolveDeviceActivationStatePath(
  args: DeviceActivationStateStoreOptions,
): Promise<string> {
  if (args.statePath) {
    return args.statePath;
  }

  const { publicIdentityKey } = await deriveStoreIdentity(args);
  const origin = new URL(args.trellisUrl).origin;
  const originHash = await hashOrigin(origin);
  const fileName =
    `activation-state-v1-${originHash}-${args.contractDigest}-${publicIdentityKey}.json`;

  return join(args.stateDir ?? defaultActivationStateDir(), fileName);
}

async function openDeviceActivationStateStore(
  args: DeviceActivationStateStoreOptions,
): Promise<DeviceActivationStateStore> {
  const { publicIdentityKey } = await deriveStoreIdentity(args);
  const statePath = await resolveDeviceActivationStatePath(args);
  const stateBackupPath = backupStatePath(statePath);

  return {
    statePath,
    async load(): Promise<TrellisDeviceLocalActivationState | null> {
      for (const path of [statePath, stateBackupPath]) {
        try {
          const text = await Deno.readTextFile(path);
          const state = parsePersistedState(text);
          assertLocalStateMatchesIdentity({ state, publicIdentityKey });
          assertLocalStateMatchesContract({
            state,
            contractDigest: args.contractDigest,
          });
          return state;
        } catch (error) {
          if (isNotFoundError(error)) {
            continue;
          }
          throw error;
        }
      }
      return null;
    },
    async save(state: TrellisDeviceLocalActivationState): Promise<void> {
      if (!Value.Check(LocalActivationStateSchema, state)) {
        throw new Error(
          "Trellis device activation state has an invalid shape.",
        );
      }

      assertLocalStateMatchesIdentity({ state, publicIdentityKey });
      assertLocalStateMatchesContract({
        state,
        contractDigest: args.contractDigest,
      });
      await Deno.mkdir(dirname(statePath), { recursive: true });
      const nextText =
        JSON.stringify({ version: 1, localState: state }, null, 2) +
        "\n";
      const nextPath = tempStatePath(statePath);
      try {
        await Deno.writeTextFile(nextPath, nextText);
        try {
          await Deno.rename(nextPath, statePath);
        } catch (error) {
          if (!isAlreadyExistsError(error)) {
            throw error;
          }
          try {
            await Deno.remove(stateBackupPath);
          } catch (backupError) {
            if (!isNotFoundError(backupError)) {
              throw backupError;
            }
          }
          await Deno.rename(statePath, stateBackupPath);
          try {
            await Deno.rename(nextPath, statePath);
            await Deno.remove(stateBackupPath);
          } catch (renameError) {
            try {
              await Deno.rename(stateBackupPath, statePath);
            } catch (rollbackError) {
              if (!isNotFoundError(rollbackError)) {
                throw rollbackError;
              }
            }
            throw renameError;
          }
        }
      } catch (error) {
        try {
          await Deno.remove(nextPath);
        } catch (cleanupError) {
          if (!isNotFoundError(cleanupError)) {
            throw cleanupError;
          }
        }
        throw error;
      }
    },
  };
}

function readResponseReason(text: string): string | null {
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

async function fetchDeviceBootstrap(args: {
  trellisUrl: string;
  publicIdentityKey: string;
  identitySeed: Uint8Array | string;
  contractDigest: string;
  iat?: number;
}): Promise<DeviceBootstrapResponse> {
  let iat = args.iat;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const request = await signDeviceWaitRequest({
      publicIdentityKey: args.publicIdentityKey,
      nonce: "connect-info",
      identitySeed: args.identitySeed,
      contractDigest: args.contractDigest,
      iat,
    });
    const bootstrapRequest = {
      publicIdentityKey: request.publicIdentityKey,
      contractDigest: request.contractDigest,
      iat: request.iat,
      sig: request.sig,
    };
    const response = await fetch(
      new URL("/bootstrap/device", args.trellisUrl),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bootstrapRequest),
      },
    );
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
        iat = serverNow;
        continue;
      }
      if (
        response.status === 404 &&
        (reason === "unknown_device" || reason === "activation_required")
      ) {
        return { status: "activation_required" };
      }

      throw new Error(
        `Device bootstrap failed: ${response.status}${
          reason ? ` ${reason}` : ""
        }`,
      );
    }

    const payload = await response.json();
    if (Value.Check(DeviceBootstrapReadySchema, payload)) {
      return payload;
    }
    if (Value.Check(DeviceBootstrapActivationRequiredSchema, payload)) {
      return payload;
    }
    if (Value.Check(DeviceBootstrapNotReadySchema, payload)) {
      return payload;
    }
    throw new Error("Device bootstrap returned an invalid response");
  }

  throw new Error("Device bootstrap time synchronization failed");
}

async function fetchDeviceActivationWaitStatus(args: {
  trellisUrl: string;
  publicIdentityKey: string;
  identitySeed: Uint8Array | string;
  contractDigest: string;
  nonce: string;
  signal?: AbortSignal;
  iat?: number;
}): Promise<DeviceActivationWaitStatus> {
  let iat = args.iat;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const request = await signDeviceWaitRequest({
      publicIdentityKey: args.publicIdentityKey,
      nonce: args.nonce,
      identitySeed: args.identitySeed,
      contractDigest: args.contractDigest,
      iat,
    });
    const response = await fetch(
      new URL("/auth/devices/activate/wait", args.trellisUrl),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: args.signal,
      },
    );
    if (!response.ok) {
      if (response.status === 429) {
        return { status: "pending", ...retryAfterStatus(response) };
      }
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
        iat = serverNow;
        continue;
      }
      if (response.status === 403 && reason === "contract_digest_not_allowed") {
        return { status: "not_ready", reason };
      }
      throw new Error(
        `Device activation status failed: ${response.status}${
          reason ? ` ${reason}` : ""
        }`,
      );
    }

    const payload = await response.json();
    if (Value.Check(WaitForDeviceActivationPendingSchema, payload)) {
      return payload;
    }
    if (Value.Check(WaitForDeviceActivationActivatedSchema, payload)) {
      return payload;
    }
    if (Value.Check(WaitForDeviceActivationRejectedSchema, payload)) {
      return payload;
    }

    throw new Error("Device activation status returned an invalid response");
  }

  throw new Error("Device activation status time synchronization failed");
}

function retryAfterStatus(response: Response): { retryAfterMs?: number } {
  const value = response.headers.get("Retry-After");
  if (!value) return {};

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return { retryAfterMs: seconds * 1_000 };
  }

  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return {};
  return { retryAfterMs: Math.max(0, dateMs - Date.now()) };
}

function activatedStatus(): TrellisDeviceActivatedStatus {
  return { status: "activated" };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function createActivatedLocalState(
  localState:
    | TrellisDevicePendingActivationState
    | TrellisDeviceActivatedActivationState,
): TrellisDeviceActivatedActivationState {
  return {
    ...localState,
    status: "activated",
  };
}

function assertActivationConnectInfoMatchesContract(args: {
  contractId: string;
  contractDigest: string;
  connectInfo: StaticDecode<typeof DeviceBootstrapReadySchema>["connectInfo"];
}): void {
  if (
    args.connectInfo.contractId !== args.contractId ||
    args.connectInfo.contractDigest !== args.contractDigest
  ) {
    throw new Error(
      "Trellis activation status returned connection details for a different contract.",
    );
  }
}

async function waitForActivationCompletion(args: {
  trellisUrl: string;
  rootSecret: Uint8Array | string;
  contractId: string;
  contractDigest: string;
  localState: TrellisDevicePendingActivationState;
  signal?: AbortSignal;
}): Promise<TrellisDeviceActivatedActivationState> {
  const identity = await deriveDeviceIdentity(
    normalizeRootSecret(args.rootSecret),
  );

  while (true) {
    const waitStatus = await fetchDeviceActivationWaitStatus({
      trellisUrl: args.trellisUrl,
      publicIdentityKey: identity.publicIdentityKey,
      identitySeed: identity.identitySeed,
      contractDigest: args.contractDigest,
      nonce: args.localState.nonce,
      signal: args.signal,
    });

    if (waitStatus.status === "activated") {
      assertActivationConnectInfoMatchesContract({
        contractId: args.contractId,
        contractDigest: args.contractDigest,
        connectInfo: waitStatus.connectInfo,
      });
      return createActivatedLocalState(args.localState);
    }
    if (waitStatus.status === "rejected") {
      throw new Error(
        `device activation rejected: ${waitStatus.reason ?? "unknown_reason"}`,
      );
    }
    if (waitStatus.status === "not_ready") {
      throw new Error(`device activation not ready: ${waitStatus.reason}`);
    }

    await sleep(
      Math.max(DEFAULT_WAIT_POLL_INTERVAL_MS, waitStatus.retryAfterMs ?? 0),
      args.signal,
    );
  }
}

async function createActivationRequiredStatus<
  TApi extends TrellisAPI,
  TContract extends {
    CONTRACT_ID: string;
    CONTRACT_DIGEST: string;
    CONTRACT: { displayName?: string };
    API: { trellis: TApi };
  },
>(args: {
  checkArgs: CheckDeviceActivationArgs<TApi, TContract>;
  store: DeviceActivationStateStore;
  localState: TrellisDeviceLocalActivationState | null;
}): Promise<TrellisDeviceActivationRequiredStatus> {
  const session = args.localState?.status === "pending"
    ? await resumeDeviceActivationWithDeps({
      trellisUrl: args.checkArgs.trellisUrl,
      contract: args.checkArgs.contract,
      rootSecret: args.checkArgs.rootSecret,
      localState: args.localState,
    }, { now: () => Date.now() })
    : await startDeviceActivationWithDeps({
      trellisUrl: args.checkArgs.trellisUrl,
      contract: args.checkArgs.contract,
      rootSecret: args.checkArgs.rootSecret,
    }, { now: () => Date.now() });

  if (args.localState?.status !== "pending") {
    await args.store.save(session.localState);
  }

  let completedState: TrellisDeviceActivatedActivationState | null = null;
  let completionPromise: Promise<TrellisDeviceActivatedStatus> | null = null;
  const finish = async (
    nextState: () => Promise<TrellisDeviceActivatedActivationState>,
  ): Promise<TrellisDeviceActivatedStatus> => {
    if (completedState) {
      return activatedStatus();
    }

    if (completionPromise) {
      return await completionPromise;
    }

    completionPromise = (async () => {
      const nextCompletedState = await nextState();
      await args.store.save(nextCompletedState);
      completedState = nextCompletedState;
      return activatedStatus();
    })();
    try {
      return await completionPromise;
    } catch (error) {
      completionPromise = null;
      throw error;
    }
  };

  return {
    status: "activation_required",
    activationUrl: session.activationUrl,
    waitForOnlineApproval(opts?: { signal?: AbortSignal }) {
      return finish(() =>
        waitForActivationCompletion({
          trellisUrl: args.checkArgs.trellisUrl,
          rootSecret: args.checkArgs.rootSecret,
          contractId: args.checkArgs.contract.CONTRACT_ID,
          contractDigest: args.checkArgs.contract.CONTRACT_DIGEST,
          localState: session.localState,
          signal: opts?.signal,
        })
      );
    },
    acceptConfirmationCode(code: string) {
      return finish(() => session.acceptConfirmationCode(code));
    },
  };
}

async function resolvePendingActivation(args: {
  trellisUrl: string;
  publicIdentityKey: string;
  identitySeed: Uint8Array;
  contractId: string;
  contractDigest: string;
  localState: TrellisDevicePendingActivationState;
  store: DeviceActivationStateStore;
}): Promise<PendingActivationResolution> {
  const waitStatus = await fetchDeviceActivationWaitStatus({
    trellisUrl: args.trellisUrl,
    publicIdentityKey: args.publicIdentityKey,
    identitySeed: args.identitySeed,
    contractDigest: args.contractDigest,
    nonce: args.localState.nonce,
  });

  if (waitStatus.status === "activated") {
    assertActivationConnectInfoMatchesContract({
      contractId: args.contractId,
      contractDigest: args.contractDigest,
      connectInfo: waitStatus.connectInfo,
    });
    await args.store.save(createActivatedLocalState(args.localState));
    return { status: "activated" };
  }

  if (waitStatus.status === "rejected") {
    return { status: "stale" };
  }

  if (waitStatus.status === "not_ready") {
    return waitStatus;
  }

  return { status: "pending" };
}

/**
 * Reports Deno device activation status and hides local activation persistence details.
 */
export async function checkDeviceActivation<
  TApi extends TrellisAPI,
  TContract extends {
    CONTRACT_ID: string;
    CONTRACT_DIGEST: string;
    CONTRACT: { displayName?: string };
    API: { trellis: TApi };
  },
>(
  args: CheckDeviceActivationArgs<TApi, TContract>,
): Promise<TrellisDeviceActivationStatus> {
  const store = await openDeviceActivationStateStore({
    trellisUrl: args.trellisUrl,
    rootSecret: args.rootSecret,
    contractDigest: args.contract.CONTRACT_DIGEST,
    stateDir: args.stateDir,
    statePath: args.statePath,
  });
  let localState = await store.load();
  const identity = await deriveDeviceIdentity(
    normalizeRootSecret(args.rootSecret),
  );
  const bootstrap = await fetchDeviceBootstrap({
    trellisUrl: args.trellisUrl,
    publicIdentityKey: identity.publicIdentityKey,
    identitySeed: identity.identitySeed,
    contractDigest: args.contract.CONTRACT_DIGEST,
  });

  if (bootstrap.status === "ready") {
    assertActivationConnectInfoMatchesContract({
      contractId: args.contract.CONTRACT_ID,
      contractDigest: args.contract.CONTRACT_DIGEST,
      connectInfo: bootstrap.connectInfo,
    });
    if (localState?.status === "pending") {
      await store.save(createActivatedLocalState(localState));
    }
    return activatedStatus();
  }

  if (bootstrap.status === "not_ready") {
    return bootstrap;
  }

  if (localState?.status === "pending") {
    const pendingStatus = await resolvePendingActivation({
      trellisUrl: args.trellisUrl,
      publicIdentityKey: identity.publicIdentityKey,
      identitySeed: identity.identitySeed,
      contractId: args.contract.CONTRACT_ID,
      contractDigest: args.contract.CONTRACT_DIGEST,
      localState,
      store,
    });

    if (pendingStatus.status === "activated") {
      return activatedStatus();
    }

    if (pendingStatus.status === "not_ready") {
      return pendingStatus;
    }

    if (pendingStatus.status === "stale") {
      localState = null;
    }
  }

  return await createActivationRequiredStatus({
    checkArgs: args,
    store,
    localState,
  });
}
