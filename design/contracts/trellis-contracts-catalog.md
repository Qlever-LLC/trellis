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
  expects Trellis to provide before install or upgrade

Those needs apply across multiple repos and multiple implementation languages.

## Goals

- Keep API ownership with the service that implements the API.
- Define one canonical contract artifact for runtime and tooling.
- Make the active deployment contract set discoverable at runtime.
- Make cloud-provided service resources explicit and reviewable at contract
  install or upgrade time.
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
- `trellis.catalog.v1` - the active set of contracts for a deployment

Both artifacts are pure JSON values. They are language-neutral and safe to
persist, hash, validate, transmit, and use for code generation.

### 2) Contract lineage and implementation model

Every contract belongs to one stable contract lineage identified by `id`, and
each active digest is installed onto the service principal that implements it.

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
- manifests MUST be self-contained; runtime processing MUST NOT require fetching
  remote `$ref` targets

## Specification

### 5) Contract manifest: top-level shape

A `trellis.contract.v1` manifest has this top-level structure:

```json
{
  "format": "trellis.contract.v1",
  "id": "graph@v1",
  "displayName": "Graph Service",
  "description": "Serve graph RPCs and publish graph change events.",
  "kind": "service",
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

| Field         | Required | Type   | Meaning                                                            |
| ------------- | -------- | ------ | ------------------------------------------------------------------ |
| `format`      | yes      | string | MUST equal `trellis.contract.v1`                                   |
| `id`          | yes      | string | Stable contract identifier such as `trellis.core@v1` or `graph@v1` |
| `displayName` | yes      | string | Human-facing contract name shown in tooling and approval UIs       |
| `description` | yes      | string | Human-facing explanation of the contract's purpose                 |
| `kind`        | yes      | string | Contract role such as `service`, `app`, `agent`, or `device`       |
| `schemas`     | no       | object | Reusable self-contained JSON Schema values keyed by schema name    |
| `exports`     | no       | object | Canonical public exports made available to dependent contracts     |
| `uses`        | no       | object | Explicit cross-contract operation/RPC/event dependencies           |
| `jobs`        | no       | object | Map of first-class service-private job queue descriptors           |
| `operations`  | no       | object | Map of logical operation names to operation descriptors            |
| `rpc`         | no       | object | Map of logical RPC names to RPC operation descriptors              |
| `events`      | no       | object | Map of logical event names to event descriptors                    |
| `state`       | no       | object | Map of named Trellis-managed state stores                          |
| `resources`   | no       | object | Map of declarative cloud resource requests                         |
| `errors`      | no       | object | Map of declared error types to error descriptors                   |

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
  contracts are verified.
- `displayName` and `description` are human-facing manifest metadata for
  catalog, docs, and approval UI. They are not part of contract digest identity.
- runtime service identity, install routing, and authorization boundaries MUST
  NOT be inferred from manifest metadata.
- top-level object members not defined by the current runtime MAY be present for
  forward compatibility; runtimes MUST ignore unknown top-level fields they do
  not understand.

### 6) Contract identity

The contract `id` identifies one logical contract lineage.

Examples:

- `trellis.core@v1`
- `trellis.jobs@v1`
- `graph@v1`

Rules:

- `id` MUST be stable for semantically compatible revisions within the same
  major line
- a breaking contract revision MUST use a new `@vN` suffix
- a deployment MAY have multiple active digests for the same `id` during rollout
  or mixed-firmware operation
- all concurrently active digests for the same `id` MUST remain semantically
  compatible within that lineage, so mixed-version callers and service instances
  can keep working during rollout
- multiple active digests for one `id` remain valid only while active compatible
  digest validation can produce an additive, unambiguous surface projection
- install records bind one exact digest to one service principal public key,
  even when multiple digests in the same lineage are active at once

This allows rolling upgrades where some service instances still run the old
digest while newer instances have already switched to the new digest. The same
model also covers preregistered activated devices whose firmware revisions map
to different digests within one device lineage.

Concurrent-digest compatibility within one lineage is defined by the owned
communication surface:

- `rpc`, `operations`, `events`, and `jobs` MUST evolve additively while
  multiple digests in the same lineage are active
- `uses`, metadata, and other non-owned sections MAY vary by digest as long as
  the exact digest being installed still validates successfully and dependency
  resolution against active catalogs stays unambiguous
- `resources` declarations are validated from the exact digest being installed;
  they do not need to be additive across the lineage, but Trellis MUST validate
  and bind the exact resource set requested by the digest bound to that
  principal
- physical resource identity is scoped to the deployment/profile and contract
  lineage, not to the digest, so compatible service updates do not lose durable
  data solely because the contract digest changed
- `jobs` are part of the owned execution surface and follow the same additive
  compatibility expectations as other owned contract sections while multiple
  digests in one lineage coexist

Active-compatible evolution means:

- a new digest MAY add owned RPCs, operations, events, and job queues
- a new digest MAY add optional fields to existing request, response, progress,
  event, and job payload/result schemas when those payload objects remain open
  to unknown fields
- a new digest MAY remove an optional field from an existing payload schema when
  that field is not required by any active digest; because optional fields may
  be absent on the wire, same-lineage active-compatible validation MUST NOT
  treat removal as a compatibility failure solely because the optional field is
  no longer declared
- a new digest MAY add new declared errors or new capabilities for newly added
  owned surfaces
- a new digest MUST NOT remove or rename an existing owned RPC, operation,
  event, or job queue while old and new digests coexist
- a new digest MUST NOT move an existing owned surface to a different subject
  while old and new digests coexist
- a new digest MUST NOT change an existing schema in a breaking way while old
  and new digests coexist

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
  do not treat `{ additionalProperties: false }` as the default
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
`id` / major version rather than a second active digest in the same lineage.

### Declared dependencies (`uses`)

Contracts MAY declare explicit dependencies on other contracts through a
top-level `uses` object.

Example:

```json
{
  "uses": {
    "auth": {
      "contract": "trellis.auth@v1",
      "events": {
        "subscribe": [
          "Auth.Connect",
          "Auth.Disconnect",
          "Auth.SessionRevoked",
          "Auth.ConnectionKicked"
        ]
      }
    },
    "core": {
      "contract": "trellis.core@v1",
      "rpc": {
        "call": ["Trellis.Bindings.Get", "Trellis.Catalog"]
      }
    }
  }
}
```

Rules:

- dependencies are declared by logical contract `id` plus logical
  operation/RPC/event names, not by raw capability strings
- a service contract MUST NOT receive cross-contract runtime permissions unless
  that access is declared in `uses` or is a Trellis-defined baseline surface
  automatically available to that participant kind
- validation, install, or upgrade MUST fail if a referenced contract is
  unavailable or if any referenced operation, RPC, or event name does not exist
  on that contract
- validation happens when resolving dependencies against active catalogs: if a
  `uses` entry targets a contract with multiple active compatible digests,
  Trellis projects the active surfaces together
- that active-compatible-digest projection MAY merge additive identical logical
  surface descriptors, but MUST reject divergent duplicate descriptors for the
  same operation, RPC, or event name
- duplicate surface descriptors are compared after resolving schema refs; same
  ref names are not sufficient, and different ref names are acceptable only when
  the resolved schemas are canonically equal or proven compatible by the
  same-lineage schema verifier
- higher-level consent scopes for user-facing applications MAY be derived from
  `uses`, but runtime enforcement remains operation-level
- any user approval or consent record for a client contract MUST be bound to the
  exact contract digest, not merely to the contract `id`

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
      "call": ["users.read"]
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
      "call": ["billing.refund"],
      "read": ["billing.refund"],
      "cancel": ["billing.refund.cancel"]
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
- `capabilities.read` gates `get`, `wait`, and `watch`; if omitted, it defaults
  to `capabilities.call`
- `capabilities.cancel` gates `cancel`; if omitted, callers do not receive
  cancel rights by default
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
      "publish": ["partners.write"],
      "subscribe": ["partners.read"]
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
- `event` is a required schema ref into the contract-level `schemas` map
- `capabilities.publish` and `capabilities.subscribe` are independent all-of
  requirements
- a wildcard authorization subject for an event is produced by replacing every
  template token with `*`

Example wildcard derivation:

- template: `events.v1.Partner.Changed.{/partner/id/origin}.{/partner/id/id}`
- wildcard: `events.v1.Partner.Changed.*.*`

### 9) No raw subject descriptor

The v1 contract model does not expose a top-level `subjects` map or
`uses.*.subjects` declarations. Public and cross-contract communication must be
modeled as RPCs, operations, or events so Trellis can derive typed SDKs,
capabilities, and active-catalog compatibility from the same surface.

Subsystem-owned raw NATS subjects may still exist behind those contract-owned
APIs. Jobs work subjects, advisories, operation reply subjects, and transfer
chunk subjects are runtime protocol details derived from jobs, operations,
transfer declarations, or installed bindings rather than caller-authored raw
subject entries.

### 10) Cloud resource requests

The optional top-level `resources` map declares cloud-provided resources that
the service expects Trellis to provision or bind during install or upgrade.

Example:

```json
{
  "resources": {
    "kv": {
      "activity": {
        "purpose": "Store normalized activity entries",
        "schema": { "schema": "ActivityEntry" },
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
  backing infrastructure at install or upgrade time
- Trellis validates requested resource declarations from the exact applied
  contract digest, but chooses physical resource identities at the
  deployment/profile/lineage scope rather than the digest scope
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
  - `maxTotalBytes`: optional desired total-store maximum in bytes
- install or upgrade approves the requested alias/type/spec, not general
  infrastructure-management credentials for the service
- required resources fail install or upgrade if Trellis cannot provision or bind
  them
- optional resources (`required: false`) may be omitted from installed bindings
  if provisioning is unavailable or fails; service code must treat those aliases
  as optional at runtime
- v1 store bindings expose only effective runtime limits; `maxObjectBytes` is
  not emitted as an installed binding because Trellis does not enforce
  per-object object-store limits in the current runtime path

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
  `kind`, `state`, `uses`, `rpc`, `operations`, `events`, `jobs`,
  `resources.kv`, `resources.store`, reachable schemas, and RPC-declared
  reachable errors
- resource `required` flags participate in the digest because they change
  install, activation, and binding behavior
- the digest projection excludes `displayName`, `description`, `exports`, unused
  schemas, and unused error declarations
- set-like arrays such as capabilities, `uses.*` logical-name lists, and RPC
  error lists are sorted and deduplicated before digesting
- order-sensitive arrays such as event params, job backoff schedules, and JSON
  Schema arrays keep their source order

The digest is the deployment/runtime identity of one concrete contract artifact.

This means different formatting, display metadata changes, export-only changes,
and unused local schema changes do not change the digest. Runtime/interface
changes do change the digest, and catalogs and registration workflows refer to
contracts by digest.

### 13) Catalog format

A deployment exposes its active contract set as `trellis.catalog.v1`.

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

- the catalog contains only active contracts for the current deployment
- entries are keyed by digest and include `id`, `displayName`, and `description`
- a catalog MAY contain multiple digests for the same `id`
- when multiple digests share one `id`, the catalog still treats each digest as
  a separate active contract record
- catalog ordering is not semantically significant, but implementations SHOULD
  return a stable order for diffability and testing
- active catalog refresh is fail-closed: failure to list installed contracts or
  hydrate required active contract state MUST fail startup or refresh rather
  than publishing a partial active catalog
- refresh MUST validate every proposed active digest before replacing the
  in-memory catalog; unknown digests or divergent duplicate active surfaces keep
  the previous catalog unavailable rather than falling back to built-in
  manifests or a partial catalog
- active device digests are derived from enabled device deployments'
  `appliedContracts[].allowedDigests`, not from per-device current-contract
  fields

Admin contract analysis records SHOULD expose enough derived metadata for CLI
and console review without reimplementing catalog analysis in each client:

- `analysisSummary` includes counts for RPCs, operations, operation controls,
  events, NATS publish/subscribe rules, KV resources, store resources, and jobs
  queues
- `analysis.operations.operations[]` includes `key`, `subject`,
  `wildcardSubject`, `controlSubject`, `wildcardControlSubject`,
  `callCapabilities`, `readCapabilities`, `cancelCapabilities`, and `cancel`
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
  implicitly part of the active catalog just because they live nearby

### 14) Trellis discovery RPCs

The `trellis.core@v1` contract implemented by the `trellis` runtime service MUST
include runtime discovery RPCs.

Required v1 discovery RPCs:

- `Trellis.Catalog`
- `Trellis.Contract.Get`
- `Trellis.Bindings.Get`

Semantics:

#### `Trellis.Catalog`

- returns the active `trellis.catalog.v1` for the deployment
- capability: `trellis.catalog.read`

#### `Trellis.Contract.Get`

- input: contract `digest`
- returns the active contract manifest for that digest
- capability: `trellis.contract.read`
- for v1, callers only retrieve active contracts through this RPC

Service install and upgrade are intentionally not part of the runtime discovery
RPC set.

- initial service deployment is a `trellis.auth@v1` admin operation exposed by
  the `trellis` runtime service that takes a service public key and a candidate
  contract
- service contract upgrade is a `trellis.auth@v1` admin operation exposed by the
  `trellis` runtime service that takes an existing service public key and a
  replacement contract
- UI and CLI implementations MAY present a human review screen before calling
  those admin RPCs
- services do not self-register contracts at runtime

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
- jobs bindings do not expose admin projection storage such as durable
  worker-presence buckets; services discover queue/runtime settings only
- services discover concrete resources through bindings rather than through
  general cloud-management credentials
- higher-level runtimes typically call `Trellis.Bindings.Get` during connect or
  bootstrap, then expose the resolved bindings or typed resource handles
  directly to service code

### 15) Installation and activation rules

The `trellis` runtime service is the authority for the active contract set in a
deployment.

The `trellis` runtime service MUST:

- validate manifests against `trellis.contract.v1`
- compute canonical digests
- store installed contracts by digest
- maintain the active contract set for the deployment
- reject active subject collisions across operations, RPCs, and events
- provision or bind required cloud resources before service apply/install or
  upgrade succeeds
- persist resource bindings so installed services can resolve them at runtime
- bind each installed contract digest to the service principal public key that
  implements it, including Trellis-owned contracts bootstrapped onto the
  `trellis` service principal
- support deployment-owned device deployment records that resolve a device class
  to a contract lineage plus an allowed digest set
- support deployment-owned portal records, portal profiles, and login/device
  portal selection records for browser login and device-activation
  customization, with built-in Trellis portal paths as the fallback
- remove the old submission/approval flow rather than preserving a compatibility
  path
- ensure any stored user approval or consent decision references the exact
  contract digest being approved

Install or upgrade validation MUST also:

- reject impossible or unsafe resource combinations before provisioning begins
- validate the exact `resources` requested by the digest being installed, even
  when other digests in the same lineage remain active
- preserve physical resource identity across compatible digest changes for the
  same deployment/profile/lineage unless an operator intentionally creates a new
  lineage or profile
- when install or activation is deployment-driven, validate that the digest
  being bound is allowed by that deployment's contract lineage and allowed
  digest set
- portal records are deployment-owned routing config for browser UX only; they
  are not a contract kind and do not create portal-specific install or auth
  behavior
- portal profiles are deployment-owned auth policy layered on top of routed
  portal records; they imply approval for one browser app lineage without
  changing contract install semantics

Operationally, install or upgrade fails if any of these conditions is true:

- any operation, RPC, or event subject string is already owned by a different
  active contract `id`
- any required resource request cannot be provisioned or bound according to
  platform policy
- optional KV or store resources that cannot be provisioned are skipped and do
  not appear in installed bindings

Upgrade rule:

- when a service rolls from one digest to another for the same contract `id`,
  the `trellis` runtime service MAY keep both digests active during rollout
- each service principal still points to one exact installed digest at any
  moment
- deployments MAY later retire the old digest once no principals still depend on
  it

Subject collision rule:

- if two active contracts declare the same subject string, activation MUST fail
  unless they belong to the same contract `id` lineage
- overlapping operation/RPC/event subjects across different digests in the same
  lineage are allowed so rolling upgrades do not break mixed-version deployments

This keeps routing, discovery, and permission derivation unambiguous.

### 16) Authorization derivation

Authorization is derived from the active contract set.

For each active contract:

- operations contribute publish permissions for callers via `capabilities.call`
  on the declared operation subject, plus `capabilities.read` /
  `capabilities.cancel` on the derived control subject as applicable
- RPCs contribute publish permissions for callers via `capabilities.call`
- events contribute publish permissions via `capabilities.publish`
- events contribute subscribe permissions via `capabilities.subscribe`
- `uses` contributes the exact cross-contract operation/RPC/event permissions
  the owning service may exercise at runtime after dependency resolution
  validates the referenced active catalog surfaces
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
- higher-level runtimes typically call `Trellis.Bindings.Get` during connect or
  bootstrap and expose the resulting bindings or typed resource handles to
  service code

Rules:

- each capability list is an all-of requirement
- operation control subjects MUST be derived deterministically from the declared
  operation subject so auth and SDK generation remain contract-driven
- operation control publish grants use `capabilities.read` and
  `capabilities.cancel` as applicable; holding only `capabilities.call` does not
  grant broad control-subject access
- when an operation has no `read` capability grant and is not cancellable,
  callers receive no control-subject publish permission even if they may start
  the operation
- if a capability list is empty or omitted, that specific action does not
  require additional capability grants
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

For TypeScript, distinguish between local contract source files and generated
SDK packages.

Local TypeScript contract source files, whether a top-level `contract.ts` or
`contract.js` for single-contract projects or `contracts/*.ts` for
multi-contract projects, MUST:

- default export the defined contract module itself

Generated TypeScript SDK packages SHOULD export:

- the defined contract module itself (for example `auth`, `core`, or `activity`)
- `use` - the dependency selector for local `uses` declarations
- `API` - the derived `API.owned`, `API.used`, and `API.trellis` projections
- request/response/event TypeScript types
- `CONTRACT`
- `CONTRACT_ID`
- `CONTRACT_DIGEST`

For Rust, Python, and other languages, the same manifest is the input to
language-specific generators or native runtime helpers.

The minimum required property is consistent semantics across languages:

- the same logical operation names
- the same operation, RPC, and event subjects
- the same schemas
- the same declared capability requirements

If a contract declares `resources`, SDKs SHOULD expose the logical aliases and
typed binding payloads needed to resolve them from `Trellis.Bindings.Get`,
typically as part of connect or bootstrap rather than through ad hoc application
calls.

- the same known error declarations

### 18) Runtime plugin projection

A contract may be projected into a runtime API module used by Trellis
client/server libraries.

For v1 TypeScript runtimes, that projection is a defined contract module
consumed by public runtime bootstrap helpers such as
`TrellisClient.connect(...)`, `TrellisService.connect(...)`, and
`TrellisDevice.connect(...)`.

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
