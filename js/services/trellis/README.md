# Trellis Runtime Service

The `trellis` service is the platform control plane for a deployment. It owns
the browser login flow, the NATS auth callout, the control-plane RPC surface,
and the builtin `trellis.core@v1` and `trellis.auth@v1` contracts.

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
- Maintains the active contract catalog and derives runtime permissions from the
  active contract set.
- Hosts the RPC handlers for Trellis control-plane operations such as contract
  lookup, catalog access, service registration, session management, approvals,
  and user projection reads.

## Folder layout

```text
js/services/trellis/
  main.ts                 # service entrypoint
  config.ts               # config loading and validation
  bootstrap/              # startup wiring and shared runtime singletons
  auth/                   # browser auth, session auth, providers, auth callout
  catalog/                # contract catalog, resource binding, permission derivation
  state/                  # shared runtime schemas and stored-record types
```

### `bootstrap/`

- `control_plane.ts` registers builtin contracts, RPC handlers, and background
  loops.
- `control_plane_api.ts` merges the owned APIs from `trellis.core` and
  `trellis.auth`.
- `globals.ts` creates shared runtime singletons: logger, NATS connections, KV
  handles, auth helpers, SQL repositories, and the local `TrellisService`
  instance.
- `storage.ts` opens the configured SQLite database, initializes the schema, and
  constructs concrete storage repositories.

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
- top-level helpers such as `auth_utils.ts`, `oauth.ts`, and `redirect_to.ts`
  support the different auth layers without forcing HTTP and callout code into
  the same directory.

### `catalog/`

- `contracts/` contains the authored builtin Trellis contracts.
- `contracts_store.ts` validates manifests, tracks active digests, and builds
  the active catalog view.
- `contracts_rpc.ts` implements catalog and contract retrieval plus contract
  install preparation.
- `contract_permissions.ts`, `permissions.ts`, and `contract_resources.ts` turn
  active contracts into runtime permission and resource binding decisions.
- `service_registry_rpc.ts` manages installed service records and coordinates
  catalog refresh after install or upgrade.

### `state/`

- `schemas.ts` is the shared export surface for runtime schemas.
- `schemas/` contains the concrete stored-record and callout payload schemas
  used across bootstrap, auth, and catalog code.

## Runtime storage

The service uses SQLite for durable Trellis-owned runtime records. The default
database path is `/var/lib/trellis/trellis.sqlite`; deployments can override it
with `storage.dbPath` in the Trellis service config. The containing directory
must be writable by the service and should be persisted across restarts.

SQL-backed records include users, sessions, approvals, grant policies, portal
configuration, service profiles and instances, device records, activations,
reviews, installed contracts, and resource bindings. Session expiry is enforced
from each session's `lastAuth` timestamp using `ttlMs.sessions`.

KV-backed records are limited to short-lived OAuth state, pending auth, browser
flows, active connection presence, and entries exposed through the public
Trellis State API.

## Main runtime flows

### Startup flow

1. `main.ts` initializes tracing, loads config, and creates the Hono app.
2. `bootstrap/control_plane.ts` registers builtin contracts and RPC handlers.
3. The control plane refreshes the active contract catalog and publishes the
   permission model used by the auth callout.
4. HTTP auth routes are mounted.
5. Background tasks start for the NATS auth callout and disconnect cleanup.

### Browser login and bind flow

This follows `design/auth/trellis-auth.md`.

1. A browser starts at `/auth/login` or `/auth/login/:provider` with a signed
   `redirectTo`, `sessionKey`, and contract payload.
2. The provider flow completes in `auth/http/http_routes.ts`, which stores
   pending auth state and resolves the authenticated Trellis user identity.
3. Approval planning in `auth/approval/app_approval.ts` inspects the exact
   contract digest and determines whether the user already approved the
   requested capabilities.
4. If approval is needed, the user is shown the auth-hosted approval page.
5. `/auth/bind` creates or refreshes the bound session and returns the binding
   token, inbox prefix, NATS servers, and sentinel credentials.

### NATS auth callout flow

1. A client connects to NATS with sentinel credentials and a Trellis auth token.
2. `auth/callout/auth_callout.ts` verifies the binding token and session proof.
3. The current principal is resolved from SQL-backed sessions, service/device
   records, and user projections.
4. Runtime permissions are derived from the active contract set plus any
   provisioned resource bindings.
5. Trellis returns a scoped NATS JWT for that connection.

### Contract install and permission flow

This follows `design/contracts/trellis-contracts-catalog.md`.

1. Contract manifests are validated and canonicalized by
   `catalog/contracts_store.ts`.
2. `catalog/contracts_rpc.ts` resolves `uses`, analyzes the contract, and
   prepares resource bindings.
3. `catalog/service_registry_rpc.ts` persists service install state.
4. The active catalog is refreshed.
5. `catalog/permissions.ts` updates the in-memory permission view consumed by
   the auth callout.

## Design constraints to keep in mind

- Approval and delegation are bound to the exact contract digest, not only the
  contract id.
- The auth HTTP flow and the NATS auth callout are separate layers and should
  stay organized separately even though they share session-proof helpers.
- Runtime permissions come from the active installed contract set, not from a
  handwritten service registry.
- `trellis.auth@v1` remains logically separate from `trellis.core@v1` even
  though both are currently hosted by this process.

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
