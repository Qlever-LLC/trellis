import { jwtAuthenticator, type NatsConnection } from "@nats-io/nats-core";

import {
  base64urlDecode,
  buildWorkloadActivationPayload,
  buildWorkloadActivationUrl,
  createWorkloadNatsAuthToken,
  deriveWorkloadIdentity,
  getWorkloadConnectInfo,
  verifyWorkloadConfirmationCode,
  waitForWorkloadActivation,
} from "./auth.ts";
import type { ClientOpts } from "./client.ts";
import type { TrellisAPI } from "./contracts.ts";
import type { TrellisAuth, Trellis } from "./trellis.ts";

type WorkloadContract<TApi extends TrellisAPI = TrellisAPI> = {
  CONTRACT_ID: string;
  CONTRACT_DIGEST: string;
  API: {
    trellis: TApi;
  };
  createClient(nats: NatsConnection, auth: TrellisAuth, opts?: ClientOpts): Trellis<TApi>;
};

type WorkloadConnectTransport = {
  connect(options: {
    servers: string | string[];
    token?: string;
    authenticator?: unknown;
    inboxPrefix?: string;
  }): Promise<NatsConnection>;
};

type WorkloadConnectDeps = {
  loadTransport(): Promise<WorkloadConnectTransport>;
  now(): number;
};

export type WorkloadActivationController = {
  url: string;
  waitForOnlineApproval(opts?: { signal?: AbortSignal }): Promise<void>;
  acceptConfirmationCode(code: string): Promise<void>;
};

export type TrellisWorkloadConnectArgs<TApi extends TrellisAPI = TrellisAPI> = {
  authUrl: string;
  contract: WorkloadContract<TApi>;
  rootSecret: Uint8Array | string;
  onActivationRequired?(activation: WorkloadActivationController): Promise<void>;
};

type ResolvedWorkloadConnectInfo = Awaited<ReturnType<typeof getWorkloadConnectInfo>>["connectInfo"];

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
  const { importEd25519PrivateKeyFromSeedBase64url } = await import("../auth/keys.ts");
  const { base64urlEncode, toArrayBuffer } = await import("../auth/utils.ts");
  const privateKey = await importEd25519PrivateKeyFromSeedBase64url(base64urlEncode(identitySeed));
  return new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, toArrayBuffer(data)));
}

async function runtimeImport<TModule>(specifier: string): Promise<TModule> {
  const load = new Function("specifier", "return import(specifier);") as (
    specifier: string,
  ) => Promise<TModule>;
  return await load(specifier);
}

export async function loadDefaultTransport(
  importModule: typeof runtimeImport = runtimeImport,
): Promise<WorkloadConnectTransport> {
  if ("Deno" in globalThis) {
    const mod = await importModule<{ wsconnect: WorkloadConnectTransport["connect"] }>(
      "@nats-io/nats-core",
    );
    return {
      connect: mod.wsconnect,
    };
  }
  const mod = await runtimeImport<{ connect: WorkloadConnectTransport["connect"] }>(
    "@nats-io/transport-node",
  );
  return {
    connect: mod.connect,
  };
}

const defaultDeps: WorkloadConnectDeps = {
  loadTransport: loadDefaultTransport,
  now: () => Date.now(),
};

function activationRequiredError(): Error {
  return new Error("Workload activation required but no activation handler was provided");
}

function isConnectInfoUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("404") || message.includes("unknown_workload");
}

export async function connectWorkloadWithDeps<TApi extends TrellisAPI>(
  args: TrellisWorkloadConnectArgs<TApi>,
  deps: WorkloadConnectDeps,
): Promise<Trellis<TApi>> {
  const rootSecret = normalizeRootSecret(args.rootSecret);
  const identity = await deriveWorkloadIdentity(rootSecret);
  const contractDigest = args.contract.CONTRACT_DIGEST;

  let connectInfo: ResolvedWorkloadConnectInfo | null = null;

  try {
    connectInfo = (await getWorkloadConnectInfo({
      trellisUrl: args.authUrl,
      publicIdentityKey: identity.publicIdentityKey,
      identitySeed: identity.identitySeed,
      contractDigest,
    })).connectInfo;
  } catch (error) {
    if (!isConnectInfoUnavailable(error)) throw error;
  }

  if (!connectInfo) {
    if (!args.onActivationRequired) throw activationRequiredError();

    const nonce = crypto.randomUUID();
    const payload = await buildWorkloadActivationPayload({
      activationKey: identity.activationKey,
      publicIdentityKey: identity.publicIdentityKey,
      nonce,
    });
    const activationUrl = buildWorkloadActivationUrl({
      trellisUrl: args.authUrl,
      payload,
    });

    let activationCompleted = false;
    let onlineConnectInfo: ResolvedWorkloadConnectInfo | null = null;

    await args.onActivationRequired({
      url: activationUrl,
      waitForOnlineApproval: async (opts?: { signal?: AbortSignal }) => {
        if (activationCompleted) return;
        const activation = await waitForWorkloadActivation({
          trellisUrl: args.authUrl,
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
        const ok = await verifyWorkloadConfirmationCode({
          activationKey: identity.activationKey,
          publicIdentityKey: identity.publicIdentityKey,
          nonce,
          confirmationCode: code,
        });
        if (!ok) {
          throw new Error("Invalid workload confirmation code");
        }
        activationCompleted = true;
      },
    });

    if (!activationCompleted) {
      throw new Error("Workload activation did not complete");
    }

    connectInfo = onlineConnectInfo ?? (await getWorkloadConnectInfo({
      trellisUrl: args.authUrl,
      publicIdentityKey: identity.publicIdentityKey,
      identitySeed: identity.identitySeed,
      contractDigest,
    })).connectInfo;
  }

  const transport = await deps.loadTransport();
  const iat = Math.floor(deps.now() / 1_000);
  const authToken = await createWorkloadNatsAuthToken({
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

  return args.contract.createClient(nc, {
    sessionKey: identity.publicIdentityKey,
    sign: (data: Uint8Array) => signIdentityBytes(identity.identitySeed, data),
  });
}

export class TrellisWorkload {
  static connect<TApi extends TrellisAPI>(
    args: TrellisWorkloadConnectArgs<TApi>,
  ): Promise<Trellis<TApi>> {
    return connectWorkloadWithDeps(args, defaultDeps);
  }
}
