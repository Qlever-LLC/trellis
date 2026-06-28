# Unit Coverage Replacement Ledger

This ledger tracks how unit-style coverage is replaced, temporarily blocked, or
retained as complementary deterministic coverage as the integration replacement
plan moves forward. It is a guardrail: do not delete or shrink a unit-test file
or group unless this document records the replacement live case id,
complementary keep rationale for a pure algorithm/invariant, duplicate-coverage
note, or `[blocked]` gap for intended live behavior that still needs
implementation, harness, or product work.

Phase 0 only freezes the classification structure and ledger template. It does
not retire any unit-test files.

## Required Existing-Live-Coverage Note

Existing live cases in `js/integration/_support/cases.ts:9-468` already cover
RPC/events/feeds, operations, state, transfer, resources, jobs, health,
authority plans, approvals, device activation, and outbox basics.

## Classification Groups

### Replace With Live Integration

Retire these unit-style concepts only after a corresponding live scenario passes
and this ledger maps the retired file or group to the replacement case id:

- Client/service public workflows: RPC success/errors/denials, caller context,
  service startup pending approval, app identity approval, device activation,
  health, operations watch/wait/control, feeds, events, files/transfer, state,
  KV/store resources, jobs, and outbox.
- Auth/admin workflows with public observable behavior: bootstrap, local login,
  app grant approval/revocation, `Auth.Sessions.Me`, device review
  approval/rejection, service/device deployment enable/disable/remove, catalog
  issue resolution, and request proof denial.
- Persistence/restart behavior: authority, sessions, state, catalog active
  contracts, resource bindings, and outbox dispatch recovery.
- Runtime lifecycle behavior: service retry/pending authority, heartbeat,
  resource binding materialization, and job worker presence when observed
  through public jobs/admin APIs.

### Keep As Complementary Unit/Conformance Tests

These categories may remain only as complementary deterministic checks. They are
not substitutes for live Trellis behavior, and they must not cover runtime
behavior by using fake NATS, fake transports, fake control-plane helpers, fake
auth/bootstrap/resource paths, or fake generated-client workflows.

- Type-level and API-export smoke tests: public subpath exports, browser-safe
  exports, package identity, npm/JSR artifacts, and import safety.
- Schema/canonicalization/crypto conformance: canonical JSON, contract digest,
  auth proof vectors, clock skew helpers, schema pointer utilities, and
  validation annotations.
- Code generation and prepare tooling: TypeScript/Rust codegen output, manifest
  layout, prepare/watch planning, and generated package metadata.
- Pure reducers, parsers, and state-machine invariants where no NATS/runtime
  behavior is being simulated. Public lifecycle behavior produced by those
  reducers still needs live integration before fake-runtime tests are retired.
- Config/parsing/release tooling: env parsing, CLI argument boundaries, release
  version/changelog commands, and docs vocabulary guards.
- UI page-state/copy helpers in console, login portal, and Svelte packages.
  These can later move to browser/component tests, but a live Trellis runtime is
  not the logical replacement.

### Existing Live Integration Already Covering Basics

These existing JS live integration groups already cover foundational public
behaviors. Future deletion work should still map retired unit assertions to the
specific case ids or group note that proves equivalent coverage.

| Existing live coverage group                                     | Source range                               | Coverage note                                              |
| ---------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| RPC/events/operations/feeds/state/transfer/resources/jobs/health | `js/integration/_support/cases.ts:10-261`  | Basic public client/service runtime workflows.             |
| Authority plan and service/app/device approval                   | `js/integration/_support/cases.ts:262-433` | Approval and authority-plan basics.                        |
| SQL outbox                                                       | `js/integration/_support/cases.ts:434-467` | Outbox commit, rollback, multi-event, and dispatch basics. |

## Unit Inventory Families

### TypeScript/Deno Families

- Result package: `js/packages/result/tests/*`.
- Trellis test harness: `js/packages/trellis-test/tests/*`, plus integration
  runtime helper tests.
- Public Trellis package: `client_connect_test.ts`, `device.test.ts`,
  `device/deno.test.ts`, `connection_test.ts`, `browser.test.ts`, `kv_test.ts`,
  `store_test.ts`, `request_error_test.ts`, `errors/traceId.test.ts`, and
  generated model tests.
- Auth public helpers: `js/packages/trellis/auth/**/*.test.ts`.
- Contract support and package hygiene:
  `js/packages/trellis/contract_support/**/*_test.ts`,
  `js/packages/trellis/tests/*artifact*`, `*exports*`, `*subpaths*`, `*schema*`,
  `*import*`, and `*publishing*`.
- Server/service runtime: `js/packages/trellis/server/**/*_test.ts`,
  `js/packages/trellis/tests/operations*`, `rpc_integration_test.ts`,
  `trellis_api_guard_test.ts`, and `state_runtime_facade_test.ts`.
- Trellis control plane: `js/services/trellis/**/**/*.test.ts` covering config,
  storage, state, catalog, auth bootstrap/admin/session/http/callout/providers,
  reconciliation, resources, and manifest conformance.
- UI/state tools: `js/packages/trellis-svelte/**/*.test.ts`,
  `js/apps/console/**/*.test.ts`, and `js/portals/login/**/*.test.ts`.
- Tools/demos: package-build release version, docs vocabulary guard, and demo
  evidence download helper.

### Rust Families

- `auth`, `auth-adapters`: protocol, proof, device activation, and request
  adapter.
- `bootstrap`, `core-bootstrap`, `local-bootstrap`: bootstrap validation and
  generated config/layout mapping.
- `cli`, `xtask`, `generate-runner`, `tools/generate`: command parsing,
  release/prepare/generate behavior.
- `client`, `service`, `trellis` facade: fake transport/runtime tests for public
  transport behavior, operation/state APIs, service routing, resources,
  transfer, auth, errors, and runtime facade; fake-runtime Trellis behavior is a
  live replacement candidate.
- `contracts`, `codegen-rust`, `codegen-ts`: manifests, builder DSL,
  canonicalization, and generator output.
- `jobs`, `service-jobs`: job manager, keyed admission, reducers, projection,
  janitor, worker presence, and SDK alignment.
- `runtime`: config, storage, and leases.
- `trellis-test` and `integration-harness`: harness command/runtime parsing.

## Proposed Replacement Case Buckets

### Shared Client Matrix Cases

Use this bucket for public, language-neutral Trellis behavior. Each added case
must have one live TypeScript/Deno test and one live Rust test.

| Proposed case id                                             | Coverage bucket                   |
| ------------------------------------------------------------ | --------------------------------- |
| `operations.client-cancels-operation`                        | Operation control.                |
| `operations.cancel-uses-cancel-capability`                   | Operation cancel authorization.   |
| `operations.rejects-cancel-for-noncancelable-operation`      | Operation cancel rejection.       |
| `operations.client-signals-running-operation`                | Operation signal/control.         |
| `operations.signals-persist-and-consume-in-acceptance-order` | Operation signal ordering.        |
| `operations.queued-signal-delivered-before-live-signal`      | Queued operation signal ordering. |
| `operations.rejects-invalid-signal-payload`                  | Operation signal validation.      |
| `operations.rejects-signal-after-terminal-state`             | Terminal signal rejection.        |
| `jobs.keyed-jobs-serialize-same-key`                         | Keyed job coordination.           |
| `auth.local-login-binds-approved-client`                     | Local login and app approval.     |
| `auth.session-revoke-denies-reconnect`                       | Session revoke/access denial.     |
| `auth.request-proof-replay-and-stale-denied`                 | Public request-proof denial.      |
| `device-activation.review-reject-denies-connect`             | Device activation rejection.      |
| `device-activation.revoked-device-cannot-reconnect`          | Device activation revocation.     |
| `state.admin-inspect-and-delete-state`                       | State admin inspection/deletion.  |
| `transfer.upload-grant-is-session-bound`                     | Upload grant/session binding.     |
| `service-approval.disabled-service-cannot-reconnect`         | Service disable/reconnect denial. |

### Trellis Control-Plane Integration Cases

Use this bucket for control-plane behavior that still needs live replacement.
These cases may start as TypeScript/Deno harness coverage, but unit retirement
requires TypeScript/Deno and Rust parity. A TypeScript-only service-integration
case is incomplete replacement work and is not sufficient retirement evidence by
itself.

| Proposed case id                                                        | Coverage bucket                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| `control-plane.admin-bootstrap-creates-first-local-admin`               | Admin bootstrap.                                              |
| `control-plane.password-reset-change-invalidates-old-password`          | Password reset/change.                                        |
| `control-plane.http-route-security-requires-admin-session`              | HTTP bootstrap route admin-session security.                  |
| `control-plane.service-deployment-remove-cascade-rolls-back-on-failure` | Deployment removal rollback.                                  |
| `control-plane.resource-reconciliation-rolls-back-created-resources`    | Resource reconciliation rollback.                             |
| `control-plane.catalog-active-contracts-survive-restart`                | Catalog active contract persistence.                          |
| `control-plane.sessions-survive-control-plane-restart`                  | Session and authority reuse across restart.                   |
| `control-plane.state-persists-across-control-plane-restart`             | State persistence across restart.                             |
| `control-plane.resources-survive-control-plane-restart`                 | Resource binding/data persistence.                            |
| `control-plane.outbox-dispatches-after-control-plane-restart`           | Service SQL outbox restart recovery.                          |
| `control-plane.catalog-dependency-issue-resolved-by-provider`           | Catalog dependency issue resolution.                          |
| `control-plane.catalog-force-replace-resolves-catalog-issue`            | Catalog force-replace issue resolution.                       |
| `control-plane.jobs-admin-lists-and-cancels-job`                        | Generated Jobs admin behavior.                                |
| `control-plane.state-schema-upgrade-preserves-data`                     | Not currently targeted until DB schema stability is declared. |
| `control-plane.oauth-provider-callback-normalizes-identities`           | OAuth/OIDC identity normalization.                            |
| `control-plane.auth-callout-drain-and-error-response`                   | Auth callout shutdown/error behavior.                         |

## Deletion And Retirement Policy

- Delete or shrink unit tests only in small subsystem packets.
- Before deletion, the replacement live integration case must be implemented,
  passing, and mapped in this ledger.
- Every deleted or shrunk unit-test file or group must record one of:
  - replacement live case id(s),
  - duplicate-coverage note,
  - complementary keep rationale for pure algorithm/invariant coverage, or
  - `[blocked]` gap when intended live behavior cannot be implemented yet.
- Use `[blocked]` only for implementation, harness, or product gaps to fix. Do
  not use it for out-of-scope coverage or tests intended to remain forever.
- Live replacements must pass both required TypeScript/Deno and Rust lanes
  before unit coverage is retired.
- TypeScript-only control-plane/service-integration cases are incomplete until
  paired with Rust parity; they must not be used as the sole reason to retire
  duplicated Trellis service unit coverage.
- Do not delete complementary deterministic tests for contract conformance,
  crypto vectors, codegen output, package export/import smoke checks,
  CLI/release parsers, pure UI state helpers, pure reducers, parser/format
  invariants, or migration invariants. These may remain only as complements, not
  substitutes for live Trellis behavior.

Parity correction: historical rows classified as `*-control-plane`, rows whose
language column is only `ts/deno`, and rows that cite only
`js/services/trellis/integration/**` or `test:service-integration` are
incomplete until Rust parity is added or confirmed. Do not use those rows as
precedent for new retirements without a matching Rust live case. Existing
shrinks that relied on TypeScript-only live evidence must be completed with Rust
live coverage or corrected by restoring/reclassifying the unit coverage.

### Parity Debt Audit

These completion-required rows were identified by the parity audit. A row is not
complete unless TypeScript/Deno and Rust live coverage both exist, or the unit
coverage is restored/reclassified so no live replacement is being claimed.

| Debt area                                | TypeScript/Deno evidence                                                                                                | Completion required                                                                                                                               | Priority |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Event consumers                          | `event-consumers.*` service-integration cases                                                                           | Rust parity is implemented for all event-consumer listener binding/error/group/ephemeral/duplicate/self-owned/readiness/abort/stop/lifecycle rows | done     |
| Prepared events                          | `prepared-events.prepared-publish-preserves-custom-headers-and-annotates-handler-error` TS and Rust live coverage       | Rust prepared publish/header/body parity and handler-error annotation coverage are implemented                                                    | done     |
| Admin bootstrap and `/bootstrap/client`  | `control-plane.admin-bootstrap-creates-first-local-admin`, `control-plane.http-route-security-requires-admin-session`   | Rust first-admin bootstrap and `/bootstrap/client` session-security parity implemented                                                            | done     |
| Password reset/change                    | `control-plane.password-reset-change-invalidates-old-password`                                                          | Rust local reset flow completion, password change, old-password denial, and new-password login parity implemented                                 | done     |
| Catalog active/dependency behavior       | `control-plane.catalog-active-contracts-survive-restart`, `control-plane.catalog-dependency-issue-resolved-by-provider` | Rust catalog restart persistence and dependency-resolution parity are implemented                                                                 | done     |
| Session restart persistence              | `control-plane.sessions-survive-control-plane-restart`                                                                  | Rust session restart persistence parity now implemented with bound-only reconnect                                                                 | done     |
| State/resource/control-plane persistence | `control-plane.state-persists-across-control-plane-restart`, `control-plane.resources-survive-control-plane-restart`    | Rust state and resource restart parity are implemented                                                                                            | done     |
| Catalog force-replace                    | `control-plane.catalog-force-replace-resolves-catalog-issue`                                                            | Rust force-replace issue resolution parity is implemented                                                                                         | done     |
| Jobs admin generated subset              | `control-plane.jobs-admin-lists-and-cancels-job`                                                                        | Rust generated Jobs admin parity is implemented                                                                                                   | done     |

Catalog dependency-resolution, catalog force-replace, state restart, resource
restart, generated Jobs admin parity, all event-consumer listener
binding/error/group/ephemeral/duplicate/self-owned/readiness/abort/stop/lifecycle
rows, and the prepared-events header/error-annotation row are now complete.

Catalog force-replace Rust parity verification passed with
`rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration control_plane_catalog_force_replace_resolves_catalog_issue -- --nocapture`
and both Rust matrix conformance tests.

Service-integration registry status: the `kind: "service"` cases in
`integration/test-matrix.json` now own all 32 service-integration cases from the
`control-plane`, `event-consumers`, and `prepared-events` fixtures. The
TypeScript runner manifest is derived from that registry, and the service matrix
conformance test enforces ID parity, file/test-name linkage, case-scoped runtime
usage, and Rust completion metadata. Rust completion is implemented for
`control-plane.admin-bootstrap-creates-first-local-admin`,
`control-plane.password-reset-change-invalidates-old-password`, and
`control-plane.http-route-security-requires-admin-session`,
`control-plane.bootstrap-requires-auth-for-unbound-client`,
`control-plane.bootstrap-rejects-unknown-contract-digest`, and
`control-plane.bootstrap-rejects-non-client-contract`,
`control-plane.catalog-active-contracts-survive-restart`,
`control-plane.catalog-dependency-issue-resolved-by-provider`,
`control-plane.catalog-force-replace-resolves-catalog-issue`,
`control-plane.sessions-survive-control-plane-restart`,
`control-plane.state-persists-across-control-plane-restart`, and
`control-plane.resources-survive-control-plane-restart`,
`control-plane.outbox-dispatches-after-control-plane-restart`,
`control-plane.session-logout-deletes-session-and-denies-reuse`, and
`control-plane.session-logout-kicks-runtime-access`,
`control-plane.session-logout-validates-return-to`, and
`control-plane.session-logout-uses-provider-logout-redirect`, and
`control-plane.jobs-admin-lists-and-cancels-job`,
`event-consumers.durable-listen-without-declared-group-returns-err`,
`event-consumers.ambiguous-group-without-opts-group-returns-err-and-specifying-group-works`,
`event-consumers.caller-provided-durable-name-returns-err`,
`event-consumers.bound-dependency-consumer-uses-trellis-provisioned-consumer-only`,
and
`event-consumers.ephemeral-listener-avoids-durable-metadata-and-jetstream-consumer`,
`event-consumers.duplicate-handlers-share-single-group-waiter`, and
`event-consumers.self-owned-durable-consumer-receives-self-published-event`, and
`event-consumers.grouped-consumer-waits-for-all-handlers-before-consuming-queued-event`,
`event-consumers.self-owned-grouped-consumer-waits-for-all-handlers-before-consuming-queued-event`,
`event-consumers.abort-re-register-restarts-delivery`, and
`event-consumers.stop-teardown-stops-durable-delivery`,
`event-consumers.transient-missing-consumer-retries-after-reconcile`,
`event-consumers.readiness-lost-does-not-nak-delivered-group-message`, and
`prepared-events.prepared-publish-preserves-custom-headers-and-annotates-handler-error`,
using `implementations.rust.module/function` entries in the shared service
matrix and matching Rust registry entries in `control_plane`,
`control_plane_jobs_admin`, `event_consumers`, and `prepared_events`. The
service matrix is now 32/32 implemented with 0 remaining Rust-required rows.

## Phase 5 Shrink Packets

| Unit file or group                                                                                                                                                                                     | Language         | Classification                       | Replacement case id(s) or keep rationale                                                                                                                                                                                                                             | Status | Verification performed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First-admin bootstrap and `/bootstrap/client` duplicated happy-path assertions from `js/services/trellis/auth/account_flows/bootstrap.test.ts` and `js/services/trellis/auth/bootstrap/client.test.ts` | ts/deno          | duplicate-retired-live-control-plane | `control-plane.admin-bootstrap-creates-first-local-admin`, `control-plane.http-route-security-requires-admin-session`                                                                                                                                                | shrunk | `deno task -c js/deno.json test:service-integration -- --case control-plane.admin-bootstrap-creates-first-local-admin` passed; `deno task -c js/deno.json test:service-integration -- --case control-plane.http-route-security-requires-admin-session` passed; `deno test --no-check -A -c js/deno.json js/services/trellis/auth/account_flows/bootstrap.test.ts js/services/trellis/auth/bootstrap/client.test.ts` passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Removed only `completeAdminBootstrapLocalPassword creates the first active local admin`, `POST /bootstrap/client returns runtime bootstrap info for bound browser sessions`, and `POST /bootstrap/client returns auth_required when no bound user session exists`. Retained first-admin bootstrap edge/error units and `/bootstrap/client` exact-digest, inactive-user, non-client-contract, clock-skew, invalid-signature, known-inactive-digest units; retained CORS/header/parser/security/provider/crypto/schema coverage.                                                                      |
| Local-password account-flow HTTP completion happy-path assertions from `js/services/trellis/auth/http/routes.test.ts`                                                                                  | ts/deno          | duplicate-retired-live-control-plane | `control-plane.password-reset-change-invalidates-old-password`                                                                                                                                                                                                       | shrunk | `deno task -c js/deno.json test:service-integration -- --case control-plane.password-reset-change-invalidates-old-password` passed; `deno test --no-check -A -c js/deno.json js/services/trellis/auth/http/routes.test.ts` passed; `deno check -c js/deno.json js/services/trellis/auth/http/routes.test.ts` passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Removed only `auth HTTP account-flow local-password endpoint completes target account flow`, a route success-path duplicate covered by the live password reset/change case. Retained password hashing parameter coverage, password reset/change RPC unit edge cases, invalid/expired/reset-token and inactive-target local-password route errors, local-login inactive/lockout/rate-limit errors, provider/CORS/cookie/parser/security/schema coverage, and bootstrap reset/session-revocation edge units.                                                                                          |
| Local-login app-session bind happy-path assertions from `js/services/trellis/auth/http/routes.test.ts` and `js/services/trellis/auth/session/bind.test.ts`                                             | ts/deno          | duplicate-retired-live-shared-matrix | `auth.local-login-binds-approved-client`                                                                                                                                                                                                                             | shrunk | `deno task -c js/deno.json test:integration -- --case auth.local-login-binds-approved-client` passed; `rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration auth_local_login_binds_approved_client -- --nocapture` passed; `deno test --no-check -A -c js/deno.json js/services/trellis/auth/http/routes.test.ts js/services/trellis/auth/session/bind.test.ts` passed; `deno check -c js/deno.json js/services/trellis/auth/http/routes.test.ts js/services/trellis/auth/session/bind.test.ts` passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Removed only `auth HTTP local login creates pending auth for linked active identity` and `ensureBoundUserSession creates a new session when none exists`. Retained malformed bind/request validation, missing-identity invalid-credential behavior, local-login lockout/reset/inactive/expired-flow edge cases, rebinding/kick/session-authority-change/storage-error units, `Auth.Sessions.Me` envelope/active-account validation units, and provider/CORS/cookie/parser/security/schema/crypto coverage.                                                                                          |
| State admin inspect/list/delete happy-path assertions from `js/services/trellis/state/rpc.test.ts`                                                                                                     | ts/deno and rust | duplicate-retired-live-shared-matrix | `state.admin-inspect-and-delete-state`                                                                                                                                                                                                                               | shrunk | `deno task -c js/deno.json test:integration -- --case state.admin-inspect-and-delete-state` passed; `rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration state_admin_inspect_and_delete_state -- --nocapture` passed; `deno test --no-check -A -c js/deno.json js/services/trellis/state/rpc.test.ts` passed; `deno check -c js/deno.json js/services/trellis/state/rpc.test.ts` passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Removed only duplicated `adminGet`, `adminList`, `adminDelete`, and post-delete missing success assertions from `State admin RPCs inspect and delete named stores`, plus the now-unused `listedKey` helper. Retained admin auth denial, missing-store validation, wrong-contract validation, migration metadata/schema coverage, session resolver failure coverage, ownership/validation/boolean schema units, and other state edge coverage.                                                                                                                                                       |
| Catalog accepted implementation offer active-catalog happy-path assertions from `js/services/trellis/catalog/runtime.test.ts`                                                                          | ts/deno          | duplicate-retired-live-control-plane | `control-plane.catalog-active-contracts-survive-restart`, `control-plane.catalog-dependency-issue-resolved-by-provider`                                                                                                                                              | shrunk | `deno task -c js/deno.json test:service-integration -- --case control-plane.catalog-active-contracts-survive-restart` passed; `deno task -c js/deno.json test:service-integration -- --case control-plane.catalog-dependency-issue-resolved-by-provider` passed; `deno test --no-check -A -c js/deno.json js/services/trellis/catalog/runtime.test.ts` passed; `deno check -c js/deno.json js/services/trellis/catalog/runtime.test.ts` passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Removed only `contracts runtime includes accepted implementation offers as active`. Retained unknown dependency validation, optional/grouped uses, known inactive provider/use coverage, stale/expired offers, incompatible active-offer issue coverage, cache pruning/repair, dry-run mutation guards, built-in lineage, disabled deployments, device cold paths, and force-replace coverage.                                                                                                                                                                                                      |
| State storage map-store public get happy-path assertion from `js/services/trellis/state/storage.test.ts`                                                                                               | ts/deno          | duplicate-shrunk                     | `control-plane.state-persists-across-control-plane-restart`, `state.map-store-prefix-put-get-list-delete`, `state.map-store-list-limit`, `state.value-store-create-read-delete`, `state.value-store-stale-revision-rejected`, `state.admin-inspect-and-delete-state` | shrunk | `deno task -c js/deno.json test:service-integration -- --case control-plane.state-persists-across-control-plane-restart` passed; `deno task -c js/deno.json test:integration -- --case state.value-store-create-read-delete` passed; `deno task -c js/deno.json test:integration -- --case state.value-store-stale-revision-rejected` passed; `deno task -c js/deno.json test:integration -- --case state.map-store-prefix-put-get-list-delete` passed; `deno task -c js/deno.json test:integration -- --case state.map-store-list-limit` passed; `deno task -c js/deno.json test:integration -- --case state.admin-inspect-and-delete-state` passed; `deno test --no-check -A -c js/deno.json js/services/trellis/state/storage.test.ts` passed; `deno check -c js/deno.json js/services/trellis/state/storage.test.ts` passed.                                                                                                                                                             | Removed only the redundant map-store public `get`/`assertFound` happy-path assertion from `StateStore lists lexicographic pages for map stores`. Retained lexicographic ordering, pagination offsets/count/nextOffset, limit-zero behavior, conditional writes, unconditional put no-extra-load, TTL expiry, KV-safe encoding, dotted tuple collision prevention, sentinel-like key listing, provenance/migration metadata, corruption/non-JSON handling, validation errors, and injected KV failure paths.                                                                                         |
| Stored service resource binding happy-path assertions from `js/services/trellis/auth/bootstrap/service.test.ts`                                                                                        | ts/deno          | duplicate-retired-live-control-plane | `control-plane.resources-survive-control-plane-restart`, `resources.service-receives-required-bindings`, `resources.service-kv-create-put-get-delete`, `resources.service-store-create-read-list-delete`                                                             | shrunk | `deno task -c js/deno.json test:service-integration -- --case control-plane.resources-survive-control-plane-restart` passed; `deno task -c js/deno.json test:integration -- --case resources.service-receives-required-bindings` passed; `deno task -c js/deno.json test:integration -- --case resources.service-kv-create-put-get-delete` passed; `deno task -c js/deno.json test:integration -- --case resources.service-store-create-read-list-delete` passed; `deno test --no-check -A -c js/deno.json js/services/trellis/auth/bootstrap/service.test.ts` passed; `deno check -c js/deno.json js/services/trellis/auth/bootstrap/service.test.ts` passed.                                                                                                                                                                                                                                                                                                                               | Removed only `POST /bootstrap/service returns stored resource bindings`. Retained first-start acceptance, accepted offer creation/status/digest/staleness, contract storage, capability projection, jobs/event-consumer binding shape, missing optional bindings, stale binding tolerance, resource grants, reconciliation, rollback/purge-adjacent, and migration tests.                                                                                                                                                                                                                           |
| Service-local `JobRef` wait/cancel happy-path assertions from `js/packages/trellis/server/service_test.ts`                                                                                             | ts/deno and rust | duplicate-retired-live-control-plane | `control-plane.jobs-admin-lists-and-cancels-job`, `jobs.keyed-jobs-serialize-same-key`, `jobs.job-wait-returns-typed-result`                                                                                                                                         | shrunk | `deno task -c js/deno.json test:service-integration -- --case control-plane.jobs-admin-lists-and-cancels-job` passed; `deno task -c js/deno.json test:integration -- --case jobs.keyed-jobs-serialize-same-key` passed; `deno task -c js/deno.json test:integration -- --case jobs.job-wait-returns-typed-result` passed; `rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration jobs_keyed_jobs_serialize_same_key -- --nocapture` passed; `rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration jobs_job_wait_returns_typed_result -- --nocapture` passed; `deno test --no-check -A -c js/deno.json js/packages/trellis/server/service_test.ts js/packages/trellis/server/internal_jobs/job-manager_test.ts js/packages/trellis/server/internal_jobs/key-coordinator_test.ts js/packages/trellis/server/internal_jobs/runtime-worker_test.ts` passed; `deno check -c js/deno.json js/packages/trellis/server/service_test.ts` passed. | Removed only `service-local JobRef wait observes scoped lifecycle events` and the duplicate final `ref.get()` cancelled-state assertion from `service-local JobRef cancel publishes scoped cancelled lifecycle event`. Updated local NATS test doubles for current `Subscription`/`NatsConnection` interfaces. Retained duplicate-handler registration, service wait worker startup/stop behavior, wait-after-terminal behavior, cancel publication event/header details, cancel-after-terminal no-op behavior, and low-level job reducer/projector/janitor/advisory/keyed-policy/worker internals. |
| Operation start/wait success assertions from `js/packages/trellis/server/service_operation_test.ts`                                                                                                    | ts/deno          | duplicate-retired-live-shared-matrix | `operations.client-starts-operation`, `operations.client-waits-for-completion`, `operations.client-watches-progress`                                                                                                                                                 | shrunk | `deno task -c js/deno.json test:integration -- --case operations.client-starts-operation` passed; `deno task -c js/deno.json test:integration -- --case operations.client-waits-for-completion` passed; `deno task -c js/deno.json test:integration -- --case operations.client-watches-progress` passed; `rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration operations_client -- --nocapture` passed; `deno test --no-check -A -c js/deno.json js/packages/trellis/server/service_operation_test.ts` passed; `deno check -c js/deno.json js/packages/trellis/server/service_operation_test.ts` passed.                                                                                                                                                                                                                                                                                                                                                        | Removed only duplicated start-ref existence and terminal completed-output assertions from `TrellisService.operation handles owned workflows`. Updated shared routed NATS test doubles for current `Subscription`/`NatsConnection` interfaces. Retained owned workflow handler registration, service handler input assertion, client context assertion, deferred completion behavior, progress watcher behavior, cancellation/signal routing, transport/control frame handling, and operation edge/error units.                                                                                      |
| Schema-validation fake-runtime RPC success assertion from `js/packages/trellis/tests/schema_validation_integration_test.ts`                                                                            | ts/deno          | duplicate-retired-live-shared-matrix | Existing `rpc.client-calls-service-success` plus pure schema validation coverage in `js/packages/trellis/tests/schema_validation_error_test.ts`; no new live cases.                                                                                                  | shrunk | `deno test --no-check -A -c js/deno.json js/packages/trellis/tests/schema_validation_integration_test.ts js/packages/trellis/tests/schema_validation_error_test.ts` passed; `deno check -c js/deno.json js/packages/trellis/tests/schema_validation_integration_test.ts js/packages/trellis/tests/schema_validation_error_test.ts` passed; `deno task -c js/deno.json test:integration -- --case rpc.client-calls-service-success` passed; `rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration rpc_client_calls_service_success -- --nocapture` passed.                                                                                                                                                                                                                                                                                                                                                                                                         | Removed only `RPC valid annotated input succeeds and handler is called`. Retained invalid schema over-wire tests because they are not live-replaced, and retained pure `SchemaValidationError`/annotation parse coverage in `schema_validation_error_test.ts`.                                                                                                                                                                                                                                                                                                                                      |

Correction for the historical service-local `JobRef` ledger row above: the
`service-local JobRef wait observes scoped lifecycle events` test is retained in
the current worktree. Packet 17 removed only the fake heartbeat baseline test
and the duplicate direct `cancelled.state` assertion while preserving the
post-cancel `ref.get()` cancelled-state assertion and lifecycle event checks.

Catalog parity correction for the historical catalog row above:
`control-plane.catalog-active-contracts-survive-restart` now has Rust live
parity in `rust/crates/trellis/tests/integration/control_plane.rs`, including a
bound-only client reconnect after control-plane restart. The separate
`control-plane.catalog-dependency-issue-resolved-by-provider` service case also
has Rust live parity, with a broad pre-provider public failure assertion and
same-client success after the provider service appears.

Jobs and outbox parity correction for the historical rows below:
`control-plane.jobs-admin-lists-and-cancels-job` now has Rust live parity in
`rust/crates/trellis/tests/integration/control_plane_jobs_admin.rs`, using
generated Jobs admin RPCs and the public Rust jobs runtime building blocks.
Durable SQL replay, retry/DLQ, key-admin, and stale-worker edge coverage remain
future work. `control-plane.outbox-dispatches-after-control-plane-restart` now
has Rust live parity in `rust/crates/trellis/tests/integration/control_plane.rs`
for a caller-owned SQL outbox row dispatched after control-plane restart. Rust
uses the public one-shot outbox dispatcher primitive; Rust does not yet have the
TypeScript service background-dispatcher facade.

Additional Phase 5 retirement entries:

Correction for the historical local-login app-session bind row below: Packet 11
later deleted `js/services/trellis/auth/session/bind.test.ts` after TS and Rust
live parity landed for rebind and replacement behavior. The old note about
retained rebinding/session-authority/storage-error units is no longer current.

- `/bootstrap/client` auth-required, unknown digest, and non-client digest fake
  assertions from `js/services/trellis/auth/bootstrap/client.test.ts`:
  `retired-live-control-plane`, `ts/deno and rust`, shrunk, replaced by
  `control-plane.bootstrap-requires-auth-for-unbound-client`,
  `control-plane.bootstrap-rejects-unknown-contract-digest`, and
  `control-plane.bootstrap-rejects-non-client-contract`. Removed the
  no-bound-session auth-required unit, unknown stored contract digest cleanup
  unit, and non-client stored digest cleanup unit. The non-client live case now
  covers both known service and known device contract digests. Retained exact
  same-contract-id digest selection, inactive/missing/insufficient user
  projection cleanup, clock-skew, invalid-signature, and known inactive app
  digest coverage.
- HTTP session logout route assertions from
  `js/services/trellis/auth/http/session_logout_routes.test.ts`:
  `retired-live-control-plane`, `ts/deno and rust`, shrunk, replaced by
  `control-plane.session-logout-deletes-session-and-denies-reuse`,
  `control-plane.session-logout-kicks-runtime-access`,
  `control-plane.session-logout-validates-return-to`, and
  `control-plane.session-logout-uses-provider-logout-redirect`. Removed the fake
  combined delete/kick/provider redirect assertion and the fake safe
  same-origin/cross-origin `returnTo` assertions. The live replacement covers
  signed logout session deletion, same-session-key bootstrap reuse denial, two
  concurrently connected clients losing authenticated runtime access, live
  provider logout URL construction from configured OIDC metadata, cross-origin
  `returnTo` rejection, same-origin `returnTo` acceptance, and rejected-request
  session preservation. Retained unknown additive field, bad signature,
  stale/future `iat`, missing session, redirect-mode 303, and malformed request
  units as deterministic parser/crypto/schema/route-shape coverage.
- Service deployment admin RPC assertions from
  `js/services/trellis/auth/admin/rpc.test.ts`: `retired-live-control-plane`,
  `ts/deno and rust`, shrunk, replaced by
  `control-plane.admin-service-deployment-lifecycle`. Removed the fake
  `Auth.Deployments.Create service returns mutable-dev compatibility mode` unit
  and the duplicate stored-deployment disabled assertion from
  `Auth.Deployments.Disable service updates the deployment authority disabled
  state`.
  The live replacement uses generated Auth admin RPCs to create, list, disable,
  enable, remove, and reject a second remove for a service deployment. Retained
  authority initialization/reset, staged catalog validation, authority-disabled
  mutation, enable reconciliation ordering, cascade/purge, runtime kick/session
  cleanup, unused-contract cleanup, storage/refresh/kick rollback, and device
  admin assertions. No matching missing-remove unit existed; the live row now
  covers that modeled failure before any future shrink.
- Admin deployment rollback/fault assertions from
  `js/services/trellis/auth/admin/rpc.test.ts`: `retired-live-control-plane`,
  `ts/deno and rust`, shrunk, replaced by
  `control-plane.admin-service-deployment-rollback-fault` and
  `control-plane.admin-device-deployment-rollback-fault`. Removed the fake
  `Auth.Deployments.Create device rolls back deployment when authority
  initialization fails`
  unit. Shrunk the fake service cascade-delete failure unit to retain only
  internal instance-delete attempt ordering; public rollback of a deleted
  service instance with the deployment still available and successful retry are
  live-covered. The service create-authority failure unit and device
  cascade-delete failure unit were not present in the current file. Retained
  staged validation, refresh failure, kick/session cleanup, activation review,
  authority-disabled mutation, security/order/validator, and other
  device/service admin edge units until a matching live TS/Rust parity case
  covers those exact behaviors. The retained `Auth.Devices.Remove`
  refresh-failure unit keeps delete-then-refresh rollback and no-kick checks.
- Auth admin refresh-failure rollback assertions from
  `js/services/trellis/auth/admin/rpc.test.ts`: `retired-live-control-plane`,
  `ts/deno and rust`, shrunk, replaced by
  `control-plane.admin-service-deployment-disable-refresh-rollback`,
  `control-plane.admin-service-deployment-enable-refresh-rollback`,
  `control-plane.admin-service-instance-disable-refresh-rollback`,
  `control-plane.admin-service-instance-enable-refresh-rollback`,
  `control-plane.admin-service-instance-remove-refresh-rollback`,
  `control-plane.admin-device-deployment-disable-refresh-rollback`,
  `control-plane.admin-device-deployment-enable-refresh-rollback`,
  `control-plane.admin-device-instance-disable-refresh-rollback`,
  `control-plane.admin-device-instance-enable-refresh-rollback`, and
  `control-plane.admin-device-instance-remove-refresh-rollback`. Removed only
  public duplicate rollback assertions: service instance enable restoring the
  listed instance state, device deployment enable restoring the listed
  deployment state, and device instance remove restoring the listed device
  record. The live replacement uses generated Auth admin RPCs plus existing
  fail-once refresh hooks, proves the injected hook through `UnexpectedError`
  cause/context, and proves publicly observable deployment disabled flags,
  service instance disabled flags, device instance states, and removed-record
  rollback. Retained authority rollback, provisioning-secret and activation
  restoration, no-kick behavior, staged validation, and private ordering
  assertions as complementary unit coverage.
- Auth admin service deployment staged-validation assertions from
  `js/services/trellis/auth/admin/rpc.test.ts`: `retired-live-control-plane`,
  `ts/deno and rust`, shrunk, tracked by
  `control-plane.admin-service-deployment-validate-before-persist-kick`. Removed
  only the duplicate fake public no-persist assertion from
  `Auth.Deployments.Disable service validates staged deployment before
  persisting or kicking`.
  The TypeScript and Rust live replacements use generated Auth admin RPCs, the
  existing fail-once `validateActiveCatalog` hook, and a live ping
  service/client to prove the failed disable leaves the deployment enabled and
  does not kick the connected service. Retained staged-payload validation,
  no-refresh, and internal no-kick assertions as complementary private/order
  coverage.
- Catalog RPC assertions from `js/services/trellis/catalog/rpc.test.ts`:
  `retired-live-control-plane`, `ts/deno and rust`, shrunk, replaced by
  `control-plane.catalog-active-contracts-survive-restart`,
  `control-plane.catalog-dependency-issue-resolved-by-provider`,
  `control-plane.catalog-force-replace-resolves-catalog-issue`,
  `control-plane.catalog-surface-status-reports-provider-runtime`,
  `resources.service-receives-required-bindings`,
  `resources.service-kv-create-put-get-delete`,
  `resources.service-store-create-read-list-delete`, and
  `control-plane.resources-survive-control-plane-restart`. Removed the fake
  materialized binding happy path, the fake `Trellis.Catalog` active-contract
  listing happy path, fake `Trellis.Contract.Get` exports/docs projection, and
  fake `Trellis.Surface.Status` assertions for accepted shape unavailable,
  unauthorized missing capability, live implementer, disabled service instance,
  unknown contract, unknown surface, event missing action validation, invalid
  feed publish validation, invalid RPC subscribe validation, no-live
  implementer, unrelated-live-service filtering, and same-lineage old-digest
  filtering. The live replacements use public contract approval, service
  registration/provisioning, client connection, generated Core
  `Trellis.Contract.Get`, generated Core `Trellis.Surface.Status`, generated
  Auth connection/admin RPCs, and generated provider RPC calls. Retained stale
  authority binding hiding and capability definition helper projection as
  deterministic projection/internal coverage. Verification passed:
  `rtk deno check -c js/deno.json js/services/trellis/catalog/rpc.test.ts js/services/trellis/integration/control-plane/catalog_surface_status_reports_provider_runtime.integration_test.ts`,
  `rtk deno test --no-check -A -c js/deno.json js/services/trellis/catalog/rpc.test.ts`,
  `rtk deno task -c js/deno.json test:service-integration -- --case control-plane.catalog-surface-status-reports-provider-runtime`,
  `rtk deno test -A -c js/deno.json js/services/trellis/integration/matrix_conformance_test.ts`,
  `rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration control_plane_catalog_surface_status_reports_provider_runtime -- --nocapture`,
  and
  `rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration rust_service_integration_manifest_conforms_to_shared_matrix`.
- Session bind/revoke helper assertions from
  `js/services/trellis/auth/session/bind.test.ts` and
  `js/services/trellis/auth/session/revoke_runtime_access.test.ts`:
  `retired-live-shared-matrix`, `ts/deno and rust`, deleted, replaced by
  `auth.local-login-rebinds-existing-session-with-updated-authority`,
  `auth.local-login-replaces-session-when-identity-changes`, and
  `auth.session-revoke-cleans-runtime-connection-presence`. Removed fake
  same-identity rebind/createdAt/updated-authority assertions,
  runtime-authority-change kick/delete assertions, and
  different-identity/session-key replacement assertions, then deleted
  `bind.test.ts` rather than keeping omitted-app or storage-error fake-only
  branches. Removed the runtime-access revoke fake assertions, then deleted
  `revoke_runtime_access.test.ts` rather than keeping malformed-record fake-only
  branches. The live replacements use public local-login, generated Auth
  Sessions/Users/Connections RPCs, same-session-key rebind/replacement,
  generated `Auth.Sessions.Revoke`, and live client denial after stale access is
  kicked. `ensureBoundUserSession` now requires the app identity shape supplied
  by its public bind caller.
- Schema-validation fake-runtime invalid RPC input assertions from
  `js/packages/trellis/tests/schema_validation_integration_test.ts`:
  `retired-live-shared-matrix`, `ts/deno and rust`, deleted, replaced by
  `rpc.invalid-annotated-input-schema-validation` and
  `rpc.invalid-mixed-input-validation`. Removed fake-runtime invalid annotated
  input and mixed input validation tests, then deleted the empty
  `schema_validation_integration_test.ts` file. Rust replacement now uses
  descriptor-backed `client.call::<...>` with invalid typed input. Retained pure
  deterministic schema validation and annotation parsing coverage in
  `js/packages/trellis/tests/schema_validation_error_test.ts`.
- Prepared-event fake-runtime publish/header/error-annotation assertions from
  `js/packages/trellis/tests/prepared_events_test.ts`:
  `duplicate-retired-live-service-matrix`, `ts/deno and rust`, shrunk, tracked
  by
  `prepared-events.prepared-publish-preserves-custom-headers-and-annotates-handler-error`.
  The TypeScript and Rust service-integration cases prove prepared publish
  custom-header preservation, prepared payload/context delivery including body
  field named `header`, and handler-error annotation against live Trellis.
  Retained only deterministic `prepare` invariants: frozen prepared events
  without contract metadata and body fields named `header` not being confused
  with runtime metadata.
- Service runtime fake-NATS heartbeat baseline and duplicate `JobRef` cancelled
  state assertions from `js/packages/trellis/server/service_test.ts`:
  `duplicate-retired-live-shared-matrix/control-plane`, `ts/deno`, shrunk,
  replaced by `health.client-subscribes-to-heartbeats`,
  `health.heartbeat-includes-service-metadata`,
  `health.heartbeat-includes-custom-checks`,
  `control-plane.jobs-admin-lists-and-cancels-job`, and
  `jobs.job-wait-returns-typed-result`. Removed the whole fake-NATS
  `service heartbeat publishing starts from baseline health use` test and only
  the duplicate `assertEquals(cancelled.state, "cancelled")` assertion from
  `service-local JobRef cancel publishes scoped cancelled lifecycle event`.
  Retained lifecycle event subject/body/header assertions, the post-cancel
  `ref.get()` cancelled-state assertion, heartbeat stop-on-terminal-close,
  health endpoint/dependency behavior, handler dependency isolation, service
  wait startup/stop behavior, wait-after-terminal behavior,
  cancel-after-terminal no-op behavior, and low-level job reducer, projector,
  janitor, advisory, key-format, keyed-policy, retry/DLQ-adjacent, and worker
  internal tests. Verification passed:
  `deno task -c js/deno.json test:integration -- --case health.client-subscribes-to-heartbeats`,
  `deno task -c js/deno.json test:integration -- --case health.heartbeat-includes-service-metadata`,
  `deno task -c js/deno.json test:integration -- --case health.heartbeat-includes-custom-checks`,
  `deno task -c js/deno.json test:service-integration -- --case control-plane.jobs-admin-lists-and-cancels-job`,
  `deno task -c js/deno.json test:integration -- --case jobs.job-wait-returns-typed-result`,
  `deno test --no-check -A -c js/deno.json js/packages/trellis/server/service_test.ts js/packages/trellis/server/internal_jobs/runtime-worker_test.ts`,
  and
  `deno check -c js/deno.json js/packages/trellis/server/service_test.ts js/packages/trellis/server/internal_jobs/runtime-worker_test.ts`.

Schema invalid-RPC verification bundle:
`deno task -c js/deno.json check:integration` passed;
`deno check -c js/deno.json js/packages/trellis-test/src/nats_container.ts js/packages/trellis-test/src/runtime.ts js/packages/trellis-test/index.ts js/packages/trellis/tests/prepared_events_test.ts js/packages/trellis/tests/schema_validation_error_test.ts`
passed;
`deno task -c js/deno.json test:integration -- --case rpc.invalid-annotated-input-schema-validation`
passed;
`deno task -c js/deno.json test:integration -- --case rpc.invalid-mixed-input-validation`
passed;
`rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration rpc_invalid_annotated_input_schema_validation -- --nocapture`
passed;
`rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration rpc_invalid_mixed_input_validation -- --nocapture`
passed;
`deno test --no-check -A -c js/deno.json js/packages/trellis/tests/prepared_events_test.ts js/packages/trellis/tests/schema_validation_error_test.ts`
passed.

Prepared-events verification bundle:
`deno task -c js/deno.json check:service-integration` passed;
`deno check -c js/deno.json js/packages/trellis-test/src/nats_container.ts js/packages/trellis-test/src/runtime.ts js/packages/trellis-test/index.ts js/packages/trellis/tests/prepared_events_test.ts js/packages/trellis/tests/schema_validation_error_test.ts`
passed;
`deno task -c js/deno.json test:service-integration -- --case prepared-events.prepared-publish-preserves-custom-headers-and-annotates-handler-error`
passed;
`deno test --no-check -A -c js/deno.json js/packages/trellis/tests/prepared_events_test.ts js/packages/trellis/tests/schema_validation_error_test.ts`
passed.

RPC auth-validation retry replacement:

- Fake routed transient `session_not_found` retry assertion from
  `js/packages/trellis/tests/rpc_integration_test.ts`:
  `retired-live-shared-matrix`, `ts/deno and rust`, deleted, replaced by
  `rpc.auth-validation-retries-transient-session-not-found`. The live TS and
  Rust cases use real clients/services, live control-plane SQLite session
  deletion and restoration, and raw NATS observation of
  `rpc.v1.Auth.Requests.Validate` to prove two validation attempts and one
  service handler call. Production auth validation now records replay state only
  after session lookup succeeds, so a transient `session_not_found` does not
  poison retry replay state. Retained no fake-routed RPC behavior in
  `rpc_integration_test.ts`.

Rust service-integration parity bundle:
`control-plane.admin-bootstrap-creates-first-local-admin`,
`control-plane.password-reset-change-invalidates-old-password`,
`control-plane.http-route-security-requires-admin-session`,
`control-plane.catalog-active-contracts-survive-restart`, and
`control-plane.sessions-survive-control-plane-restart` now have Rust live parity
in `rust/crates/trellis/tests/integration/control_plane.rs`.
`control-plane.state-persists-across-control-plane-restart` now also has Rust
live parity there, writing generated value/map state through public typed state
facades before restart and reading the same values, revisions, and timestamps
after a bound-only reconnect. `control-plane.jobs-admin-lists-and-cancels-job`
now has Rust parity in `control_plane_jobs_admin`, creating a service-local
long-running job through public Rust jobs runtime building blocks and using the
generated Jobs admin SDK for `Health`, `List`, `Get`, `Cancel`, and
`ListServices`. The password reset/change Rust case uses generated Auth
user/password reset/password change RPCs plus public account-flow and
local-login HTTP routes, then verifies old-password denial and new-password
`Auth.Sessions.Me`. The catalog restart Rust case uses live service/client
contracts, restarts only the Trellis control-plane process against the same
workdir and NATS container, reconnects the same service key, and uses a
bound-only client reconnect so a fresh auth flow cannot satisfy the post-restart
proof. The sessions restart Rust case uses generated `Auth.Sessions.Me/List`,
restarts only the control-plane process, and reconnects with captured bound-only
material so no fresh auth flow or contract presentation can satisfy the
post-restart proof. The resource restart Rust case uses a case-specific service
contract with required KV/store resources, writes through fresh public Rust
service resource clients before restart, restarts only the control-plane
process, then reconnects the same service seed and verifies binding config plus
persisted KV value and store bytes through fresh public clients. The service
matrix Rust implementation shape is `{ module, function }`, and Rust service
conformance is distinct from the client matrix so required-but-unimplemented
service rows may be absent while implemented rows must exist in the Rust service
registry. The first three event-consumer rows now have Rust live parity in
`rust/crates/trellis/tests/integration/event_consumers.rs`, using the public
service listener API to resolve Trellis-provisioned event-consumer bindings,
reject missing groups, reject ambiguous groups without an explicit group, reject
caller-provided durable names, prove explicit group delivery through real
Trellis/NATS, and verify a bound dependency listener attaches to the existing
Trellis-provisioned JetStream durable consumer without creating an extra
consumer. No additional unit files are retired by this parity packet; all other
service-matrix rows remain completion-required.
`event-consumers.grouped-consumer-waits-for-all-handlers-before-consuming-queued-event`
now also has Rust live parity in the same module, using a real two-subject
Trellis-provisioned durable group to prove a queued dependency event is not
delivered until both group subjects have registered handlers.
`event-consumers.self-owned-grouped-consumer-waits-for-all-handlers-before-consuming-queued-event`
now also has Rust live parity, proving the same grouped readiness behavior for a
self-owned durable group and self-published queued event.
`event-consumers.abort-re-register-restarts-delivery` now also has Rust live
parity, proving abort removes a single-subject durable handler from the shared
listener registry, stops active delivery, queues a later event on the same
Trellis-provisioned durable consumer, and re-registering restarts delivery.

Resource restart ledger correction: the historical row below for
`control-plane.resources-survive-control-plane-restart` is now
`ts/deno and
rust` covered. Rust intentionally asserts persisted bytes and
binding config only because the current Rust public store handles do not expose
TypeScript-only store metadata/content-type APIs.

- Durable event listener fake-NATS assertions from
  `js/packages/trellis/tests/trellis_api_guard_test.ts`:
  `duplicate-retired-live-control-plane`, `ts/deno`, shrunk, replaced by
  `event-consumers.durable-listen-without-declared-group-returns-err`,
  `event-consumers.ambiguous-group-without-opts-group-returns-err-and-specifying-group-works`,
  `event-consumers.caller-provided-durable-name-returns-err`,
  `event-consumers.bound-dependency-consumer-uses-trellis-provisioned-consumer-only`,
  `event-consumers.ephemeral-listener-avoids-durable-metadata-and-jetstream-consumer`,
  `event-consumers.duplicate-handlers-share-single-group-waiter`,
  `event-consumers.self-owned-durable-consumer-receives-self-published-event`,
  `event-consumers.grouped-consumer-waits-for-all-handlers-before-consuming-queued-event`,
  `event-consumers.self-owned-grouped-consumer-waits-for-all-handlers-before-consuming-queued-event`,
  `event-consumers.abort-re-register-restarts-delivery`,
  `event-consumers.stop-teardown-stops-durable-delivery`,
  `event-consumers.transient-missing-consumer-retries-after-reconcile`, and
  `event-consumers.readiness-lost-does-not-nak-delivered-group-message`.
  Verification passed:
  `deno task -c js/deno.json test:service-integration -- --fixture event-consumers`,
  `deno task -c js/deno.json check:service-integration`,
  `deno test --no-check -A -c js/deno.json js/packages/trellis/tests/trellis_api_guard_test.ts`,
  and
  `deno check -c js/deno.json js/packages/trellis-test/src/runtime.ts js/packages/trellis-test/src/nats_container.ts`.
  Removed fake durable-listener tests for missing group, ambiguous group, caller
  durable name, bound consumer use, self-owned metadata, self grouped readiness,
  restart after handler removal, immediate re-register, stop without restart,
  and transient missing-consumer retry. Added narrow scratch JetStream
  inspection helpers to `trellis-test` for live assertions. Packet 11 also
  removed fake tests for ephemeral no-durable-consumer behavior, duplicate
  handler/single pull-loop behavior, and dependency grouped readiness after
  adding live event-consumer cases for those concepts. Packet 12 restored
  self-owned grouped readiness live coverage and strengthened abort/re-register
  to prove a delayed restart after the durable consumer has no active pull
  waiter and the next event is queued. Packet 13 replaced the final fake event
  guard with
  `event-consumers.readiness-lost-does-not-nak-delivered-group-message`, which
  uses real NATS/JetStream ACK-frame inspection plus a narrow internal
  readiness-check test seam to prove stale delivered grouped messages are not
  NAKed after readiness is lost. All fake event-consumer assertions in this unit
  file have now been removed. Rust parity now also covers
  `event-consumers.transient-missing-consumer-retries-after-reconcile` with a
  real JetStream consumer deletion helper and durable listener retry after
  deployment reconciliation, and
  `event-consumers.readiness-lost-does-not-nak-delivered-group-message` with a
  live ACK-frame observer and JetStream ack-pending inspection.

Note: Phase 5 shrink-row language values identify the unit files that were
shrunk. Rust commands in those rows are replacement-lane verification, not Rust
unit retirement, unless the row explicitly names a Rust unit file or group.

Fake NATS/live-replacement audit: fake NATS, fake transport, and fake runtime
tests that assert Trellis behavior are replacement candidates, not keep-forever
coverage. Current high-value candidates include `rpc_integration_test.ts`,
`operations_watch_nats_it.ts`, `service_operation_test.ts`,
`trellis_api_guard_test.ts`, `service_test.ts`, `runtime-worker_test.ts`,
`transfer_test.ts`, and `request_error_test.ts` under `js/packages/trellis/**`.
Durable event-consumer live coverage has replaced the fake JetStream/NATS
behavior in `js/packages/trellis/tests/trellis_api_guard_test.ts`;
schema-validation fake runtime over-wire coverage moved to shared live matrix
cases, and prepared-event publish/header/error-annotation coverage moved to TS
and Rust service-integration cases.

Immediate packet mock-shrink notes:

- Accidental NATS interface compatibility members were removed from remaining
  mock `NatsConnection` or `Subscription` objects in
  `js/packages/trellis/client_connect_test.ts`,
  `js/packages/trellis/device.test.ts`,
  `js/packages/trellis/server/transfer_test.ts`,
  `js/packages/trellis/tests/rpc_integration_test.ts`,
  `js/packages/trellis/tests/telemetry_error_metrics_test.ts`, and
  `js/packages/trellis/tests/trellis_api_guard_test.ts`. This is a mock-shrink
  cleanup only; no behavior assertions were retired from those files by this
  note.
- The deterministic-only remainder of
  `js/packages/trellis/tests/prepared_events_test.ts` had the same fake NATS
  compatibility members removed. The already-retired fake prepared-event runtime
  behavior remains mapped to
  `prepared-events.prepared-publish-preserves-custom-headers-and-annotates-handler-error`.
  The retained assertions are complementary deterministic `prepare` invariants,
  not Trellis/NATS behavior simulation.
- `js/packages/trellis/tests/rpc_integration_test.ts` no longer retains the fake
  declared-error handler-context sanitization assertion. The live
  `rpc.client-receives-declared-error` row now asserts handler context metadata
  and raw subject stripping in both TypeScript and Rust.
- `js/packages/trellis/tests/rpc_integration_test.ts` no longer retains the fake
  routed RPC assertion for transient `session_not_found` retry during auth
  validation. The live TS and Rust row
  `rpc.auth-validation-retries-transient-session-not-found` now proves the exact
  retry behavior with real clients/services, the shared `trellis-test`
  control-plane session snapshot helper, and raw NATS observation of two
  `Auth.Requests.Validate` attempts. The whole fake routed RPC test file is
  deleted.
- `js/packages/trellis/server/transfer_test.ts` no longer retains the fake
  subscription-readiness assertions for `ServiceTransfer.initiateUpload` and
  `ServiceTransfer.initiateDownload`. Replaced by TS and Rust live cases
  `transfer.client-uploads-file-via-operation` and
  `transfer.client-downloads-file-via-receive-grant`, whose public transfer
  helpers use the returned send/receive grants immediately without caller retry.
- Transfer fake assertions retired, 2026-06-25: deleted
  `js/packages/trellis/server/transfer_test.ts` after the remaining
  store-derived max-byte rejection and stored-object observation assertions were
  replaced by TS and Rust live rows `transfer.upload-rejects-over-max-bytes` and
  `transfer.upload-stores-object-before-completion`.
- Routed NATS helper retired, 2026-06-25: deleted
  `js/packages/trellis/testing/routed_nats.ts` after no TypeScript imports
  remained.
- Operation fake assertions retired, 2026-06-25: deleted
  `js/packages/trellis/server/service_operation_test.ts` after its remaining
  service operation facade and durable-control assertions were replaced by TS
  and Rust live rows: `operations.service-handler-receives-client-context`,
  `operations.service-defer-keeps-operation-running`,
  `operations.service-control-resumes-deferred-operation`,
  `operations.service-control-loads-durable-record-after-restart`,
  `operations.service-accept-resume-completes-durable-operation`, and
  `operations.service-control-rejects-invalid-mismatch-payload-terminal`.
  Verification passed with the six new TS live operation tests, TS operation
  fixture/check files, Rust `operations_service_` live test group, JS and Rust
  shared-matrix conformance, and JS/Rust format checks.
- Operation fake assertion retired, 2026-06-25:
  `js/packages/trellis/tests/operations_attach_it.ts` was deleted. Its
  `Operation attach waits for job completion` assertion is replaced by TS and
  Rust live `operations.service-attach-job-waits-for-completion`, which proves
  attached service work keeps the public operation running until release and
  then completes with the attached-work output.
- Operation fake assertion retired, 2026-06-25: `operations_watch_nats_it.ts`
  `Operation cancel rejects unsupported operations
  and uses cancel capabilities`.
  Replaced by TS and Rust live `operations.cancel-uses-cancel-capability` and
  `operations.rejects-cancel-for-noncancelable-operation`, which prove cancel
  authority is separate from control authority and non-cancelable operations
  reject cancel without mutating state.
- Operation fake assertions retired, 2026-06-25: `operations_watch_nats_it.ts`
  `Operations watch stream delivers callbacks in
  order` and
  `Operations builder callbacks keep accepted deterministic for fast
  completion`.
  Replaced by TS and Rust live
  `operations.watch-callbacks-deliver-accepted-first-in-order`, which proves
  accepted-first ordering for progress/completion observation, fast-completion
  determinism, and terminal output.
- Operation fake assertions retired, 2026-06-25: deleted
  `operations_watch_nats_it.ts` after its final signal assertions were replaced
  by TS and Rust live rows:
  `operations.signals-persist-and-consume-in-acceptance-order`,
  `operations.queued-signal-delivered-before-live-signal`,
  `operations.rejects-invalid-signal-payload`, and
  `operations.rejects-signal-after-terminal-state`. These prove monotonic signal
  acknowledgement and service consumption order, queued-before-live delivery,
  invalid payload rejection without service consumption, and terminal-operation
  signal rejection.
- Operation fake assertion blocker map, 2026-06-24: retained remaining fake
  operation portions of `service_operation_test.ts`. Broad live coverage is
  `operations.client-starts-operation`, `operations.client-watches-progress`,
  `operations.client-waits-for-completion`,
  `operations.client-cancels-operation`, and
  `operations.client-signals-running-operation`; those rows do not prove
  `service.handle.operation.*` client-context ergonomics after bootstrap,
  `op.defer()` no-auto-complete behavior, service-side `.control(id)` resume
  without handler rerun, durable deferred record load after service restart,
  `.accept()` plus client `resume(ref)`, or service-control mismatch/payload/
  terminal validation. Proposed live case ids:
  `operations.service-handler-receives-client-context`,
  `operations.service-defer-keeps-operation-running`,
  `operations.service-control-resumes-deferred-operation`,
  `operations.service-control-loads-durable-record-after-restart`,
  `operations.service-accept-resume-completes-durable-operation`, and
  `operations.service-control-rejects-invalid-mismatch-payload-terminal`.
- Operation fake assertion blocker map, 2026-06-24: repaired only the stale
  fake-auth caller shape in `operations_attach_it.ts` and
  `operations_watch_nats_it.ts` by adding `lastAuth`. No fake NATS mock was
  enriched and no operation assertion was retired.
- Operation fake assertion blocker map, 2026-06-24: updated the retained
  terminal-signal rejection assertion in `operations_watch_nats_it.ts` to expect
  the current public `OperationAlreadyTerminalError` shape instead of a stale
  direct `code` property. The invalid-payload control-error assertion remains.
- Operation fake assertion blocker map, 2026-06-24: deleted the duplicate local
  routed-NATS helper from `operations_watch_nats_it.ts` and reused the existing
  `testing/routed_nats.ts` helper. This removes duplicated fake NATS code rather
  than enriching a mock.

Focused type-check verification also passed for packet 1:
`deno check -c js/deno.json js/services/trellis/auth/account_flows/bootstrap.test.ts js/services/trellis/auth/bootstrap/client.test.ts`.

## Future Ledger Table

Worker-presence coverage is partial through
`control-plane.jobs-admin-lists-and-cancels-job` and its generated
`Jobs.ListServices` assertions; there is no standalone
`control-plane.jobs-worker-presence-observed-through-public-surface` case.

Rust shared client-matrix parity audit: the Rust registry now exactly matches
the `kind: "client"` cases in `integration/test-matrix.json` with 71 matrix ids
and 71 Rust registered ids, with no missing or extra ids. Focused Rust
verification passed for `rust_integration_manifest_conforms_to_shared_matrix`,
the full `authority_plan` group, and the full `outbox` group. The fixes were
harness/fixture-level: the Rust admin contract grants authority-plan list/reject
RPCs, the mutable-dev migration case mirrors the JS base-service-active flow,
and the outbox fixture keeps `TrellisTestRuntime` alive for the service/client
lifetime. No unit files were retired by this parity packet.

Use this table during later phases to map each retired or retained unit-test
file/group to a concrete replacement or rationale. Do not use `retired` until
the replacement has passed and the deletion/shrink has happened.

Current session-bind/revoke helper decision: Packet 11 deleted
`js/services/trellis/auth/session/bind.test.ts` and
`js/services/trellis/auth/session/revoke_runtime_access.test.ts` after TS and
Rust live parity landed for
`auth.local-login-rebinds-existing-session-with-updated-authority`,
`auth.local-login-replaces-session-when-identity-changes`, and
`auth.session-revoke-cleans-runtime-connection-presence`. No fake-only
bind/revoke unit coverage remains for Packet 11.

Packet 12 final verification and retained-unit justification:

- Final required checks passed: `rtk deno fmt -c js/deno.json --check`,
  `rtk deno task -c js/deno.json check`,
  `rtk cargo fmt --manifest-path rust/Cargo.toml --all --check`,
  `rtk cargo check --manifest-path rust/Cargo.toml --workspace`,
  `rtk cargo test --manifest-path rust/Cargo.toml --workspace --lib`, both JS
  matrix conformance tests, and both Rust matrix conformance tests.
- Changed live fixture reruns passed: 21 selected TypeScript client-integration
  cases, 22 selected TypeScript service-integration cases, and the full Rust
  live integration target with 142 tests. A first full Rust live run had three
  failures: two new local-login Rust replacement tests over-asserted stale
  original-connection denial, and
  `control_plane_outbox_dispatches_after_control_plane_restart` hit a transient
  runtime startup failure. The outbox case passed focused rerun. The two auth
  tests were corrected to keep the runtime-observable session-list/replacement
  assertions and remove only the duplicate stale-connection denial assertion;
  focused reruns and the full Rust live target then passed.
- Retained TypeScript unit groups now include in-test comments explaining why
  they remain. `js/services/trellis/auth/bootstrap/client.test.ts` keeps exact
  digest selection, projection cleanup, clock-skew, invalid-signature, and known
  inactive-app digest checks. These are deterministic bootstrap/signature branch
  checks; runtime-observable auth-required and non-client/unknown digest
  failures have TS/Rust live rows.
- `js/services/trellis/auth/http/session_logout_routes.test.ts` keeps malformed
  signed request, bad signature, stale/future `iat`, missing-session,
  redirect-mode 303, and route-shape checks. Session deletion, runtime kick,
  returnTo, and provider logout behavior have TS/Rust live rows.
- `js/services/trellis/auth/admin/rpc.test.ts` keeps pure normalizers, schemas,
  private authority/staged-validation/rollback/cascade/no-kick ordering, and
  device review operation-completion edges. Runtime-observable admin deployment
  lifecycle, rollback, refresh-failure, and validate-before-persist/kick
  behavior have TS/Rust live rows.
- `js/services/trellis/catalog/rpc.test.ts` keeps stale-authority binding hiding
  and capability-definition helper projection as deterministic internal/helper
  checks. Runtime-observable active-contract/provider behavior has TS/Rust live
  service-matrix rows.
- `js/packages/trellis/tests/prepared_events_test.ts` keeps only deterministic
  `prepare` invariants. Live prepared publish headers and handler-error
  annotation have TS/Rust service-matrix coverage.
- `js/packages/trellis/tests/schema_validation_error_test.ts` keeps pure error
  serialization and validation-annotation parser/encoder checks. Over-wire
  schema failures have TS/Rust live RPC rows.
- `js/packages/trellis/server/service_test.ts` keeps service-local
  subject/header, lifecycle, dependency-isolation, shutdown, and `JobRef`
  publication details. Runtime-observable service, health, jobs, and operation
  behavior removed from fake runtime tests has TS/Rust live matrix coverage.
- `js/packages/trellis/tests/trellis_api_guard_test.ts` keeps API/facade guards
  that should fail before network use. Live event-consumer and RPC recovery
  behavior has moved to TS/Rust matrix rows.
- `js/services/trellis/auth/session/rpc.test.ts` keeps deterministic session RPC
  envelope, projection, and cleanup edge branches. Runtime-observable
  revoke/runtime access cleanup behavior has TS/Rust live matrix rows.

State/resource restart parity correction: the historical rows below that cite
`control-plane.state-persists-across-control-plane-restart` and
`control-plane.resources-survive-control-plane-restart` were initially recorded
from TypeScript service-integration coverage. State restart and resource restart
now have Rust live parity in
`rust/crates/trellis/tests/integration/control_plane.rs`, and the service matrix
marks both implemented.

Operation signal/control row correction: `operations_watch_nats_it.ts` has now
been deleted after exact TS and Rust live replacements landed for multi-signal
acceptance order, queued-before-live delivery, invalid signal payload rejection,
and terminal signal rejection. The historical candidate row below is retained
only as older planning context.

| Unit file or group                                                                                                                                                                                                                                                                              | Language          | Classification                                   | Replacement case id(s) or keep rationale                                                                                                                                                                                                                                                                                                                                                                                                     | Status                                                       | Verification performed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation cancel public workflow concepts from `js/packages/trellis/tests/operations_test.ts`, `js/packages/trellis/server/service_operation_test.ts`, and Rust client/service operation-control unit tests                                                                                     | ts/deno and rust  | replace-live                                     | `operations.client-cancels-operation`                                                                                                                                                                                                                                                                                                                                                                                                        | covered-js / covered-rust                                    | `deno task -c js/deno.json check:integration` passed; `deno task -c js/deno.json test:integration -- --case operations.client-cancels-operation` passed; `rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration operations_client_cancels_operation -- --nocapture` passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Candidate mapping only; no unit files retired.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Operation signal/control public workflow concepts from `js/packages/trellis/tests/operations_test.ts`, `js/packages/trellis/tests/operations_watch_nats_it.ts`, `js/packages/trellis/server/service_operation_test.ts`, and Rust client/service operation-control unit tests                    | ts/deno and rust  | replace-live                                     | `operations.client-signals-running-operation`                                                                                                                                                                                                                                                                                                                                                                                                | covered-js / covered-rust                                    | `deno task -c js/deno.json check:integration` passed; `deno task -c js/deno.json test:integration -- --case operations.client-signals-running-operation` passed; `rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration operations_client_signals_running_operation -- --nocapture` passed.                                                                                                                                                                                                                                                                                                                                                                                                                                      | Candidate mapping only; no unit files retired.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Keyed job coordinator/manager public workflow concepts from TS job manager/key-coordinator units and Rust `jobs` keyed admission/worker coordination units                                                                                                                                      | ts/deno and rust  | replace-live                                     | `jobs.keyed-jobs-serialize-same-key`                                                                                                                                                                                                                                                                                                                                                                                                         | covered-js / covered-rust                                    | `deno task -c js/deno.json check:integration` passed; `deno task -c js/deno.json test:integration -- --case jobs.keyed-jobs-serialize-same-key` passed; `rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration jobs_keyed_jobs_serialize_same_key -- --nocapture` passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Candidate mapping only; no unit files retired. The live case covers same-key serialization through public service-local job creation/handling; low-level reducer, queue-policy, stale-lease, and collision units remain keep-unit coverage.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Local login, session bind, app grant approval, `Auth.Sessions.Me`, and approved-client service-call concepts from browser login helpers, `js/packages/trellis/auth/**/*.test.ts`, Trellis auth HTTP/session/account-flow units, and Rust auth/client approval units                             | ts/deno and rust  | replace-live                                     | `auth.local-login-binds-approved-client`                                                                                                                                                                                                                                                                                                                                                                                                     | covered-js / covered-rust                                    | `deno task -c js/deno.json check:integration` passed; `deno task -c js/deno.json test:integration -- --case auth.local-login-binds-approved-client` passed; `rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration auth_local_login_binds_approved_client -- --nocapture` passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                | Candidate mapping only; no unit files retired. The live JS case proves auth-required callback, local-admin HTTP login/portal approval, app session bind to active admin user, and approved service RPC. Low-level crypto/schema/provider/UI units remain keep-unit coverage.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Session revoke, runtime access revoke, public session state, and request validation concepts from Auth session revoke/runtime-access units and Rust auth/request-adapter session validation tests                                                                                               | ts/deno and rust  | replace-live                                     | `auth.session-revoke-denies-reconnect`                                                                                                                                                                                                                                                                                                                                                                                                       | covered-js / partial-rust-verified                           | `deno task -c js/deno.json check:integration` passed; `deno task -c js/deno.json test:integration -- --case auth.session-revoke-denies-reconnect` passed; `rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration auth_session_revoke_denies_reconnect -- --nocapture` passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Candidate mapping only; no unit files retired. The JS live case revokes an approved app session through generated `Auth.Sessions.Revoke`, observes removal from `Auth.Sessions.List`, verifies the existing session is denied, and verifies reconnect without a new auth flow fails. The Rust live-style case uses generated `Auth.Sessions.List/Revoke` and verifies public state plus existing-session denial; Rust reconnect-without-new-auth is not currently practical because the `trellis-test` Rust helper does not expose bound session transport material without completing a new auth flow.                                                                                            |
| Device activation review rejection and session-principal stale-denial concepts from TS device activation helper tests, Trellis auth device activation operation/admin units, and Rust auth/device activation request-adapter tests                                                              | ts/deno and rust  | replace-live                                     | `device-activation.review-reject-denies-connect`                                                                                                                                                                                                                                                                                                                                                                                             | covered-js / covered-rust                                    | `deno task -c js/deno.json check:integration` passed; `deno task -c js/deno.json test:integration -- --case device-activation.review-reject-denies-connect` passed; `rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration device_activation_review_reject_denies_connect -- --nocapture` passed.                                                                                                                                                                                                                                                                                                                                                                                                                                | Candidate mapping only; no unit files retired. The live cases use public `Auth.DeviceUserAuthorities.Resolve`, `Auth.DeviceUserAuthorities.Reviews.List`, `Auth.DeviceUserAuthorities.Reviews.Decide`, device activation wait helpers, and device runtime connect helpers. Low-level proof signing, schema validation, and deterministic activation helper units remain keep-unit coverage.                                                                                                                                                                                                                                                                                                        |
| Device activation revocation, device runtime access kick, session principal stale-denial, and revoked device reconnect-denial concepts from TS device activation helper tests, Trellis auth device activation admin/runtime-access units, and Rust auth/device activation request-adapter tests | ts/deno and rust  | replace-live                                     | `device-activation.revoked-device-cannot-reconnect`                                                                                                                                                                                                                                                                                                                                                                                          | covered-js / covered-rust                                    | `deno task -c js/deno.json check:integration` passed; `deno task -c js/deno.json test:integration -- --case device-activation.revoked-device-cannot-reconnect` passed; `rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration device_activation_revoked_device_cannot_reconnect -- --nocapture` passed.                                                                                                                                                                                                                                                                                                                                                                                                                          | Candidate mapping only; no unit files retired. The live cases revoke activation through generated `Auth.DeviceUserAuthorities.Revoke`, observe revoked public state through `Auth.DeviceUserAuthorities.List`, verify the existing device session is denied by `Auth.Sessions.Me`, and verify device reconnect is denied. Low-level proof signing, schema validation, and deterministic activation helper units remain keep-unit coverage.                                                                                                                                                                                                                                                         |
| State RPC admin inspect/delete, storage metadata, provenance, and admin user-app target concepts from Trellis state RPC/admin/storage units and Rust state runtime facade/admin client tests                                                                                                    | ts/deno and rust  | replace-live                                     | `state.admin-inspect-and-delete-state`                                                                                                                                                                                                                                                                                                                                                                                                       | covered-js / covered-rust                                    | `deno task -c js/deno.json check:integration` passed; `deno task -c js/deno.json test:integration -- --case state.admin-inspect-and-delete-state` passed; `rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration state_admin_inspect_and_delete_state -- --nocapture` passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Candidate mapping only; no unit files retired. The live cases write value and map state through generated public state facades, discover the user-app target through generated `Auth.Sessions.List`, inspect state through generated `State.Admin.Get/List`, delete through generated `State.Admin.Delete`, and verify generated client reads observe missing state. Low-level schema/migration/TTL/envelope corruption units remain keep-unit coverage.                                                                                                                                                                                                                                           |
| First local admin bootstrap concepts from `js/services/trellis/auth/account_flows/bootstrap.test.ts` and built-in bootstrap HTTP/session flow units                                                                                                                                             | ts/deno           | replace-live-control-plane                       | `control-plane.admin-bootstrap-creates-first-local-admin`                                                                                                                                                                                                                                                                                                                                                                                    | covered                                                      | `deno task -c js/deno.json check:service-integration` passed; `deno task -c js/deno.json test:service-integration -- --case control-plane.admin-bootstrap-creates-first-local-admin` passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | No unit files retired.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Local admin password reset/change, local credential replacement, old-password rejection, and new-password login concepts from Trellis auth account-flow/session/http/local-credential unit tests                                                                                                | ts/deno           | replace-live-control-plane                       | `control-plane.password-reset-change-invalidates-old-password`                                                                                                                                                                                                                                                                                                                                                                               | covered                                                      | Direct `deno test --no-check -A -c deno.json --lock ../../../deno.lock control-plane/password_reset_change_invalidates_old_password.integration_test.ts` passed; `deno task -c js/deno.json check:service-integration` passed; `deno task -c js/deno.json test:service-integration -- --case control-plane.password-reset-change-invalidates-old-password` passed; full `deno task -c js/deno.json test:service-integration` passed.                                                                                                                                                                                                                                                                                                                       | No unit files retired. Live case uses generated Auth user/password reset/password change RPCs plus public account-flow and local-login HTTP routes against a case-scoped local admin account. It does not reset the hidden bootstrap admin password owned by `TrellisTestRuntime`.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Control-plane HTTP bootstrap route session-security concepts from Trellis auth HTTP/bootstrap route units                                                                                                                                                                                       | ts/deno           | replace-live-control-plane                       | `control-plane.http-route-security-requires-admin-session`                                                                                                                                                                                                                                                                                                                                                                                   | covered                                                      | `deno check -c services/trellis/integration/deno.json services/trellis/integration/control-plane/http_route_security_requires_admin_session.integration_test.ts` passed; direct `deno test --no-check -A -c deno.json --lock ../../../deno.lock control-plane/http_route_security_requires_admin_session.integration_test.ts` passed; `deno task -c js/deno.json check:service-integration` passed; `deno task -c js/deno.json test:service-integration -- --case control-plane.http-route-security-requires-admin-session` passed; full `deno task -c js/deno.json test:service-integration` passed.                                                                                                                                                      | No unit files retired. Covers live `/bootstrap/client` modeled unauthenticated denial and authenticated admin-capable session success through public runtime helpers and HTTP fetch. Detailed CORS/security-header parser edge cases remain unit coverage.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Catalog active contract persistence concepts from `js/services/trellis/catalog/**/*.test.ts`, authority active-contract storage tests, and control-plane restart storage behavior                                                                                                               | ts/deno           | replace-live-control-plane                       | `control-plane.catalog-active-contracts-survive-restart`                                                                                                                                                                                                                                                                                                                                                                                     | covered                                                      | `deno task -c js/deno.json check:service-integration` passed; `deno task -c js/deno.json test:service-integration -- --case control-plane.catalog-active-contracts-survive-restart` passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | No unit files retired.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| User/app session persistence, session-key reconnect, `Auth.Sessions.Me/List`, and identity-authority reuse concepts from Trellis auth session/callout/storage persistence units                                                                                                                 | ts/deno           | replace-live-control-plane                       | `control-plane.sessions-survive-control-plane-restart`                                                                                                                                                                                                                                                                                                                                                                                       | covered                                                      | Direct `deno check -c deno.json --lock ../../../deno.lock control-plane/sessions_survive_control_plane_restart.integration_test.ts` passed; direct `deno test --no-check -A -c deno.json --lock ../../../deno.lock control-plane/sessions_survive_control_plane_restart.integration_test.ts` passed; `deno task -c js/deno.json check:service-integration` passed; `deno task -c js/deno.json test:service-integration -- --case control-plane.sessions-survive-control-plane-restart` passed; full `deno task -c js/deno.json test:service-integration` passed.                                                                                                                                                                                           | No unit files retired. Live case authenticates an app session through public runtime helpers, verifies `Auth.Sessions.Me` and `Auth.Sessions.List`, restarts only the Trellis control plane, reconnects with the same session key seed and a failing auth callback, and verifies the same user/session remains authenticated and listed.                                                                                                                                                                                                                                                                                                                                                           |
| State value/map persistence across control-plane restart concepts from Trellis state storage/runtime units                                                                                                                                                                                      | ts/deno           | replace-live-control-plane                       | `control-plane.state-persists-across-control-plane-restart`                                                                                                                                                                                                                                                                                                                                                                                  | covered                                                      | Direct `deno check -c deno.json control-plane/state_persists_across_control_plane_restart.integration_test.ts` passed; direct `deno test --no-check -A -c deno.json --lock ../../../deno.lock control-plane/state_persists_across_control_plane_restart.integration_test.ts` passed; `deno task -c js/deno.json check:service-integration` passed; `deno task -c js/deno.json test:service-integration -- --case control-plane.state-persists-across-control-plane-restart` passed; full `deno task -c js/deno.json test:service-integration` passed.                                                                                                                                                                                                      | No unit files retired. Live case writes value and map state through generated public state facades before restart, reconnects with the same session-key material after control-plane restart without a new auth callback, and verifies value plus revision/timestamp metadata survives.                                                                                                                                                                                                                                                                                                                                                                                                            |
| Service resource binding and backing-data persistence across control-plane restart concepts from Trellis catalog/resource reconciliation/storage and service runtime resource unit tests                                                                                                        | ts/deno           | replace-live-control-plane                       | `control-plane.resources-survive-control-plane-restart`                                                                                                                                                                                                                                                                                                                                                                                      | covered                                                      | Direct `deno check -c deno.json --lock ../../../deno.lock control-plane/resources_survive_control_plane_restart.integration_test.ts` passed; direct `deno test --no-check -A -c deno.json --lock ../../../deno.lock control-plane/resources_survive_control_plane_restart.integration_test.ts` passed; `deno task -c js/deno.json check:service-integration` passed; `deno task -c js/deno.json test:service-integration -- --case control-plane.resources-survive-control-plane-restart` passed; full `deno task -c js/deno.json test:service-integration` passed.                                                                                                                                                                                        | No unit files retired. Live case declares service-owned KV and store resources, writes through public `service.kv`/`service.store` handles before restart, reconnects the service with the same session key seed after control-plane restart, and verifies the KV value plus store object/metadata remain readable through fresh public handles.                                                                                                                                                                                                                                                                                                                                                   |
| SQL outbox queued-row dispatch recovery concepts from Trellis service SQL outbox dispatcher/unit coverage and control-plane restart persistence planning                                                                                                                                        | ts/deno and rust  | replace-live-control-plane                       | `control-plane.outbox-dispatches-after-control-plane-restart`                                                                                                                                                                                                                                                                                                                                                                                | covered-service-sql-outbox / blocked-control-plane-owned-row | Direct `deno check control-plane/outbox_dispatches_after_control_plane_restart.integration_test.ts` passed; direct `deno test -A control-plane/outbox_dispatches_after_control_plane_restart.integration_test.ts` passed; `deno task -c js/deno.json check:service-integration` passed; `deno task -c js/deno.json test:service-integration -- --case control-plane.outbox-dispatches-after-control-plane-restart` passed; full `deno task -c js/deno.json test:service-integration` passed. Rust parity added with public `SqliteOutboxStore`, `OutboxStore::enqueue`, `dispatch_outbox_once`, and `TrellisClient::publish_prepared`.                                                                                                                     | No unit files retired. Live cases queue an event through generated RPC and a caller-owned SQL outbox, stop before publish, restart the Trellis control plane, reconnect with the same SQL DB, and observe the queued event through a post-restart public subscriber. Rust uses the public one-shot dispatcher primitive because Rust does not yet have the TypeScript `service.createSqlOutbox(...)` background dispatcher facade. A Trellis control-plane-owned durable event row remains blocked without private DB mutation.                                                                                                                                                                    |
| Old-SQLite schema upgrade preservation concepts from Trellis storage upgrade/migration units                                                                                                                                                                                                    | ts/deno           | not-currently-targeted                           | _no live case; old-version SQLite compatibility is not a shipped contract while the control-plane DB schema is unstable_                                                                                                                                                                                                                                                                                                                     | deleted                                                      | Deleted `js/services/trellis/storage/upgrades.test.ts`; no runtime verification needed for a deleted unstable-compatibility test file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Removed old storage-layout compatibility tests because the control-plane database structure has not stabilized. Do not add historical SQLite fixture coverage, pre-start DB fixture hooks, live old-DB upgrade tests, or unit tests preserving old storage layouts until DB stability is declared and old-version compatibility becomes a shipped contract.                                                                                                                                                                                                                                                                                                                                        |
| Catalog required dependency resolution and inactive-provider public RPC concepts from `js/services/trellis/catalog/uses.test.ts`, `js/services/trellis/catalog/runtime.test.ts`, auth contract-proposal dependency units, and accepted-offer authority materialization tests                    | ts/deno and rust  | replace-live-control-plane                       | `control-plane.catalog-dependency-issue-resolved-by-provider`                                                                                                                                                                                                                                                                                                                                                                                | covered                                                      | Direct `deno test --no-check -A -c deno.json --lock ../../../deno.lock control-plane/catalog_dependency_issue_resolved_by_provider.integration_test.ts` passed; direct `deno check -c deno.json --lock ../../../deno.lock control-plane/catalog_dependency_issue_resolved_by_provider.integration_test.ts` passed; `deno task -c js/deno.json check:service-integration` passed; `deno task -c js/deno.json test:service-integration -- --case control-plane.catalog-dependency-issue-resolved-by-provider` passed; `rtk cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration control_plane_catalog_dependency_issue_resolved_by_provider -- --nocapture` passed; full `deno task -c js/deno.json test:service-integration` passed. | No unit files retired. Live cases prove a generated app/client RPC requiring a provider dependency is unusable before an active provider service exists, then succeeds on the same connected client after provider registration and service connection; unknown-contract and low-level active-catalog issue projection edge cases remain unit coverage.                                                                                                                                                                                                                                                                                                                                            |
| Catalog incompatible active-offer issue resolution and force-replace concepts from `js/services/trellis/catalog/runtime.test.ts` and `js/services/trellis/auth/admin/rpc.test.ts`                                                                                                               | ts/deno and rust  | replace-live-control-plane                       | `control-plane.catalog-force-replace-resolves-catalog-issue`                                                                                                                                                                                                                                                                                                                                                                                 | covered                                                      | Direct `deno check -c deno.json --lock ../../../deno.lock control-plane/catalog_force_replace_resolves_catalog_issue.integration_test.ts` passed; direct `deno test --no-check -A -c deno.json --lock ../../../deno.lock control-plane/catalog_force_replace_resolves_catalog_issue.integration_test.ts` passed; `deno task -c js/deno.json check:service-integration` passed; `deno task -c js/deno.json test:service-integration -- --case control-plane.catalog-force-replace-resolves-catalog-issue` passed; full `deno task -c js/deno.json test:service-integration` passed; Rust parity added with focused verification pending in this packet.                                                                                                     | No unit files retired. Live cases create incompatible active offers through public runtime/service flows, observe the catalog issue through public `Trellis.Catalog`, invoke generated `Auth.CatalogIssues.Resolve` with `force-replace`, and verify the replacement digest becomes active after previous effective offers are withdrawn.                                                                                                                                                                                                                                                                                                                                                          |
| Jobs admin list/detail/cancel action concepts from Jobs admin RPC/page-action tests, service-local job cancellation paths, and Jobs admin visibility expectations                                                                                                                               | ts/deno           | replace-live-control-plane                       | `control-plane.jobs-admin-lists-and-cancels-job`                                                                                                                                                                                                                                                                                                                                                                                             | covered-generated-admin-subset / partial-durable-admin       | `deno task -c js/deno.json check:service-integration` passed; `deno task -c js/deno.json test:service-integration -- --case control-plane.jobs-admin-lists-and-cancels-job` passed with generated Jobs admin `Health/List/Get/Cancel/ListServices` RPCs; full `deno task -c js/deno.json test:service-integration` passed.                                                                                                                                                                                                                                                                                                                                                                                                                                 | No unit files retired. Generated Jobs admin `Health/List/Get/Cancel/ListServices` now work in the JS control-plane runtime through a live in-memory NATS lifecycle/heartbeat projection. Durable SQL projection/replay, DLQ/retry, and key-admin RPCs remain future work.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Job worker presence/advisory observability concepts from TS job worker/manager/key-coordinator units and Jobs admin visibility expectations                                                                                                                                                     | ts/deno           | replace-live-control-plane                       | `control-plane.jobs-worker-presence-observed-through-public-surface`                                                                                                                                                                                                                                                                                                                                                                         | partial-covered-list-services / keep-unit                    | Research-only packet; no test run because no files were changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | No unit files retired. Basic worker presence is now partially covered by generated `Jobs.ListServices` in `control-plane.jobs-admin-lists-and-cancels-job`; keep worker/advisory parser, stale-worker, heartbeat edge-case, and durable replay units.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Phase 5 auth/admin unit shrink readiness audit for first-admin bootstrap, password reset/change, HTTP bootstrap security, local-login bind, and session revoke workflow units                                                                                                                   | ts/deno           | shrink-candidate / keep-unit / partial-rust      | `control-plane.admin-bootstrap-creates-first-local-admin`, `control-plane.http-route-security-requires-admin-session`, `control-plane.password-reset-change-invalidates-old-password`, `auth.local-login-binds-approved-client`, `auth.session-revoke-denies-reconnect`                                                                                                                                                                      | audited-no-retirement                                        | Research-only audit; no test run because no unit files were changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | No unit files retired. Audit found no whole-file deletion candidates. Shrink candidates are selected broad workflow assertions in auth bootstrap, password reset/change, HTTP route, local-login bind, and session revoke tests. Keep crypto/proof vectors, schemas, password hashing detail, OAuth/provider/redirect/CORS/cookie parsers, lockout/rate-limit/inactive-account edge cases, request validation, admin invariants, and service/device bootstrap edge cases. Local-login bind is now covered in both JS and Rust lanes; session-revoke reconnect-specific shrinkage remains partial because the Rust harness cannot observe reconnect-without-new-auth.                               |
| Phase 5 catalog/state/resources/outbox/jobs unit shrink readiness audit                                                                                                                                                                                                                         | ts/deno and rust  | shrink-candidate / keep-unit / blocked           | `control-plane.catalog-active-contracts-survive-restart`, `control-plane.catalog-dependency-issue-resolved-by-provider`, `control-plane.state-persists-across-control-plane-restart`, `state.admin-inspect-and-delete-state`, `control-plane.resources-survive-control-plane-restart`, `control-plane.outbox-dispatches-after-control-plane-restart`, `control-plane.jobs-admin-lists-and-cancels-job`, `jobs.keyed-jobs-serialize-same-key` | audited-no-retirement                                        | Research-only audit; no test run because no unit files were changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | No unit files retired by that audit. Audit recommends shrink-only candidates for catalog active/dependency happy paths, tiny state restart persistence and state admin inspect/delete happy paths, narrow resource materialized binding/data happy paths, service SQL outbox workflow duplication if found, and service-local `JobRef` cancel/wait happy paths. Keep catalog reducers/permissions/resource reconciliation, state TTL/corruption/fault-injection, job reducers/projectors/janitors/advisory/key-format/worker internals. Force-replace, durable Jobs admin projection/replay, worker-presence edge cases, control-plane-owned outbox, and Rust-lane-dependent cases remain blocked. |
| _TBD by future implementer_                                                                                                                                                                                                                                                                     | _ts/deno or rust_ | _replace-live / keep-unit / duplicate / blocked_ | _case id(s), keep rationale, or duplicate coverage note_                                                                                                                                                                                                                                                                                                                                                                                     | _candidate / covered / keep / blocked / retired_             | _focused integration and/or remaining unit partition_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | _no unit files retired in Phase 0_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
