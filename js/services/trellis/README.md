# Trellis Runtime Service

The `trellis` service is the platform control plane for a deployment. It owns
the browser login flow, the NATS auth callout, the control-plane RPC surface,
the durable Trellis runtime database, and the builtin Trellis contracts.

This service is the bootstrap exception described in
`design/core/trellis-patterns.md`: it wires the platform together before other
services can rely on the catalog, bindings, and auth runtime.

## What the service does

- Serves `/auth/*` HTTP routes for login, callback, approval, and bind.
- Issues short-lived NATS JWTs through the auth callout after a client proves
  session ownership.
- Stores durable auth, catalog, session, service, device, and portal records in
  SQLite.
- Stores short-lived OAuth, pending auth, browser-flow, connection-presence, and
  public State API entries in NATS KV.
- Maintains the deployment-active contract catalog and derives runtime
  permissions from that active contract set.
- Hosts the RPC handlers for Trellis control-plane operations such as contract
  lookup, catalog access, service registration, session management, approvals,
  and user projection reads.
- Owns the platform contracts explicitly through top-level `contracts/` modules;
  service deployment display names do not grant Trellis contract ownership.

## Folder layout

```text
js/services/trellis/
  main.ts                 # service entrypoint
  config.ts               # config loading and validation
  bootstrap/              # startup factories, control-plane API, storage wiring
  auth/                   # browser auth, session auth, providers, auth callout
  catalog/                # contract catalog, resource binding, permission derivation
  contracts/              # authored builtin Trellis contracts
  state/                  # public State API RPC, storage, and model code
  storage/                # SQLite schema, migrations, and database bootstrap
```

### `bootstrap/`

- `control_plane.ts` registers builtin contracts, RPC handlers, and background
  loops.
- `control_plane_api.ts` merges the owned APIs from `trellis.core`,
  `trellis.auth`, `trellis.state`, and `trellis.health`.
- `globals.ts` exposes `createRuntimeGlobals(config)`, which creates the logger,
  NATS connections, KV handles, auth helpers, SQL repositories, and local
  `TrellisService` instance in explicit startup order.
- `storage.ts` exposes `createStorage(config)`, which opens the configured
  SQLite database, initializes the schema, and constructs concrete storage
  repositories.

### `auth/`

- `http/` contains the browser-facing login, callback, approval, and bind routes
  plus the small HTML renderers and HTTP helpers that support them.
- `providers/` contains pluggable identity provider adapters and the provider
  registry.
- `approval/` contains contract approval planning and approval-related RPC
  handlers.
- `session/` contains session binding, principal resolution, session RPC
  handlers, and user projection updates.
- `callout/` contains the NATS auth callout loop, connection cleanup, kick
  support, and rate limiting.
- `bootstrap/`, `registration/`, `admin/`, `grants/`, and `device_activation/`
  keep service/device startup, RPC registration, admin policy, and activation
  flows out of the browser-login and callout modules.
- top-level helpers such as `oauth.ts`, `redirect.ts`, `transports.ts`, and
  `keys.ts` support the different auth layers without forcing HTTP and callout
  code into the same directory.

### `catalog/`

- `store.ts` validates manifests, persists installed contracts, and builds the
  catalog view.
- `rpc.ts` implements catalog, contract lookup, and binding lookup RPCs.
- `permissions.ts` and `resources.ts` turn active contracts into runtime
  permission and resource binding decisions.
- `runtime.ts` wires catalog storage, active-set refresh, and permission
  publication for the auth callout.
- `uses.ts` and `analysis.ts` resolve contract dependencies and inspect resource
  requirements.

### `contracts/`

- `trellis_core.ts`, `trellis_auth.ts`, `trellis_state.ts`, and
  `trellis_health.ts` are the authored builtin platform contracts hosted by this
  process.
- These modules are the source of Trellis-owned contract implementations. The
  catalog and auth layers no longer infer control-plane ownership from a profile
  display name.

### `state/`

- `rpc.ts` resolves caller/session ownership and implements the public State API
  plus State admin RPCs.
- `storage.ts` stores State entries in the `trellis_state` NATS KV bucket.
- `model.ts` defines the stored State entry envelope: values carry the
  author-known `stateVersion` and internal `writerContractDigest` provenance so
  compatible contract-lineage upgrades can report migration-required responses
  without executing app migration code in Trellis.
- `schemas.ts` and `schemas/` remain the shared export surface for runtime auth,
  catalog, session, and callout record schemas.

### `storage/`

- `db.ts` opens the configured SQLite database and applies migrations.
- `schema.ts` defines the durable Trellis SQL schema.
- `migrations/` contains the current Drizzle migration baseline.

## Runtime storage

The service uses SQLite for durable Trellis-owned runtime records. The default
database path is `/var/lib/trellis/trellis.sqlite`; deployments can override it
with `storage.dbPath` in the Trellis service config. The containing directory
must be writable by the service and should be persisted across restarts.

Pre-v1 storage uses a clean Drizzle baseline migration named `00000_baseline`.
Existing development databases created by older bootstrap code are not upgraded
in place; delete or recreate them before starting a build that uses the baseline
migration.

SQL-backed records include users, sessions, approvals, grant policies, portal
configuration, service deployments and instances, device records, activations,
reviews, installed contracts, and resource bindings. Session expiry is enforced
from each session's `lastAuth` timestamp using `ttlMs.sessions`.

KV-backed records are limited to short-lived OAuth state, pending auth, browser
flows, active connection presence, and entries exposed through the public
Trellis State API.

## Main runtime flows

### Startup flow

1. `main.ts` initializes tracing, loads config, creates runtime globals, and
   creates the Hono app.
2. `bootstrap/control_plane.ts` registers builtin contracts and RPC handlers.
3. The control plane refreshes the active contract catalog and publishes the
   permission model used by the auth callout.
4. HTTP auth routes are mounted.
5. Background tasks start for the NATS auth callout and disconnect cleanup.

### Browser login and bind flow

This follows `design/auth/trellis-auth.md`.

1. A browser starts auth through `/auth/requests`, which creates a browser flow
   for a signed `redirectTo`, `sessionKey`, and contract payload.
2. Provider routes in `auth/http/routes.ts` complete the external login, store
   pending auth state, and resolve the authenticated Trellis user identity.
3. Approval planning in `auth/approval/plan.ts` inspects the exact contract
   digest and determines whether the user already approved the requested
   capabilities.
4. If approval is needed, the user is shown the auth-hosted approval page.
5. `/auth/flow/:flowId/bind` creates or refreshes the bound session and returns
   the binding token, inbox prefix, NATS servers, and sentinel credentials.

### NATS auth callout flow

1. A client connects to NATS with sentinel credentials and a Trellis auth token.
2. `auth/callout/callout.ts` verifies the binding token and session proof.
3. The current principal is resolved from SQL-backed sessions, service/device
   records, and user projections.
4. Runtime permissions are derived from the active contract set plus any
   provisioned resource bindings.
5. Trellis returns a scoped NATS JWT for that connection.

### Contract install, active catalog, and permission flow

This follows `design/contracts/trellis-contracts-catalog.md`.

1. Contract manifests are validated and canonicalized by `catalog/store.ts`.
2. Catalog RPC handlers resolve `uses`, analyze the contract, and prepare
   resource bindings.
3. Service install state is persisted through the auth/admin service-profile and
   service-instance repositories.
4. The active catalog is refreshed from builtin Trellis contracts and installed
   service instances, not from user sessions.
5. Multiple compatible digests may be active for the same contract id during
   rollouts, mixed firmware, or externally controlled service deployments; this
   is expected v1 behavior, not compatibility debt.
6. User/app runtime permissions are derived from the approved caller contract
   digest and its declared `uses`; a user capability alone does not grant access
   to unrelated active contracts.
7. Service/device runtime permissions are derived from the active installed
   contract set plus provisioned resource bindings.

### State entry version flow

1. State writes validate the value against the caller contract's current store
   schema.
2. Stored entries are stamped with the current author-known `stateVersion` and
   the concrete `writerContractDigest` that wrote the value.
3. Reads validate entries against either the current schema or an explicitly
   accepted older state version.
4. Older accepted entries return migration-required metadata to the caller. The
   service does not run app migration code server-side.

## Design constraints to keep in mind

- Approval and delegation are bound to the exact contract digest, not only the
  contract id.
- The auth HTTP flow and the NATS auth callout are separate layers and should
  stay organized separately even though they share session-proof helpers.
- Multiple active compatible digests per contract id are required. Trellis
  admins may not control every remote service or device firmware rollout, so
  catalog and permission code must tolerate concurrent active revisions in one
  lineage.
- User/app runtime permissions come from the approved exact digest plus declared
  `uses`; service/device runtime permissions come from active installed digests.
  Neither path uses a handwritten service registry or currently bound user
  sessions as the active-contract source.
- Runtime resource grants are intentionally narrow. Bound resources no longer
  grant broad stream creation/deletion or durable KV consumer creation unless a
  current runtime client requires that exact subject.
- `trellis.auth@v1`, `trellis.core@v1`, `trellis.state@v1`, and
  `trellis.health@v1` remain logically separate even though they are currently
  hosted by this process.
- State versioning and migration semantics are documented in
  `design/core/state-patterns.md` and `design/state/state-typescript-api.md`.

## Common commands

```bash
deno task dev
deno task test
deno task verify:contracts
deno task prepare
```

## Related design docs

- `design/core/trellis-patterns.md`
- `design/auth/trellis-auth.md`
- `design/contracts/trellis-contracts-catalog.md`
