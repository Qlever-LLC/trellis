# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.23-rc.1] - 2026-06-26

### Changed

- Bumped release-managed Trellis package and crate base versions to `0.10.23`
  for the `0.10.23` release line.
- Reduced Console authority-plan preview queries to bounded page sizes and added
  pagination to the authority plan register so large pending-plan sets do not
  overload admin views.

### Fixed

- Fixed Console path resolution when the app is mounted under a base path so
  already-resolved paths are not prefixed twice and relative paths still resolve
  correctly.
- Fixed repeated browser auth handoffs by preserving `ClientAuthHandledError`
  through `TrellisClient.connect(...).orThrow()` instead of wrapping it as an
  unexpected error, allowing caller-owned redirects and flow handling to remain
  distinguishable.
- Fixed service bootstrap refreshes so accepting a newer contract digest stales
  all older active accepted offers for the same service lineage, not only the
  latest lineage record.
- Fixed Rust TLS setup for `reqwest` with `rustls-no-provider` by installing the
  ring crypto provider in the CLI and disabling unwanted default features in the
  shared Rust dependency graph.

## [0.10.22] - 2026-06-25

### Changed

- Split service-author AI guidance into shared, TypeScript-specific, and
  Rust-specific AGENTS templates so service repos can copy the smallest relevant
  guidance set.

## [0.10.21] - 2026-06-25

### Fixed

- Rebuilt and republished `@qlever-llc/trellis` so the npm
  `@qlever-llc/trellis/auth/browser` subpath includes `completeSessionLogout`,
  and added npm smoke coverage for that export.
- Fixed the Trellis service image build by freezing the login portal static
  build to `js/deno.lock` and using Deno 2.8.3 for the portal build stage.

## [0.10.20] - 2026-06-24

### Added

- Added the exported `CursorPageResponseSchema<TItem>` TypeBox return type for
  `CursorPageSchema(...)` so service contracts can name cursor-page response
  schemas cleanly.
- Added public API regression coverage for root contract helpers and retained
  auth, browser auth, device, service, and generated SDK subpath exports.

### Changed

- Clarified TypeScript package guidance so ordinary `define*Contract(...)`
  imports use the browser-safe `@qlever-llc/trellis` root, with advanced
  contract tooling and runtime-specific helpers kept on explicit subpaths.
- Updated Trellis service, console, and demo TypeScript imports to use the
  browser-safe root for normal contract helpers and shared JSON/schema helpers.
- Updated demo workspace import maps and Vite aliases for the Trellis browser,
  device, service, and error subpaths used by the local examples.

## [0.10.19] - 2026-06-24

### Added

- Added signed HTTP browser logout for Trellis user sessions, including
  session-key logout proofs, validated post-logout return targets, optional
  OIDC/Auth0 provider logout redirects, browser logout helpers, Console sign-out
  integration, and service-author guidance updates.

### Changed

- Changed `Auth.Sessions.Logout` into terminal Trellis session revocation only;
  browser apps should use the signed HTTP logout helpers for provider logout
  instead of calling the active app connection RPC.

## [0.10.18] - 2026-06-22

### Changed

- Changed the public deployment authority protocol so proposal and desired-state
  `needs` are grouped by `contracts`, `surfaces`, `capabilities`, and
  `resources`, and materialized authority `grants` are grouped by
  `capabilities`, `surfaces`, and `nats`. The TypeScript
  `DeploymentAuthorityNeed` union was replaced by `DeploymentAuthorityNeeds` and
  family-specific need types.
- Added browser auth recovery classification helpers and Svelte provider hooks
  so browser apps can handle stale sessions, expired auth flows, and
  auth-required reconnects by restarting sign-in instead of showing terminal
  connection errors.

### Fixed

- Repaired stale or obsolete persisted materialized-authority projections
  through storage upgrade and reconciliation while preserving the rule that
  runtime permissions require current materialization.
- Fixed stale Trellis browser sessions and expired browser login flows across
  the Console, login portal, and Svelte provider surfaces so recoverable auth
  failures clear local session state, return users to sign-in, and avoid brief
  intermediate loading-card flicker during callback handoff.
- Fixed OAuth browser callbacks so flows with already-satisfied approval and
  capabilities redirect directly back to the app instead of forcing another
  login-portal approval step.
- Fixed login portal route management so disabled selectors can be reclaimed by
  a different portal, and Console route edits can update selector fields by
  replacing the old selector after the new route is saved.
- Fixed capability and authority displays by de-duplicating capability catalog
  entries, counting grouped materialized grants correctly in Console, and hiding
  raw capability keys from the login portal's primary insufficient-access copy
  when no capability metadata is available.

## [0.10.18-rc.1] - 2026-06-13

### Changed

- Changed the public deployment authority protocol so proposal and desired-state
  `needs` are grouped by `contracts`, `surfaces`, `capabilities`, and
  `resources`, and materialized authority `grants` are grouped by
  `capabilities`, `surfaces`, and `nats`. The TypeScript
  `DeploymentAuthorityNeed` union was replaced by `DeploymentAuthorityNeeds` and
  family-specific need types.

### Fixed

- Repaired stale or obsolete persisted materialized-authority projections
  through storage upgrade and reconciliation while preserving the rule that
  runtime permissions require current materialization.

## [0.10.17] - 2026-06-12

### Fixed

- Fixed the `@qlever-llc/trellis` npm root export so browser bundlers select the
  browser-safe entrypoint without app-level Vite aliases, preventing DNT and
  Node/Deno builtin shims from leaking into browser client bundles.
- Fixed Trellis contract catalog startup and lookup behavior so invalid cached
  manifests are pruned from the SQLite `contracts` cache, stale derived
  projections no longer block manifest hydration, active implementation offers
  remain untouched when their cached manifest is missing, and presenting a full
  valid manifest repairs a corrupt same-digest cache row.

## [0.10.16] - 2026-06-12

### Fixed

- Fixed Trellis browser client and Svelte provider startup under strict Content
  Security Policy by removing `new Function` and eval-like dynamic import probes
  from browser-reachable runtime detection, transport loading, and telemetry
  helpers, keeping browser clients on the websocket transport path without
  requiring `unsafe-eval`.
- Fixed Rust generated SDK compile checks against current registry resolution by
  pinning the `time` dependency below the patch that conflicts with the
  `async-nats` JetStream error type blanket implementation.

## [0.10.15] - 2026-06-11

### Changed

- Changed generated TypeScript package import maps for out-of-tree SDK shells to
  depend on the JSR Trellis runtime package instead of the npm package.
- Exposed service event publishing on bound TypeScript service clients so
  generated service event surfaces can publish prepared Trellis events.

### Fixed

- Fixed release JSR publish availability checks to probe exact immutable version
  metadata instead of the lagging package index used by `deno info`.
- Fixed the trellis-svelte JSR dry-run artifact to use a compatible published
  Trellis runtime range instead of assuming the previous patch exists on JSR.

## [0.10.14] - 2026-06-11

### Added

- Added grouped event consumer declarations so service contracts can declare
  dependency event subscriptions by use alias with `uses` and consume their own
  events with `self`, with manifest validation, resource planning, contract
  proposal analysis, design docs, and service-author AI guidance updated for the
  grouped form.
- Added package artifact smoke coverage for the Trellis browser graph and the
  `@qlever-llc/trellis-svelte` package output, including declaration files,
  public export declarations, and JSR publish targets.
- Added Auth0 organization support to OIDC provider configuration and login
  routing.

### Changed

- Changed the Trellis browser package entrypoint to export an explicit
  browser-safe public surface instead of re-exporting the full root package.
- Hid raw runtime transport handles from public TypeScript and Rust service,
  client, device, jobs, event, transfer, and package declaration surfaces,
  keeping low-level NATS access behind internal APIs and using curated
  connection/status APIs for public consumers.
- Changed release publishing to dry-run and publish the prepared
  `@qlever-llc/trellis-svelte` JSR package artifact alongside the existing
  staged JSR packages.
- Updated the release guide to preserve release marker branches after
  publication.
- Refreshed built-in capability definitions and admin capability projections so
  deployment authority planning and Console capability-group editing use the
  current materialized capability metadata.

### Fixed

- Fixed browser npm artifacts so the browser graph excludes DNT polyfills and
  Node-only shims, including environment detection paths that need to remain
  safe in bundled browser builds.
- Fixed `@qlever-llc/trellis-svelte` package builds to emit declaration files,
  compiled JavaScript component output for JSR, self-type directives, rewritten
  Svelte component imports, and the runtime dependency metadata needed by
  consumers.
- Ignored generated package declaration outputs from local Trellis package
  builds so release and package smoke checks do not leave untracked `.d.ts`
  files behind.
- Fixed expired browser auth callbacks so stale callback state is reported
  cleanly instead of reusing an invalid browser flow.

## [0.10.13] - 2026-06-10

### Added

- Added language-specific LLM guidance files for TypeScript services, Rust
  services, and Svelte browser apps that consume Trellis.

### Changed

- Updated service-development AI guidance and the service `AGENTS.md` template
  to point agents at focused Trellis service, browser-app, and verification
  rules.

### Fixed

- Fixed Trellis contract event subject parameter validation for union payload
  schemas so `anyOf` and `oneOf` event variants are accepted only when every
  branch exposes the routed JSON Pointer as a string, number, or integer token.

## [0.10.12] - 2026-06-07

### Added

- Added Trellis OpenTelemetry error metrics, including the `trellis.errors`
  counter, low-cardinality error attribute sanitization, public telemetry metric
  helpers, and runtime instrumentation for RPCs, jobs, operations, events,
  feeds, transfers, auth failures, and service lifecycle failures.
- Added optional metrics export from the TypeScript telemetry runtime through
  OTLP endpoints or `TRELLIS_METRICS_CONSOLE`, with metric export interval
  support from `OTEL_METRIC_EXPORT_INTERVAL`.

### Changed

- Changed release publishing to use `release/v*` branch markers so GitHub
  Actions creates the release tag only after the release gate passes and
  publishes from the same verified artifacts.

### Fixed

- Fixed release verification so broad Deno tests run after npm package artifacts
  are built, and made the Jobs integration fixture tolerate transient `Jobs.Get`
  projection misses while the Jobs projector catches up.

## [0.10.11] - 2026-06-07

### Added

- Added `release pretag-check` and `release local-verify` xtask commands so
  release operators can run repeatable local verification and fail-closed
  pre-tag GitHub Release workflow dry-runs from the CLI.
- Added prepared Deno test partitions for faster focused package, service,
  UI/tooling, and packaging verification loops after a single prepare step.

### Changed

- Updated the Release workflow with Deno dependency caching, broader Rust tool
  cache coverage, and timing diagnostics for release verification phases.
- Expanded the release guide with exact Git review commands, targeted
  integration fixture guidance, corrected Rust formatter checks, and staged JSR
  publish verification.

### Fixed

- Annotated TypeScript and Rust handler-boundary errors with service, contract,
  surface, request, and trace metadata while preserving declared business error
  types and omitting internal NATS subjects from serialized error contexts.
- Fixed release verification type checks for cross-runtime timer handles and
  Node stack-trace capture, and restored JS demo contract parity resolution with
  local Trellis import mappings.

## [0.10.10] - 2026-06-06

### Added

- Added deps-aware extracted TypeScript service handler aliases for RPC, event,
  feed, job, operation, and health handlers so standalone handlers can preserve
  `service.with(deps)` typing without local argument/result aliases.

### Fixed

- Made Trellis generator output formatting part of artifact generation so
  `prepare` no longer leaves generated TypeScript, npm package, or embedded Rust
  SDK files needing release-time formatter cleanup.

## [0.10.9] - 2026-06-06

### Added

- Added reusable TypeScript cursor pagination helpers for service contracts and
  handlers, including `CursorQuerySchema`, `CursorPageSchema`,
  `normalizeCursorQuery`, and `buildCursorPage` for stable ID/keyset pages.

### Changed

- Extended `TrellisService.with(deps)` so service health checks and health info
  callbacks can receive application-owned dependencies through `args.deps`.
- Documented offset and cursor pagination helper choices in the design docs,
  guide docs, and out-of-tree service `AGENTS.md` template.

### Fixed

- Restored public root and contract-support exports for offset pagination
  handler helpers `normalizePageQuery` and `buildPageResponse`.

## [0.10.8] - 2026-06-06

### Added

- Added authority-owned capability definition storage and API projections so
  accepted deployment authority, not the active catalog, owns runtime capability
  metadata for admin capability listing and capability-group validation.
- Added typed materialized NATS grants for runtime authority, including service
  transfer endpoints, Jobs runtime internals, platform service calls, and
  owned/used surface grants.
- Added Console Creates/Given authority views for service and device deployment
  capabilities.

### Changed

- Runtime authorization now issues service, device, and delegated user NATS
  permissions from accepted materialized authority instead of deriving allow
  lists from active or known contract manifests at reconnect time.
- Service authority planning now keeps requested needs separate from provided
  surfaces, records accepted offers before materialization refreshes, and uses
  latest accepted implementation offers for same-contract digest updates.
- Updated runtime-authority, capability, and auth API design docs to describe
  contracts as planning inputs and materialized authority as the runtime source
  of truth.

### Fixed

- Fixed service reconnects during accepted-offer stale grace windows and
  restored service operation-store KV grants for operation runtimes.
- Fixed user reauth races where stale same-session-key reconnects could
  overwrite a newer successful bind to another approved contract digest.
- Fixed materialized authority reconstruction so provider-owned surfaces remain
  provided surfaces instead of being copied into requested needs.

## [0.10.7] - 2026-06-06

### Added

- Added `TrellisService.with(deps)` for TypeScript services so service-owned
  RPC, feed, operation, job, and event listener handlers can receive
  application-owned dependencies as `args.deps` without mixing them into Trellis
  runtime context or resource bindings.
- Added service event listener context for TypeScript handlers, including event
  id, time, subject, mode, group, and sequence metadata while preserving
  existing payload-first listener usage.

### Changed

- Updated generated TypeScript SDK service typings, docs, and demos to use bound
  service dependency wrappers where handlers need application dependencies.

### Fixed

- Fixed npm release packaging by bumping hardcoded internal package dependency
  ranges in npm build scripts and teaching `release bump` and
  `release check-versions` to manage those specs for future releases.

## [0.10.6] - 2026-06-06

### Added

- Added `TrellisService.with(deps)` for TypeScript services so service-owned
  RPC, feed, operation, job, and event listener handlers can receive
  application-owned dependencies as `args.deps` without mixing them into Trellis
  runtime context or resource bindings.
- Added service event listener context for TypeScript handlers, including event
  id, time, subject, mode, group, and sequence metadata while preserving
  existing payload-first listener usage.

### Changed

- Updated generated TypeScript SDK service typings, docs, and demos to use bound
  service dependency wrappers where handlers need application dependencies.

## [0.10.5] - 2026-06-05

### Changed

- Trellis now treats omitted `nats.jetstream.replicas` as automatic: the runtime
  probes NATS JetStream topology through the system account and uses `3` only
  when enough current metadata peers are visible, otherwise falling back to `1`.
- Trellis authority resource provisioning and reconciliation now pass the
  resolved JetStream replica count into KV buckets, object stores, and built-in
  Jobs streams instead of relying on hardcoded resource defaults.

### Fixed

- Fixed Trellis-created contract resources and Jobs infrastructure so explicit
  `nats.jetstream.replicas` values in `config.jsonc` are honored consistently.

## [0.10.4] - 2026-06-01

### Fixed

- Fixed the JSR `@qlever-llc/trellis/generate` wrapper so `deno task prepare`
  can read package metadata when the wrapper is loaded from a remote module URL,
  avoiding Deno's file-URL-only read path before the release binary starts.

## [0.10.3] - 2026-05-30

### Fixed

- Promoted the `0.10.3` release after fixing staged JSR publishing and npm
  artifact smoke failures for the public Trellis packages.

## [0.10.3-rc.4] - 2026-05-29

### Fixed

- Fixed npm package smoke failures by rewriting bundled generated SDK imports to
  public `@qlever-llc/trellis` package subpaths and correcting npm `generate`
  manifest discovery for Deno `npm:` execution.

## [0.10.3-rc.3] - 2026-05-29

### Fixed

- Fixed JSR publishing for `@qlever-llc/trellis` by replacing published
  same-package `@qlever-llc/trellis/*` imports with relative imports, including
  the embedded generated SDKs that JSR analyzes without the workspace import
  map.

## [0.10.3-rc.2] - 2026-05-29

### Fixed

- Restored JSR `--allow-dirty` publishing for release-prepared workspaces, which
  intentionally rewrite manifests and generated artifacts before package
  dry-runs and publishing.

## [0.10.3-rc.1] - 2026-05-29

### Fixed

- Fixed JSR release publishing in GitHub Actions by removing the invalid
  `deno eval --allow-read` invocation while keeping slow-type publishing enabled
  for the current generated SDK surface.
- Removed unnecessary dirty-worktree allowances from JSR release dry-runs and
  publishing.

## [0.10.2] - 2026-05-29

### Fixed

- Enabled GitHub Actions JSR publishing for the staged `@qlever-llc/result` and
  `@qlever-llc/trellis` packages.
- Fixed the `@qlever-llc/trellis` JSR package layout so first-party generated
  SDK exports publish from package-local generated files instead of private
  workspace aliases.

## [0.10.1] - 2026-05-29

### Changed

- Renamed the public Rust facade package to `trellis-rs` (crate name
  `trellis_rs`) for crates.io, replacing the previous `trellis` package name
  which conflicted with an unrelated crate.
- Removed generated Trellis-owned SDK crates (`trellis-sdk-auth`,
  `trellis-sdk-core`) from crates.io release publishing; they remain embedded in
  the public Rust facade.
- Updated all Rust code generation to emit the `trellis-rs` dependency key and
  `trellis_rs` import paths consistently across generated SDKs and participant
  facades.

### Fixed

- Fixed crates.io release publishing to publish only public Rust crates and skip
  private workspace crates marked `publish = false`.
- Fixed release preparation for Rust builds by rewriting internal dependencies
  on the root `trellis` crate to the correct version.
- Fixed release npm smoke checks by installing Node type definitions in the
  generated consumer project.
- Fixed release generator tests for current TypeScript client method output and
  Rust SDK dependency names.
- Fixed Rust-authored demo service contract parity with the TypeScript source
  contract.
- Fixed GitHub Pages release-site builds to tolerate unavailable or incomplete
  release worktrees and fall back to current docs or console sources.
- Updated docs examples and guide snippets to use `trellis_rs` import paths.

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

[Unreleased]: https://github.com/Qlever-LLC/trellis/compare/v0.10.14...HEAD
[0.10.14]: https://github.com/Qlever-LLC/trellis/compare/v0.10.13...v0.10.14
[0.10.13]: https://github.com/Qlever-LLC/trellis/compare/v0.10.12...v0.10.13
[0.10.12]: https://github.com/Qlever-LLC/trellis/compare/v0.10.11...v0.10.12
[0.10.11]: https://github.com/Qlever-LLC/trellis/compare/v0.10.10...v0.10.11
[0.10.10]: https://github.com/Qlever-LLC/trellis/compare/v0.10.9...v0.10.10
[0.10.9]: https://github.com/Qlever-LLC/trellis/compare/v0.10.8...v0.10.9
[0.10.8]: https://github.com/Qlever-LLC/trellis/compare/v0.10.7...v0.10.8
[0.10.7]: https://github.com/Qlever-LLC/trellis/compare/v0.10.6...v0.10.7
[0.10.6]: https://github.com/Qlever-LLC/trellis/compare/v0.10.5...v0.10.6
[0.10.5]: https://github.com/Qlever-LLC/trellis/compare/v0.10.4...v0.10.5
[0.10.4]: https://github.com/Qlever-LLC/trellis/compare/v0.10.3...v0.10.4
[0.10.3]: https://github.com/Qlever-LLC/trellis/compare/v0.10.3-rc.4...v0.10.3
[0.10.3-rc.4]: https://github.com/Qlever-LLC/trellis/compare/v0.10.3-rc.3...v0.10.3-rc.4
[0.10.3-rc.3]: https://github.com/Qlever-LLC/trellis/compare/v0.10.3-rc.2...v0.10.3-rc.3
[0.10.3-rc.2]: https://github.com/Qlever-LLC/trellis/compare/v0.10.3-rc.1...v0.10.3-rc.2
[0.10.3-rc.1]: https://github.com/Qlever-LLC/trellis/compare/v0.10.2...v0.10.3-rc.1
[0.10.2]: https://github.com/Qlever-LLC/trellis/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/Qlever-LLC/trellis/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/Qlever-LLC/trellis/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/Qlever-LLC/trellis/compare/v0.8.4...v0.9.0
[0.8.4]: https://github.com/Qlever-LLC/trellis/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/Qlever-LLC/trellis/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/Qlever-LLC/trellis/compare/v0.8.1...v0.8.2
[0.8.0]: https://github.com/Qlever-LLC/trellis/compare/v0.7.0...v0.8.0
[0.8.0-rc.1]: https://github.com/Qlever-LLC/trellis/compare/v0.7.0...v0.8.0-rc.1
