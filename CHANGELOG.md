# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.1-rc.1] - 2026-05-29

### Fixed

- Fixed release npm smoke checks by installing Node type definitions in the
  generated consumer project.
- Fixed release generator tests for current TypeScript client method output and
  Rust SDK dependency names.
- Fixed Rust-authored demo service contract parity with the TypeScript source
  contract.
- Fixed GitHub Pages release-site builds to tolerate unavailable or incomplete
  release worktrees and fall back to current docs or console sources.

## [0.10.0] - 2026-05-29

### Added

- Added deployment authority planning, acceptance, rejection, reconciliation,
  storage, admin RPCs, CLI flows, and Console review pages for service and
  device contract authority changes.
- Added implementation-offer backed service authority, so non-builtin service
  runtime availability is derived from accepted offers instead of repair-state
  catalog evidence.
- Added prepared event outbox/inbox support, event consumer groups, and expanded
  runtime and integration coverage for event publish/subscribe behavior.
- Added first-class Rust `trellis` facade modules for auth, client, service,
  jobs, generated SDKs, events, transfer, resources, and service runtime APIs.
- Added richer generated TypeScript and Rust contract support for digest-stable
  manifests, schema pointers, resource declarations, and generated SDK metadata.
- Added integration-harness fixtures and scenarios for authority, events, feeds,
  jobs, operations, resources, RPC, state, transfer, and public API guards.

### Changed

- Replaced deployment envelopes and envelope-expansion admin surfaces with the
  deployment authority model. Existing envelope RPCs, Console pages, design
  docs, migrations, and helper names were removed or renamed to authority
  terminology.
- Changed service bootstrap, runtime auth, auth-callout, catalog runtime, and
  reconnect checks to use materialized deployment authority and accepted
  implementation offers.
- Changed service APIs to prefer `TrellisService.connect(...)` and returned
  resource handles instead of constructing lower-level runtime objects or
  passing raw binding payloads through service bootstrap code.
- Renamed operation observation/control surfaces and simplified capability key
  handling across contracts, SDKs, tests, and docs.
- Reworked the documentation site under `docs/`, split and expanded the guides,
  added deployment-authority concepts, Rust and TypeScript library pages, and
  refreshed `llms.txt` / `llms-full.txt`.
- Consolidated Rust runtime APIs under the top-level `trellis` crate facade and
  updated demos to use current authority, event, and resource flows.

### Fixed

- Fixed service bootstrap dependency polling, dependency repair handling, and
  default workspace build behavior for clean clone prepare flows.
- Fixed jobs service bootstrap by provisioning jobs consumers before runtime
  use.
- Fixed legacy service-session pruning during storage upgrades and refreshed the
  Trellis service SQLite baseline around deployment authority history.
- Fixed Console contract dependency displays and service contract authority
  summaries for the new authority model.

## [0.9.0-rc.10] - 2026-05-22

### Fixed

- Removed the brittle generated SDK path guard from CLI release builds while
  keeping forced SDK regeneration so each runner rewrites local paths before
  compiling.

## [0.9.0-rc.9] - 2026-05-22

### Fixed

- Fixed macOS CLI release builds to force-refresh generated Rust SDK manifests
  before building, preventing Linux runner absolute paths from leaking into
  Darwin builds.
- Opted release and Pages workflows into Node.js 24 for JavaScript actions to
  avoid the GitHub Actions Node 20 deprecation warning.

## [0.9.0-rc.8] - 2026-05-22

### Fixed

- Fixed GitHub Pages release-site generation fallback cleanup so missing or
  delayed `trellis-generate` release assets no longer leave a stale `RETURN`
  trap that fails under `set -u`.

## [0.9.0-rc.7] - 2026-05-22

### Fixed

- Fixed CLI release builds to install Deno on each build runner before
  refreshing generated Rust SDK paths.

## [0.9.0-rc.6] - 2026-05-22

### Fixed

- Fixed prerelease npm dry-run validation to pass the `rc` dist-tag for
  prerelease package versions.
- Fixed macOS CLI release builds to refresh generated Rust SDK local dependency
  paths on each runner instead of reusing Linux absolute paths from the prepared
  release artifact.

## [0.9.0-rc.5] - 2026-05-22

### Added

- Added Forced Contract Update handling for active contract digest conflicts,
  including operator review, keep/accept resolution paths, and service runtime
  waiting while updates are pending.
- Added Console review and confirmation surfaces for Forced Contract Updates,
  including current/proposed contract comparison details.
- Added cleanup for pending service-originated envelope expansion requests when
  the requesting service disconnects.

### Changed

- Consolidated the GitHub release pipelines for release preparation, CLI assets,
  npm, crates, images, and JSR dry-runs into the unified `Release` workflow.
- Changed active catalog semantics so one `contractId` has at most one current
  active digest; resolving a Forced Contract Update now deletes non-selected
  evidence instead of retaining ignored or quarantined evidence.
- Changed service bootstrap and runtime handling for same-contract digest
  conflicts to report `contract_catalog_issue` and retry while the catalog issue
  is unresolved.
- Renamed Console and admin wording from repair-oriented catalog language to
  Forced Contract Update language.
- Changed generated auth identifiers to use ULID-based user, browser-flow,
  device-flow, and device activation review IDs.

### Fixed

- Fixed local self-registration username conflicts to return `username_taken`
  and present a user-facing "That username is already in use" message.
- Fixed `AuthError` serialization and deserialization to preserve explicit
  human-readable messages.
- Fixed legacy ignored contract-evidence metadata handling during reconnects so
  it is cleared under the Forced Contract Update model.
- Fixed GitHub Pages builds to prefer cached or published `trellis-generate`
  release assets while falling back to building from source when assets are not
  available yet.

## [0.9.0-rc.4] - 2026-05-21

### Added

- Added durable deployment-envelope, contract-evidence, portal, user, session,
  and resource-binding storage so Trellis authority no longer depends on
  long-lived in-memory contract state.
- Added first-class deployment grant overrides, capability groups, envelope
  expansion review surfaces, and active catalog repair support for operator-led
  rollout recovery.
- Added login portal account flows for local password setup/reset, identity
  linking, and admin bootstrap.
- Added durable user administration, linked identities, local password
  credentials, login-attempt tracking, and account-flow session APIs.
- Added first-class feed declarations plus TypeScript and Rust runtime APIs for
  authenticated request/stream subscriptions with typed feed events.
- Added SQLite-backed jobs query storage and paged Jobs admin queries, replacing
  broader KV scans for job, resource, and state projections.
- Added `trellis local init` and `trellis infra apply/check` workflows for local
  NATS/Trellis bootstrap files and shared infrastructure verification.
- Added Rust client support for device connect info, service bootstrap with
  contract evidence and envelope approval waits, feed subscriptions, event
  replay/ack controls, and typed RPC error payloads.
- Added a Rust demo workspace and a shared demo app layout so TypeScript and
  Rust service/device examples exercise the same inspection workflow.
- Added the Rust integration harness plus `trellis-local-bootstrap` and
  `trellis-generate-runner` workspace crates for local bootstrap, release, and
  end-to-end verification workflows.

### Changed

- Reworked auth around deployment envelopes, identity envelopes, auth-owned
  login portals, deployment-owned device routes, user accounts, and
  resource-first admin RPC names.
- Reworked the Trellis CLI command tree around top-level login/logout/whoami,
  users, portals, grants, `svc`/`dev`, local, infra, init, keys, and upgrade
  commands; update scripts and operator runbooks that call old subcommands.
- Reworked the Console admin surface around envelopes, grants, capability
  groups, consolidated devices, service repair, jobs detail, portal routing, and
  destructive-action confirmations.
- Reworked the guides site with split concept pages, a multi-page TypeScript
  service tutorial, updated install/start/local-development flows, and improved
  API-doc navigation.
- Removed the TypeScript runtime `authBypassMethods` option; unauthenticated RPC
  handlers must now opt out per handler with `authRequired: false` instead of
  using process-wide method bypass lists.
- Changed Trellis service storage to a squashed `0.9` SQLite baseline with new
  user identity, local credential, envelope, portal, grant override, resource
  binding, and catalog evidence tables; existing `0.8.x` service databases
  should be treated as incompatible unless an explicit migration path is added.
- Changed RPC, feed, and transfer request proofs to include issued-at and
  request-id headers, renamed the validation RPC to `Auth.Requests.Validate`,
  and rejected transfer proofs that omit those fields.
- Changed store, auth, state, and jobs list-style APIs to require bounded
  standard Trellis pagination or explicit limits, replacing unbounded scans with
  targeted storage queries and `nextOffset` response cursors.
- Changed contract manifests and SDK generation to support grouped
  required/optional uses, feeds, state accepted versions, contract-declared
  capabilities, operation control capabilities/signals, and shared
  `PageRequest`/`PageResponse` pagination models.
- Changed contract digest and catalog handling to support forward-compatible
  schemas, normalized manifests, feeds, declared capabilities, deployment
  evidence quarantine/ignore state, active catalog repair, durable resource
  bindings, and rejection of unsupported v1 subject and jobs/stream fields.
- Changed operation runtime APIs to support service-side control handles, named
  operation signals, durable signal history, and control/cancel capability
  metadata.
- Changed Trellis service configuration to require system NATS credentials,
  resolve credential paths relative to the config file, enable SQLite
  WAL/busy-timeout handling, and reject non-loopback HTTP/WS public origins
  unless listed in `web.allowInsecureOrigins`.
- Renamed the Rust service runtime crate surface from server-oriented naming to
  `trellis-service`, added Rust client state/store support, and expanded service
  resource, transfer, operation, and jobs runtime coverage.
- Moved release tooling into Rust xtask commands and prepared release-managed
  Rust crate, generated SDK, npm package, image, and workflow metadata for the
  `0.9.0-rc.1` release.

### Fixed

- Fixed expired browser auth/account flows to redirect back to the app login
  callback with a `flow_expired` error instead of leaving users stranded in the
  portal flow.
- Fixed Console grant override loading and removal grouping so override lists
  and revoke actions target the correct deployment and identity groups.
- Fixed local password setup/reset/change flows to return clearer policy and
  flow-state errors.
- Fixed release and publishing bootstrap paths so clean checkouts generate the
  required SDK artifacts before release, package, and image verification.
- Fixed generated Rust SDK formatting so prepared generated crates pass the
  workspace formatter checks used by release verification.
- Fixed service runtime RPC subscriptions so multiple instances share requests
  through queue groups instead of each instance handling the same request.
- Fixed service runtime first-connect retry behavior when Trellis is temporarily
  unavailable during bootstrap.
- Fixed heartbeat liveness status and expanded integration coverage for auth,
  catalog repair, events, feeds, jobs, operations, resources, state, transfer,
  portal, and runtime flows.
- Fixed generator TypeScript compiler discovery from repository-root workflows
  that use the JavaScript workspace `node_modules` directory.
- Fixed npm package export normalization so the `@qlever-llc/trellis/generate`
  subpath remains available in freshly built publish artifacts.
- Fixed the published npm `@qlever-llc/trellis/generate` subpath so it reads
  package metadata from the packed package instead of requiring a source
  `deno.json` next to the generated JavaScript entrypoint.
- Fixed prerelease npm smoke validation to invoke the packed Trellis CLI by its
  exact prerelease version when Deno resolves manual `node_modules` packages.
- Fixed Rust crate prerelease publishing order so registry-verified crates are
  published only after their internal Trellis dependencies are visible in the
  crates.io index.
- Fixed the Rust auth agent-flow polling test timeout so slower CI runners do
  not fail before the mocked redirect status is observed.

## [0.8.4] - 2026-05-07

### Fixed

- Fixed the Trellis npm generator entrypoint and release packaging so generated
  packages can launch the version-pinned generator through npm bin wrappers.

## [0.8.3] - 2026-05-07

### Added

- Added version-pinned generator launchers for shell-first contract generation.

### Fixed

- Fixed shell-first contract generation and serialized auth session store tests
  that were racing in release verification.

## [0.8.2] - 2026-05-01

### Fixed

- Fixed the `@qlever-llc/trellis-svelte` npm package to publish built runtime
  JavaScript under `dist/` so Vite can optimize Svelte 5 rune modules without
  parsing raw `.svelte.ts` source from `node_modules`.

## [0.8.0-rc.8] - 2026-05-01

### Fixed

- Fixed the Trellis npm package build by removing the stale activity SDK export
  after the built-in activity contract was removed from generated SDK outputs.

## [0.8.0-rc.7] - 2026-05-01

### Changed

- Changed generated TypeScript SDK packages to expose only their root export,
  export the contract module consistently as `sdk`, and require explicit
  `use(...)` selections instead of `useDefaults()` helpers.

### Fixed

- Fixed GitHub Pages guide builds to prepare generated Trellis SDK artifacts
  before generating TypeScript API docs.
- Fixed CLI release publishing to build and attach `trellis-generate` archives
  alongside `trellis`, added `trellis-generate self check/update`, and hardened
  self-upgrade asset selection for both binaries.

## [0.8.0-rc.6] - 2026-04-30

### Changed

- Normalized formatting in the `trellis-generate` Rust command and planning
  code.

### Added

- Added unauthenticated `GET /version` on the Trellis service to report public
  build version and revision metadata for deployed containers.
- Added `trellis-generate prepare --out <path>` to let callers choose the output
  root for generated manifests and SDKs while scanning contracts from a separate
  source path.

### Fixed

- Fixed the built-in Trellis portal to resolve the runtime origin from the
  browser by default so published service images work behind deployment-specific
  hostnames without rebuilding.
- Fixed npm package error construction and Deno service transport loading so
  locally linked npm artifacts can construct Trellis errors and connect service
  runtimes without relying on missing dnt or Deno transport package shims.
- Fixed hand-built `trellis` and `trellis-generate` binaries to include local
  git metadata in `--version` output while keeping official GitHub Actions
  release builds on the clean package version.
- Fixed local app aliases and Trellis client SDK loading so generated Trellis
  SDK imports resolve through linked packages instead of app-private
  `#trellis-generated-sdk/*` aliases, and added a regression test for
  out-of-tree SDK generation defaulting to the `@trellis-sdk/` scope.
- Fixed generated TypeScript SDK dependency metadata to use the Trellis runtime
  version bundled with `trellis-generate`, emit npm runtime imports, and publish
  npm SDKs with Trellis as a peer and development dependency instead of a nested
  runtime dependency.
- Fixed checked-in release version bumps to include the standalone
  `trellis-generate` Cargo package version.

## [0.8.0-rc.5] - 2026-04-30

### Changed

- Changed generated TypeScript SDK package names for non-Trellis-owned contracts
  to default to the `@trellis-sdk/` scope, added `--prefix` for custom generated
  SDK package prefixes, and updated demos/docs to consume generated SDKs as
  linked packages instead of import-map aliases.

### Fixed

- Fixed npm package smoke validation to pack and install the release artifacts
  locally, verify public ESM/CJS/TypeScript consumer imports, and reject private
  generated SDK build-path references in published packages.

## [0.8.0-rc.4] - 2026-04-30

### Fixed

- Fixed export in public packages

## [0.8.0-rc.3] - 2026-04-30

### Fixed

- Moved release metadata validation to the start of all publish workflows so a
  missing release changelog section fails before crates, npm packages, CLI
  binaries, or container images are built.
- Built the console ARM64 image from the amd64 GitHub runner with QEMU so the
  static console build uses the known-good amd64 Vite/Rolldown/Tailwind path
  while still producing an ARM64 nginx runtime image.

## [0.8.0] - 2026-04-30

### Changed

- Raised the minimum supported `nats-server` version to 2.10.0 and changed
  jobs-derived worker permissions to use only the newer filtered JetStream
  consumer-create API subject.
- Documented the Trellis service v1 follow-up cleanup across design docs,
  guides, and portal notes: active subject collision checks now use the
  effective wildcard subject for templated events, omitted store `maxTotalBytes`
  reconciles object-store streams back to the unlimited runtime default, and
  portal selection records are keyed directly by browser app contract id or
  device deployment id.
- Documented the final Trellis service v1 architecture cleanup across design
  docs, guides, the built-in portal, and demos: active catalog and approval
  planning now fail closed on inactive dependencies, embedded schemas reject all
  `$ref`, event template params are schema-checked, operation handlers use
  `op.defer()` for external completion, service resources are exact-digest
  install input, missing sessions return `session_not_found`, and malformed
  internal State or connection storage is treated as runtime noise/corruption
  rather than caller data.
- Redesigned the JavaScript browser demo as the Field Inspection Desk demo
  client, with a Trellis-powered product identity, mostly-light Executive
  Systems theme, full-height left navigation shell, integrated workflow pages,
  and clearer live-versus-fixture data handling.
- Documented and surfaced the final v1 activation/state cleanup across design
  docs, guides, the built-in portal, and console: device activation review
  decisions now complete the original `Auth.DeviceUserAuthorities.Resolve`
  operation durably, and State rejects unstamped pre-v1 entries instead of
  inferring current or accepted-version metadata.
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
  provisioned from deployment envelopes before runtime binding, service
  bootstrap consumes deployment-owned resource bindings, physical resource names
  remain deployment scoped, app/agent contracts are treated as approved-session
  contracts rather than active catalog entries, and baseline
  `Auth.Requests.Validate` may be granted by resolved envelopes.
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
  authenticated device activation to a single
  `Auth.DeviceUserAuthorities.Resolve` operation.
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
  than widening typed responses like `Auth.Sessions.Me` to `unknown`.
- Fixed activated-device state flows by preserving top-level contract `state`
  metadata, refreshing device reconnect permissions from the presented digest,
  and encoding state KV keys safely so the JavaScript state demo runs
  end-to-end.
- Fixed standalone login portal builds by defaulting the portal Trellis URL to
  `http://localhost:3000` when `PUBLIC_TRELLIS_URL` is not set.

## [0.8.0-rc.1] - 2026-04-19

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

[Unreleased]: https://github.com/Qlever-LLC/trellis/compare/v0.10.1-rc.1...HEAD
[0.10.1-rc.1]: https://github.com/Qlever-LLC/trellis/compare/v0.10.0...v0.10.1-rc.1
[0.10.0]: https://github.com/Qlever-LLC/trellis/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/Qlever-LLC/trellis/compare/v0.8.4...v0.9.0
[0.8.4]: https://github.com/Qlever-LLC/trellis/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/Qlever-LLC/trellis/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/Qlever-LLC/trellis/compare/v0.8.1...v0.8.2
[0.8.0]: https://github.com/Qlever-LLC/trellis/compare/v0.7.0...v0.8.0
[0.8.0-rc.1]: https://github.com/Qlever-LLC/trellis/compare/v0.7.0...v0.8.0-rc.1
