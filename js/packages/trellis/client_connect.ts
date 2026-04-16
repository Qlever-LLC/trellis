import { jwtAuthenticator, type NatsConnection } from "@nats-io/nats-core";
import {
  buildLoginUrl,
  getOrCreateSessionKey,
  startAuthRequest,
} from "./auth.ts";
import { BindResponseSchema } from "./auth.ts";
import { createAuth } from "./auth.ts";
import { sha256, utf8 } from "./auth.ts";
import type { ClientOpts } from "./client.ts";
import type { TrellisAPI, TrellisContractV1 } from "./contracts.ts";
import {
  loadDefaultRuntimeTransport,
  selectRuntimeTransportServers,
  type RuntimeTransport,
} from "./runtime_transport.ts";
import { Trellis } from "./trellis.ts";
import { Type, type StaticDecode } from "typebox";
import { Value } from "typebox/value";
import {
  type SessionKeyHandle,
  bindFlowSig,
  getPublicSessionKey,
  oauthInitSig,
  signBytes,
} from "./auth/browser/session.ts";

type ClientContract<TApi extends TrellisAPI = TrellisAPI> = {
  CONTRACT: TrellisContractV1;
  API: {
    trellis: TApi;
  };
};

type BrowserClientAuthOptions = {
  mode?: "browser";
  handle?: SessionKeyHandle;
  provider?: string;
  redirectTo?: string;
  landingPath?: string;
  context?: unknown;
  currentUrl?: URL | string;
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

export type TrellisClientConnectArgs<TApi extends TrellisAPI = TrellisAPI> =
  & ClientOpts
  & {
    trellisUrl: string;
    contract: ClientContract<TApi>;
    auth?: ClientAuthOptions;
    onAuthRequired?: (
      ctx: ClientAuthRequiredContext,
    ) => Promise<ClientAuthContinuation> | ClientAuthContinuation;
  };

type ClientRuntimeIdentity = {
  mode: "browser" | "session_key";
  sessionKey: string;
  sign(data: Uint8Array): Promise<Uint8Array>;
  oauthInitSig(redirectTo: string, context?: unknown): Promise<string>;
  bindingTokenSig(bindingToken: string): Promise<string>;
  bootstrapSig(iat: number): Promise<string>;
  bindFlowSig(flowId: string): Promise<string>;
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
};

const ClientBootstrapReadySchema = Type.Object({
  status: Type.Literal("ready"),
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
    auth: Type.Object({
      mode: Type.Literal("binding_token"),
      bindingToken: Type.String({ minLength: 1 }),
      expiresAt: Type.String({ format: "date-time" }),
    }),
  }),
}, { additionalProperties: true });

const ClientBootstrapAuthRequiredSchema = Type.Object({
  status: Type.Literal("auth_required"),
}, { additionalProperties: true });

const ClientBootstrapNotReadySchema = Type.Object({
  status: Type.Literal("not_ready"),
  reason: Type.String({ minLength: 1 }),
}, { additionalProperties: true });

type ClientBootstrapReady = StaticDecode<typeof ClientBootstrapReadySchema>;
type ClientBootstrapAuthRequired = StaticDecode<typeof ClientBootstrapAuthRequiredSchema>;
type ClientBootstrapNotReady = StaticDecode<typeof ClientBootstrapNotReadySchema>;
type ClientBootstrapResponse =
  | ClientBootstrapReady
  | ClientBootstrapAuthRequired
  | ClientBootstrapNotReady;

function isBrowserRuntime(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

const defaultDeps: ClientConnectDeps = {
  loadTransport: loadDefaultRuntimeTransport,
  now: () => Date.now(),
};

function normalizeTrellisUrl(trellisUrl: string): string {
  return new URL(trellisUrl).toString().replace(/\/$/, "");
}

function resolveCurrentUrl(auth?: BrowserClientAuthOptions): URL | null {
  if (auth?.currentUrl instanceof URL) return auth.currentUrl;
  if (typeof auth?.currentUrl === "string") return new URL(auth.currentUrl);
  if (isBrowserRuntime()) return new URL(window.location.href);
  return null;
}

function resolveRedirectTo(auth: BrowserClientAuthOptions, currentUrl: URL): string {
  if (auth.redirectTo) {
    return new URL(auth.redirectTo, currentUrl.origin).toString();
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

async function signDomainValue(sign: (data: Uint8Array) => Promise<Uint8Array>, prefix: string, value: string): Promise<string> {
  const digest = await sha256(utf8(`${prefix}:${value}`));
  const signature = await sign(digest);
  const binary = String.fromCharCode(...signature);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function resolveClientIdentity(auth: ClientAuthOptions | undefined): Promise<ClientRuntimeIdentity> {
  if (auth?.mode === "session_key") {
    const sessionAuth = await createAuth({ sessionKeySeed: auth.sessionKeySeed });
    return {
      mode: "session_key",
      sessionKey: sessionAuth.sessionKey,
      sign: sessionAuth.sign,
      oauthInitSig: sessionAuth.oauthInitSig,
      bindingTokenSig: sessionAuth.natsConnectSigForBindingToken,
      bootstrapSig: (iat) => signDomainValue(sessionAuth.sign, "bootstrap-client", String(iat)),
      bindFlowSig: (flowId) => signDomainValue(sessionAuth.sign, "bind-flow", flowId),
    };
  }

  const handle = auth?.handle ?? await getOrCreateSessionKey();
  return {
    mode: "browser",
    sessionKey: getPublicSessionKey(handle),
    sign: (data) => signBytes(handle, data),
    oauthInitSig: (redirectTo, context) => oauthInitSig(handle, redirectTo, context),
    bindingTokenSig: (bindingToken) => signDomainValue((data) => signBytes(handle, data), "nats-connect", bindingToken),
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
    throw new Error(`Client bind failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  const parsed = Value.Parse(BindResponseSchema, payload);
  if (parsed.status !== "bound") {
    throw new Error(`Client bind did not complete: ${parsed.status}`);
  }
}

async function fetchClientBootstrap(args: {
  trellisUrl: string;
  sessionKey: string;
  bootstrapSig: string;
  iat: number;
}): Promise<ClientBootstrapResponse> {
  const response = await fetch(new URL("/bootstrap/client", args.trellisUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionKey: args.sessionKey,
      iat: args.iat,
      sig: args.bootstrapSig,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const reason = typeof payload?.reason === "string"
      ? payload.reason
      : `http_${response.status}`;
    throw new Error(`Client bootstrap failed: ${reason}`);
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

  throw new Error("Client bootstrap returned an invalid response");
}

function cleanupBrowserCallbackUrl(currentUrl: URL): void {
  if (!isBrowserRuntime()) return;
  if (!currentUrl.searchParams.has("flowId") && !currentUrl.searchParams.has("authError")) {
    return;
  }

  currentUrl.searchParams.delete("flowId");
  currentUrl.searchParams.delete("authError");
  window.history.replaceState({}, "", currentUrl.pathname + currentUrl.search);
}

function needsReauth(
  bootstrap: ClientBootstrapResponse,
): bootstrap is Extract<ClientBootstrapResponse, { status: "auth_required" }> |
  Extract<ClientBootstrapResponse, { status: "not_ready"; reason: "insufficient_permissions" }> {
  return bootstrap.status === "auth_required" ||
    (bootstrap.status === "not_ready" && bootstrap.reason === "insufficient_permissions");
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
  const response = await fetch(`${args.trellisUrl}/auth/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirectTo: args.redirectTo,
      sessionKey: args.sessionKey,
      sig: args.oauthInitSig,
      contract: args.contract,
      ...(args.provider ? { provider: args.provider } : {}),
      ...(args.context && typeof args.context === "object" && !Array.isArray(args.context)
        ? { context: args.context }
        : {}),
    }),
  });
  if (!response.ok) {
    const reason = await response.text();
    throw new Error(`Login flow creation failed: ${response.status} ${reason}`);
  }

  const payload = await response.json();
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
  throw new Error("Login flow creation returned an invalid response");
}

export async function connectClientWithDeps<TApi extends TrellisAPI>(
  args: TrellisClientConnectArgs<TApi>,
  deps: ClientConnectDeps,
): Promise<Trellis<TApi>> {
    const trellisUrl = normalizeTrellisUrl(args.trellisUrl);
    const identity = await resolveClientIdentity(args.auth);
    const currentUrl = args.auth?.mode === "session_key" ? null : resolveCurrentUrl(args.auth);
    const callbackFlowId = args.auth?.mode === "session_key"
      ? args.auth.flowId
      : currentUrl?.searchParams.get("flowId") ?? undefined;

    if (callbackFlowId) {
      await bindClientFlow({
        trellisUrl,
        sessionKey: identity.sessionKey,
        flowId: callbackFlowId,
        sig: await identity.bindFlowSig(callbackFlowId),
      });
      if (currentUrl) cleanupBrowserCallbackUrl(currentUrl);
    }

    const bootstrapIat = Math.floor(deps.now() / 1_000);
    const initialBootstrap = await fetchClientBootstrap({
      trellisUrl,
      sessionKey: identity.sessionKey,
      iat: bootstrapIat,
      bootstrapSig: await identity.bootstrapSig(bootstrapIat),
    });

    const bootstrap = needsReauth(initialBootstrap)
      ? await resolveAuthRequired(args, identity, currentUrl, deps)
      : initialBootstrap;

    if (bootstrap.status !== "ready") {
      if (bootstrap.status === "not_ready") {
        throw new Error(`Client bootstrap is not ready: ${bootstrap.reason}`);
      }
      throw new Error("Client bootstrap still requires authentication");
    }

    const transport = await deps.loadTransport();
    const token = JSON.stringify({
      v: 1,
      sessionKey: identity.sessionKey,
      bindingToken: bootstrap.connectInfo.auth.bindingToken,
      sig: await identity.bindingTokenSig(bootstrap.connectInfo.auth.bindingToken),
    });
    const nc = await transport.connect({
      servers: selectRuntimeTransportServers(bootstrap.connectInfo.transports),
      token,
      inboxPrefix: bootstrap.connectInfo.transport.inboxPrefix,
      authenticator: jwtAuthenticator(
        bootstrap.connectInfo.transport.sentinel.jwt,
        new TextEncoder().encode(bootstrap.connectInfo.transport.sentinel.seed),
      ),
    });

    const clientOpts: ClientOpts = {
      ...(typeof args.name === "string" ? { name: args.name } : {}),
      ...(args.log ? { log: args.log } : {}),
      ...(typeof args.timeout === "number" ? { timeout: args.timeout } : {}),
      ...(typeof args.stream === "string" ? { stream: args.stream } : {}),
      ...(args.noResponderRetry ? { noResponderRetry: args.noResponderRetry } : {}),
    };

    return new Trellis<TApi>(
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
      },
    );
  }

async function resolveAuthRequired<TApi extends TrellisAPI>(
  args: TrellisClientConnectArgs<TApi>,
  identity: ClientRuntimeIdentity,
  currentUrl: URL | null,
  deps: ClientConnectDeps,
): Promise<ClientBootstrapResponse> {
  const browserAuth: BrowserClientAuthOptions = args.auth?.mode === "session_key"
    ? {}
    : args.auth ?? {};
  const redirectTo = args.auth?.mode === "session_key"
    ? args.auth.redirectTo
    : currentUrl
    ? resolveRedirectTo(browserAuth, currentUrl)
    : undefined;
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
      oauthInitSig: await identity.oauthInitSig(redirectTo, args.auth.context),
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
    const bootstrapIat = Math.floor(deps.now() / 1_000);
    return await fetchClientBootstrap({
      trellisUrl: normalizeTrellisUrl(args.trellisUrl),
      sessionKey: identity.sessionKey,
      iat: bootstrapIat,
      bootstrapSig: await identity.bootstrapSig(bootstrapIat),
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
    const bootstrapIat = Math.floor(deps.now() / 1_000);
    return await fetchClientBootstrap({
      trellisUrl: normalizeTrellisUrl(args.trellisUrl),
      sessionKey: identity.sessionKey,
      iat: bootstrapIat,
      bootstrapSig: await identity.bootstrapSig(bootstrapIat),
    });
  }

  if (isBrowserRuntime()) {
    window.location.href = loginUrl;
    throw new Error("Redirecting to Trellis login");
  }

  throw new Error("Client authentication required and no auth continuation was provided");
}

export class TrellisClient {
  static connect<TApi extends TrellisAPI>(
    args: TrellisClientConnectArgs<TApi>,
  ): Promise<Trellis<TApi>> {
    return connectClientWithDeps<TApi>(args, defaultDeps);
  }
}
