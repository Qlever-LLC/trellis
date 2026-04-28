# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Documented and surfaced the final Trellis service hardening pass across design
  docs, guides, the built-in portal, and console: active-catalog dry-run
  validation now gates staged apply/bootstrap state, service apply/unapply roll
  back failed refreshes instead of exposing partial mutations, and service NATS
  reconnect requires the exact current digest still allowed by the deployment.
- Aligned Trellis service v1 docs and app surfaces with the latest cleanup:
  optional payload-field removal is documented as compatible when absence
  remains valid, State no longer infers accepted versions for unversioned
  entries, State list pagination documents the current NATS KV scan/sort
  trade-off, auth callout unexpected failures return a stable `internal_error`,
  auth HTTP rate limiting avoids client-controlled forwarding headers, device
  runtime cleanup removes durable device sessions by public identity key, and
  store bindings no longer advertise unenforced per-object limits.
- Aligned the Trellis service v1 deployment model so required resources are
  provisioned during service deployment apply/install/upgrade before deployment
  mutation, service bootstrap consumes persisted exact-digest bindings, physical
  resource names remain deployment/profile/lineage scoped, app/agent contracts
  are treated as approved-session contracts rather than active catalog entries,
  baseline `Auth.ValidateRequest` may be auto-granted to service runtimes, and
  device `allowedDigests` are rollout allow-lists.
- Changed same-lineage active digest projection to verify duplicate RPC,
  operation, event, and job schema refs by resolved schema compatibility instead
  of ref-name equality: canonically equal schemas and optional additive fields
  on open objects are accepted, while closed-object property-set divergence and
  unproven non-identical schema constructs fail closed.
- Changed Rust CLI agent login and reauth to use the same normalized contract
  identity digest as the TypeScript catalog, so display-only metadata changes no
  longer cause `contract_changed` reconnect denials, and generic NATS
  authorization denials no longer clear the saved local CLI session unless auth
  explicitly reports the session as missing, revoked, or rejected.
- Browser Trellis clients now treat revoked or missing sessions
  (`session_not_found`) as auth-required, allowing Svelte apps such as the
  console to redirect back through their login page with the current return
  path.
- Removed raw subject declarations and service-declared stream resource requests
  from the documented v1 contract surface, aligned guides/portal docs/console
  copy with app-based portal contracts, and clarified that unversioned Trellis
  State entries remain readable when the current schema accepts them.
- Documented and surfaced the Trellis service v1 cleanup across design docs,
  guides, login portal docs, and console admin views, including canonical device
  connect-info, deployment-derived device digests, optional KV/store resources,
  operation analysis metadata, fail-closed catalog refresh, and explicit
  transfer-derived permissions.
- Aligned outward-facing auth, catalog, app, and guide docs with the Trellis v1
  runtime/control-plane cleanup and active-compatible-digest `uses` validation.
- Documented fail-closed active catalog refresh, explicit auth-callout denial,
  read/cancel-only operation-control grants, and strict device allowed-digest
  validation across design docs, guides, the built-in portal README, and demos.
- Tightened Trellis service v1 behavior by validating contract `uses` before
  persistence, scoping operation control permissions to read/cancel grants,
  keeping jobs projection buckets runtime-owned, requiring NATS for jobs
  provisioning, accepting boolean State JSON schemas, and making startup and
  shutdown cleanup attempt every registered path.
- Changed contract identity to hash a normalized runtime/interface digest
  projection instead of human-facing manifest metadata, and removed
  service-declared stream resources from the v1 contract/resource model.
- Reworked service and device rollout management around explicit deployments:
  auth protocol, storage, runtime bootstrap, CLI, portals, docs, guides, and
  demos now use `ServiceDeployment` / `DeviceDeployment`, `deploymentId`, and
  `trellis deploy` instead of service/device profile APIs.
- Changed Trellis State to store author-owned state versions and internal writer
  digest provenance per entry, while keeping durable namespaces scoped by
  contract id lineage. Older declared `acceptedVersions` now surface
  migration-required read/list/conditional-put responses for app/device-side
  migration instead of digest-keyed author APIs.
- Tightened the Trellis control-plane service for v1 by removing display-name
  based Trellis-owned contract implementation, keeping user sessions out of the
  deployment-active catalog, validating State accepted-version schemas at
  contract validation time, removing hidden stream replica downgrades, and
  reducing bound resource runtime grants to use-oriented subjects.
- Changed Svelte app docs and examples to derive app-local client types from
  `createTrellisApp` contracts instead of importing generated `client.ts`
  facades from local `generated/js/sdks/...` paths.
- Changed local SvelteKit app aliasing so each app owns explicit `kit.alias`
  mappings, with Vite relying on SvelteKit-provided aliases and the old shared
  frontend workspace alias helper removed.
- Changed `@qlever-llc/trellis-svelte` so `createTrellisApp(...)` owns both the
  contract and Trellis URL and `TrellisProvider` takes a single `trellisApp`
  prop instead of separate app and `trellisUrl` props.
- Changed TypeScript contract authoring so manifest `exports` are declared in
  the `define*Contract(...)` callback body rather than the first-argument local
  registry, with registry-side `exports` now rejected at type and runtime
  boundaries.
- Changed Trellis control-plane storage so durable auth, catalog, service,
  device, portal, and session records are SQLite-backed with ULID row IDs while
  KV remains for OAuth/pending/browser scratch, connection presence, and the
  public State API; updated CLI bootstrap and docs for the SQL/KV boundary.
- Changed TypeScript activated-device startup so root
  `TrellisDevice.connect(...)` is runtime-only, Deno devices use
  `checkDeviceActivation(...)` to learn whether activation is ready or still
  required, hidden Deno activation-state persistence is scoped by deployment
  origin, device identity, and contract digest, and the JS device demos, design
  docs, and device guide now follow the `checkDeviceActivation(...)` then
  `connect(...)` flow.
- Redesigned `@qlever-llc/trellis-svelte` around app-owned separate contexts:
  `createTrellisProviderContexts<TContract>()` now bundles Trellis, auth, and
  connection-state contexts for `TrellisProvider`, the old runtime-bag design is
  gone, and the design docs, SvelteKit guide, and browser demo app now show the
  `contexts`-based integration path.
- Changed service-owned KV from an opened-at-startup helper pattern to a
  schema-backed contract surface: `resources.kv.<alias>` now requires `schema`,
  `service.kv.<alias>` and handler `trellis.kv.<alias>` are directly typed
  stores, and public service-author guidance now leads only with
  `TrellisService.connect(...)` rather than exposing Trellis-internal bootstrap
  helpers.
- Made the JavaScript service jobs lifecycle service-owned by removing public
  `jobs.startWorkers()`, making `jobs.<queue>.handle(...)` synchronous, and
  starting and stopping registered job workers through `service.wait()` /
  `service.stop()` instead.
- Changed TypeScript contract discovery and authoring guidance so
  single-contract projects may use a top-level `contract.ts` or `contract.js`,
  updated design and guide docs to describe that layout, and migrated the JS
  demos from one-file `contracts/` folders to root `contract.ts` modules.
- Renamed the TypeScript service runtime package from
  `@qlever-llc/trellis/host*` to `@qlever-llc/trellis/service*`, aligned the
  extracted service handler types to `RpcHandler`, `JobHandler`, and
  `OperationHandler`, and updated design docs and demo examples to show the
  canonical single-object handler callback shape with the narrow injected
  service `trellis` facade.
- Changed `trellis auth login` to require a positional Trellis URL, renamed the
  persisted admin-session URL field to `trellis_url`, and updated the related
  design and guide examples.
- Changed TypeScript `prepare` so service and app contracts generate concrete
  consumer `client.ts` facade types, SvelteKit-style `src/lib/contract.ts`
  contracts are discovered, and app contracts produce TypeScript SDKs without
  Rust SDK crates.
- Updated Svelte app integration so `createTrellisApp` derives app-local client
  helper types from the supplied contract without app-local casts or handwritten
  overloads.
- Simplified portal auth by removing the portal contract kind and portal
  `appContractId`, keeping custom portals as routing config, and moving
  authenticated device activation to a single `Auth.ActivateDevice` operation.
- Made the TypeScript service runtime surface v1-clean by removing the legacy
  `TrellisServer` public name, making `@qlever-llc/trellis/service*` explicit
  service-author entrypoints, hiding raw runtime and NATS transport internals
  from root and generated client facades, and using `TrellisConnection` for
  lifecycle control.
- Changed TypeScript contract authoring so baseline app, agent, device, and
  top-level state Trellis-owned dependencies are derived automatically, while
  non-baseline Auth surfaces use explicit `auth.use(...)` declarations.
- Simplified the Trellis control-plane service for pre-v1 by removing old auth
  reconnect compatibility paths, making `sessionKey` the durable session storage
  identity, validating operation subjects before contract persistence, scoping
  State entries by contract id lineage, and replacing raw SQLite bootstrap with
  a Drizzle baseline migration named `00000_baseline`. Existing pre-baseline
  development databases must be deleted or recreated.
- Removed undocumented pre-v1 Trellis auth compatibility paths, including the
  query-init `/auth/login` flow, public `/auth/bind` token bind endpoint,
  `TRELLIS_AUTH_CONFIG`, contract `sessionKey` records, and single-active digest
  assumptions, while keeping flow-owned bind and multi-active compatible
  contract rollout support.

### Added

- Added `trellis-generate prepare --watch`, repo-local
  `cargo xtask prepare-watch`, and JS/demo `prepare:watch` tasks so contract and
  SDK artifacts can stay fresh during active service and app development. Watch
  mode now prepares only affected contract entries when safe, ignores
  non-TypeScript, non-JavaScript, and non-Rust file changes except recognized
  project/discovery inputs, falls back to full prepare for project manifests and
  discovery-shape changes, asks for a watch restart after generator/tooling
  changes, and prints the event paths plus the watch decision and reason with
  `--changes`.
- Added a reusable Svelte `DeviceActivationController` for custom and built-in
  authenticated device portal flows.
- Made service and activated-device runtime NATS lifecycle logging explicit so
  disconnects, reconnect attempts, reconnect success, stale connections, and
  connection errors produce distinct operator-facing messages.
- Moved contract-manifest job queue declarations to canonical top-level `jobs`
  in both the JavaScript and Rust contract layers, and aligned bootstrap and
  contract-get views with that shape.

### Fixed

- Fixed browser portal approval submissions so the built-in login portal and
  shared portal helpers send the auth endpoint's canonical `approved: boolean`
  request body, preventing console login approval from failing with HTTP 400.
- Fixed console auth-required redirects to restart the configured console login
  flow with a session-ended message instead of reusing a stale provider URL.
- Fixed Trellis local watched restarts to exit cleanly after shutdown, bounded
  HTTP listener drain during Trellis control-plane shutdown, and aligned
  service-author docs and JS demo shutdown examples with that deterministic exit
  pattern.
- Fixed schema-backed KV validation so invalid stored values now surface read or
  watch errors instead of being auto-deleted, and delayed service heartbeat
  publishing until required KV bootstrap succeeds.
- Fixed `trellis-generate` top-level contract discovery to reject ambiguous
  duplicate layouts while ignoring helper modules named `contract.ts` or
  `contract.js` that do not default export a contract, while also skipping
  `.worktrees/` during contract discovery.
- Granted KV-backed services JetStream info access so operation handlers can
  open their durable operation store without `$JS.API.INFO` permission errors.
- Fixed jobs worker permission grants for cancellation subscriptions and made
  server shutdown idempotent while NATS draining is already in progress.
- Corrected demo workspace generated-SDK resolution during contract prepare,
  wrote local TypeScript SDKs into the owning nested JS workspace, and switched
  local generated Trellis imports to repo-relative runtime paths.
- Fixed `TrellisClient.connect(...)` and `TrellisDevice.connect(...)` so
  contract-driven RPC request typing is inferred from the passed contract rather
  than widening typed responses like `Auth.Me` to `unknown`.
- Fixed activated-device state flows by preserving top-level contract `state`
  metadata, refreshing device reconnect permissions from the presented digest,
  and encoding state KV keys safely so the JavaScript state demo runs
  end-to-end.
- Fixed standalone login portal builds by defaulting the portal Trellis URL to
  `http://localhost:3000` when `PUBLIC_TRELLIS_URL` is not set.

## [0.8.0] - 2026-04-19

### Added

- Made TypeScript jobs and named stores first-class client surfaces.
- Split the JavaScript demo into more focused inspection surfaces.

### Changed

- Switched public async APIs to `AsyncResult` and hardened operation startup and
  transfer flows.
- Simplified runtime auth wiring by removing binding tokens and advertising
  native client NATS endpoints.

### Fixed

- Aligned detached agent login and revocation behavior.
- Stabilized console profile loading across reconnects, supported optional
  portal app contracts, and trimmed login portal files from the runtime image.

[Unreleased]: https://github.com/Qlever-LLC/trellis/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/Qlever-LLC/trellis/compare/v0.7.0...v0.8.0
