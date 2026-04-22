---
title: Auth TypeScript API
description: TypeScript browser and service auth helpers for session keys, flow-owned binds, and service-side NATS auth.
order: 40
---

# Design: Auth TypeScript API

## Prerequisites

- [trellis-auth.md](./trellis-auth.md) - auth architecture and flow model
- [auth-protocol.md](./auth-protocol.md) - proof and connect token rules
- [auth-api.md](./auth-api.md) - public HTTP and RPC endpoints
- [../core/type-system-patterns.md](./../core/type-system-patterns.md) - Result and error-model guidance

## Scope

This document defines the normative TypeScript public API surface across `@qlever-llc/trellis`, `@qlever-llc/trellis/auth`, `@qlever-llc/trellis-svelte`, and the portal/browser clients.

It covers:

- browser session-key helpers
- flow-owned browser bind helpers
- portal-flow helpers for custom portal apps
- service auth helpers
- device activation helpers
- browser-facing portal flow state

## Design Rules

- browser and service helpers expose the same proof model through different ergonomics
- session-key seeds remain protected from normal browser code where possible
- browser login clients preserve and consume `flowId`; they do not treat fragment-delivered `authToken` as the main UX path
- device activation portal clients preserve and consume `flowId`
- high-level runtime entrypoints use `trellisUrl`; lower-level auth-only helpers may still use `authUrl`
- portal redirects in the default model preserve `flowId` but do not need to carry `trellisUrl`; portal and app deployments should already know their target Trellis URL from explicit instance config

## Browser Surface

```ts
type SessionKeyHandle = {
  // opaque WebCrypto-backed handle
};

type AuthConfig = {
  authUrl: string;
};

declare function getOrCreateSessionKey(): Promise<SessionKeyHandle>;
declare function getPublicSessionKey(handle: SessionKeyHandle): string;

type AuthStartResponse =
  | BindSuccessResponse
  | {
      status: "flow_started";
      flowId: string;
      loginUrl: string;
    };

declare function startAuthRequest(args: {
  authUrl: string;
  redirectTo: string;
  contract: Record<string, unknown>;
  context?: unknown;
  handle: SessionKeyHandle;
}): Promise<AuthStartResponse>;

declare function buildLoginUrl(args: {
  authUrl: string;
  redirectTo: string;
  contract: Record<string, unknown>;
  context?: unknown;
  handle: SessionKeyHandle;
}): Promise<string>;

declare function bindFlow(
  config: AuthConfig,
  handle: SessionKeyHandle,
  flowId: string,
): Promise<BindResponse>;

declare function bindSession(
  config: AuthConfig,
  handle: SessionKeyHandle,
  authToken: string,
): Promise<BindResponse>;

type BrowserSignInOptions = {
  redirectTo?: string;
  landingPath?: string;
  context?: unknown;
};

type AuthState = {
  signIn(options?: BrowserSignInOptions): Promise<never>;
};
```

Rules:

- browser session keys SHOULD be stored in IndexedDB via WebCrypto with `extractable=false`
- `startAuthRequest(...)` is the normal login and reauth entry point; it sends
  the contract in a `POST /auth/requests` body and may return `bound`
  immediately when auth can auto-approve the current contract change
- `buildLoginUrl(...)` is a convenience wrapper over `startAuthRequest(...)`
  that expects `flow_started` and returns only the resulting `loginUrl`
- browser clients MUST preserve `flowId` in redirects and callback URLs
- browser and portal redirects in the default model SHOULD rely on deployment-local Trellis URL config rather than echoing `trellisUrl` through auth-owned redirect URLs
- portal state comes from `GET /auth/flow/:flowId`
- the final browser bind proof is `sign(hash("bind-flow:" + flowId))`
- `bindSession(..., authToken)` still exists as a lower-level path, but `bindFlow(..., flowId)` is the primary browser UX path
- higher-level browser helpers such as `AuthState.signIn(...)` SHOULD hide low-level provider placeholders and redirect URL assembly from app code
- `AuthState.signIn()` with no explicit `redirectTo` SHOULD first use a `redirectTo` query parameter from the current page when present
- if no explicit or query-derived `redirectTo` exists, `AuthState.signIn()` SHOULD fall back to `landingPath` and then to the current browser location
- `context` is an opaque JSON value for app and portal coordination; auth stores it on the browser flow and portals receive it back in `PortalFlowState`
- `context` is not an authorization input and portals MUST tolerate unknown shapes
- login-init proofs SHOULD cover both `redirectTo` and canonicalized `context` so the browser flow cannot be retargeted or recontextualized after signing
- browser and session-key runtime reconnect uses freshly generated auth payloads
  carrying `sessionKey + contractDigest + iat + sig`
- browser runtimes SHOULD estimate and store `serverClockOffsetMs` from
  bootstrap `serverNow`
- browser runtimes SHOULD compute `iat` from corrected server-relative time
  rather than trusting local wall clock directly
- on `iat_out_of_range`, browser runtimes SHOULD refresh server time and retry
  once
- if reconnect fails because approval is required, auth is required, or the
  contract changed, callers SHOULD restart the normal auth request flow rather
  than trying to renew a transport token

## Portal Flow Surface

```ts
type PortalFlowApp = {
  contractId: string;
  contractDigest: string;
  displayName: string;
  description: string;
  origin?: string;
  context?: unknown;
};

type PortalFlowState =
  | {
      status: "choose_provider";
      flowId: string;
      app: PortalFlowApp;
      providers: Array<{ id: string; displayName: string }>;
    }
  | {
      status: "approval_required";
      flowId: string;
      user: { origin: string; id: string; name?: string; email?: string };
      approval: PortalFlowApproval;
    }
  | {
      status: "approval_denied";
      flowId: string;
      approval: PortalFlowApproval;
    }
  | {
      status: "insufficient_capabilities";
      flowId: string;
      approval: PortalFlowApproval;
      missingCapabilities: string[];
      userCapabilities: string[];
    }
  | { status: "redirect"; location: string }
  | { status: "expired" };
```

Portal/browser route rules:

- provider continuation URLs are `GET /auth/login/:provider?flowId=...`
- approval submission is `POST /auth/flow/:flowId/approval`
- normal browser bind is `POST /auth/flow/:flowId/bind`
- the portal redirects using the `location` returned by auth-owned flow state
- portal customization data comes from `flowState.app.context`, not from portal-local query conventions
- static SvelteKit portal apps SHOULD read their Trellis URL from build-time public env such as `PUBLIC_TRELLIS_URL`
- a portal may later continue as a normal user-authenticated browser app route, but that uses a standard browser app contract rather than service auth

## Portal Helper Surface

Portal authors should not need to reassemble auth-owned flow URLs and `fetch(...)`
calls by hand. The intended public helper split is:

- low-level framework-neutral browser helpers in `@qlever-llc/trellis/auth`
- browser-only facade helpers in `@qlever-llc/trellis/auth/browser`
- thin Svelte-specific wrappers in `@qlever-llc/trellis-svelte`

```ts
type PortalClientConfig = {
  authUrl: string;
};

declare function portalFlowIdFromUrl(url: URL): string | null;

declare function fetchPortalFlowState(
  config: PortalClientConfig,
  flowId: string,
): Promise<PortalFlowState>;

declare function portalProviderLoginUrl(
  config: PortalClientConfig,
  providerId: string,
  flowId: string,
): string;

declare function submitPortalApproval(
  config: PortalClientConfig,
  flowId: string,
  decision: "approved" | "denied",
): Promise<PortalFlowState>;

declare function portalRedirectLocation(
  state: PortalFlowState | null,
): string | null;

type PortalFlowController = {
  flowId: string | null;
  state: PortalFlowState | null;
  loading: boolean;
  error: string | null;
  load(): Promise<void>;
  providerUrl(providerId: string): string;
  approve(): Promise<void>;
  deny(): Promise<void>;
};

declare function createPortalFlow(args: {
  authUrl: string;
  getUrl(): URL;
}): PortalFlowController;
```

Rules:

- portal helper APIs SHOULD treat `flowId` as browser URL state rather than forcing server-side loader glue
- Svelte portal apps SHOULD be able to remain static SPAs
- high-level portal helpers SHOULD own the low-level fetch URL construction, approval payload shape, and auth redirect handling
- framework-neutral helpers MUST remain usable by non-Svelte custom portals

## Service Surface

```ts
type CreateAuthOptions = {
  sessionKeySeed: string;
};

type AuthHandle = {
  sessionKey: string;
  oauthInitSig(redirectTo: string, context?: unknown): Promise<string>;
  bindSig(authToken: string): Promise<string>;
  natsConnectSigForIat(iat: number): Promise<string>;
  createProof(subject: string, payload: Uint8Array | string): Promise<string>;
  currentIat(): number;
  setServerClockOffsetMs(clockOffsetMs: number): void;
  natsConnectOptions(): Promise<{ authenticator: Authenticator; inboxPrefix: string }>;
};

declare function createAuth(options: CreateAuthOptions): Promise<AuthHandle>;
```

Rules:

- service helpers expose the same proof domains as browser helpers, but return direct values rather than fragment/callback-oriented flows
- service NATS auth tokens use the session-key proof model described in `auth-protocol.md`
- `TrellisClient.connect(...)` owns runtime bootstrap, `serverNow` handling,
  corrected-`iat` retry, and reconnect-safe auth-token generation; bind
  responses no longer carry a reusable runtime binding token

## Device Activation Surface

`@qlever-llc/trellis/auth` also exposes the normal TypeScript integration surface
for activated devices.

```ts
type DeviceIdentity = {
  identitySeed: Uint8Array;
  identitySeedBase64url: string;
  publicIdentityKey: string;
  activationKey: Uint8Array;
  activationKeyBase64url: string;
};

declare function deriveDeviceIdentity(deviceRootSecret: Uint8Array): Promise<DeviceIdentity>;

declare function buildDeviceActivationPayload(args: {
  activationKey: Uint8Array | string;
  publicIdentityKey: string;
  nonce: string;
}): Promise<DeviceActivationPayload>;

declare function encodeDeviceActivationPayload(
  payload: DeviceActivationPayload,
): string;

declare function parseDeviceActivationPayload(
  payload: string,
): DeviceActivationPayload;

declare function buildDeviceActivationUrl(args: {
  trellisUrl: string;
  payload: DeviceActivationPayload | string;
}): string;

declare function signDeviceWaitRequest(args: {
  publicIdentityKey: string;
  nonce: string;
  identitySeed: Uint8Array | string;
  contractDigest?: string;
  iat?: number;
}): Promise<DeviceActivationWaitRequest>;

declare function waitForDeviceActivation(args: {
  trellisUrl: string;
  publicIdentityKey: string;
  nonce: string;
  identitySeed: Uint8Array | string;
  contractDigest: string;
  signal?: AbortSignal;
  pollIntervalMs?: number;
}): Promise<Extract<WaitForDeviceActivationResponse, { status: "activated" }>>;

declare function deriveDeviceConfirmationCode(args: {
  activationKey: Uint8Array | string;
  publicIdentityKey: string;
  nonce: string;
}): Promise<string>;

declare function verifyDeviceConfirmationCode(args: {
  activationKey: Uint8Array | string;
  publicIdentityKey: string;
  nonce: string;
  confirmationCode: string;
}): Promise<boolean>;

declare function getDeviceConnectInfo(args: {
  trellisUrl: string;
  publicIdentityKey: string;
  identitySeed: Uint8Array | string;
  contractDigest: string;
  iat?: number;
}): Promise<GetDeviceConnectInfoResponse>;

type AuthActivateDeviceProgress = {
  status: "pending_review";
  reviewId: string;
  instanceId: string;
  profileId: string;
  requestedAt: string;
};

type AuthActivateDeviceOutput =
  | {
      status: "activated";
      instanceId: string;
      profileId: string;
      activatedAt: string;
      confirmationCode?: string;
    }
  | {
      status: "rejected";
      reason?: string;
    };

type AuthActivateDeviceOperation = {
  watch(): AsyncResult<
    AsyncIterable<OperationEvent<AuthActivateDeviceProgress, AuthActivateDeviceOutput>>,
    BaseError
  >;
  wait(): AsyncResult<
    TerminalOperation<AuthActivateDeviceProgress, AuthActivateDeviceOutput>,
    BaseError
  >;
};

declare function createDeviceActivationClient(client: {
  request(method: string, input: unknown, opts?: unknown): AsyncResult<unknown, BaseError>;
  operation(method: "Auth.ActivateDevice"): {
    input(input: { flowId: string }): {
      start(): AsyncResult<AuthActivateDeviceOperation, BaseError>;
    };
  };
}): {
  activateDevice(input: { flowId: string }): Promise<AuthActivateDeviceOperation>;
  listDeviceActivations(input?: Record<string, unknown>): Promise<{
    activations: DeviceActivationRecord[];
  }>;
  revokeDeviceActivation(input: { instanceId: string }): Promise<{ success: boolean }>;
  getDeviceConnectInfo(input: GetDeviceConnectInfoRequest): Promise<GetDeviceConnectInfoResponse>;
};

declare const TrellisDevice: {
  connect<TApi extends TrellisAPI>(args: {
    trellisUrl: string;
    contract: TrellisClientContract<TApi>;
    rootSecret: Uint8Array | string;
    log?: LoggerLike | false;
  }): AsyncResult<TrellisDeviceConnection<TApi>, TransportError | UnexpectedError>;
};
```

```ts
declare module "@qlever-llc/trellis/device/deno" {
type TrellisDeviceActivatedStatus = {
  status: "activated";
};

type TrellisDeviceNotReadyStatus = {
  status: "not_ready";
  reason: string;
};

type TrellisDeviceActivationRequiredStatus = {
  status: "activation_required";
  activationUrl: string;
  waitForOnlineApproval(opts?: { signal?: AbortSignal }): Promise<TrellisDeviceActivatedStatus>;
  acceptConfirmationCode(code: string): Promise<TrellisDeviceActivatedStatus>;
};

type TrellisDeviceActivationStatus =
  | TrellisDeviceActivatedStatus
  | TrellisDeviceNotReadyStatus
  | TrellisDeviceActivationRequiredStatus;

declare function checkDeviceActivation<TApi extends TrellisAPI>(args: {
  trellisUrl: string;
  contract: TrellisClientContract<TApi>;
  rootSecret: Uint8Array | string;
  stateDir?: string;
  statePath?: string;
}): Promise<TrellisDeviceActivationStatus>;
}
```

Rules:

- activated-device code SHOULD prefer these helpers over hand-written HKDF,
  HMAC, polling, proof-signing, and connect-info refresh logic
- `buildDeviceActivationUrl(...)` targets Trellis auth directly; callers do not choose a portal URL because device portal resolution is deployment-owned server policy
- `waitForDeviceActivation(...)` owns the polling loop for `POST /auth/devices/activate/wait`
- if the wait endpoint returns `{ status: "rejected" }`, `waitForDeviceActivation(...)` SHOULD throw rather than returning a rejected union branch
- `getDeviceConnectInfo(...)` owns the connect-info proof/signature step for `POST /auth/devices/connect-info`
- portal and admin apps SHOULD prefer `createDeviceActivationClient(...)` over
  repeated raw string `request(...).orThrow()` calls and manual plumbing
- authenticated portal-side activation starts the `Auth.ActivateDevice`
  operation; review state is observed through operation `progress`, `watch()`,
  and `wait()` rather than a separate status RPC
- `TrellisDevice.connect(...)` is a pure runtime entrypoint; it does not accept
  `onActivationRequired(...)` and does not start activation on the caller's
  behalf
- `TrellisDevice.connect(...)` accepts `rootSecret` directly as bytes or a string form; storage/loading policy belongs to the application, not the helper
- `TrellisDevice.connect(...)` accepts `log?: LoggerLike | false` using the same convention as service runtime helpers; device NATS lifecycle logs should emit distinct messages for disconnect, reconnect attempts, reconnect success, stale connections, and connection errors
- `TrellisDevice.connect(...)` SHOULD fetch connect info on startup rather than persisting stale connect info across restarts
- `@qlever-llc/trellis/device/deno` exposes the high-level activation-status helper for Deno device runtimes; callers check activation status first and then call plain `TrellisDevice.connect(...)`
- `checkDeviceActivation(...)` returns `activated`, `activation_required`, or `not_ready`; callers do not manage serialized local activation state directly
- Deno file-backed activation persistence is internal to `checkDeviceActivation(...)`; callers work only with the returned status plus activation actions, with optional `stateDir` and `statePath` overrides when they need to control the storage location
- offline confirmation through `acceptConfirmationCode(...)` transitions the Deno helper to later `activated` status; callers still connect with a separate `TrellisDevice.connect(...)` call
- when the connected device contract uses the shared `Health.Heartbeat` event,
  `TrellisDevice.connect(...)` publishes baseline heartbeats automatically and
  exposes a `health` helper for adding callback-based heartbeat metadata
- no migration or backward-compatibility helper is documented for the removed
  root activation-session surface or the earlier callback-driven activation flow
- the helper layer MUST remain a thin wrapper over the canonical wire surfaces
  defined in `auth-api.md` and `device-activation.md`

## Non-Goals

- redefining HTTP or RPC payload schemas
- deployment/runbook guidance
