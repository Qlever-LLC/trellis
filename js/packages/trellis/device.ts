import { jwtAuthenticator, type NatsConnection } from "@nats-io/nats-core";

import {
  buildDeviceActivationPayload,
  buildDeviceActivationUrl,
  createDeviceNatsAuthToken,
  deriveDeviceIdentity,
  signDeviceWaitRequest,
  verifyDeviceConfirmationCode,
  waitForDeviceActivation,
} from "../auth/device_activation.ts";
import { importEd25519PrivateKeyFromSeedBase64url } from "../auth/keys.ts";
import { base64urlDecode, base64urlEncode, toArrayBuffer } from "../auth/utils.ts";
import type { TrellisAPI } from "./contracts.ts";
import { loadDefaultRuntimeTransport } from "./runtime_transport.ts";
import { Trellis } from "./trellis.ts";
import { Type, type StaticDecode } from "typebox";
import { Value } from "typebox/value";

type DeviceContract<TApi extends TrellisAPI = TrellisAPI> = {
  CONTRACT_ID: string;
  CONTRACT_DIGEST: string;
  API: {
    trellis: TApi;
  };
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

export type DeviceActivationController = {
  url: string;
  waitForOnlineApproval(opts?: { signal?: AbortSignal }): Promise<void>;
  acceptConfirmationCode(code: string): Promise<void>;
};

export type TrellisDeviceConnectArgs<TApi extends TrellisAPI = TrellisAPI> = {
  trellisUrl: string;
  contract: DeviceContract<TApi>;
  rootSecret: Uint8Array | string;
  onActivationRequired?(activation: DeviceActivationController): Promise<void>;
};

const DeviceBootstrapReadySchema = Type.Object({
  status: Type.Literal("ready"),
  connectInfo: Type.Object({
    instanceId: Type.String({ minLength: 1 }),
    profileId: Type.String({ minLength: 1 }),
    contractId: Type.String({ minLength: 1 }),
    contractDigest: Type.String({ minLength: 1 }),
    transport: Type.Object({
      natsServers: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
      sentinel: Type.Object({
        jwt: Type.String({ minLength: 1 }),
        seed: Type.String({ minLength: 1 }),
      }, { additionalProperties: false }),
    }, { additionalProperties: false }),
    auth: Type.Object({
      mode: Type.Literal("device_identity"),
      iatSkewSeconds: Type.Integer({ minimum: 1 }),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

const DeviceBootstrapActivationRequiredSchema = Type.Object({
  status: Type.Literal("activation_required"),
}, { additionalProperties: false });

const DeviceBootstrapNotReadySchema = Type.Object({
  status: Type.Literal("not_ready"),
  reason: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

type DeviceBootstrapReady = StaticDecode<typeof DeviceBootstrapReadySchema>;
type DeviceBootstrapActivationRequired = StaticDecode<typeof DeviceBootstrapActivationRequiredSchema>;
type DeviceBootstrapNotReady = StaticDecode<typeof DeviceBootstrapNotReadySchema>;
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

async function signIdentityBytes(identitySeed: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const privateKey = await importEd25519PrivateKeyFromSeedBase64url(base64urlEncode(identitySeed));
  return new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, toArrayBuffer(data)));
}

const defaultDeps: DeviceConnectDeps = {
  loadTransport: loadDefaultRuntimeTransport,
  now: () => Date.now(),
};

function activationRequiredError(): Error {
  return new Error("Device activation required but no activation handler was provided");
}

function isConnectInfoUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("404") || message.includes("unknown_device") || message.includes("activation_required");
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
    throw new Error(`Device bootstrap failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  if (Value.Check(DeviceBootstrapReadySchema, payload)) return payload;
  if (Value.Check(DeviceBootstrapActivationRequiredSchema, payload)) return payload;
  if (Value.Check(DeviceBootstrapNotReadySchema, payload)) return payload;
  throw new Error("Device bootstrap returned an invalid response");
}

export async function connectDeviceWithDeps<TApi extends TrellisAPI>(
  args: TrellisDeviceConnectArgs<TApi>,
  deps: DeviceConnectDeps,
): Promise<Trellis<TApi>> {
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
      throw new Error(bootstrap.reason);
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
    const activationUrl = buildDeviceActivationUrl({
      trellisUrl: args.trellisUrl,
      payload,
    });

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
        throw new Error(`Device bootstrap is not ready: ${bootstrap.status}`);
      }
      connectInfo = bootstrap.connectInfo;
    }
  }

  if (!connectInfo) {
    throw new Error("Device bootstrap did not return runtime connect info");
  }

  const transport = await deps.loadTransport();
  const iat = Math.floor(deps.now() / 1_000);
  const authToken = await createDeviceNatsAuthToken({
    publicIdentityKey: identity.publicIdentityKey,
    identitySeed: identity.identitySeed,
    contractDigest,
    iat,
  });
  const nc = await transport.connect({
    servers: connectInfo.transport.natsServers,
    token: JSON.stringify(authToken),
    inboxPrefix: `_INBOX.${identity.publicIdentityKey.slice(0, 16)}`,
    authenticator: jwtAuthenticator(
      connectInfo.transport.sentinel.jwt,
      new TextEncoder().encode(connectInfo.transport.sentinel.seed),
    ),
  });

  return new Trellis<TApi>(
    args.contract.CONTRACT_ID,
    nc,
    {
      sessionKey: identity.publicIdentityKey,
      sign: (data: Uint8Array) => signIdentityBytes(identity.identitySeed, data),
    },
    {
      api: args.contract.API.trellis,
    },
  );
}

export const TrellisDevice = {
  connect<TApi extends TrellisAPI>(
    args: TrellisDeviceConnectArgs<TApi>,
  ): Promise<Trellis<TApi>> {
    return connectDeviceWithDeps<TApi>(args, defaultDeps);
  },
};
