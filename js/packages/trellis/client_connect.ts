import { jwtAuthenticator, type Authenticator, type Msg, type NatsConnection } from "@nats-io/nats-core";
import { CONTRACT_STATE_METADATA, type ContractStateMetadata } from "./contract_support/mod.ts";
import { AsyncResult, type BaseError, Result, UnexpectedError } from "@qlever-llc/result";
import {
  base64urlDecode,
  base64urlEncode,
  getOrCreateSessionKey,
  getPublicSessionKey,
  natsConnectSigForIat,
  startAuthRequest,
} from "./auth/browser.ts";
import { BindResponseSchema, sha256, toArrayBuffer, utf8 } from "./auth/browser.ts";
import { correctedIatSeconds, estimateMidpointClockOffsetMs } from "./auth/time.ts";
import { canonicalizeJsonValue } from "./auth/utils.ts";
import {
  importEd25519PrivateKeyFromSeedBase64url,
  publicKeyBase64urlFromSeed,
  signEd25519SeedSha256,
} from "./auth/keys.ts";
import type { ClientOpts } from "./client.ts";
import type { TrellisAPI, TrellisContractV1 } from "./contracts.ts";
import {
  loadDefaultRuntimeTransport,
  selectRuntimeTransportServers,
  type RuntimeTransport,
} from "./runtime_transport.ts";
import {
  type RuntimeStateStoresForContract,
  Trellis,
} from "./trellis.ts";
import { TransportError } from "./errors/index.ts";
import { Type, type StaticDecode } from "typebox";
import { Value } from "typebox/value";
import {
  type SessionKeyHandle,
  bindFlowSig,
  oauthInitSig,
  signBytes,
} from "./auth/browser/session.ts";

type ClientContract<
  TApi extends TrellisAPI = TrellisAPI,
  TContract extends TrellisContractV1 = TrellisContractV1,
> = {
  CONTRACT: TContract;
  API: {
    trellis: TApi;
  };
  readonly [CONTRACT_STATE_METADATA]?: ContractStateMetadata;
};

type ClientContractApi<TContract extends ClientContract> =
  TContract["API"]["trellis"];

type BrowserClientAuthOptions = {
  mode?: "browser";
  handle?: SessionKeyHandle;
  provider?: string;
  redirectTo?: string | (() => string);
  landingPath?: string;
  context?: unknown;
  currentUrl?: URL | string | (() => URL | string);
  flowId?: string;
};

type SessionKeyClientAuthOptions = {
  mode: "session_key";
  sessionKeySeed: string;
  provider?: string;
  redirectTo: string;
  context?: unknown;
  flowId?: string;
};

export type ClientAuthOptions = BrowserClientAuthOptions | SessionKeyClientAuthOptions;

export type ClientAuthRequiredContext = {
  loginUrl: string;
  sessionKey: string;
  mode: "browser" | "session_key";
};

export type ClientAuthContinuation = { flowId: string } | void;

type ClientRuntime<
  TApi extends TrellisAPI,
  TState extends Record<string, { kind: "value" | "map"; value: unknown }>,
> = Trellis<TApi, "client", TState>;

export type TrellisClientConnection<
  TApi extends TrellisAPI,
  TState extends Record<string, { kind: "value" | "map"; value: unknown }> = {},
> = {
  readonly jobs: ClientRuntime<TApi, TState>["jobs"];
  readonly respondWithError: (msg: Msg, error: Error | BaseError) => void;
  readonly request: ClientRuntime<TApi, TState>["request"];
  readonly publish: ClientRuntime<TApi, TState>["publish"];
  readonly event: ClientRuntime<TApi, TState>["event"];
  readonly operation: ClientRuntime<TApi, TState>["operation"];
  readonly wait: ClientRuntime<TApi, TState>["wait"];
  readonly template: ClientRuntime<TApi, TState>["template"];
  readonly state: ClientRuntime<TApi, TState>["state"];
  readonly name: string;
  readonly timeout: number;
  readonly stream: string;
  readonly api: TApi;
  readonly natsConnection: NatsConnection;
};

type ClientConnection<
  TApi extends TrellisAPI,
  TState extends Record<string, { kind: "value" | "map"; value: unknown }> = {},
> = TrellisClientConnection<TApi, TState>;
type ConnectArgsForApi<TApi extends TrellisAPI = TrellisAPI> =
  & ClientOpts
  & {
    trellisUrl: string;
    contract: ClientContract<TApi, TrellisContractV1>;
    auth?: ClientAuthOptions;
    onAuthRequired?: (
      ctx: ClientAuthRequiredContext,
    ) => Promise<ClientAuthContinuation> | ClientAuthContinuation;
  };

function clientConnectResult<T>(
  promise: Promise<T>,
): AsyncResult<T, TransportError | UnexpectedError> {
  return AsyncResult.from(
    promise.then(
      (
        value,
      ): Result<T, TransportError | UnexpectedError> => Result.ok(value),
      (
        cause,
      ): Result<T, TransportError | UnexpectedError> => Result.err(
        cause instanceof TransportError
          ? cause
          : new UnexpectedError({ cause }),
      ),
    ),
  );
}

export type TrellisClientConnectArgs<
  TApi extends TrellisAPI = TrellisAPI,
  TContract extends ClientContract<TApi, TrellisContractV1> = ClientContract<
    TApi,
    TrellisContractV1
  >,
> =
  & ClientOpts
  & {
    trellisUrl: string;
    contract: TContract;
    auth?: ClientAuthOptions;
    onAuthRequired?: (
      ctx: ClientAuthRequiredContext,
    ) => Promise<ClientAuthContinuation> | ClientAuthContinuation;
  };

type ClientRuntimeIdentity = {
  mode: "browser" | "session_key";
  sessionKey: string;
  sign(data: Uint8Array): Promise<Uint8Array>;
  oauthInitSig(
    redirectTo: string,
    context?: unknown,
    provider?: string,
    contract?: Record<string, unknown>,
  ): Promise<string>;
  natsConnectSigForIat(iat: number): Promise<string>;
  bootstrapSig(iat: number): Promise<string>;
  bindFlowSig(flowId: string): Promise<string>;
  buildRuntimeAuthTokenSync?(iat: number, contractDigest: string): string;
};

const ClientTransportEndpointsSchema = Type.Object({
  natsServers: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
});

const ClientTransportsSchema = Type.Object({
  native: Type.Optional(ClientTransportEndpointsSchema),
  websocket: Type.Optional(ClientTransportEndpointsSchema),
});

type ClientConnectDeps = {
  loadTransport(): Promise<RuntimeTransport>;
  now(): number;
  setInterval?: (handler: () => void, ms: number) => ReturnType<typeof globalThis.setInterval>;
  clearInterval?: (id: ReturnType<typeof globalThis.setInterval>) => void;
};

const ClientBootstrapReadySchema = Type.Object({
  status: Type.Literal("ready"),
  serverNow: Type.Integer(),
  connectInfo: Type.Object({
    sessionKey: Type.String({ minLength: 1 }),
    contractId: Type.String({ minLength: 1 }),
    contractDigest: Type.String({ minLength: 1 }),
    transports: ClientTransportsSchema,
    transport: Type.Object({
      inboxPrefix: Type.String({ minLength: 1 }),
      sentinel: Type.Object({
        jwt: Type.String({ minLength: 1 }),
        seed: Type.String({ minLength: 1 }),
      }),
    }),
  }),
}, { additionalProperties: true });

const ClientBootstrapAuthRequiredSchema = Type.Object({
  status: Type.Literal("auth_required"),
  serverNow: Type.Integer(),
}, { additionalProperties: true });

const ClientBootstrapNotReadySchema = Type.Object({
  status: Type.Literal("not_ready"),
  reason: Type.String({ minLength: 1 }),
  serverNow: Type.Integer(),
}, { additionalProperties: true });

const ClientBootstrapIatOutOfRangeSchema = Type.Object({
  reason: Type.Literal("iat_out_of_range"),
  serverNow: Type.Integer(),
}, { additionalProperties: true });

type ClientBootstrapReady = StaticDecode<typeof ClientBootstrapReadySchema>;
type ClientBootstrapAuthRequired = StaticDecode<typeof ClientBootstrapAuthRequiredSchema>;
type ClientBootstrapNotReady = StaticDecode<typeof ClientBootstrapNotReadySchema>;
type ClientBootstrapIatOutOfRange = StaticDecode<typeof ClientBootstrapIatOutOfRangeSchema>;
type ClientBootstrapResponse =
  | ClientBootstrapReady
  | ClientBootstrapAuthRequired
  | ClientBootstrapNotReady;
type ClientBootstrapAttemptResponse = ClientBootstrapResponse | ClientBootstrapIatOutOfRange;
type ClockOffsetState = { serverClockOffsetMs: number };

function isBrowserRuntime(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

const defaultDeps: ClientConnectDeps = {
  loadTransport: loadDefaultRuntimeTransport,
  now: () => Date.now(),
  setInterval: (handler, ms) => globalThis.setInterval(handler, ms),
  clearInterval: (id) => globalThis.clearInterval(id),
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

function normalizeTrellisUrl(trellisUrl: string): string {
  return new URL(trellisUrl).toString().replace(/\/$/, "");
}

function resolveCurrentUrl(auth?: BrowserClientAuthOptions): URL | null {
  const currentUrl = typeof auth?.currentUrl === "function"
    ? auth.currentUrl()
    : auth?.currentUrl;
  if (currentUrl instanceof URL) return currentUrl;
  if (typeof currentUrl === "string") return new URL(currentUrl);
  return null;
}

function resolveRedirectTo(auth: BrowserClientAuthOptions, currentUrl: URL): string {
  const redirectTo = typeof auth.redirectTo === "function"
    ? auth.redirectTo()
    : auth.redirectTo;
  if (redirectTo) {
    return new URL(redirectTo, currentUrl.origin).toString();
  }

  const queryRedirect = currentUrl.searchParams.get("redirectTo");
  if (queryRedirect) {
    return new URL(queryRedirect, currentUrl.origin).toString();
  }

  if (auth.landingPath) {
    return new URL(auth.landingPath, currentUrl.origin).toString();
  }

  return currentUrl.toString();
}

function resolveConfiguredRedirectTo(
  redirectTo: string | (() => string) | undefined,
): string | undefined {
  return typeof redirectTo === "function" ? redirectTo() : redirectTo;
}

function authRequestContextRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

async function signDomainValue(sign: (data: Uint8Array) => Promise<Uint8Array>, prefix: string, value: string): Promise<string> {
  const digest = await sha256(utf8(`${prefix}:${value}`));
  const signature = await sign(digest);
  const binary = String.fromCharCode(...signature);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createSessionKeyRuntimeIdentity(sessionKeySeed: string): Promise<ClientRuntimeIdentity> {
  const seed = base64urlDecode(sessionKeySeed);
  const privateKey = await importEd25519PrivateKeyFromSeedBase64url(sessionKeySeed);
  const sessionKey = publicKeyBase64urlFromSeed(seed);
  const sign = async (data: Uint8Array): Promise<Uint8Array> => {
    const signature = await crypto.subtle.sign("Ed25519", privateKey, toArrayBuffer(data));
    return new Uint8Array(signature);
  };

  return {
    mode: "session_key",
    sessionKey,
    sign,
    oauthInitSig: (redirectTo, context, provider, contract) =>
      signDomainValue(
        sign,
        "oauth-init",
        contract === undefined
          ? `${redirectTo}:${canonicalizeJsonValue(context ?? null)}`
          : `${redirectTo}:${provider ?? ""}:${canonicalizeJsonValue(contract)}:${canonicalizeJsonValue(context ?? null)}`,
      ),
    natsConnectSigForIat: (iat) => signDomainValue(sign, "nats-connect", String(iat)),
    bootstrapSig: (iat) => signDomainValue(sign, "bootstrap-client", String(iat)),
    bindFlowSig: (flowId) => signDomainValue(sign, "bind-flow", flowId),
    buildRuntimeAuthTokenSync: (iat, contractDigest) => {
      const sig = signEd25519SeedSha256(seed, utf8(`nats-connect:${iat}`));
      return JSON.stringify({
        v: 1,
        sessionKey,
        iat,
        contractDigest,
        sig: base64urlEncode(new Uint8Array(sig)),
      });
    },
  };
}

async function resolveClientIdentity(auth: ClientAuthOptions | undefined): Promise<ClientRuntimeIdentity> {
  if (auth?.mode === "session_key") {
    return await createSessionKeyRuntimeIdentity(auth.sessionKeySeed);
  }

  const handle = auth?.handle ?? await getOrCreateSessionKey();
  return {
    mode: "browser",
    sessionKey: getPublicSessionKey(handle),
    sign: (data) => signBytes(handle, data),
    oauthInitSig: (redirectTo, context, provider, contract) =>
      oauthInitSig(handle, redirectTo, context, provider, contract),
    natsConnectSigForIat: (iat) => natsConnectSigForIat(handle, iat),
    bootstrapSig: (iat) => signDomainValue((data) => signBytes(handle, data), "bootstrap-client", String(iat)),
    bindFlowSig: (flowId) => bindFlowSig(handle, flowId),
  };
}

async function bindClientFlow(args: {
  trellisUrl: string;
  sessionKey: string;
  flowId: string;
  sig: string;
}): Promise<void> {
  const response = await fetch(
    `${args.trellisUrl}/auth/flow/${encodeURIComponent(args.flowId)}/bind`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey: args.sessionKey, sig: args.sig }),
    },
  );
  if (!response.ok) {
    const reason = await response.text();
    throw createTransportError({
      code: "trellis.auth.bind_failed",
      message: "Trellis could not finish the sign-in step.",
      hint: "Start the sign-in flow again.",
      context: { status: response.status, trellisUrl: args.trellisUrl, reason },
    });
  }

  const payload = await readJsonResponse(response, {
    code: "trellis.auth.bind_invalid_response",
    message: "Trellis returned an invalid sign-in response.",
    hint: "Start the sign-in flow again.",
    context: { flowId: args.flowId },
  });
  if (
    payload && typeof payload === "object" &&
    (payload as { status?: unknown }).status === "expired"
  ) {
    throw createTransportError({
      code: "trellis.auth.bind_expired",
      message: "The Trellis sign-in step expired.",
      hint: "Start the sign-in flow again.",
      context: { flowId: args.flowId },
    });
  }
  let parsed: StaticDecode<typeof BindResponseSchema>;
  try {
    parsed = Value.Parse(BindResponseSchema, payload) as StaticDecode<
      typeof BindResponseSchema
    >;
  } catch (cause) {
    throw createTransportError({
      code: "trellis.auth.bind_invalid_response",
      message: "Trellis returned an invalid sign-in response.",
      hint: "Start the sign-in flow again.",
      cause,
      context: { flowId: args.flowId },
    });
  }
  if (parsed.status !== "bound") {
    throw createTransportError({
      code: "trellis.auth.bind_invalid_response",
      message: "Trellis returned an invalid sign-in response.",
      hint: "Start the sign-in flow again.",
      context: { flowId: args.flowId, status: parsed.status },
    });
  }
}

async function fetchClientBootstrap(args: {
  trellisUrl: string;
  sessionKey: string;
  bootstrapSig: string;
  iat: number;
}): Promise<ClientBootstrapAttemptResponse> {
  const response = await fetch(`${args.trellisUrl}/bootstrap/client`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: args.sessionKey,
      iat: args.iat,
      sig: args.bootstrapSig,
    }),
  });

  const payload = await readJsonResponse(response, {
    code: "trellis.bootstrap.invalid_response",
    message: "Trellis returned an invalid bootstrap response.",
    hint: "Retry the connection. If it keeps happening, check the Trellis deployment.",
    context: { trellisUrl: args.trellisUrl },
  });
  if (!response.ok) {
    if (Value.Check(ClientBootstrapIatOutOfRangeSchema, payload)) {
      return payload;
    }
    const reason = payload && typeof payload === "object" &&
        typeof (payload as { reason?: unknown }).reason === "string"
      ? (payload as { reason: string }).reason
      : `http_${response.status}`;
    throw createTransportError({
      code: "trellis.bootstrap.failed",
      message: "Trellis could not prepare the client session.",
      hint: "Retry the connection. If it keeps failing, check Trellis availability and access.",
      context: { trellisUrl: args.trellisUrl, status: response.status, reason },
    });
  }

  if (Value.Check(ClientBootstrapReadySchema, payload)) {
    return payload;
  }
  if (Value.Check(ClientBootstrapAuthRequiredSchema, payload)) {
    return payload;
  }
  if (Value.Check(ClientBootstrapNotReadySchema, payload)) {
    return payload;
  }

  throw createTransportError({
    code: "trellis.bootstrap.invalid_response",
    message: "Trellis returned an invalid bootstrap response.",
    hint: "Retry the connection. If it keeps happening, check the Trellis deployment.",
    context: { trellisUrl: args.trellisUrl },
  });
}

function updateClockOffsetFromServer(args: {
  offsetState: ClockOffsetState;
  requestStartedAtMs: number;
  responseReceivedAtMs: number;
  serverNowSeconds: number;
}): void {
  args.offsetState.serverClockOffsetMs = estimateMidpointClockOffsetMs({
    requestStartedAtMs: args.requestStartedAtMs,
    responseReceivedAtMs: args.responseReceivedAtMs,
    serverNowSeconds: args.serverNowSeconds,
  });
}

async function fetchClientBootstrapWithRetry(args: {
  trellisUrl: string;
  sessionKey: string;
  identity: ClientRuntimeIdentity;
  deps: ClientConnectDeps;
  offsetState: ClockOffsetState;
}): Promise<ClientBootstrapResponse> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const requestStartedAtMs = args.deps.now();
    const iat = correctedIatSeconds(requestStartedAtMs, args.offsetState.serverClockOffsetMs);
    const response = await fetchClientBootstrap({
      trellisUrl: args.trellisUrl,
      sessionKey: args.sessionKey,
      iat,
      bootstrapSig: await args.identity.bootstrapSig(iat),
    });
    const responseReceivedAtMs = args.deps.now();

    updateClockOffsetFromServer({
      offsetState: args.offsetState,
      requestStartedAtMs,
      responseReceivedAtMs,
      serverNowSeconds: response.serverNow,
    });

    if ("status" in response) {
      return response;
    }
  }

  throw createTransportError({
    code: "trellis.bootstrap.time_sync_failed",
    message: "Trellis could not confirm the client time window.",
    hint: "Retry the connection. If it keeps happening, check the client and Trellis clocks.",
    context: { trellisUrl: args.trellisUrl },
  });
}

async function createRuntimeUserAuthenticator(args: {
  identity: ClientRuntimeIdentity;
  deps: ClientConnectDeps;
  offsetState: ClockOffsetState;
  getContractDigest(): string;
  getSentinel(): { jwt: string; seed: string };
  recoverBrowserAuth?(): Promise<void>;
}): Promise<{ authenticators: Authenticator[]; stop: () => void }> {
  const browserTokenLookaheadSeconds = 300;
  const jwtAuth: Authenticator = (nonce?: string) => {
    const sentinel = args.getSentinel();
    return jwtAuthenticator(
      sentinel.jwt,
      new TextEncoder().encode(sentinel.seed),
    )(nonce);
  };

  if (args.identity.buildRuntimeAuthTokenSync) {
    return {
      authenticators: [
        jwtAuth,
        () => ({
          auth_token: args.identity.buildRuntimeAuthTokenSync!(
            correctedIatSeconds(args.deps.now(), args.offsetState.serverClockOffsetMs),
            args.getContractDigest(),
          ),
        }),
      ],
      stop: () => {},
    };
  }

  const buildRuntimeAuthToken = async (iat: number): Promise<string> => {
    return JSON.stringify({
      v: 1,
      sessionKey: args.identity.sessionKey,
      iat,
      contractDigest: args.getContractDigest(),
      sig: await args.identity.natsConnectSigForIat(iat),
    });
  };

  let currentToken = await buildRuntimeAuthToken(
    correctedIatSeconds(args.deps.now(), args.offsetState.serverClockOffsetMs),
  );
  const precomputedTokens = new Map<number, string>();
  let latestPreparedIat = 0;
  let refreshInFlight: Promise<void> | null = null;
  let recoveryInFlight: Promise<void> | null = null;

  const refresh = (): Promise<void> => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const currentIat = correctedIatSeconds(
        args.deps.now(),
        args.offsetState.serverClockOffsetMs,
      );
      const maxIat = currentIat + browserTokenLookaheadSeconds;
      const startIat = Math.max(currentIat, latestPreparedIat + 1);

      for (let iat = startIat; iat <= maxIat; iat += 1) {
        precomputedTokens.set(iat, await buildRuntimeAuthToken(iat));
      }

      latestPreparedIat = Math.max(latestPreparedIat, maxIat);
      for (const iat of precomputedTokens.keys()) {
        if (iat < currentIat - 5) {
          precomputedTokens.delete(iat);
        }
      }

      const nextToken = precomputedTokens.get(currentIat);
      if (nextToken) {
        currentToken = nextToken;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  };

  const recover = (): Promise<void> => {
    if (!args.recoverBrowserAuth) {
      return Promise.resolve();
    }
    if (recoveryInFlight) return recoveryInFlight;
    recoveryInFlight = (async () => {
      const digestBefore = args.getContractDigest();
      await args.recoverBrowserAuth?.();
      if (args.getContractDigest() !== digestBefore) {
        precomputedTokens.clear();
        latestPreparedIat = 0;
      }
      await refresh();
    })().finally(() => {
      recoveryInFlight = null;
    });
    return recoveryInFlight;
  };

  await refresh();
  const setRefreshInterval = args.deps.setInterval ??
    ((handler: () => void, ms: number): ReturnType<typeof globalThis.setInterval> =>
      globalThis.setInterval(handler, ms));
  const clearRefreshInterval = args.deps.clearInterval ??
    ((id: ReturnType<typeof globalThis.setInterval>) => globalThis.clearInterval(id));
  const refreshIntervalId = setRefreshInterval(() => {
    void refresh();
  }, 10_000);

  return {
    authenticators: [
      jwtAuth,
      () => {
        const currentIat = correctedIatSeconds(
          args.deps.now(),
          args.offsetState.serverClockOffsetMs,
        );
        const nextToken = precomputedTokens.get(currentIat);
        if (nextToken) {
          currentToken = nextToken;
          if (currentIat >= latestPreparedIat - 60) {
            void refresh();
          }
          return { auth_token: currentToken };
        }
        if (args.recoverBrowserAuth) {
          void recover();
          return { auth_token: currentToken };
        }
        void refresh();
        return { auth_token: currentToken };
      },
    ],
    stop: () => {
      clearRefreshInterval(refreshIntervalId);
    },
  };
}

function cleanupBrowserCallbackUrl(currentUrl: URL): void {
  if (!isBrowserRuntime()) return;
  if (!currentUrl.searchParams.has("flowId") && !currentUrl.searchParams.has("authError")) {
    return;
  }

  currentUrl.searchParams.delete("flowId");
  currentUrl.searchParams.delete("authError");
  window.history.replaceState({}, "", currentUrl.pathname + currentUrl.search + currentUrl.hash);
}

function isExpiredBindError(error: unknown): boolean {
  return error instanceof TransportError && error.code === "trellis.auth.bind_expired";
}

function needsReauth(
  bootstrap: ClientBootstrapResponse,
): bootstrap is Extract<ClientBootstrapResponse, { status: "auth_required" }> |
  Extract<
    ClientBootstrapResponse,
    { status: "not_ready"; reason: "contract_not_active" | "insufficient_permissions" }
  > {
  return bootstrap.status === "auth_required" ||
    (
      bootstrap.status === "not_ready" &&
      (bootstrap.reason === "insufficient_permissions" || bootstrap.reason === "contract_not_active")
    );
}

function bootstrapTargetsRequestedContract<TApi extends TrellisAPI>(
  bootstrap: ClientBootstrapResponse,
  args: ConnectArgsForApi<TApi>,
): boolean {
  return bootstrap.status === "ready" &&
    bootstrap.connectInfo.contractId === args.contract.CONTRACT.id;
}

async function buildSessionKeyLoginUrl(args: {
  trellisUrl: string;
  redirectTo: string;
  sessionKey: string;
  contract: TrellisContractV1;
  provider?: string;
  context?: unknown;
  oauthInitSig: string;
}): Promise<{ status: "bound" } | { status: "flow_started"; loginUrl: string }> {
  const context = authRequestContextRecord(args.context);
  const response = await fetch(`${args.trellisUrl}/auth/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirectTo: args.redirectTo,
      sessionKey: args.sessionKey,
      sig: args.oauthInitSig,
      contract: args.contract,
      ...(args.provider ? { provider: args.provider } : {}),
      ...(context ? { context } : {}),
    }),
  });
  if (!response.ok) {
    const reason = await response.text();
    throw createTransportError({
      code: "trellis.auth.login_failed",
      message: "Trellis could not start sign-in.",
      hint: "Retry sign-in. If it keeps failing, check Trellis availability and access.",
      context: { status: response.status, reason, trellisUrl: args.trellisUrl },
    });
  }

  const payload = await readJsonResponse(response, {
    code: "trellis.auth.login_invalid_response",
    message: "Trellis returned an invalid sign-in response.",
    hint: "Retry sign-in. If it keeps happening, start the sign-in flow again.",
    context: { trellisUrl: args.trellisUrl },
  });
  if (
    payload && typeof payload === "object" &&
    (payload as { status?: unknown }).status === "flow_started" &&
    typeof (payload as { loginUrl?: unknown }).loginUrl === "string"
  ) {
    return { status: "flow_started", loginUrl: (payload as { loginUrl: string }).loginUrl };
  }
  if (payload && typeof payload === "object" && (payload as { status?: unknown }).status === "bound") {
    return { status: "bound" };
  }
  throw createTransportError({
    code: "trellis.auth.login_invalid_response",
    message: "Trellis returned an invalid sign-in response.",
    hint: "Retry sign-in. If it keeps happening, start the sign-in flow again.",
    context: { trellisUrl: args.trellisUrl },
  });
}

export async function connectClientWithDeps<
  TContract extends ClientContract<TrellisAPI, TrellisContractV1>,
>(
  args: TrellisClientConnectArgs<ClientContractApi<TContract>, TContract>,
  deps: ClientConnectDeps,
): Promise<
  ClientConnection<
    ClientContractApi<TContract>,
    RuntimeStateStoresForContract<TContract>
  >
> {
  const trellisUrl = normalizeTrellisUrl(args.trellisUrl);
  const identity = await resolveClientIdentity(args.auth);
  const currentUrl = args.auth?.mode === "session_key" ? null : resolveCurrentUrl(args.auth);
  const browserAuth = args.auth?.mode === "session_key" ? undefined : args.auth;
  const callbackFlowId = args.auth?.mode === "session_key"
    ? args.auth.flowId
    : browserAuth?.flowId ?? currentUrl?.searchParams.get("flowId") ?? undefined;
  const offsetState: ClockOffsetState = { serverClockOffsetMs: 0 };

  if (callbackFlowId) {
    try {
      await bindClientFlow({
        trellisUrl,
        sessionKey: identity.sessionKey,
        flowId: callbackFlowId,
        sig: await identity.bindFlowSig(callbackFlowId),
      });
      if (currentUrl) cleanupBrowserCallbackUrl(currentUrl);
    } catch (error) {
      if (currentUrl && isExpiredBindError(error)) {
        cleanupBrowserCallbackUrl(currentUrl);
      }
      throw error;
    }
  }

  const initialBootstrap = await fetchClientBootstrapWithRetry({
    trellisUrl,
    sessionKey: identity.sessionKey,
    identity,
    deps,
    offsetState,
  });

  const bootstrap = needsReauth(initialBootstrap) ||
      !bootstrapTargetsRequestedContract(initialBootstrap, args)
    ? await resolveAuthRequired(args, identity, currentUrl, deps, offsetState)
    : initialBootstrap;

  if (bootstrap.status !== "ready") {
    if (bootstrap.status === "not_ready") {
      throw createTransportError({
        code: "trellis.bootstrap.not_ready",
        message: "Trellis is not ready to connect this client.",
        hint: "Wait for the requested app access to become available, then try again.",
        context: { reason: bootstrap.reason },
      });
    }
    throw createTransportError({
      code: "trellis.bootstrap.auth_required",
      message: "Trellis still requires sign-in before connecting this client.",
      hint: "Complete sign-in, then try again.",
    });
  }

  const transport = await deps.loadTransport();
  const runtimeState = {
    contractDigest: bootstrap.connectInfo.contractDigest,
    sentinel: bootstrap.connectInfo.transport.sentinel,
  };
  const recoverBrowserAuth = identity.mode === "browser"
    ? async () => {
      const latestCurrentUrl = resolveCurrentUrl(browserAuth);
      const refreshedBootstrap = await fetchClientBootstrapWithRetry({
        trellisUrl,
        sessionKey: identity.sessionKey,
        identity,
        deps,
        offsetState,
      });
      const resolvedBootstrap = needsReauth(refreshedBootstrap)
        ? await resolveAuthRequired(args, identity, latestCurrentUrl, deps, offsetState)
        : refreshedBootstrap;
      if (resolvedBootstrap.status !== "ready") {
        if (resolvedBootstrap.status === "not_ready") {
          throw createTransportError({
            code: "trellis.bootstrap.not_ready",
            message: "Trellis is not ready to reconnect this client.",
            hint: "Wait for the requested app access to become available, then try again.",
            context: { reason: resolvedBootstrap.reason },
          });
        }
        throw createTransportError({
          code: "trellis.bootstrap.auth_required",
          message: "Trellis still requires sign-in before reconnecting this client.",
          hint: "Complete sign-in, then try again.",
        });
      }
      runtimeState.contractDigest = resolvedBootstrap.connectInfo.contractDigest;
      runtimeState.sentinel = resolvedBootstrap.connectInfo.transport.sentinel;
    }
    : undefined;
  const runtimeAuth = await createRuntimeUserAuthenticator({
    identity,
    deps,
    offsetState,
    getContractDigest: () => runtimeState.contractDigest,
    getSentinel: () => runtimeState.sentinel,
    recoverBrowserAuth,
  });
  let nc: NatsConnection;
  try {
    nc = await transport.connect({
      servers: selectRuntimeTransportServers(bootstrap.connectInfo.transports),
      inboxPrefix: bootstrap.connectInfo.transport.inboxPrefix,
      authenticator: runtimeAuth.authenticators,
    });
  } catch (error) {
    runtimeAuth.stop();
    throw createTransportError({
      code: "trellis.runtime.connect_failed",
      message: "Trellis could not open the runtime connection.",
      hint: "Retry the connection. If it keeps failing, check Trellis transport availability.",
      cause: error,
      context: { trellisUrl },
    });
  }
  void nc.closed().finally(() => runtimeAuth.stop());

  const clientOpts: ClientOpts = {
    ...(typeof args.name === "string" ? { name: args.name } : {}),
    ...(args.log ? { log: args.log } : {}),
    ...(typeof args.timeout === "number" ? { timeout: args.timeout } : {}),
    ...(typeof args.stream === "string" ? { stream: args.stream } : {}),
    ...(args.noResponderRetry ? { noResponderRetry: args.noResponderRetry } : {}),
  };

  const trellis = new Trellis<
    ClientContractApi<TContract>,
    "client",
    RuntimeStateStoresForContract<TContract>
  >(
    clientOpts.name ?? "client",
    nc,
    {
      sessionKey: identity.sessionKey,
      sign: identity.sign,
    },
    {
      log: clientOpts.log,
      timeout: clientOpts.timeout,
      stream: clientOpts.stream,
      noResponderRetry: clientOpts.noResponderRetry,
      api: args.contract.API.trellis,
      state: args.contract[CONTRACT_STATE_METADATA],
    },
  );
  return {
    jobs: trellis.jobs.bind(trellis),
    respondWithError: trellis.respondWithError.bind(trellis),
    request: trellis.request.bind(trellis),
    publish: trellis.publish.bind(trellis),
    event: trellis.event.bind(trellis),
    operation: trellis.operation.bind(trellis),
    wait: trellis.wait.bind(trellis),
    template: trellis.template.bind(trellis),
    state: trellis.state,
    name: trellis.name,
    timeout: trellis.timeout,
    stream: trellis.stream,
    api: trellis.api,
    natsConnection: trellis.natsConnection,
  };
}

async function resolveAuthRequired<TApi extends TrellisAPI>(
  args: ConnectArgsForApi<TApi>,
  identity: ClientRuntimeIdentity,
  currentUrl: URL | null,
  deps: ClientConnectDeps,
  offsetState: ClockOffsetState,
): Promise<ClientBootstrapResponse> {
  const browserAuth: BrowserClientAuthOptions = args.auth?.mode === "session_key"
    ? {}
    : args.auth ?? {};
  const redirectTo = args.auth?.mode === "session_key"
    ? args.auth.redirectTo
    : currentUrl
    ? resolveRedirectTo(browserAuth, currentUrl)
    : resolveConfiguredRedirectTo(browserAuth.redirectTo);
  if (!redirectTo) {
    throw new Error("Client authentication requires a redirectTo URL");
  }

  const authStart = args.auth?.mode === "session_key"
    ? await buildSessionKeyLoginUrl({
        trellisUrl: normalizeTrellisUrl(args.trellisUrl),
        redirectTo,
        sessionKey: identity.sessionKey,
        contract: args.contract.CONTRACT,
        provider: args.auth.provider,
        context: args.auth.context,
        oauthInitSig: await identity.oauthInitSig(
          redirectTo,
          authRequestContextRecord(args.auth.context),
          args.auth.provider,
          args.contract.CONTRACT,
        ),
      })
    : await startAuthRequest({
      authUrl: normalizeTrellisUrl(args.trellisUrl),
      redirectTo,
      handle: browserAuth.handle ?? await getOrCreateSessionKey(),
      provider: browserAuth.provider,
      contract: args.contract.CONTRACT,
      context: browserAuth.context,
    });

  if (authStart.status === "bound") {
    return await fetchClientBootstrapWithRetry({
      trellisUrl: normalizeTrellisUrl(args.trellisUrl),
      sessionKey: identity.sessionKey,
      identity,
      deps,
      offsetState,
    });
  }

  const loginUrl = authStart.loginUrl;

  const continuation = await args.onAuthRequired?.({
    loginUrl,
    sessionKey: identity.sessionKey,
    mode: identity.mode,
  });
  if (continuation && typeof continuation === "object" && "flowId" in continuation) {
    await bindClientFlow({
      trellisUrl: normalizeTrellisUrl(args.trellisUrl),
      sessionKey: identity.sessionKey,
      flowId: continuation.flowId,
      sig: await identity.bindFlowSig(continuation.flowId),
    });
    return await fetchClientBootstrapWithRetry({
      trellisUrl: normalizeTrellisUrl(args.trellisUrl),
      sessionKey: identity.sessionKey,
      identity,
      deps,
      offsetState,
    });
  }

  if (isBrowserRuntime()) {
    window.location.href = loginUrl;
    throw new Error("Redirecting to Trellis login");
  }

  throw new Error("Client authentication required and no auth continuation was provided");
}

function connectTypedClient<
  TContract extends ClientContract<TrellisAPI, TrellisContractV1>,
>(args: TrellisClientConnectArgs<ClientContractApi<TContract>, TContract>) {
  return clientConnectResult(connectClientWithDeps(args, defaultDeps));
}

export class TrellisClient {
  static connect = connectTypedClient;
}
