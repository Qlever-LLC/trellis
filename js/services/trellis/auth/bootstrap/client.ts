import type { Context } from "@hono/hono";
import { AsyncResult, type BaseError, isErr, type Result } from "@qlever-llc/result";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { Type, type StaticDecode } from "typebox";
import { Value } from "typebox/value";

import type { ContractStore } from "../../catalog/store.ts";
import type { ContractResourceBindings } from "../../../../packages/contracts/protocol.ts";
import { resolveSessionPrincipal } from "../session/principal.ts";
import type {
  BindingTokenRecord,
  SentinelCreds,
  Session,
  SessionKey,
  UserSession,
} from "../../state/schemas.ts";
import {
  SessionKeySchema,
  SignatureSchema,
} from "../../state/schemas/auth_state.ts";

export const DEFAULT_CLIENT_BOOTSTRAP_IAT_SKEW_SECONDS = 30;

export function isClientBootstrapProofIatFresh(
  iat: number,
  nowSeconds: number = Math.floor(Date.now() / 1_000),
  skewSeconds: number = DEFAULT_CLIENT_BOOTSTRAP_IAT_SKEW_SECONDS,
): boolean {
  return Math.abs(nowSeconds - iat) <= skewSeconds;
}

export const ClientBootstrapRequestSchema = Type.Object({
  sessionKey: SessionKeySchema,
  iat: Type.Number(),
  sig: SignatureSchema,
}, { additionalProperties: false });

type ClientBootstrapRequest = StaticDecode<typeof ClientBootstrapRequestSchema>;

type ClientBootstrapContractView = {
  id: string;
  digest: string;
  displayName: string;
  description: string;
  resources?: TrellisContractV1["resources"];
};

type ClientBootstrapUserView = {
  trellisId: string;
  origin: string;
  id: string;
  email: string;
  name: string;
  image?: string;
};

type ClientBootstrapBindingView = {
  contractId: string;
  digest: string;
  capabilities: string[];
  publishSubjects: string[];
  subscribeSubjects: string[];
  resourceBindings?: ContractResourceBindings;
};

type ClientConnectInfo = {
  sessionKey: SessionKey;
  contractId: string;
  contractDigest: string;
  transport: {
    natsServers: string[];
    inboxPrefix: string;
    sentinel: SentinelCreds;
  };
  auth: {
    mode: "binding_token";
    bindingToken: string;
    expiresAt: string;
  };
};

export type ClientBootstrapResult =
  | {
    status: "ready";
    connectInfo: ClientConnectInfo;
    contract: ClientBootstrapContractView;
    user: ClientBootstrapUserView;
    binding: ClientBootstrapBindingView;
  }
  | { status: "auth_required" }
  | {
    status: "not_ready";
    reason:
      | "contract_not_active"
      | "insufficient_permissions"
      | "service_role_on_user"
      | "user_inactive"
      | "user_not_found";
  };

type SessionStore = {
  get(key: string): Promise<{ take(): { value: Session } | Session | Result<never, BaseError> }>;
  keys(filter: string): Promise<{ take(): AsyncIterable<string> | Result<never, BaseError> }>;
};

type UserStore = {
  get(key: string): Promise<{ take(): unknown }>;
};

type ServiceStore = {
  get(key: string): Promise<{ take(): unknown }>;
};

type BindingTokenStore = {
  put(key: string, value: BindingTokenRecord): Promise<{ take(): unknown }>;
};

export type ClientBootstrapDeps = {
  contractStore: ContractStore;
  natsServers: string[];
  sentinel: SentinelCreds;
  sessionKV: SessionStore;
  usersKV: UserStore;
  servicesKV: ServiceStore;
  bindingTokenKV: BindingTokenStore;
  hashKey(value: string): Promise<string>;
  randomToken(bytes: number): string;
  verifyIdentityProof(input: {
    sessionKey: SessionKey;
    iat: number;
    sig: string;
  }): Promise<boolean>;
  bindingTokenTtlMs(session: UserSession): number;
  now?(): Date;
  nowSeconds?(): number;
};

function unwrapValue<T>(entry: { value: T } | T): T {
  if (entry && typeof entry === "object" && "value" in entry) {
    return entry.value;
  }
  return entry;
}

async function loadSessionBySessionKey(
  sessionKey: string,
  sessionStore: SessionStore,
): Promise<Session | null> {
  const keysIter = (await sessionStore.keys(`${sessionKey}.>`)).take();
  if (isErr(keysIter)) return null;

  let sessionKeyId: string | undefined;
  for await (const key of keysIter) {
    if (!sessionKeyId) {
      sessionKeyId = key;
      continue;
    }
    return null;
  }

  if (!sessionKeyId) return null;

  const sessionValue = (await sessionStore.get(sessionKeyId)).take();
  if (isErr(sessionValue)) return null;
  return unwrapValue(sessionValue);
}

function buildContractView(
  contract: TrellisContractV1,
  digest: string,
): ClientBootstrapContractView {
  return {
    id: contract.id,
    digest,
    displayName: contract.displayName,
    description: contract.description,
    ...(contract.resources ? { resources: contract.resources } : {}),
  };
}

async function issueBindingToken(
  deps: ClientBootstrapDeps,
  session: UserSession,
  sessionKey: SessionKey,
  now: Date,
): Promise<{ bindingToken: string; expiresAt: Date }> {
  const bindingToken = deps.randomToken(32);
  const bindingTokenHash = await deps.hashKey(bindingToken);
  const expiresAt = new Date(now.getTime() + deps.bindingTokenTtlMs(session));
  await deps.bindingTokenKV.put(bindingTokenHash, {
    sessionKey,
    kind: "renew",
    createdAt: now,
    expiresAt,
  });
  return { bindingToken, expiresAt };
}

export async function resolveClientBootstrap(
  deps: ClientBootstrapDeps,
  request: ClientBootstrapRequest,
): Promise<ClientBootstrapResult> {
  const session = await loadSessionBySessionKey(request.sessionKey, deps.sessionKV);
  if (!session || session.type !== "user") {
    return { status: "auth_required" };
  }

  const principal = await resolveSessionPrincipal(session, request.sessionKey, {
    servicesKV: deps.servicesKV,
    usersKV: deps.usersKV,
  });
  if (!principal.ok) {
    switch (principal.error.reason) {
      case "user_not_found":
      case "user_inactive":
      case "insufficient_permissions":
      case "service_role_on_user":
        return { status: "not_ready", reason: principal.error.reason };
      default:
        return { status: "auth_required" };
    }
  }

  const activeDigest = deps.contractStore.findActiveDigestById(session.contractId);
  if (activeDigest !== session.contractDigest) {
    return { status: "not_ready", reason: "contract_not_active" };
  }

  const contract = deps.contractStore.getContract(session.contractDigest);
  if (!contract || contract.id !== session.contractId) {
    return { status: "not_ready", reason: "contract_not_active" };
  }

  const now = deps.now?.() ?? new Date();
  const bindingToken = await issueBindingToken(deps, session, request.sessionKey, now);

  return {
    status: "ready",
    connectInfo: {
      sessionKey: request.sessionKey,
      contractId: session.contractId,
      contractDigest: session.contractDigest,
      transport: {
        natsServers: deps.natsServers,
        inboxPrefix: `_INBOX.${request.sessionKey.slice(0, 16)}`,
        sentinel: deps.sentinel,
      },
      auth: {
        mode: "binding_token",
        bindingToken: bindingToken.bindingToken,
        expiresAt: bindingToken.expiresAt.toISOString(),
      },
    },
    contract: buildContractView(contract, session.contractDigest),
    user: {
      trellisId: session.trellisId,
      origin: session.origin,
      id: session.id,
      email: session.email,
      name: session.name,
      ...(session.image ? { image: session.image } : {}),
    },
    binding: {
      contractId: session.contractId,
      digest: session.contractDigest,
      capabilities: session.delegatedCapabilities,
      publishSubjects: session.delegatedPublishSubjects,
      subscribeSubjects: session.delegatedSubscribeSubjects,
    },
  };
}

export function createClientBootstrapHandler(deps: ClientBootstrapDeps) {
  return async (c: Context) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const body = bodyResult.take();
    if (!Value.Check(ClientBootstrapRequestSchema, body)) {
      return c.json({ reason: "invalid_request" }, 400);
    }

    const request = Value.Parse(ClientBootstrapRequestSchema, body);
    const nowSeconds = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1_000);
    if (!isClientBootstrapProofIatFresh(request.iat, nowSeconds)) {
      return c.json({ reason: "iat_out_of_range" }, 400);
    }

    const proofOk = await deps.verifyIdentityProof({
      sessionKey: request.sessionKey,
      iat: request.iat,
      sig: request.sig,
    });
    if (!proofOk) {
      return c.json({ reason: "invalid_signature" }, 400);
    }

    return c.json(await resolveClientBootstrap(deps, request));
  };
}
