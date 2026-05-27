---
title: Trellis Contracts And Catalog
description: Canonical Trellis contract format, ownership model, activation rules, and permission derivation inputs.
order: 10
---

# Design: Trellis Contracts And Catalog

## Prerequisites

- [../core/trellis-patterns.md](./../core/trellis-patterns.md) - service
  patterns and platform boundaries
- [../auth/trellis-auth.md](./../auth/trellis-auth.md) - session keys, auth
  callout, and dynamic authorization

## Context

Trellis needs one contract model that works for five different concerns at the
same time:

- service authors need a local way to define operations, RPCs, events, jobs,
  schemas, authorization requirements, and cloud resource requests
- the `trellis` runtime must derive runtime NATS permissions from the APIs that
  are actually active in a deployment
- clients and peer services need typed SDKs
- documentation and tooling need a language-neutral artifact
- operators need a reviewable description of which cloud resources a service
  expects Trellis to provide before deployment-envelope expansion

Those needs apply across multiple repos and multiple implementation languages.

This document is the architecture and specification for the canonical manifest,
catalog projections, digest projection, dependency model, and permission
derivation. It is not the place for ordinary language-library usage. TypeScript
and Rust authoring walkthroughs belong in `/guides/libraries/typescript`,
`/guides/libraries/rust`, and exact generated APIs/Rustdoc are linked from
`/api`.

## Goals

- Keep API ownership with the service that implements the API.
- Define one canonical contract artifact for runtime and tooling.
- Make the active deployment contract set discoverable at runtime.
- Make cloud-provided service resources explicit and reviewable at
  deployment-envelope expansion time.
- Support generated SDKs and docs from the same source of truth.
- Support operations, RPC, domain events, jobs, and contract-owned state.
- Support declarative resource requests with cloud-assigned physical bindings.
- Support Trellis-owned contracts and cloud/domain service contracts with the
  same mechanism.

## Non-Goals

- Defining one required human authoring language for every service.
- Making AsyncAPI the canonical runtime model.
- Documenting historical implementation paths.

## Design

### 1) Canonical artifacts

Trellis defines two canonical JSON artifacts:

- `trellis.contract.v1` - one service contract manifest
- `trellis.catalog.v1` - the runtime's active implementation projection

Both artifacts are pure JSON values. They are language-neutral and safe to
persist, hash, validate, transmit, and use for code generation.

### 2) Contract lineage and implementation model

Every contract belongs to one stable contract lineage identified by `id`.
Deployment and identity envelopes decide whether a presented contract boundary
is authorized; expansion and retraction history records what changed and what
was reviewed.

- Trellis-managed contracts such as `trellis.core@v1`, `trellis.auth@v1`, and
  `trellis.state@v1` are implemented by the `trellis` runtime service even when
  they are committed in the Trellis repo
- cloud/domain contracts live in the repo that implements the corresponding
  service behavior
- a single service principal may implement multiple logical contracts
- Trellis runtime libraries do not act as a handwritten central registry for all
  service APIs

### 3) Authoring model

The canonical source of truth for runtime and tooling is the authored contract
definition.

For repository layout and tooling boundaries, Trellis treats generated
`trellis.contract.v1` JSON as a release and exchange artifact, not as a
committed source file.

- services may author contracts in their native language
- those authoring helpers are normal workflow inputs, not hidden implementation
  details
- `trellis` verifies, packs, and uses generated manifests produced from those
  contract sources

The human-authored source may vary by language or team as long as it
deterministically emits a valid manifest.

Examples:

- a TypeScript service may author a contract with `@qlever-llc/trellis`
- a Rust service may author a contract with Rust-side types/macros/build tooling
- a Python service may author a contract with Python-native tooling
- a service may author the manifest directly if desired, but that is not the
  default workflow

The architectural requirement is not a specific authoring language. The
requirement is deterministic production of the canonical manifest.

### 4) JSON Schema dialect

All embedded schemas in a contract manifest MUST be JSON Schema compatible
values using the same dialect Trellis validates at runtime.

For v1:

- dialect: JSON Schema Draft 2019-09
- schema fields MAY be either a JSON object schema or a boolean schema
- manifests MUST be self-contained; v1 embedded schemas MUST NOT use `$ref`,
  including local or remote targets. Cross-schema references belong in Trellis
  schema-ref fields such as `{ "schema": "Name" }`.

## Specification

### 5) Contract manifest: top-level shape

A `trellis.contract.v1` manifest has this top-level structure:

```json
{
  "format": "trellis.contract.v1",
  "id": "graph@v1",
  "displayName": "Graph Service",
  "description": "Serve graph RPCs and publish graph change events.",
  "docs": {
    "summary": "Graph service contract.",
    "markdown": "# Graph Service\n\nTyped graph APIs and change events."
  },
  "kind": "service",
  "capabilities": {
    "graph::users.read": {
      "displayName": "Read users",
      "description": "View user records exposed by the graph service."
    }
  },
  "schemas": {
    "Checkpoint": { "type": "object" }
  },
  "exports": {
    "schemas": ["Checkpoint"]
  },
  "uses": {},
  "jobs": {},
  "operations": {},
  "rpc": {},
  "events": {},
  "state": {},
  "resources": {
    "kv": {
      "state": {
        "purpose": "Store service checkpoints",
        "schema": { "schema": "Checkpoint" },
        "required": true,
        "history": 1,
        "ttlMs": 0
      }
    }
  },
  "errors": {}
}
```

Top-level fields:

| Field          | Required | Type   | Meaning                                                            |
| -------------- | -------- | ------ | ------------------------------------------------------------------ |
| `format`       | yes      | string | MUST equal `trellis.contract.v1`                                   |
| `id`           | yes      | string | Stable contract identifier such as `trellis.core@v1` or `graph@v1` |
| `displayName`  | yes      | string | Human-facing contract name shown in tooling and approval UIs       |
| `description`  | yes      | string | Human-facing explanation of the contract's purpose                 |
| `docs`         | no       | object | Optional authored documentation metadata                           |
| `kind`         | yes      | string | Contract role such as `service`, `app`, `agent`, or `device`       |
| `capabilities` | no       | object | Human-facing metadata for contract-owned capability keys           |
| `schemas`      | no       | object | Reusable self-contained JSON Schema values keyed by schema name    |
| `exports`      | no       | object | Canonical public exports made available to dependent contracts     |
| `uses`         | no       | object | Explicit cross-contract operation/RPC/event dependencies           |
| `jobs`         | no       | object | Map of first-class service-private job queue descriptors           |
| `operations`   | no       | object | Map of logical operation names to operation descriptors            |
| `rpc`          | no       | object | Map of logical RPC names to RPC operation descriptors              |
| `events`       | no       | object | Map of logical event names to event descriptors                    |
| `feeds`        | no       | object | Map of logical feed names to feed descriptors                      |
| `state`        | no       | object | Map of named Trellis-managed state stores                          |
| `resources`    | no       | object | Map of declarative cloud resource requests                         |
| `errors`       | no       | object | Map of declared error types to error descriptors                   |

Rules:

- `format`, `id`, `displayName`, `description`, and `kind` are required.
- `schemas` is the contract-level schema registry referenced by RPC, operations,
  events, jobs, state declarations, and schema-backed KV resources.
- `exports.schemas` is the canonical list of schema names exported from the
  contract-level `schemas` registry for other contracts and generated APIs to
  reference.
- every name in `exports.schemas` MUST resolve to a top-level `schemas` entry;
  exported schemas follow the same self-contained schema rules as all other
  contract schema refs.
- `kind` drives discovery behavior in bootstrap-safe generation flows: `service`
  contracts generate manifests and SDKs, while `app`, `agent`, and `device`
  contracts are verified. User-facing runtime identity is still envelope-bound:
  browser apps anchor by origin, CLI/native tools by session public key, and
  device-user flows by device public key rather than by contract digest alone.
- `displayName` and `description` are human-facing manifest metadata for
  catalog, docs, and approval UI. They are not part of contract digest identity.
- `docs` is optional authored documentation metadata. It is normalized supported
  metadata and is not part of contract digest identity.
- `capabilities` is human-facing approval metadata, but it is runtime authority
  metadata rather than display-only contract metadata. It participates in the
  contract digest because changing a capability's meaning changes what users and
  operators approve.
- runtime service identity, install routing, and authorization boundaries MUST
  NOT be inferred from manifest metadata.
- top-level object members not defined by the current runtime MAY be present for
  forward compatibility; runtimes MUST ignore unknown top-level fields they do
  not understand.

### 5.1) Contract docs metadata

Contracts MAY include authored documentation metadata on the contract and on
owned contract surfaces.

Shape:

```ts
docs?: {
  summary?: string;
  markdown: string;
}
```

Rules:

- `docs.markdown` is required when `docs` is present; `docs.summary` is
  optional.
- `docs` MAY appear at the contract level and on owned RPCs, operations,
  operation signals, events, feeds, jobs, state stores, KV resources, and store
  resources.
- `docs` is normalized supported metadata. It is preserved in normalized
  manifests for generated documentation and tooling.
- `docs` is excluded from the contract digest projection. Documentation-only
  edits can update generated docs and catalog metadata without changing runtime
  identity, authority, resources, dependencies, or wire shape.
- `docs` is separate from `displayName` and `description`, which provide concise
  catalog, docs, and approval UI copy.
- `docs` is separate from capability metadata. Capability `displayName`,
  `description`, and `consequence` define the human meaning of granted authority
  and participate in the digest projection.

### 6) Contract identity

The contract `id` identifies one logical contract lineage.

Examples:

- `trellis.core@v1`
- `trellis.jobs@v1`
- `trellis.portal.activation@v1`
- `graph@v1`

Rules:

- `id` MUST be stable for semantically compatible revisions within the same
  major line
- a breaking contract revision MUST use a new `@vN` suffix
- Trellis-owned contracts, including Trellis-owned app contracts, SHOULD use the
  `trellis.` prefix so ownership is visible from the stable lineage id
- within one Trellis runtime, each `id` is globally unique for subject ownership
  and generated SDK identity
- a new digest for the same `id` is reviewed as a boundary change against the
  relevant envelope; the digest is not itself durable authority
- service deployments default to `strict` same-contract compatibility, which
  rejects incompatible replacement for an existing service instance; development
  deployments may opt into `mutable-dev` compatibility for fast local iteration

### 6.1) Contract digest projection

The contract digest is computed from the canonical semantic projection of the
manifest, not from every byte in the submitted JSON document.

The digest projection includes:

- `format`, `id`, and `kind`
- top-level `capabilities`
- reachable schemas referenced by state, RPCs, operations, operation signals,
  events, feeds, jobs, schema-backed KV resources, and declared RPC error
  schemas
- state, `uses`, RPCs, operations, events, feeds, jobs, declared RPC errors, and
  KV/store resource requests
- sorted and deduplicated capability and `uses` selector lists

The digest projection excludes:

- contract-level `displayName`, `description`, and other display-only review
  metadata
- `docs` metadata at the contract level and on owned contract surfaces
- `exports` and other code-generation metadata that does not change runtime
  permissions or wire surfaces
- unused schemas and undeclared error definitions
- unknown top-level extension fields that the current runtime ignores

Rules:

- tooling and runtime implementations MUST use the same digest projection before
  comparing reviewed and installed manifests
- digest projection and manifest normalization are Trellis protocol rules, not
  language-helper rules; every supported implementation MUST either call the
  shared contract utilities for its language or pass shared conformance vectors
  that prove the same projection
- runtimes MUST NOT compute a digest from a service-local normalized copy of a
  manifest unless that normalization is the shared contract manifest
  normalization for the current Trellis protocol version
- deployment envelope expansion requests that include a presented contract MUST
  carry the locally reviewed digest, and auth MUST reject the request if
  canonical digest computation produces a different digest
- digest-stable metadata edits may update catalog display information without
  requiring new runtime permissions or new app approvals, but capability
  metadata edits are not digest-stable
- the runtime catalog projection MUST NOT publish multiple active digests for
  one Trellis-owned `id`
- install records bind one exact digest to one service principal public key

Manifest normalization is separate from digest projection:

- manifest normalization produces the canonical supported manifest shape used
  for validation, persistence, code generation, and runtime install; it
  preserves human-facing fields such as `displayName`, `description`, and `docs`
- the global `contracts` store is the authoritative content-addressed store for
  full normalized manifests keyed by digest
- digest projection starts from the normalized manifest and keeps only fields
  that define runtime identity, authority, resources, dependencies, or wire
  shape
- unknown top-level extension fields MAY appear in submitted manifests for
  forward compatibility, but current runtimes MUST drop them during manifest
  normalization and MUST NOT let them affect the digest until the Trellis
  protocol explicitly defines their semantics
- adding a supported top-level manifest field requires updating the shared
  manifest normalization and digest projection/conformance vectors in the same
  change whenever the field has runtime or authority semantics

This allows Trellis to validate a proposed replacement before a service or
device offer for the same `id` becomes accepted. Preregistered device firmware
revisions that map to different digests in one device lineage still resolve
through deployment-envelope fit rather than a deployment digest allow list.

### 6.2) Runtime implementation offers

Contracts, envelopes, and implementation liveness are separate concepts.

Terms:

- **known contract**: a validated normalized manifest stored by digest in the
  global `contracts` store, or a built-in Trellis manifest. Known contracts are
  historical content-addressed facts. They are not runtime authority and do not
  become active merely because they are stored.
- **presented contract**: the manifest or digest supplied by a participant
  during bootstrap, reconnect, approval, or review. A presented contract is
  scoped to that request.
- **envelope-authorized boundary**: the contracts, surfaces, capabilities, and
  resources covered by a deployment or identity envelope. Envelopes are durable
  authority and do not retain a relationship to the digest that caused an
  expansion.
- **implementation offer**: an accepted statement that a service or device
  instance currently implements one `contractId` at one digest for one
  deployment. Offers are derived from successful runtime bootstrap or
  activation, not from every known manifest and not from envelope authority.
- **active offer**: an implementation offer whose deployment and instance are
  enabled, whose current connection is live or still within the configured grace
  window, and whose `expiresAt` has not passed.
- **effective active contract**: for one `contractId`, the compatible union of
  all active offers for that lineage. Multiple service versions may run together
  during rollout only when their owned surfaces are active-compatible.
- **stale offer**: an offer whose connection has disconnected or whose graceful
  shutdown has been observed, but whose short grace window has not expired.
- **expired offer**: an offer past `expiresAt`. Expired offers do not contribute
  to active implementation projection, dependency resolution, approval
  provisioning, or runtime authorization.

Rules:

- non-builtin runtime activity is derived from active offers only
- known historical manifests MUST NOT be broadly merged into approval,
  provisioning, dependency resolution, catalog, or runtime authorization
  decisions
- an envelope MAY authorize surfaces that no active implementation currently
  offers; that is allowed because the envelope is authority, not liveness
- if no active offer exists for a required dependency, Trellis reports a
  targeted dependency-not-active blocker rather than searching historical
  manifests for a compatible shape
- if active offers for one `contractId` are compatible, Trellis derives the
  effective active contract from their union
- if a newly presented offer is incompatible with the latest accepted
  same-lineage offer under a strict deployment, bootstrap rejects the new offer
  before it becomes active
- if incompatible active offers already exist because of a race, migration, or
  external repair, Trellis keeps the previous effective active set and surfaces
  a catalog repair issue for operators
- the latest accepted expired offer for a deployment and `contractId` MAY be
  used for strict same-lineage compatibility, because it is the implementation
  most likely to return after an outage
- graceful shutdown marks the offer stale for the same short grace window used
  for unplanned disconnects
- health heartbeats MAY refresh offer freshness and Console-visible status only
  for an already accepted matching offer; a heartbeat MUST NOT create an offer
  or change the offered digest

This is a clean break from evidence-derived active implementation projections.
Expansion and retraction history remains useful audit data, but it is not an
active implementation source.

Same-lineage replacement compatibility is defined by the owned communication
surface:

- `rpc`, `operations`, `events`, and `jobs` MUST evolve additively while
  replacement compatibility is being validated
- `uses`, metadata, and other non-owned sections MAY vary by digest as long as
  the presented contract validates successfully and dependency resolution
  against effective active contracts stays unambiguous
- `resources` declarations are validated from the presented contract; they do
  not need to be additive across the lineage, but Trellis MUST validate and bind
  the exact resource set requested by the contract bound to that principal
- physical resource identity is scoped to the deployment and contract lineage,
  not to the digest, so compatible service updates do not lose durable data
  solely because the contract digest changed
- `jobs` are part of the owned execution surface and follow the same additive
  compatibility expectations as other owned contract sections during replacement
  validation

Active-compatible evolution means:

- a new digest MAY add owned RPCs, operations, events, and job queues
- a new digest MAY add optional fields to existing request, response, progress,
  event, and job payload/result schemas when those payload objects remain open
  to unknown fields
- a new digest MAY remove an optional field from an existing payload schema when
  that field is not required by the previously accepted same-instance digest;
  because optional fields may be absent on the wire, same-lineage compatibility
  validation MUST NOT treat removal as a compatibility failure solely because
  the optional field is no longer declared
- a new digest MAY add new declared errors or new capabilities for newly added
  owned surfaces
- a new digest MUST NOT remove or rename an existing owned RPC, operation,
  event, or job queue during compatible replacement validation
- a new digest MUST NOT move an existing owned surface to a different subject
  during compatible replacement validation
- a new digest MUST NOT change an existing schema in a breaking way while old
  and new digests are compared for replacement

Active-compatible projection verifies duplicate same-lineage surfaces by
resolving their schema refs against each digest's `schemas` map. Projection MAY
accept canonically equal resolved schemas, MAY accept optional additive fields
on open object schemas, and MUST tolerate optional field removal when absence is
valid for consumers. Required fields and declared property schemas that remain
in the active projection MUST stay compatible. Projection MUST fail closed for
required-field removal, required/optional-breaking type changes, closed-object
property-set divergence other than tolerated optional removal, unresolved refs,
and any non-identical schema construct whose wire compatibility is not proven by
the supported v1 verifier.

Authoring note:

- additive rollout only works when older runtimes can still validate newer
  payloads that include unknown optional fields
- for TypeBox-authored request, response, progress, and event payload objects,
  do not treat closed-object additional-property rejection as the default
- close a payload object only when rejecting unknown fields is an intentional
  contract rule and mixed-version additive rollout does not need those fields

Breaking schema changes include:

- removing an existing required field that callers or subscribers may still send
  or read
- changing an optional field to required
- changing a field type incompatibly, such as `string` to `object` or `number`
  to `string`
- narrowing allowed enum values or formats in a way that rejects payloads
  accepted by the older digest
- changing payload semantics incompatibly while keeping the same field names and
  operation/RPC/event subjects

If a rollout needs one of those breaking changes, it MUST use a new contract
`id` / major version for production deployments. During early unreleased
development, an operator MAY mark the service deployment `mutable-dev` so the
same instance can accept an incompatible same-lineage contract without creating
a production compatibility guarantee.

### 6.3) Capability metadata and global keys

Contract manifests may declare top-level capability metadata keyed by global
capability key.

Example:

```json
{
  "capabilities": {
    "trellis.jobs::admin.read": {
      "displayName": "Read jobs admin data",
      "description": "View Jobs service health, services, jobs, and dead-letter queues."
    },
    "trellis.jobs::admin.mutate": {
      "displayName": "Mutate jobs admin data",
      "description": "Cancel, retry, replay, or dismiss Jobs service work items.",
      "consequence": "Can change background job execution state."
    }
  }
}
```

The global key format is `<capability namespace>::<local capability>`. The
capability namespace is the contract `id` with a trailing `@vN` major-version
suffix removed. For example, `trellis.jobs@v1` emits capability keys in the
`trellis.jobs::` namespace.

Rules:

- top-level capability entries require `displayName` and `description`; they MAY
  include `consequence` for concise user-facing risk or effect copy
- capability metadata is authored by the contract that owns the authority
- capability metadata is included in the digest projection because approval copy
  defines the meaning of the authority being granted
- canonical manifests SHOULD use global keys in top-level `capabilities` and in
  RPC, operation, and event capability lists
- language authoring helpers MAY let authors write local capability names and
  project them into global keys during manifest emission
- only declared local capability names are projected; undeclared strings remain
  raw platform or external capabilities
- dependency contracts are selected through `uses`; callers do not redeclare a
  dependency's capability metadata
- approval UIs should render capability metadata first and treat raw keys,
  contract ids, and digests as technical detail

### Declared dependencies (`uses`)

Contracts MAY declare explicit dependencies on other contracts through a
top-level `uses` object. Dependency aliases MUST be grouped under
`uses.required` or `uses.optional`; required aliases fail closed and optional
aliases grant authority only when their target contract and surface resolve in
the effective active contract set.

Example:

```json
{
  "uses": {
    "required": {
      "auth": {
        "contract": "trellis.auth@v1",
        "events": {
          "subscribe": [
            "Auth.Connections.Opened",
            "Auth.Connections.Closed",
            "Auth.Sessions.Revoked",
            "Auth.Connections.Kicked"
          ]
        }
      }
    },
    "optional": {
      "core": {
        "contract": "trellis.core@v1",
        "rpc": {
          "call": ["Trellis.Surface.Status"]
        }
      }
    }
  }
}
```

Rules:

- dependencies are declared by logical contract `id` plus logical
  operation/RPC/event names, not by raw capability strings
- dependencies are defined only under `uses.required` or `uses.optional`;
  aliases directly under `uses` are invalid and undefined, and callers must not
  rely on any authority or digest semantics for them
- both required and optional uses participate in digest identity
- if the same alias appears in both `required` and `optional`, the required
  entry wins and the optional duplicate is ignored
- a service contract MUST NOT receive cross-contract runtime permissions unless
  that access is declared in `uses` or is a Trellis-defined baseline surface
  automatically available to that participant kind
- connected service and device manifests receive the Trellis-defined baseline
  `health` use automatically, targeting `trellis.health@v1` with
  `events.publish: ["Health.Heartbeat"]`; `trellis.health@v1` itself is excluded
  from this self-use
- if a service or device author explicitly declares `uses.required.health` or
  `uses.optional.health` for `trellis.health@v1`, authoring helpers merge the
  baseline heartbeat publish selector into that alias rather than requiring a
  second alias
- manifest validation is structural and MAY accept referenced contracts that are
  not active yet, but approval, provisioning, and runtime authorization MUST NOT
  derive dependency surfaces from inactive historical manifests
- required dependency resolution uses the dependency's effective active
  contract; if no effective active contract exists, Trellis reports a
  dependency-not-active blocker
- if the dependency's active offers are incompatible, Trellis reports a catalog
  repair issue for that active lineage and does not resolve the dependency from
  historical manifests
- missing optional contracts and missing optional surfaces do not fail
  structural validation and do not grant transport authority
- if a missing optional contract or surface later becomes active, a fresh
  envelope expansion and approval is required before reconnects receive that
  optional authority
- validation happens when resolving dependencies against effective active
  contracts: if a `uses` entry targets a contract with multiple active
  compatible offers, Trellis projects their surfaces together
- that active-offer projection MAY merge additive identical logical surface
  descriptors, but MUST reject divergent duplicate descriptors for the same
  operation, RPC, or event name
- duplicate surface descriptors are compared after resolving schema refs; same
  ref names are not sufficient, and different ref names are acceptable only when
  the resolved schemas are canonically equal or proven compatible by the
  same-lineage schema verifier
- required dependency cycles that cannot produce an active provider first are
  not resolved through historical manifests; service authors should break such
  cycles by staging one provider, making one edge optional, or splitting
  contracts
- higher-level consent scopes for user-facing applications MAY be derived from
  `uses`, but runtime enforcement remains operation-level
- any user approval or consent record for a client contract MUST retain the
  reviewed contract digest for audit, while the durable authority is the
  resulting identity-envelope boundary

### Runtime surface status

Catalog knowledge, authorization, and runtime availability are separate
decisions. A contract is known when Trellis has stored a validated manifest by
digest. A deployment boundary is authorized only when the deployment envelope
covers it. A surface is active only when an enabled service or device offer
currently contributes it. `Trellis.Surface.Status` is an advisory Trellis core
RPC that checks known contract metadata, checks the caller's current capability
envelope, and checks implementation offers only after authorization succeeds.

Status outcomes are:

- `unknown_contract` when the contract id is not known to the catalog
- `unknown_surface` when the known contract lineage has no matching logical RPC,
  operation, event, or feed surface
- `unauthorized` with missing capability keys when the caller's current envelope
  does not authorize the requested surface
- `unavailable` with `envelope_unavailable` when the contract is known but the
  caller's effective envelope does not cover the requested surface
- `unavailable` with `dependency_not_active` when the surface depends on a
  contract with no effective active implementation offer
- `available` with `liveImplementer: true` and `runtime: "live"` when an enabled
  connected service or device instance currently offers the requested surface
- `available` with `liveImplementer: false` and `runtime: "no_live_implementer"`
  when the surface is authorized and recently offered within grace but no live
  connection currently implements it
- `available` with `liveImplementer: false` and `runtime: "disabled"` when only
  disabled matching service or device instances currently implement it

Availability MUST NOT grant authority or remove transport permissions that were
already granted from the caller's effective contract envelope. During
mixed-version rollouts, availability is scoped to the compatible active offers
that define the requested logical surface, not merely to any known digest in the
same contract lineage.

### 7) RPC operation descriptor

Each `rpc` entry describes one logical request/reply operation.

Example:

```json
{
  "schemas": {
    "FindUserRequest": { "type": "object" },
    "FindUserResponse": { "type": "object" }
  },
  "User.Find": {
    "version": "v1",
    "subject": "rpc.v1.User.Find",
    "input": { "schema": "FindUserRequest" },
    "output": { "schema": "FindUserResponse" },
    "capabilities": {
      "call": ["graph::users.read"]
    },
    "errors": [{ "type": "ValidationError" }, { "type": "NotFoundError" }]
  }
}
```

Fields:

| Field               | Required | Meaning                                  |
| ------------------- | -------- | ---------------------------------------- |
| `version`           | yes      | Version tag for the operation, `vN`      |
| `subject`           | yes      | Concrete NATS subject used for the RPC   |
| `input`             | yes      | Schema reference for the request payload |
| `output`            | yes      | Schema reference for the success payload |
| `capabilities.call` | no       | Capabilities required to invoke the RPC  |
| `errors`            | no       | Declared serializable error types        |

Rules:

- the map key is the logical RPC name, for example `User.Find`
- `subject` SHOULD follow the convention `rpc.<version>.<LogicalName>`
- `input` and `output` are required schema refs into the contract-level
  `schemas` map
- `capabilities.call` is an all-of requirement; the caller must hold every
  listed capability
- declared contract-owned capabilities SHOULD appear as global capability keys
  in canonical manifests
- if `capabilities.call` is omitted, the RPC is callable without extra
  capability grants
- `errors` enumerates known typed error payloads but does not close the wire
  format to unknown future error types

### 7a) Operation descriptor

Each `operations` entry describes one logical caller-visible asynchronous
workflow.

Example:

```json
{
  "Billing.Refund": {
    "version": "v1",
    "subject": "operations.v1.Billing.Refund",
    "input": { "schema": "BillingRefundRequest" },
    "progress": { "schema": "BillingRefundProgress" },
    "output": { "schema": "BillingRefundResult" },
    "capabilities": {
      "call": ["billing::billing.refund"],
      "observe": ["billing::billing.refund"],
      "cancel": ["billing::billing.refund.cancel"],
      "control": ["billing::billing.refund.control"]
    },
    "signals": {
      "approveRefund": {
        "input": { "schema": "BillingRefundApproval" }
      }
    },
    "cancel": true
  }
}
```

Rules:

- `subject` SHOULD follow the convention `operations.<version>.<LogicalName>`
- each operation also owns a derived control subject `<subject>.control`
- `input` and `output` are required schema refs; `progress` is optional
- `capabilities.call` gates invocation
- `capabilities.observe` gates `get`, `wait`, and `watch`; if omitted, it
  defaults to `capabilities.call`
- `capabilities.cancel` gates `cancel`; if omitted, callers do not receive
  cancel rights by default
- `capabilities.control` gates named operation signals; if omitted, signal
  submission has no extra capability gate beyond authentication and operation
  ownership, so user-facing post-start inputs SHOULD declare explicit control
  capabilities
- `signals` declares named post-start input schemas for validation, review,
  documentation, digest projection, and generated SDK aliases
- accepted signals are private operation-control inputs; they are persisted with
  an operation-local signal sequence and do not increment the public operation
  snapshot revision
- `cancel: true` declares cancellation support; callers may still have a
  language-level `cancel()` helper, but unsupported cancellation MUST return a
  runtime error frame and MUST NOT mutate operation state
- operations are always authenticated; omitting a capability list removes only
  additional capability grants, not the authentication requirement itself
- operations are durable async contracts, not raw jobs and not unary RPCs
- services own operation-level authorization for specific operation ids; the
  contract only declares the coarse capability gates

### 8) Event descriptor

Each `events` entry describes one domain event published on a NATS subject.

Example:

```json
{
  "schemas": {
    "PartnerChanged": { "type": "object" }
  },
  "Partner.Changed": {
    "version": "v1",
    "subject": "events.v1.Partner.Changed.{/partner/id/origin}.{/partner/id/id}",
    "params": ["/partner/id/origin", "/partner/id/id"],
    "event": { "schema": "PartnerChanged" },
    "capabilities": {
      "publish": ["partners::partners.write"],
      "subscribe": ["partners::partners.read"]
    }
  }
}
```

Fields:

| Field                    | Required | Meaning                                                |
| ------------------------ | -------- | ------------------------------------------------------ |
| `version`                | yes      | Version tag for the event, `vN`                        |
| `subject`                | yes      | Concrete or templated NATS subject                     |
| `params`                 | no       | Ordered JSON Pointer list used by the subject template |
| `event`                  | yes      | Schema reference for the event payload                 |
| `capabilities.publish`   | no       | Capabilities required to publish the event             |
| `capabilities.subscribe` | no       | Capabilities required to subscribe to the event        |

Rules:

- the map key is the logical event name, for example `Partner.Changed`
- `subject` SHOULD follow the convention
  `events.<version>.<LogicalName>[.<tokens...>]`
- template tokens use the form `{<json-pointer>}` and MUST reference values in
  the event payload
- if `params` is present, it MUST list the template pointers in subject order
- every template pointer MUST resolve through direct object-schema `properties`
  from the referenced event payload schema; pointers through arrays, non-object
  schemas, or missing properties fail contract validation
- `event` is a required schema ref into the contract-level `schemas` map
- `capabilities.publish` and `capabilities.subscribe` are independent all-of
  requirements
- a wildcard authorization subject for an event is produced by replacing every
  template token with `*`
- that effective wildcard subject is also the subject key used by catalog
  collision checks, so two templated events with different JSON Pointer tokens
  still collide if they normalize to the same NATS wildcard subject

Example wildcard derivation:

- template: `events.v1.Partner.Changed.{/partner/id/origin}.{/partner/id/id}`
- wildcard: `events.v1.Partner.Changed.*.*`

### 8a) Event consumer groups

The optional top-level `eventConsumers` map declares service-owned durable event
consumer groups. These groups are not public event surfaces. They are deployment
resources that tell Trellis which subscribed events a service processes with a
Trellis-provisioned JetStream pull consumer.

Example:

```json
{
  "uses": {
    "required": {
      "billing": {
        "contract": "billing@v1",
        "events": { "subscribe": ["Billing.SubscriptionConfirmed"] }
      }
    }
  },
  "eventConsumers": {
    "workspaceBilling": {
      "events": [
        { "use": "billing", "event": "Billing.SubscriptionConfirmed" }
      ],
      "replay": "new",
      "ordering": "strict",
      "concurrency": 1,
      "ackWaitMs": 300000,
      "maxDeliver": 6,
      "backoffMs": [5000, 30000, 120000, 600000, 1800000]
    }
  }
}
```

Fields:

| Field         | Required | Meaning                                                                  |
| ------------- | -------- | ------------------------------------------------------------------------ |
| `events`      | yes      | Subscribed dependency events included in this consumer group             |
| `replay`      | no       | `"new"` or `"all"`; defaults to `"new"`                                  |
| `ordering`    | no       | Ordering mode; v1 supports `"strict"` and defaults to `"strict"`         |
| `concurrency` | no       | Handler concurrency; defaults to `1`; strict ordering requires `1`       |
| `ackWaitMs`   | no       | JetStream ack wait in milliseconds; Trellis applies a runtime default    |
| `maxDeliver`  | no       | Maximum delivery attempts; Trellis applies a NATS-valid runtime default  |
| `backoffMs`   | no       | Redelivery backoff in milliseconds, capped to fit `maxDeliver` semantics |

Rules:

- every `eventConsumers.<group>.events[]` entry references a `uses` alias and a
  logical event name from that dependency
- the referenced `uses` alias MUST be present under `uses.required` or
  `uses.optional` and MUST include that event in `events.subscribe`
- durable service event processing is explicit-only; Trellis does not create an
  implicit consumer group from `uses.events.subscribe`
- the same event MAY appear in multiple groups; each group is an independent
  durable cursor, so duplicate delivery to those groups is intentional
- group names are logical contract aliases; Trellis owns the physical stream,
  durable consumer name, filter subjects, and runtime binding payload
- `eventConsumers` is part of digest identity except for nested `docs` metadata
- envelope expansion validates the referenced subscribed event surfaces against
  effective active dependency offers and the requested envelope before
  provisioning
- durable event consumers are provisioned during successful approval so events
  published after approval are captured even if the service process has not
  finished reconnecting
- if a referenced dependency has no effective active offer, approval fails with
  a dependency-not-active blocker before Trellis creates any NATS resource
- if consumer creation or adoption fails, approval fails and the envelope is not
  expanded
- event consumer bindings are deployment resources. Service code consumes the
  binding through the connected runtime, not by constructing or naming a
  JetStream durable consumer itself
- service principals MUST NOT receive broad event-processing grants such as
  `$JS.API.CONSUMER.DURABLE.CREATE.trellis.>`; auth grants only the exact bound
  consumer subjects required for info, pull-next, and acknowledgements
- ephemeral event listeners remain live direct subscriptions governed by the
  normal `uses.events.subscribe` authority. They do not require an
  `eventConsumers` binding and do not replay stored events

### 9) No raw subject descriptor

The v1 contract model does not expose a top-level `subjects` map or
`uses.*.subjects` declarations. Public and cross-contract communication must be
modeled as RPCs, operations, or events so Trellis can derive typed SDKs,
capabilities, and compatibility from the same surface.

Subsystem-owned raw NATS subjects may still exist behind those contract-owned
APIs. Jobs work subjects, advisories, operation reply subjects, and transfer
chunk subjects are runtime protocol details derived from jobs, operations,
transfer declarations, or installed bindings rather than caller-authored raw
subject entries.

### 10) Cloud resource requests

The optional top-level `resources` map declares cloud-provided resources that
the service expects Trellis to provision or bind during deployment-envelope
expansion.

Example:

```json
{
  "resources": {
    "kv": {
      "activity": {
        "purpose": "Store normalized activity entries",
        "schema": { "schema": "AuditEntry" },
        "required": true,
        "history": 1,
        "ttlMs": 0,
        "maxValueBytes": 262144
      }
    },
    "store": {
      "uploads": {
        "purpose": "Temporary uploaded files awaiting processing",
        "required": true,
        "ttlMs": 86400000,
        "maxTotalBytes": 10737418240
      }
    }
  }
}
```

Rules:

- resource keys such as `activity` are logical aliases chosen by the service
  author
- aliases are part of the contract and are stable API surface for the service
- the contract requests logical resources; Trellis assigns physical names and
  backing infrastructure when the deployment envelope expands
- Trellis validates requested resource declarations from the reviewed contract,
  but chooses physical resource identities at the deployment/lineage scope
  rather than the digest scope
- the v1 resource surface supports `resources.kv` and `resources.store`
- a KV request declares:
  - `purpose`: required human-facing explanation of why the service needs the
    resource
  - `schema`: required schema reference for the JSON value stored in the bucket
  - `required`: whether activation depends on successful provisioning; default
    `true`
  - `history`: desired KV history depth; default `1`
  - `ttlMs`: desired bucket TTL in milliseconds; default `0`
  - `maxValueBytes`: optional desired per-value maximum in bytes
- a store request declares:
  - `purpose`: required human-facing explanation of why the service needs the
    resource
  - `required`: whether activation depends on successful provisioning; default
    `true`
  - `ttlMs`: optional desired retention in milliseconds; `0` or omitted means no
    automatic expiry requested
  - `maxTotalBytes`: optional desired total-store maximum in bytes; omitted
    means no finite total-size request and reconciles the backing NATS object
    store to the backend sentinel for "no contract-requested finite total limit"
  - `maxObjectBytes`: optional desired per-object maximum in bytes, enforced by
    Trellis runtime write paths when exposed in the installed binding
- envelope expansion approves the requested alias/type/spec, not general
  infrastructure-management credentials for the service
- all declared resources in an approved contract boundary MUST be provisioned or
  adopted during approval; this includes `resources.kv`, `resources.store`,
  top-level `jobs` bindings, and top-level `eventConsumers`
- resource approval is atomic from Trellis's perspective: if approval fails,
  returns pending/waiting, or cannot persist SQL state, Trellis MUST best-effort
  clean up every NATS resource created by that attempt
- resources adopted from existing matching bindings are never deleted by
  rollback
- deterministic resource names make retry safe when cleanup partially fails;
  retry MUST adopt matching resources rather than creating duplicates
- an existing resource with an incompatible shape or unsafe ownership conflict
  fails approval before Trellis creates any new resource
- `required: false` remains part of the contract and generated service typing,
  but it is not a best-effort provisioning flag; Trellis does not silently skip
  a declared resource because provisioning failed
- v1 store bindings expose effective runtime limits, including `maxObjectBytes`
  when the contract requested a finite per-object limit; NATS object-store
  `max_bytes` is the total-store limit, while Trellis runtime write paths
  enforce the per-object binding limit

### 10a) First-class jobs

The optional top-level `jobs` map declares first-class service-private job
queues.

Example:

```json
{
  "jobs": {
    "refundCharge": {
      "payload": { "schema": "RefundChargePayload" },
      "result": { "schema": "RefundChargeResult" },
      "maxDeliver": 5,
      "backoffMs": [5000, 30000, 120000, 600000, 1800000],
      "ackWaitMs": 300000,
      "defaultDeadlineMs": 900000,
      "progress": true,
      "logs": true,
      "dlq": true,
      "concurrency": 1
    }
  }
}
```

Rules:

- job keys such as `refundCharge` are logical queue names chosen by the service
  author
- the v1 jobs surface is top-level contract data, not a `resources` request
- each queue entry requires `payload.schema`
- each queue entry may include `result.schema`
- each queue entry may include `maxDeliver`; default `5`
- each queue entry may include `backoffMs`; default
  `[5000, 30000, 120000, 600000, 1800000]`
- each queue entry may include `ackWaitMs`; default `300000`
- each queue entry may include `defaultDeadlineMs`
- each queue entry may include `progress`; default `true`
- each queue entry may include `logs`; default `true`
- each queue entry may include `dlq`; default `true`
- each queue entry may include `concurrency`; default `1`
- Trellis owns the shared jobs infrastructure and resolves any internal
  work-stream or projected-state bindings needed by the runtime; ordinary
  service-author APIs should use `service.jobs` rather than raw stream bindings

### 10b) First-class state stores

The optional top-level `state` map declares named Trellis-managed state stores.

Example:

```json
{
  "schemas": {
    "Preferences": {
      "type": "object",
      "properties": {
        "theme": { "type": "string" }
      },
      "required": ["theme"]
    },
    "PreferencesV2": {
      "type": "object",
      "properties": {
        "theme": { "type": "string" },
        "compact": { "type": "boolean" }
      },
      "required": ["theme", "compact"]
    },
    "Draft": {
      "type": "object",
      "properties": {
        "title": { "type": "string" }
      },
      "required": ["title"]
    }
  },
  "state": {
    "preferences": {
      "kind": "value",
      "schema": { "schema": "PreferencesV2" },
      "stateVersion": "preferences.v2",
      "acceptedVersions": {
        "preferences.v1": { "schema": "Preferences" }
      }
    },
    "drafts": {
      "kind": "map",
      "schema": { "schema": "Draft" }
    }
  }
}
```

Rules:

- state store keys such as `preferences` and `drafts` are logical store names
  chosen by the contract author
- the v1 state surface is top-level contract data, not a `resources` request
- each state store requires `kind`
- `kind` MUST be either `value` or `map`
- each state store requires `schema`
- `schema` MUST reference an entry in the top-level contract `schemas` map
- `stateVersion` is optional and defaults to `"v1"`
- `stateVersion` is the author-known persisted-state version, not the contract
  digest
- `acceptedVersions` is optional and maps older accepted state versions to
  schema refs in the top-level `schemas` map
- runtimes MUST validate every `acceptedVersions` schema ref during contract
  validation
- state values are JSON on the wire and are validated against the declared store
  schema
- the named store is the public runtime entrypoint; normal callers do not choose
  an arbitrary `scope` or a contract-wide generic keyspace
- admin inspection remains a separate API surface from the normal runtime state
  helpers

Implementation note:

- Rust manifest parsing and builder validation must validate both the primary
  state store schema ref and any `acceptedVersions` schema refs, matching the
  TypeScript-generated manifest semantics

### 11) Error declarations

The optional top-level `errors` map declares named serializable error payloads.

Example:

```json
{
  "ValidationError": {
    "type": "ValidationError",
    "schema": { "type": "object" }
  }
}
```

Rules:

- the map key is a local declaration name; matching `type` is preferred but not
  required
- operation-level `errors` entries reference error types by `type`
- the wire error envelope is open; runtimes MUST preserve unknown error payloads
- declared error schemas enable SDK generation and typed client helpers but do
  not prevent forward-compatible unknown error handling
- manifest-level error declarations stay pure JSON and do not carry
  language-specific runtime metadata such as class constructors
- language runtimes MAY attach out-of-band metadata to local contract objects so
  declared errors can be reconstructed as real runtime error instances without
  changing the canonical manifest format

### 12) Canonicalization and digest

Contracts are content-addressed by the digest of a normalized runtime/interface
projection derived from the canonical manifest.

Canonicalization rules for v1:

- the manifest must be a pure JSON value
- numbers must be finite and must not use negative zero
- object keys are sorted lexicographically during canonicalization
- arrays preserve source order during generic JSON canonicalization
- the canonical JSON string contains no insignificant whitespace

Digest rules for v1:

- algorithm: SHA-256 over the canonical JSON string for the digest projection
- encoding: base64url without padding
- the digest projection includes runtime identity and behavior: `format`, `id`,
  `kind`, `capabilities`, `state`, `uses`, `rpc`, `operations`, `events`,
  `feeds`, `jobs`, `resources.kv`, `resources.store`, reachable schemas, and
  RPC-declared reachable errors
- resource `required` flags participate in the digest because they change
  install, activation, and binding behavior
- the digest projection excludes contract-level `displayName`, `description`,
  `docs`, `exports`, unused schemas, and unused error declarations
- capability metadata is not display-only contract metadata; it participates in
  the digest because it defines the human meaning of granted authority
- set-like arrays such as capabilities, `uses.*` logical-name lists, and RPC
  error lists are sorted and deduplicated before digesting
- order-sensitive arrays such as event params, job backoff schedules, and JSON
  Schema arrays keep their source order

The digest is the deployment/runtime identity of one concrete contract artifact.

This means different formatting, display or docs metadata changes, export-only
changes, and unused local schema changes do not change the digest.
Runtime/interface changes do change the digest, and catalogs and registration
workflows refer to contracts by digest.

### 13) Catalog format

The Trellis runtime exposes its catalog projection as `trellis.catalog.v1`.
Deployment envelopes and identity envelopes are the authority for approved
surfaces. Expansion and retraction history is cold review and audit data, and
resource binding rows describe provisioned resources for envelope-covered
deployments. The global `contracts` store is the authority for full normalized
manifests by digest. In-memory contract/catalog objects are validation,
projection, and cache state only.

Shape:

```json
{
  "format": "trellis.catalog.v1",
  "contracts": [
    {
      "id": "graph@v1",
      "digest": "<base64url-sha256>",
      "displayName": "Graph Service",
      "description": "Serve graph RPCs and publish graph change events."
    }
  ]
}
```

Catalog rules:

- the catalog contains the runtime's active implementation projection: built-in
  Trellis contracts plus non-expired service and device offers
- entries are keyed by digest and include `id`, `displayName`, and `description`
- a catalog MAY include multiple concrete digests for one non-builtin `id`
  during a compatible mixed-version rollout; runtime authorization uses the
  effective active union internally
- a catalog MUST NOT invent a synthetic union digest
- catalog ordering is not semantically significant, but implementations SHOULD
  return a stable order for diffability and testing
- catalog refresh is fail-closed: failure to hydrate required builtin contract
  state MUST fail startup or refresh rather than publishing a partial catalog
- catalog hydration resolves full manifests from built-in Trellis contracts or
  the global `contracts` store; expansion history and implementation offer rows
  MUST NOT be used as manifest lookup fallbacks
- catalog refresh, surface-status checks, shrink previews, and unused
  installed-contract cleanup MUST use targeted durable-store queries keyed by
  the relevant deployment, digest, route, or offer records rather than scanning
  nearby local manifests or broad in-memory catalogs
- refresh MUST validate every proposed catalog digest before replacing the
  in-memory catalog; unknown digests or divergent duplicate surfaces keep the
  previous catalog unavailable rather than falling back to partial state
- admin envelope expansion and shrink flows MUST use the same validation in
  dry-run mode against staged deployment-envelope records before mutating the
  durable envelope set, so incompatible boundaries fail before partial state is
  persisted or exposed to callers
- service and device runtime authority is derived from envelope fit and the
  participant's presented contract; active offers describe implementation
  availability and dependency resolution, not durable authority
- deployment enable/disable validation MUST stage the matching deployment
  envelope state, because deployment-envelope enabled state determines whether
  that deployment can authorize a presented contract

Admin contract analysis records SHOULD expose enough derived metadata for CLI
and console review without reimplementing catalog analysis in each client:

- `analysisSummary` includes counts for RPCs, operations, operation controls,
  events, NATS publish/subscribe rules, KV resources, store resources, and jobs
  queues
- `analysis.operations.operations[]` includes `key`, `subject`,
  `wildcardSubject`, `controlSubject`, `wildcardControlSubject`,
  `callCapabilities`, `observeCapabilities`, `cancelCapabilities`, and `cancel`
- `analysis.operations.control[]` includes `key`, `action`, `subject`,
  `wildcardSubject`, and `requiredCapabilities`
- NATS analysis rule `kind` values include operation call, operation handle, and
  operation control rules in addition to RPC, event, transfer, jobs, and
  resource rules

Repository-layout clarification:

- `in-tree` versus `out-of-tree` is not an architectural distinction for service
  contracts
- Trellis-managed contracts such as `trellis.core@v1`, `trellis.auth@v1`, and
  `trellis.state@v1` are ordinary service contracts implemented by the `trellis`
  runtime service
- colocated service contracts MUST be treated the same way as service contracts
  committed in another repo
- a repo MAY carry additional manifests for local development, but they are not
  implicitly authorized or catalog-visible just because they live nearby

### 14) Trellis discovery RPCs

The `trellis.core@v1` contract implemented by the `trellis` runtime service MUST
include runtime discovery RPCs.

Required v1 discovery RPCs:

- `Trellis.Catalog`
- `Trellis.Contract.Get`
- `Trellis.Bindings.Get`

Semantics:

#### `Trellis.Catalog`

- returns the runtime `trellis.catalog.v1` projection
- capability: `trellis.core::catalog.read`
- returns a bounded runtime projection; it is not a repository scan, an
  authority source, or a way to enumerate inactive/local manifests
- lists concrete active offered digests; callers use `Trellis.Contract.Get` to
  read a specific known manifest by digest

#### `Trellis.Contract.Get`

- input: contract `digest`
- returns the known contract manifest for that digest, resolved from built-in
  Trellis contracts or the global `contracts` store
- capability: `trellis.core::contract.read`
- for v1, callers only retrieve known contracts through this RPC when their
  contract grants the relevant Trellis-owned `uses` surface

Deployment envelope expansion and shrink are intentionally not part of the
runtime discovery RPC set.

- initial service deployment creates an empty service deployment envelope and a
  provisioned service instance key
- service runtime bootstrap MAY present the full manifest for the requested
  digest when Trellis does not already know it
- bootstrap validates and stores the presented manifest as a known contract;
  invalid manifests still fail before any envelope expansion request is created
- when required dependencies are unknown or inactive, bootstrap and approval
  return targeted dependency blockers and MUST NOT derive dependency surfaces or
  capabilities from missing or historical manifests
- when the presented contract boundary does not fit the deployment envelope,
  bootstrap stores the requested delta in a pending envelope expansion request
  and returns `envelope_expansion_required` so the service runtime can wait and
  retry
- pending service-originated envelope expansion requests are keyed by requester
  connection and requested delta; repeated requests from the same connected
  requester are deduplicated, and requests created by that requester are removed
  when it disconnects
- if the presented digest has the same `contractId` as the service instance's
  latest accepted offer but is incompatible under `strict` mode, bootstrap
  returns `contract_compatibility_violation`; production deployments should use
  a new contract version, while development deployments may opt into
  `mutable-dev`
- when the deployment envelope fits but required dependency surfaces cannot be
  resolved from effective active offers, bootstrap returns a dependency blocker;
  service runtimes wait and retry rather than receiving runtime credentials
- when the presented digest no longer fits the enabled deployment envelope,
  bootstrap returns `contract_changed`; runtimes must restart with an
  envelope-compatible contract rather than refreshing stale authority
- approving the pending request expands the deployment envelope and persists
  resource bindings only after all declared resources are created or adopted;
  runtime bootstrap completes only after every required dependency in the
  approved closure is active.
- UI and CLI implementations MAY still present a human review screen before
  calling direct envelope expansion RPCs for pre-approved rollout workflows

#### `Trellis.Bindings.Get`

- returns the installed resource bindings visible to the caller service
- capability: `service`
- supports optional filtering by `contractId` or `digest`
- returns logical aliases with cloud-assigned physical binding details
- does not expose operator or platform management credentials

Binding rules:

- bindings remain keyed by contract alias so application code stays stable
  across environments
- KV bindings expose concrete bucket information plus the granted usage limits
  needed by the service runtime
- store bindings expose the resolved physical store `name` plus effective
  retention and size limits needed by the service runtime
- jobs bindings expose a service namespace, the built-in jobs work stream, plus
  resolved queue bindings (`publishPrefix`, `workSubject`, `consumerName`) and
  effective per-queue runtime settings
- event consumer bindings expose the Trellis-owned event stream, physical
  `consumerName`, filter subjects, replay policy, ordering, concurrency, ack
  wait, max-deliver, and redelivery backoff for each declared group
- jobs bindings do not expose admin projection storage such as durable
  worker-presence buckets; services discover queue/runtime settings only
- services discover concrete resources through bindings rather than through
  general cloud-management credentials
- higher-level runtimes typically call `Trellis.Bindings.Get` during connect or
  bootstrap, then expose the resolved bindings or typed resource handles
  directly to service code
- authenticated service bootstrap MAY return the resolved binding payload
  directly; in that mode the bootstrapped service runtime MUST use the bootstrap
  binding instead of requiring the service principal to call `Trellis.Catalog`
  or `Trellis.Bindings.Get` after connect
- service principals only call discovery RPCs when their presented contract
  grants the relevant Trellis-owned `uses` surface; resource bindings alone do
  not grant general core discovery access

### 15) Installation and activation rules

The `trellis` runtime service owns the durable deployment records that define a
deployment's envelope authority.

The `trellis` runtime service MUST:

- validate manifests against `trellis.contract.v1`
- compute canonical digests
- upsert full normalized manifests into the global `contracts` store by digest
- store expansion and retraction history by reviewed digest; any redundant
  contract JSON in history records is historical/review data only, not a
  manifest lookup fallback
- treat `contractId` as globally unique within one Trellis runtime for subject
  ownership and SDK identity
- store reviewed history rows covered by enabled deployment envelopes as cold
  review/audit data; history does not promote non-builtin contracts into the
  active implementation projection
- maintain durable deployment envelope and history rows for the deployment and
  publish an in-memory catalog only as a fail-closed projection
- reject subject collisions across operations, RPCs, and events using the
  effective subject after event-template wildcard normalization
- provision or adopt every declared cloud resource before service envelope
  expansion or upgrade succeeds
- persist resource bindings so service runtimes can resolve them at runtime
- bind each service deployment envelope to the service principal public key that
  implements it, including Trellis-owned contracts bootstrapped onto the
  `trellis` service principal
- support deployment-owned device deployment records that resolve a device class
  to a deployment envelope and presented contract
- support auth-owned login portal route selectors for browser login and
  deployment-owned portal-route metadata for device-activation routing, with
  built-in Trellis portal paths as the fallback
- remove the old submission/approval flow rather than preserving a compatibility
  path
- ensure any stored user approval or consent decision references the identity
  envelope delta and presented contract being approved

Envelope expansion validation MUST also:

- reject impossible or unsafe resource combinations before provisioning begins
- validate newly installed service digests and their effective active dependency
  surfaces before external resource provisioning begins
- reject service or device deployment envelope changes when canonical digest
  computation differs from the caller's reviewed presented contract digest
- validate the exact `resources` requested by the presented contract
- validate the exact `eventConsumers` requested by the presented contract and
  provision or bind their deployment-scoped consumers before approval succeeds
- preserve physical resource identity across compatible contract changes for the
  same deployment and lineage unless an operator intentionally creates a new
  lineage
- when activation or runtime auth is deployment-driven, validate that the
  presented contract fits that deployment's envelope
- login portal routes are auth-owned routing config for browser UX, while device
  portal routes remain deployment-owned routing config; neither form is a
  contract kind, standalone portal authority, or source of portal-specific
  install or service-auth behavior
- grant overrides are deployment-owned metadata layered on top of envelopes; web
  rows are keyed by `contractId + origin`, session-keyed rows are keyed by
  `contractId + sessionPublicKey`, and both may pre-authorize envelope and
  capability decisions without changing deployment-envelope semantics or
  inventing availability

Operationally, envelope expansion fails if any of these conditions is true:

- any operation, RPC, or event subject string is already owned by a different
  known contract `id` in the validation set
- any declared resource request cannot be provisioned or adopted according to
  platform policy
- any declared event consumer group cannot be resolved to approved subscribed
  dependency events or provisioned as a bound JetStream consumer
- approval returns pending or waiting after creating any NATS resource but
  before persisting the corresponding envelope and binding state

Same-contract replacement rule:

- `contractId` is globally unique within one Trellis runtime, but deployment
  envelopes authorize boundaries rather than selecting one non-builtin digest as
  active authority
- each service instance presents one exact contract digest at any moment
- in `strict` mode, a service instance may replace its current same-contract
  digest only when same-lineage compatibility validation succeeds
- in `mutable-dev` mode, Trellis skips same-lineage compatibility validation for
  that deployment so unreleased local development can iterate without inventing
  a production compatibility promise
- instances that present an envelope-incompatible contract are rejected with
  `contract_changed`; instances that present an incompatible same-contract offer
  in `strict` mode are rejected with `contract_compatibility_violation`
- envelope expansion remains a separate review path for missing boundaries;
  compatibility mode does not by itself expand the deployment envelope

Subject collision rule:

- if two known surfaces declare the same effective subject, validation MUST fail
  unless they are the same operation, RPC, or event surface in the same contract
  `id` lineage
- templated event subjects compare by the wildcard subject produced by replacing
  each template token with `*`, not by the literal JSON Pointer tokens in the
  template
- overlapping subjects for the same operation/RPC/event surface across candidate
  replacement digests in the same lineage are allowed during validation only
  when same-lineage compatibility keeps the subject meaning unambiguous

This keeps routing, discovery, and permission derivation unambiguous.

### 16) Authorization derivation

Authorization is derived from the presented contract that fits the effective
deployment or identity envelope.

For each envelope-compatible presented contract:

- operations contribute publish permissions for callers via `capabilities.call`
  on the declared operation subject, plus `capabilities.observe` and
  `capabilities.cancel` on the derived control subject as applicable
- RPCs contribute publish permissions for callers via `capabilities.call`
- events contribute publish permissions via `capabilities.publish`
- events contribute subscribe permissions via `capabilities.subscribe`
- feeds contribute publish permissions for feed request subjects via
  `capabilities.subscribe`; feed responses use the caller's authenticated inbox
  subscribe permission
- `uses` contributes the exact cross-contract operation/RPC/event/feed
  permissions the owning service may exercise at runtime after dependency
  resolution validates the referenced effective active surfaces
- operation uses that declare `transfer: { direction: "send", ... }` and grant
  `capabilities.call` contribute caller publish access to
  `transfer.v1.upload.*.*`
- RPC uses that declare `transfer: { direction: "receive" }` and grant
  `capabilities.call` contribute caller subscribe access to
  `transfer.v1.download.*.*`

For each installed resource binding:

- Trellis MAY derive additional runtime permissions needed to use the bound
  resource
- those permissions are scoped to the installed physical resource binding, not
  to general management APIs for the whole cloud
- store bindings may require both publish and subscribe grants depending on the
  backing implementation; those grants still remain service-local to the owning
  binding
- event-consumer bindings grant only exact bound JetStream subjects such as
  `$JS.API.CONSUMER.INFO.<stream>.<consumerName>`,
  `$JS.API.CONSUMER.MSG.NEXT.<stream>.<consumerName>`, and
  `$JS.ACK.<stream>.<consumerName>.>` plus any required JetStream info subject
- higher-level runtimes typically call `Trellis.Bindings.Get` during connect or
  bootstrap and expose the resulting bindings or typed resource handles to
  service code
- if authenticated service bootstrap already returned the resolved binding,
  higher-level runtimes use that payload as the binding source of truth rather
  than issuing service-principal discovery RPCs during startup

Rules:

- each capability list is an all-of requirement
- operation control subjects MUST be derived deterministically from the declared
  operation subject so auth and SDK generation remain contract-driven
- operation control publish grants currently use `capabilities.observe` and
  `capabilities.cancel` as applicable; holding only `capabilities.call` does not
  grant broad control-subject access beyond the operation-specific control
  subject
- generated runtime operation descriptors include `controlCapabilities` so
  services and clients can reason about signal gates even where catalog NATS
  permission derivation has not yet materialized separate signal-only grants
- `capabilities.cancel` gates only cancellation; it is not a fallback for named
  signals
- `capabilities.control` gates named signals; it is not a fallback for
  cancellation
- deployments that need signal-only callers, with neither observe nor cancel
  rights, need capability-derived control-subject grants for
  `capabilities.control`; that NATS permission derivation is not yet part of the
  current catalog analysis
- omitted `capabilities.observe` defaults to `capabilities.call`, so callers
  that can start an operation can also observe that operation unless the
  contract declares a different observe list
- an explicit empty `observe`, `cancel`, or `control` capability list means
  authenticated callers need no additional Trellis capability for that action
- templated event subjects are authorized using wildcard subjects derived by
  replacing each template token with `*`
- service sessions receive cross-contract permissions only from explicit `uses`,
  Trellis-defined baseline surfaces, and installed resource bindings; raw
  capability grants alone are not sufficient
- service-side transfer subscriptions are scoped to contracts installed on that
  service principal and to the service session prefix, not broad global transfer
  prefixes

Service-side RPC handling rule:

- a service may subscribe to RPC subjects for contracts installed on its
  authenticated service principal public key
- a service may subscribe to operation subjects and derived operation control
  subjects for contracts installed on its authenticated service principal public
  key
- runtime ownership is determined by the install record for that public key, not
  by contract metadata
- the bootstrapped `trellis` runtime service follows the same ownership rule;
  Trellis-owned contracts such as `trellis.core@v1`, `trellis.auth@v1`, and
  `trellis.state@v1` are intentionally bootstrap-active on that service
  principal unless a future SQL install-record model replaces this bootstrap
  shortcut

This install-record-based subscription rule is separate from caller capability
checks.

### 17) SDK derivation

SDKs derive from the canonical manifest, not from deployment-specific runtime
state.

For every supported language, the same manifest is the input to
language-specific generators, native authoring helpers, generated SDK packages,
or participant facades. Exact package export inventories, crate modules, type
aliases, and helper signatures belong in `/api`, generated TypeScript reference,
and Rustdoc.

The minimum required property is consistent semantics across languages:

- the same logical operation names
- the same operation, RPC, and event subjects
- the same schemas
- the same declared capability requirements
- the same known error declarations

If a contract declares `resources`, SDKs SHOULD expose the logical aliases and
typed binding payloads needed to resolve them from `Trellis.Bindings.Get`,
typically as part of connect or bootstrap rather than through ad hoc application
calls.

### 18) Runtime plugin projection

A contract may be projected into a runtime API module used by Trellis
client/server libraries.

For v1 TypeScript runtimes, that projection is a defined contract module
consumed by public runtime bootstrap helpers such as
`TrellisClient.connect(...)`, `TrellisService.connect(...)`, and
`TrellisDevice.connect(...)`.

Equivalent projections in other languages may be generated participant facades,
SDK modules, or runtime descriptors. This document owns the projection
requirements; language-library guides and API reference own ordinary usage
examples and exact helper names.

Projection requirements:

- preserve logical operation/RPC/event names
- preserve schemas needed for runtime validation
- preserve enough metadata for typed operation, request, response, publish, and
  subscribe helpers
- fail fast on duplicate merged RPC/event keys

### 19) AsyncAPI export

AsyncAPI is a derived documentation format.

Trellis tooling SHOULD support exporting a contract or catalog to
AsyncAPI-compatible documentation artifacts.

AsyncAPI is not the canonical runtime model because Trellis requires native
representation of:

- operation workflows
- RPC operations
- capability requirements
- subsystem-owned runtime subject spaces behind contract-owned APIs
- activation and catalog semantics

## Notes

- This document defines the architecture and the v1 contract/catalog
  specification.
- Language-specific authoring helpers are implementation details around the
  canonical manifest.
- A separate companion document may define service-specific authoring ergonomics
  for a particular language if needed, but this document is the normative
  contract boundary.
