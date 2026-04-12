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
- workload activation helpers
- browser-facing portal flow state

## Design Rules

- browser and service helpers expose the same proof model through different ergonomics
- session-key seeds remain protected from normal browser code where possible
- browser clients preserve and consume `flowId`; they do not treat fragment-delivered `authToken` as the main UX path
- high-level runtime entrypoints use `trellisUrl`; lower-level auth-only helpers may still use `authUrl`

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

declare function natsConnectSigForBindingToken(
  handle: SessionKeyHandle,
  bindingToken: string,
): Promise<string>;
```

Rules:

- browser session keys SHOULD be stored in IndexedDB via WebCrypto with `extractable=false`
- browser clients MUST preserve `flowId` in redirects and callback URLs
- portal state comes from `GET /auth/flow/:flowId`
- the final browser bind proof is `sign(hash("bind-flow:" + flowId))`
- `bindSession(..., authToken)` still exists as a lower-level path, but `bindFlow(..., flowId)` is the primary browser UX path
- higher-level browser helpers such as `AuthState.signIn(...)` SHOULD hide low-level provider placeholders and redirect URL assembly from app code
- `AuthState.signIn()` with no explicit `redirectTo` SHOULD first use a `redirectTo` query parameter from the current page when present
- if no explicit or query-derived `redirectTo` exists, `AuthState.signIn()` SHOULD fall back to `landingPath` and then to the current browser location
- `context` is an opaque JSON value for app and portal coordination; auth stores it on the browser flow and portals receive it back in `PortalFlowState`
- `context` is not an authorization input and portals MUST tolerate unknown shapes
- login-init proofs SHOULD cover both `redirectTo` and canonicalized `context` so the browser flow cannot be retargeted or recontextualized after signing

## Portal Flow Surface

```ts
type PortalFlowApp = {
  contractId: string;
  contractDigest: string;
  displayName: string;
  description: string;
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
- a portal may later continue as a normal user-authenticated browser app route, but that uses a standard browser app contract rather than service auth

## Portal Helper Surface

Portal authors should not need to reassemble auth-owned flow URLs and `fetch(...)`
calls by hand. The intended public helper split is:

- low-level framework-neutral helpers in `@qlever-llc/trellis`
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
  natsConnectSigForBindingToken(bindingToken: string): Promise<string>;
  natsConnectSigForIat(iat: string): Promise<string>;
  createProof(subject: string, payload: Uint8Array | string): Promise<string>;
  createNatsAuthTokenForService(): Promise<string>;
  natsConnectOptions(): Promise<{ token: string; inboxPrefix: string }>;
};

declare function createAuth(options: CreateAuthOptions): Promise<AuthHandle>;
```

Rules:

- service helpers expose the same proof domains as browser helpers, but return direct values rather than fragment/callback-oriented flows
- service NATS auth tokens use the session-key proof model described in `auth-protocol.md`

## Workload Activation Surface

`@qlever-llc/trellis/auth` also exposes the normal TypeScript integration surface
for activated workloads.

```ts
type WorkloadIdentity = {
  identitySeed: Uint8Array;
  identitySeedBase64url: string;
  publicIdentityKey: string;
  activationKey: Uint8Array;
  activationKeyBase64url: string;
};

declare function deriveWorkloadIdentity(workloadRootSecret: Uint8Array): Promise<WorkloadIdentity>;

declare function buildWorkloadActivationPayload(args: {
  activationKey: Uint8Array | string;
  publicIdentityKey: string;
  nonce: string;
}): Promise<WorkloadActivationPayload>;

declare function encodeWorkloadActivationPayload(
  payload: WorkloadActivationPayload,
): string;

declare function parseWorkloadActivationPayload(
  payload: string,
): WorkloadActivationPayload;

declare function buildWorkloadActivationUrl(args: {
  trellisUrl: string;
  payload: WorkloadActivationPayload | string;
}): string;

declare function signWorkloadWaitRequest(args: {
  publicIdentityKey: string;
  nonce: string;
  identitySeed: Uint8Array | string;
  contractDigest?: string;
  iat?: number;
}): Promise<WorkloadActivationWaitRequest>;

declare function waitForWorkloadActivation(args: {
  trellisUrl: string;
  publicIdentityKey: string;
  nonce: string;
  identitySeed: Uint8Array | string;
  contractDigest: string;
  signal?: AbortSignal;
  pollIntervalMs?: number;
}): Promise<Extract<WaitForWorkloadActivationResponse, { status: "activated" }>>;

declare function deriveWorkloadConfirmationCode(args: {
  activationKey: Uint8Array | string;
  publicIdentityKey: string;
  nonce: string;
}): Promise<string>;

declare function verifyWorkloadConfirmationCode(args: {
  activationKey: Uint8Array | string;
  publicIdentityKey: string;
  nonce: string;
  confirmationCode: string;
}): Promise<boolean>;

declare function getWorkloadConnectInfo(args: {
  trellisUrl: string;
  publicIdentityKey: string;
  identitySeed: Uint8Array | string;
  contractDigest: string;
  iat?: number;
}): Promise<GetWorkloadConnectInfoResponse>;

declare function createWorkloadActivationClient(client: {
  requestOrThrow(method: string, input: unknown, opts?: unknown): Promise<unknown>;
}): {
  activateWorkload(input: { handoffId: string }): Promise<ActivateWorkloadResponse>;
  getWorkloadActivationStatus(input: GetWorkloadActivationStatusRequest): Promise<GetWorkloadActivationStatusResponse>;
  listWorkloadActivations(input?: Record<string, unknown>): Promise<{
    activations: WorkloadActivationRecord[];
  }>;
  revokeWorkloadActivation(input: { instanceId: string }): Promise<{ success: boolean }>;
  getWorkloadConnectInfo(input: GetWorkloadConnectInfoRequest): Promise<GetWorkloadConnectInfoResponse>;
};

type WorkloadActivationController = {
  url: string;
  waitForOnlineApproval(opts?: { signal?: AbortSignal }): Promise<void>;
  acceptConfirmationCode(code: string): Promise<void>;
};

declare class TrellisWorkload {
  static connect<TApi extends TrellisAPI>(args: {
    trellisUrl: string;
    contract: TrellisClientContract<TApi>;
    rootSecret: Uint8Array | string;
    onActivationRequired?(activation: WorkloadActivationController): Promise<void>;
  }): Promise<Trellis<TApi>>;
}
```

Rules:

- activated-workload code SHOULD prefer these helpers over hand-written HKDF,
  HMAC, polling, proof-signing, and connect-info refresh logic
- `buildWorkloadActivationUrl(...)` targets Trellis auth directly; callers do not choose a portal URL because workload portal resolution is deployment-owned server policy
- `waitForWorkloadActivation(...)` owns the polling loop for `POST /auth/workloads/activate/wait`
- if the wait endpoint returns `{ status: "rejected" }`, `waitForWorkloadActivation(...)` SHOULD throw rather than returning a rejected union branch
- `getWorkloadConnectInfo(...)` owns the connect-info proof/signature step for `POST /auth/workloads/connect-info`
- portal and admin apps SHOULD prefer `createWorkloadActivationClient(...)` over
  repeated raw string `requestOrThrow(...)` calls and manual plumbing
- `TrellisWorkload.connect(...)` is the intended high-level runtime entrypoint; it SHOULD behave more like `TrellisService.connect(...)` than a caller-managed activation state machine
- `TrellisWorkload.connect(...)` accepts `rootSecret` directly as bytes or a string form; storage/loading policy belongs to the application, not the helper
- `TrellisWorkload.connect(...)` SHOULD fetch connect info on startup rather than persisting transport details across restarts
- `onActivationRequired(...)` is the hook for local displays, local setup web UIs, CLIs, and other workload-local activation UX
- the helper layer MUST remain a thin wrapper over the canonical wire surfaces
  defined in `auth-api.md` and `workload-activation.md`

## Non-Goals

- redefining HTTP or RPC payload schemas
- deployment/runbook guidance
