---
title: Rust Auth Service Ownership
description: TypeScript-to-Rust auth responsibility inventory and permanent cutover boundaries.
order: 19
---

# Design: Rust Auth Service Ownership

## Purpose

The Rust `platform` subsystem is the sole runtime owner of external auth,
bootstrap, session, connection, and NATS Auth Callout behavior. The TypeScript
implementation remains only where this inventory identifies client or portal
source, generated vocabulary, or behavioral reference tests. It does not read,
write, proxy, validate, or fall back for Rust-owned auth state.

This inventory records the removed legacy implementation because product
behavior is preserved without preserving its storage or authority model. The
TypeScript runtime source and image were deleted after the cutover; the listed
paths are historical. The Rust service extends the accepted records and
materialization in `rust-authorization-state.md`; it does not introduce a
parallel auth subsystem.

Disposition meanings are:

- **migrate**: preserve the product behavior on Rust-owned state;
- **replace with clean Rust model**: preserve behavior while retiring the legacy
  storage or authority representation;
- **keep only as test reference**: no supported runtime registration remains;
- **intentionally retire**: the behavior or surface is not part of the Rust API;
- **defer**: the responsibility remains outside this cutover and cannot affect
  current authority.

## Ownership Inventory

Legacy paths were relative to the removed `ts/services/trellis` tree unless
stated otherwise.

| Responsibility                   | Current TypeScript module/file                                                                                                                                          | Current storage, KV, or subject                                                                | Current route, RPC, operation, or event                                                                   | Required product behavior                                                                                                                                                                                                    | Rust target                                                                                            | Disposition                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Browser auth request             | `auth/http/start_request.ts`, `auth/http/browser_routes.ts`, `auth/http/route_context.ts`                                                                               | `contracts`; `trellis_browser_flows`; `trellis_pending_auth`                                   | `POST /auth/requests`                                                                                     | Validate proof, origin, and exact artifacts; bind directly only when current authority covers exact needs; otherwise create a portal-selected flow                                                                           | `platform::auth::http::browser::request::start_auth` over participant, session, and authority services | replace with clean Rust model            |
| OAuth state and callback         | `auth/http/browser_routes.ts`, `auth/http/account_flow_routes.ts`, `auth/oauth.ts`, `auth/providers/*`                                                                  | `trellis_oauth_states`; secure cookie; provider configuration                                  | Provider login/callback and account-flow provider login                                                   | Authorization code with PKCE, provider-bound CAS state consumption, safe callback validation, stable principal linking, and no token persistence                                                                             | `platform::auth::http::browser::oidc::oidc_callback` and account-flow service                          | migrate                                  |
| Local login                      | `auth/http/browser_routes.ts`, `auth/local_credentials/*`                                                                                                               | `user_identities`, `users`, `local_credentials`; browser-flow KV                               | `POST /auth/login/local`                                                                                  | Normalize username, use uniform failures, enforce lockout/account state, upgrade hash profile, and continue the consent flow                                                                                                 | `platform::auth::account::{local_credentials,users}` and browser-flow service                          | migrate                                  |
| Local registration               | `auth/http/browser_routes.ts`, `auth/storage/portals.ts`                                                                                                                | Atomic `users`, `user_identities`, and `local_credentials` writes                              | `POST /auth/flow/:flowId/register/local`                                                                  | Permit only under portal policy; atomically create stable principal, profile, local identity, and credential                                                                                                                 | account and browser domain services                                                                    | replace with clean Rust model            |
| Bootstrap administrator          | `auth/account_flows/bootstrap.ts`, `bootstrap/register.ts`                                                                                                              | `users`, `user_identities`, `account_flows`                                                    | Structured startup output and built-in account-flow URL                                                   | Maintain one durable bootstrap principal and permanent canonical authority; one expiring single-use flow creates or edits its local username and password without selecting among additional admins                          | `platform::auth::account::flows`                                                                       | replace with clean Rust model            |
| Durable account flows            | `auth/session/account_flows.ts`, `auth/account_flows/*`, `auth/http/account_flow_routes.ts`                                                                             | Hashed tokens in `account_flows`                                                               | Account-flow HTTP routes; `Auth.Users.IdentityLink.Create`, `Auth.Users.PasswordReset.Create`             | Target-bound, expiring, single-consumption admin-account, identity-link, and ordinary password-reset workflows with atomic completion                                                                                        | `platform::auth::account::flows`                                                                       | migrate                                  |
| User account and profile         | `auth/session/users.ts`, `auth/storage/sessions_users_approvals.ts`                                                                                                     | `users`; profile observations duplicated in identities and sessions                            | `Auth.Users.Resolve/List/Get/Create/Update`                                                               | Stable user principal plus non-authority human metadata, bounded administration, lifecycle checks, and last-admin safety                                                                                                     | principal repository plus `platform::auth::account::users`                                             | replace with clean Rust model            |
| Provider identities              | `auth/identity.ts`, `auth/account_flows/oauth_completion.ts`, `auth/session/users.ts`                                                                                   | Unique `(provider, subject)` in `user_identities`                                              | `Auth.Users.IdentityLink.Create`, `Auth.UserIdentities.List/Unlink`                                       | Provider subjects link to stable user principals, cannot move between users, and keep observations separate from account profile authority                                                                                   | existing provider-identity repository plus account identity-link service                               | migrate                                  |
| Local credentials                | `auth/local_credentials/passwords.ts`, `auth/storage/sessions_users_approvals.ts`                                                                                       | `local_credentials`                                                                            | Login, password change/reset, first-admin completion                                                      | Argon2id only, versioned bounded profile, library verification, no plaintext, atomic reset, and post-login profile upgrade                                                                                                   | `platform::auth::account::local_credentials`                                                           | replace with clean Rust model            |
| Login portals                    | `auth/storage/portals.ts`, `auth/admin/portals_rpc.ts`                                                                                                                  | Portal and login-settings/default-policy tables                                                | `Auth.Portals.List/Get/Put/Remove`, `Auth.Portals.LoginSettings.Get/Update`                               | Preserve non-removable built-in portal, disabled state, provider/local-registration policy, and required-nullable settings                                                                                                   | `platform::auth::browser::portals`                                                                     | migrate                                  |
| Portal routing                   | `auth/storage/portals.ts`, `auth/http/portal_flow.ts`                                                                                                                   | Login and deployment portal routes                                                             | Portal route RPCs; browser/activation selection                                                           | Deterministic participant/origin/deployment selection with priority and built-in fallback; routes never confer authority                                                                                                     | portal repository and selector                                                                         | replace with clean Rust model            |
| Built-in browser assets          | Unified SvelteKit source under `web/`; distinct Portal and Console contracts under `web/contracts/`                                                                     | Compiled static output                                                                         | `/login/*`, `/assets/login/*`, `/console/*`                                                               | Preserve browser apps without a production filesystem mount; allow shared or per-surface directory and reverse-proxy sources                                                                                                 | Rust embedded-asset and reverse-proxy HTTP adapter; Svelte remains source                              | migrate                                  |
| Identity consent and authority   | `auth/approval/*`, `auth/http/support.ts`, `auth/session/bind.ts`, `auth/storage/sessions_users_approvals.ts`                                                           | `identity_authorities`, `identity_grants`, capability assignments, serialized session evidence | Flow approval/bind; legacy identity-grant RPCs                                                            | Decide exact needs digest, `GrantSet`, capabilities, and consent metadata; update one current identity authority and reconcile before bind                                                                                   | existing authority/materialization services plus immutable proposals/decisions                         | replace with clean Rust model            |
| Sessions                         | `auth/session/*`, `auth/http/session_logout_routes.ts`, `auth/storage/sessions_users_approvals.ts`                                                                      | `sessions` columns plus serialized session JSON                                                | Session RPCs; HTTP logout                                                                                 | One creation/bind/revoke path for all principal kinds, stable ID, exact participant evidence, server-owned inbox, bounded list, durable revocation before kick, safe return validation, and provider logout URL construction | `platform::auth::application::sessions::AuthService` plus `SessionRepository`                          | replace with clean Rust model            |
| Session reconnect                | Client auth helpers                                                                                                                                                     | Sessions, current authority, signed contexts, and trust registry                               | proof-bound `POST /auth/context/refresh` and NATS reconnect                                               | Verify the session-key proof, issue a fresh context from current authority, and reconnect with a minimal `contextDigest` token plus NATS challenge proof                                                                     | context issuance and Auth Callout                                                                      | complete                                 |
| Service bootstrap                | `auth/bootstrap/service.ts`, `auth/http/bootstrap_routes.ts`                                                                                                            | Deployment/instance, contract, plan, materialization, offer, and binding tables                | `POST /bootstrap/service`                                                                                 | Verify provisioned identity, validate exact participant, plan authority, reconcile dependencies/resources, create a distinct session, and return stable states                                                               | `platform::auth::bootstrap::service`                                                                   | replace with clean Rust model            |
| Device bootstrap                 | historical `auth/bootstrap/device.ts`, `auth/device_activation/http.ts`                                                                                                 | Rust device/deployment/activation, contract, authority, and materialization tables             | `POST /bootstrap/device`                                                                                  | Verify proof-bound identity and exact participant/deployment evidence; return `activation_pending` without credentials or ready session/context/NATS evidence after current activation policy is satisfied                   | `platform::auth::http::bootstrap::device`                                                              | complete                                 |
| Device activation flow           | historical `auth/device_activation/http.ts`, `auth/device_activation/operation.ts`; portal routes remain under `web/src/routes/login`                                   | Rust provisioning, activation-review, delegation, operation, and outbox tables                 | `Auth.DeviceUserAuthorities.Resolve`, review/list/decision/revoke RPCs; repeated `POST /bootstrap/device` | Keep user delegation independent from required-nullable deployment `reviewMode`; only privileged `Reviews.Decide` resolves required administrative review; repeated fresh proof-bound bootstrap observes readiness           | `platform::auth_operation` plus Auth application/repository services                                   | complete                                 |
| Service deployments              | `auth/admin/service_rpc.ts`, `auth/storage/services.ts`                                                                                                                 | `service_deployments`, legacy deployment authority                                             | `Auth.Deployments.*` with `kind=service`                                                                  | Manage lifecycle; update eligibility, reconcile, and revoke runtime access after commit                                                                                                                                      | deployment repository and unified admin domain service                                                 | replace with clean Rust model            |
| Service instances                | `auth/admin/service_rpc.ts`, `auth/storage/services.ts`                                                                                                                 | `service_instances`; sessions and connection KV                                                | `Auth.ServiceInstances.*`                                                                                 | Provision public identity, reject reassignment, manage lifecycle, and revoke sessions/connections after commit                                                                                                               | instance, principal, session, and provisioning repositories                                            | replace with clean Rust model            |
| Device deployments               | `auth/admin/rpc.ts`, `auth/storage/devices_activation.ts`                                                                                                               | `device_deployments`, legacy authority and portal route                                        | `Auth.Deployments.*` with `kind=device`                                                                   | Manage eligibility and review/delegation policy without treating policy as authority                                                                                                                                         | deployment repository and unified admin domain service                                                 | replace with clean Rust model            |
| Device instances                 | `auth/admin/rpc.ts`, `auth/storage/devices_activation.ts`                                                                                                               | `device_instances`; overlapping activation state                                               | `Auth.Devices.Provision/List/Enable/Disable/Remove`                                                       | Bind immutable identity to deployment/principal, keep instance/device lifecycle separate, and revoke runtime access after commit                                                                                             | instance, device, principal, and provisioning repositories                                             | replace with clean Rust model            |
| Device provisioning secrets      | `auth/admin/rpc.ts`, `auth/storage/devices_activation.ts`                                                                                                               | `device_provisioning_secrets`                                                                  | Device provision and first identity binding                                                               | Return raw secret once, store only a hash, consume atomically, and never reactivate revoked identity                                                                                                                         | `platform::auth::deployment::device_provisioning`                                                      | replace with clean Rust model            |
| Device activation reviews        | `auth/admin/rpc.ts`, `auth/device_activation/operation.ts`                                                                                                              | `device_activation_reviews`; operation state                                                   | Review RPCs and events                                                                                    | Keep administrative approval distinct from user delegation; record idempotent decision and complete operation                                                                                                                | activation proposal/decision repository and operation handler                                          | replace with clean Rust model            |
| Device user delegation           | `auth/device_activation/*`, `auth/admin/rpc.ts`                                                                                                                         | `device_activations`; sessions and connection KV                                               | Device-authority list/revoke/resolve and events                                                           | Deployment-scoped required/active/revoked delegation with expiry; revocation commits before kick                                                                                                                             | existing delegation repository plus activation service                                                 | replace with clean Rust model            |
| Deployment authority proposals   | `auth/contract_proposal_analysis.ts`, `auth/deployment_authority_plan.ts`, `auth/admin/authority_rpc.ts`                                                                | `deployment_authority_plans` and legacy authority children                                     | Deployment-authority plan/accept/reject/reconcile RPCs                                                    | Derive one stable lineage per deployment + participant; reuse only equivalent pending plans, preserve terminal history, expose initial plans before acceptance, and atomically decide desired authority                      | `platform::auth::authority::proposals` plus authority repository                                       | replace with clean Rust model            |
| Implementation offers            | `auth/bootstrap/service.ts`, `catalog/runtime.ts`, callout disconnect handling                                                                                          | `implementation_offers`; connection liveness                                                   | Indirect bootstrap/catalog behavior                                                                       | Preserve provider availability and exact API evidence without allowing offers to mutate desired authority                                                                                                                    | dependency evidence plus operational provider presence                                                 | replace with clean Rust model            |
| Dependency selection             | `catalog/uses.ts`, `catalog/runtime.ts`, proposal analysis                                                                                                              | Implicit contract/offer lookup                                                                 | Planning, bootstrap, catalog status                                                                       | Resolve exact required/optional API digests and provider evidence at authority scope                                                                                                                                         | participant resolution and dependency-evidence repositories                                            | replace with clean Rust model            |
| Resource binding                 | `catalog/resources.ts`, authority reconciler, `catalog/rpc.ts`                                                                                                          | Physical JetStream resources and binding JSON                                                  | Reconciliation, internal bindings RPC, bootstrap                                                          | Provision through an adapter, persist structured evidence, expose exact bindings, and never derive authority from physical names                                                                                             | resource provider, evidence repository, runtime-binding projection                                     | replace with clean Rust model            |
| NATS Auth Callout                | Rust-owned runtime                                                                                                                                                      | `$SYS.REQ.USER.AUTH`; local context/trust cache; signing/XKey material                         | NATS auth request/response JWT                                                                            | Verify the NATS challenge and digest-selected signed context locally, compile exact permissions, write exact connection presence, recheck revocation, issue a bounded JWT, seal the response, and fail safely                | `platform::auth::callout` under `platform.owner`                                                       | complete                                 |
| Transport permission compilation | `auth/callout/permissions.ts`, legacy materialization/catalog helpers                                                                                                   | Persisted delegated subjects and materialized ACLs                                             | Embedded in callout JWT                                                                                   | Project exact grants, descriptors, bindings, inbox, and narrow built-ins; subjects never create grants                                                                                                                       | pure `platform::auth::callout::permissions`                                                            | replace with clean Rust model            |
| Connection presence              | Rust-owned runtime                                                                                                                                                      | `trellis_connections` keyed by `connectionId`; disconnect advisories                           | `Auth.Connections.List`; connection events                                                                | Track every physical connection as bounded operational presence; context revocation installs a local admission fence and kicks every exact connection; disconnect removes only the matching connection                       | `platform::auth::sessions::connections` KV repository and watcher                                      | complete                                 |
| Session revoke and kick          | `auth/session/revoke*.ts`, `auth/callout/kick.ts`, `auth/session/rpc.ts`                                                                                                | Sessions; connection KV; NATS system kick                                                      | Session revoke/logout, connection kick, events                                                            | Commit revocation first, then use one exact bounded kick path; kick failure cannot restore authority                                                                                                                         | session/connection services and outbox                                                                 | migrate                                  |
| Local request validation         | Provider-local Rust verifier and TypeScript/WASM provider cache                                                                                                         | Signed contexts, current manifest, revocation watch state                                      | Generated descriptor route                                                                                | Verify actual context digest, subject, reply, request time/id, raw payload, exact permission atom, and capabilities without control-plane I/O                                                                                | shared local request verifier                                                                          | complete                                 |
| Local event validation           | Consumer/Event Log local verifier                                                                                                                                       | Retained signed context, exact historical manifest, revocation timestamp                       | Receiver-owned generated event descriptor                                                                 | Verify event id/time/subject/raw payload and historical context window; any context revocation invalidates all of its event proofs; produce typed publisher projection locally                                               | shared local event verifier                                                                            | complete                                 |
| Auth transition events           | `auth/callout/callout.ts`, `auth/registration/session.ts`, `auth/session/revoke.ts`, `auth/device_activation/operation.ts`, `auth/admin/rpc.ts`, reconciliation storage | Direct session, connection, and device events; authority reconciliation history                | Current Auth session/connection/device events and internal authority history                              | Couple durable changes, including authority transitions, to deterministic outbox rows; publish at least once and emit no secrets or no-op duplicates                                                                         | existing authorization outbox plus auth event publisher                                                | replace with clean Rust model            |
| Auth API contract source         | `contracts/trellis_auth.ts` and generated auth SDKs                                                                                                                     | Current native `trellis.api.v1` and `trellis.participant.v1` manifest                          | Current Auth RPC/operation/event vocabulary                                                               | Replace the definition with source-owned `trellis.api.v1` and `trellis.participant.v1` artifacts; regenerate Rust and TypeScript SDKs without legacy aliases or compatibility artifacts                                      | source artifacts and generator pipeline                                                                | legacy source retired after regeneration |
| Capability catalog               | `auth/session/users.ts`, `auth/registration/approval_users.ts`                                                                                                          | `deployment_authority_capability_definitions` and built-in definitions                         | `Auth.Capabilities.List`                                                                                  | Expose a read-only catalog derived from installed API artifacts and built-in platform capability definitions; it is not mutable authority                                                                                    | generated artifact catalog view                                                                        | migrate                                  |
| Capability groups                | `auth/capability_groups.ts`, user and portal policy helpers                                                                                                             | Capability groups and assignments                                                              | `Auth.CapabilityGroups.*`                                                                                 | Retain as recursive administrative macros; expand only proposal-defined capabilities and never persist group objects in runtime authority                                                                                    | typed SQLite policy plus portal-policy resolver                                                        | migrated                                 |
| Trusted portal policy            | Rust-owned browser and policy services                                                                                                                                  | Portal grant policy and authority-binding provenance                                           | `Auth.Portals.GrantOverrides.*`                                                                           | Key by exact portal + participant, select proposal-defined concrete capabilities through provider-scoped verified roles, and commit through ordinary identity authority with separate reconciliation provenance              | typed portal policy/binding repositories and bounded reconciler                                        | complete                                 |
| Catalog issue resolution         | Catalog modules and auth registration                                                                                                                                   | Catalog issue projection                                                                       | `Auth.CatalogIssues.Resolve`                                                                              | Catalog issues remain catalog/platform responsibility                                                                                                                                                                        | catalog surface                                                                                        | intentionally retire from auth           |
| Event-consumer listing           | Catalog/resource registration                                                                                                                                           | Participant resource bindings                                                                  | `Auth.EventConsumers.List`                                                                                | Event-consumer bindings remain participant/resource management                                                                                                                                                               | resource/catalog surface                                                                               | intentionally retire from auth           |
| Contexts and trust               | Rust issuer and TypeScript/Rust client caches                                                                                                                           | SQLite trust/context state and immutable digest-keyed KV records                               | proof-bound `/auth/context/refresh`; trust discovery                                                      | Issue signed contexts, publish immutable trust records, refresh from current authority, and enforce revocation through initialized local caches                                                                              | authorization-context issuer, registry, and client caches                                              | complete                                 |
| Ordinary local validation        | Rust verifier and TypeScript/WASM provider cache                                                                                                                        | Signed context and local trust/revocation cache                                                | Generated request and event descriptors                                                                   | Verify context, proof, exact surface, payload, and permission locally without per-request policy, group, role, Auth RPC, or SQLite lookup                                                                                    | shared local request/event verification                                                                | complete                                 |

## Runtime Cutover Rules

The Rust service uses one composition root after `platform.owner` acquisition:

```text
platform storage and migrations
  -> authorization/account/provisioning repositories
  -> shared domain services
  -> startup reconciliation and first-admin check
  -> auth flow and connection KV resources
  -> Auth Callout, RPC/operation/event, and HTTP adapters
  -> platform readiness
```

HTTP, RPC, operation, Auth Callout, and background paths call the same domain
services. Handlers do not execute SQL directly. Session creation, authority
acceptance, and connection kick each have one mutation path.

The TypeScript control-plane auth registration is disabled in supported
`platform` and `all` deployments. There is no shared database, dual write,
read-through, proxy, fallback, or concurrent callout responder.

## Implementation Architecture

### Source Artifacts And Generation

The Rust runtime crate owns two authored JSON inputs:

```text
rust/crates/runtime/trellis.api.json
rust/crates/runtime/trellis.participant.json
```

The first is the `trellis.auth@v1` `trellis.api.v1` artifact. The second is the
Rust auth runtime's `trellis.participant.v1` artifact. Repository preparation
discovers, lints, parses, and generates directly from these formats. It does not
convert them to or from native `trellis.api.v1` and `trellis.participant.v1`.

The API artifact owns public RPCs, operations, events, schemas, errors,
capability definitions, and consent metadata. Transitional request and event
validators are `internal: true` RPC definitions. The generator emits their typed
vocabulary only to private runtime adapters. They are absent from public Auth
clients and participant facades. Legacy native `trellis.api.v1` and
`trellis.participant.v1` Auth outputs are deleted rather than retained or
aliased.

The participant artifact implements the exact Auth API digest and declares the
runtime's built-in API uses, private consumers, queues, state, and resources.
Generated Rust and TypeScript artifacts derive from the same two authored files.
The legacy TypeScript Auth contract is not an alias or compatibility source.

Trellis-owned API artifacts are permanent entries in the platform catalog. An
exact built-in API ID and digest does not require deployed-service discovery
evidence when materializing authority. Participant needs and accepted grants
still determine which operations and capabilities a session receives. Runtime
startup and readiness own the availability of the subsystem implementing each
built-in API; service discovery remains authoritative only for deployed
service-owned APIs.

### Service Composition

`platform::auth` remains the only auth subsystem. It contains the accepted
authorization state and adds cohesive account, workflow, browser, bootstrap,
session, callout, HTTP, and RPC modules as their behavior is implemented. File
layout follows actual cohesion rather than pre-creating one file per planned
operation.

One cloneable `AuthService` composes:

- the existing authorization store and materialization service;
- account, workflow, and provisioning repository ports implemented by the same
  in-memory and SQLite stores;
- exact API and participant artifact lookup;
- short-lived flow, replay, and connection-presence KV ports;
- configured OAuth/OIDC provider clients;
- resource provisioning and binding resolution;
- NATS system connection control and canonical event publication.

HTTP, RPC, operation, callout, and background adapters call this service. They
do not execute SQL, reconstruct authority, or call one another over public
transport merely because they share a process.

### Durable Storage And Transactions

`V1002__auth_service_cutover.sql` adds companion records around the accepted
V1001 authority core. V1001 principals, provider links, participant bindings,
sessions, desired authority, deployments, instances, devices, delegations,
dependency/resource evidence, materialization, and authorization transition
outbox remain canonical.

V1002 adds only the missing product records:

- user profiles and local credentials;
- login portals, login settings, and portal routes;
- hashed single-use account flows;
- immutable authority proposal payloads and decision records;
- service and device provisioned identity metadata;
- hashed one-time device provisioning secrets;
- device activation review workflow records;
- bounded idempotency results for state-changing proof requests;
- one post-commit action outbox for normal events and deterministic connection
  kick intents not represented by the existing authorization transition outbox.

V1002 also normalizes accepted M7 deployment-authority keys to the deterministic
deployment + participant lineage and updates authority-keyed evidence and
materialization rows in the same migration. Proposal rows store normalized
deployment identity. Their semantic digest is unique only while pending;
terminal rows remain immutable history and may coexist with a later proposal of
the same semantics.

Repositories expose aggregate transactions rather than table-shaped CRUD. Local
registration, account-flow completion, browser bind/session creation, authority
acceptance, provisioning-secret consumption, activation decision, and session
revocation plus post-commit actions each have one atomic repository operation.
Every state-changing proof transaction atomically claims a key scoped by proof
purpose, authenticated principal or key, and request ID; compares the exact
request digest; performs the mutation; and stores the replayable result. Session
revocation inserts deterministic event and kick actions in that same
transaction. A critical dispatcher retries kick actions idempotently after
restart; kick failure cannot restore or roll back revocation.

Required-nullable values are required JSON members and SQL `NULL` when absent.

### Bootstrap And Connect Proofs

`trellis-protocol` owns explicit, length-prefixed proofs for user auth request
initiation and service/device bootstrap. Each proof binds its fixed domain and
version, canonical key identity, request ID, issued-at time, exact operation
fields, and canonical request digest. Service and device bootstrap bind both the
provisioned identity and newly generated session key.

Bootstrap returns a deny-all Auth-account JWT whose subject is the session key
encoded as a canonical NATS User NKey. Rust and TypeScript authenticators use
the session private key for the standard NATS challenge signature and send a
minimal auth token:

```json
{ "format": "trellis.nats-connect-token.v1", "contextDigest": "..." }
```

The callout validates the bootstrap JWT and standard NATS challenge, loads the
digest-selected signed context, and requires the generated NATS User NKey to
encode the same Ed25519 public key as `context.sessionKey`. There is no second
Trellis connect signature or generic connection replay state.

State-changing HTTP requests retain bounded durable idempotency results so a
matching request ID and digest can return the committed result after restart.
The claim and result are part of the business transaction, never a separate
best-effort write. The same ID with changed content fails.

Browser and OAuth scratch state remains in Trellis KV. A mutation-owning flow
step first CAS-claims the KV record with a claim ID and request digest, then
commits the same claim, mutation, and result in SQLite, then marks the KV record
completed or consumed. A retry observing a claim checks the durable result and
either completes the KV transition or safely resumes an uncommitted claim. It
never repeats a committed mutation.

OAuth state distinguishes `active`, `exchange_started`, `restart_required`, and
`completed`. Callback handling CAS-transitions to `exchange_started` before the
provider exchange. If the normalized provider identity and linked-account result
commit, retry completes from that durable result. If exchange began but no
durable result exists after interruption or unknown external outcome, the flow
becomes `restart_required` and requires a fresh provider authorization. Provider
codes and tokens are never replayed or persisted.

### HTTP Runtime

Auth routes merge into the existing Axum listener. The platform does not start a
second HTTP server. `platform::start` returns a platform startup result
containing its `SubsystemHandle` and an erased-state `Router<()>`. Subsystem
startup retains that platform-specific result instead of erasing it into the
ordinary handle list. The supervisor merges the platform router with health
routes before it starts the sole listener, only after all selected subsystems
are ready.

The platform owner exposes an acceptance/fence guard shared by the router and
store. V1002 stores the current owner ID and immutable NATS lease acquisition
fence in one singleton platform row. A successor replaces that row before it
starts auth work. Every auth write uses a bounded immediate SQLite transaction,
checks the expected persisted generation at start and immediately before commit,
and checks a conservative in-memory lease-valid-until deadline at both points.
Transactions refuse to start without enough remaining lease time for the fixed
maximum transaction duration and roll back if that budget is exhausted.

On ownership loss, the supervisor closes the guard, aborts the HTTP listener and
in-flight auth work without graceful mutation drain, aborts platform tasks, and
terminates the process. Graceful bounded HTTP drain applies only to ordinary
signal shutdown while ownership remains held. The persisted generation prevents
a stale process from committing after a successor has fenced the shared store;
the lease deadline prevents commits after the stale owner's last defensible
ownership window even before a successor opens the database.

The implementation uses established libraries for security-sensitive protocol
work:

- `oauth2` and `openidconnect` for OAuth/OIDC authorization code, PKCE,
  discovery, token, and ID-token behavior;
- RustCrypto `argon2` for Argon2id credentials and profile verification;
- `tower-http` for standard HTTP middleware;
- Axum body limits and an Axum-compatible governor middleware for bounded
  source-keyed rate limiting.

Origin, redirect, cookie, and flow-local checks remain explicit auth-domain
rules because generic CORS middleware cannot establish flow ownership. Public
errors contain no credentials, provider tokens, proofs, or internal storage
details.

### NATS Runtime

After `platform.owner` acquisition, platform startup opens the existing
Trellis-account client plus dedicated auth-account and system-account clients.
The Auth-account client owns only callout subscription and replies. The system
client owns only connection advisories and exact kick requests. The Trellis
client owns platform RPC/event subjects and Trellis KV resources.

Startup loads the configured callout issuer, target, and XKey seeds and reuses
the repository's established `nats-jwt-rs` and XKey-capable `nkeys` stack.
Before subscribing, it validates key types and verifies that the auth issuer key
matches the Auth account represented by auth credentials and that the target key
matches the Trellis account represented by Trellis credentials. Invalid or
mismatched material fails startup.

The callout performs:

```text
connect request
  -> proof and replay validation
  -> resolve_issuable_state
  -> exact artifact and binding lookup
  -> deterministic transport permission compilation
  -> expiry-bounded NATS user JWT
  -> sealed auth response
  -> operational connection presence
```

Permission compilation consumes only exact grant atoms, exact API descriptors,
structured resource bindings, the authoritative inbox prefix, and a narrow
participant-kind-dependent built-in list. Subjects, ACLs, current responders,
and physical resource names do not create permission atoms.

Auth Callout, disconnect watcher, outbox publisher, and reconciliation run as
critical platform tasks. Unexpected task completion or ownership loss stops all
auth acceptance and terminates the owning runtime through the existing
supervisor path.

### Portal Assets

The current Svelte portal remains the authored UI. Repository preparation builds
its static output reproducibly into generated artifacts. The Rust release binary
embeds that output, including content-hashed assets. SPA fallback applies only
beneath `/login/*` and `/console/*`; hashed asset misses and unknown
auth/bootstrap/API paths remain ordinary `404` responses. Production has no
source-tree or mounted asset dependency. A configured development override
directory may replace the embedded files without changing production behavior,
and canonical-path checks prevent traversal or symlink escape outside that
directory.

## Authority Replacement Rules

The following legacy data can inform behavior and tests but is never imported as
current machine authority:

- serialized session capability or subject snapshots;
- identity-grant subjects;
- capability-group objects or unresolved expansion;
- deployment grant overrides that expand authority;
- persisted NATS publish/subscribe ACLs;
- implementation-offer liveness without exact authority-scoped evidence;
- resource bucket, stream, consumer, or object-store names.

Current authority remains the accepted identity or deployment authority
projection defined in `rust-authorization-state.md`. Transport permissions are a
short-lived edge projection from issuable state, exact API descriptors, and
structured resource bindings.

## Trust And Context Integration Inventory

This appendix records the implemented trust/context boundary. Rust remains the
only runtime Auth owner; Rust and TypeScript providers verify ordinary requests
and events locally from Rust-authored protocol evidence.

### Issuance, Bootstrap, Persistence, And Consumption

TypeScript remains a supported client and service-provider implementation, not a
second authority engine. Client lifecycle code verifies and persists only its
own Rust-issued context through Rust/WASM, refreshes that context and route-only
JWT, reconnects, and projects browser/Svelte state. TypeScript service-provider
code keeps the same minimal connected registry state as the Rust provider and
delegates signed-object, request, and event cryptography to Rust/WASM.

| Item                  | Final ownership and shape                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Issuance              | Rust resolves one coherent `IssuableAuthorizationState`, signs a context naming the current manifest generation, persists canonical signed JSON keyed by its digest, and publishes that exact JSON.                                                          |
| Bootstrap and refresh | Successful browser, service, and device responses carry `{context, trust}` plus route JWT/session metadata. Rust and TypeScript clients verify through Rust protocol code or WASM and compute digest/refresh time locally.                                   |
| Trust persistence     | Server SQLite and each client's own durable store retain the pinned root and accepted manifest floor. Clearing a context does not reset trust.                                                                                                               |
| NATS connection       | The standard NATS nonce signature proves session-key possession. A minimal token selects `contextDigest`; Auth Callout verifies that context, requires NKey/session-key equality, and compiles permissions directly from signed grants and current bindings. |
| Provider cache        | One current manifest, live contexts by digest, revocation timestamps, and registry watch state. Historical verification exact-reads one context and one named manifest without a second cache.                                                               |
| Request verification  | Generated route metadata supplies the exact permission and capabilities. The signed outer request proof is the only normal connected RPC proof.                                                                                                              |
| Event verification    | Typed consumers use receiver-owned generated metadata. Event Log verifies the signed event and authenticated publisher projection without reconstructing arbitrary contracts.                                                                                |
| Client lifecycle      | Rust and TypeScript own only their current session/context persistence, refresh scheduling, route JWT renewal, reconnect, and terminal/transient state projection.                                                                                           |
| Svelte projection     | `trellis-svelte` projects the TypeScript own-context lifecycle; it does not authorize requests or events.                                                                                                                                                    |

### Authorization-Relevant Mutation Inventory

Rows below describe the current context selection and revocation coupling.
Implemented invalidations select affected active contexts in the same
authoritative SQLite transaction. SQLite is the sole complete persistence
implementation for trust, contexts, and revocations; in-memory auth fixtures do
not duplicate those semantics. Deterministic `context_revoke` post-commit
actions publish after commit; failure cannot roll back the domain mutation.

| Mutation                                                    | Current authoritative path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Milestone 9 invalidation coupling                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session revoke/logout                                       | `rust/crates/runtime/src/platform/auth/application/sessions.rs::AuthService::revoke_session` -> aggregate `rust/crates/runtime/src/platform/auth/application/repository.rs::SessionRepository::revoke_session`; HTTP logout and Auth RPC call that shared workflow.                                                                                                                                                                                                                                         | Revoke every active context for the session and enqueue deterministic revocations before kick/event actions.                                                                                                                                                                                            |
| Session expire                                              | `rust/crates/runtime/src/platform/auth/application/repository.rs::SessionRepository::touch_session`, implemented by `rust/crates/runtime/src/platform/auth/sqlite/sessions.rs`; expiry is also checked during `resolve_issuable_state` and liveness admission.                                                                                                                                                                                                                                              | Expire the session and revoke its active contexts in the same SQLite transaction.                                                                                                                                                                                                                       |
| Browser session bind (no replacement path)                  | `rust/crates/runtime/src/platform/auth/http/browser/consent.rs::bind_flow` calls `rust/crates/runtime/src/platform/auth/application/sessions.rs::AuthService::create_session` -> `rust/crates/runtime/src/platform/auth/application/repository.rs::SessionRepository::create_session`, implemented by `rust/crates/runtime/src/platform/auth/sqlite/sessions.rs::create_session`; immutable `flowId` owns durable replay of the committed session ID. There is no session-key rebind or replacement method. | A successful new bind creates a session. Retrying the same flow replays that session; signed `requestId` is freshness metadata and does not replace or revoke an existing session or context.                                                                                                           |
| Password change                                             | `AuthService::change_password` -> aggregate `PasswordChange`; it updates the credential and revokes sibling sessions.                                                                                                                                                                                                                                                                                                                                                                                       | Revoke contexts for every sibling session revoked by that transaction.                                                                                                                                                                                                                                  |
| Password reset                                              | `AuthService::complete_password_reset` -> aggregate `PasswordResetCompletion`.                                                                                                                                                                                                                                                                                                                                                                                                                              | Revoke contexts for every session disabled by reset in the same completion transaction.                                                                                                                                                                                                                 |
| User principal/profile update                               | `rust/crates/runtime/src/platform/auth_rpc.rs::AuthRpcProcessor::users_update` -> `rust/crates/runtime/src/platform/auth/application/accounts.rs::AuthService::update_user` -> `rust/crates/runtime/src/platform/auth/application/repository.rs::AccountRepository::update_user_account`, implemented by `rust/crates/runtime/src/platform/auth/sqlite/accounts.rs::update_user_account`. `Auth.Users.Update` accepts only `active` or `disabled` user state.                                               | An `active`/`disabled` state change revokes matching active contexts in the SQLite transaction. Profile-only changes may advance the aggregate version but do not revoke contexts; user-principal `revoked` updates and a separate principal-authorization-state method are not implemented.            |
| Identity authority decision/version change                  | `AuthService::decide_authority_proposal` and `AuthRpcProcessor::identity_authority_revoke` update desired authority and enqueue reconciliation.                                                                                                                                                                                                                                                                                                                                                             | Revoke contexts for the authority on any state/version change, including expansion, in the authority transaction.                                                                                                                                                                                       |
| Deployment authority decision/version change                | `AuthService::decide_authority_proposal` updates desired deployment authority and supersedes plans atomically.                                                                                                                                                                                                                                                                                                                                                                                              | Revoke every active context for the stable deployment-authority lineage in that decision transaction.                                                                                                                                                                                                   |
| Materialization semantic change/unavailability              | `AuthorizationStateService::reconcile_authority` -> repository reconciliation transaction using `materializer.rs`.                                                                                                                                                                                                                                                                                                                                                                                          | When materialization version, effective grants/capabilities, availability, or expiry changes, revoke contexts for that authority in the same reconciliation transaction. Semantic no-ops do not revoke.                                                                                                 |
| Deployment disable/remove/expiry                            | `rust/crates/runtime/src/platform/auth_rpc.rs::AuthRpcProcessor::deployments_set_state` -> aggregate `rust/crates/runtime/src/platform/auth/application/repository.rs::DeploymentRepository::put_deployment_profile`; live expiry is checked during issuance.                                                                                                                                                                                                                                               | Revoke deployment contexts atomically on disable/remove/expiry transition. No-op profile writes do nothing.                                                                                                                                                                                             |
| Instance disable/revoke/stale/remove                        | `ProvisioningRepository::mutate_provisioned_instance`, called by Auth RPC lifecycle handlers.                                                                                                                                                                                                                                                                                                                                                                                                               | Revoke contexts selected by exact instance ID in that aggregate mutation.                                                                                                                                                                                                                               |
| Device disable/revoke/remove                                | Device lifecycle uses the same provisioned-instance aggregate and device/principal records.                                                                                                                                                                                                                                                                                                                                                                                                                 | Revoke exact device principal/deployment/instance contexts in the lifecycle transaction.                                                                                                                                                                                                                |
| Device delegation revoke/expiry decision                    | `ProvisioningRepository::mutate_device_delegation`, called by Auth RPC and the activation operation.                                                                                                                                                                                                                                                                                                                                                                                                        | Revoke contexts for the device/deployment delegation when state or expiry changes.                                                                                                                                                                                                                      |
| Participant artifact presentation and authority replacement | `rust/crates/runtime/src/platform/auth/application/authority.rs::AuthService::present_deployment_authority` stores the exact binding through `rust/crates/runtime/src/platform/auth/authority/mod.rs::AuthorityRepository::put_participant_binding`; accepted proposals use `AuthService::decide_authority_proposal` -> `AuthorityRepository::decide_authority_proposal`. There is no session rebind or replacement method.                                                                                 | Bindings are immutable by `(participant_id, artifact_digest)`. Presenting a new binding or a pending update/migration does not replace a session or revoke its context; accepting the authority decision revokes matching active contexts through the SQLite repository, but does not rebind a session. |
| Issuer revocation                                           | Runtime startup accepts only a verified current root-signed manifest and durable generation floor.                                                                                                                                                                                                                                                                                                                                                                                                          | Manifest-floor advancement marks all unexpired contexts from newly revoked issuers revoked and enqueues registry actions while retaining certificates for history.                                                                                                                                      |

Context expiry remains the cryptographic upper bound. Registry revocation is
prompt distribution, not a source of broader authority. Profile display-name,
email/image changes, session last-seen coalescing, unrelated principals or
authorities, outbox retries, and semantic no-op reconciliation do not change an
issuance snapshot token and do not revoke contexts.
