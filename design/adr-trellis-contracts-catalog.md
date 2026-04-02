# ADR: Trellis Contracts and Catalog

## Status

Proposed

## Prerequisites

- [adr-trellis-patterns.md](./adr-trellis-patterns.md) - service patterns and platform boundaries
- [adr-trellis-auth.md](./adr-trellis-auth.md) - session keys, auth callout, and dynamic authorization

## Context

Trellis needs one contract model that works for five different concerns at the same time:

- service authors need a local way to define RPCs, events, raw pub/sub subjects, schemas, authorization requirements, and cloud resource requests
- the `trellis` runtime must derive runtime NATS permissions from the APIs that are actually active in a deployment
- clients and peer services need typed SDKs
- documentation and tooling need a language-neutral artifact
- operators need a reviewable description of which cloud resources a service expects Trellis to provide before install or upgrade

Those needs apply across multiple repos and multiple implementation languages.

## Goals

- Keep API ownership with the service that implements the API.
- Define one canonical contract artifact for runtime and tooling.
- Make the active deployment contract set discoverable at runtime.
- Make cloud-provided service resources explicit and reviewable at contract install or upgrade time.
- Support generated SDKs and docs from the same source of truth.
- Support RPC, domain events, and raw subject spaces.
- Support declarative resource requests with cloud-assigned physical bindings.
- Support Trellis-owned contracts and cloud/domain service contracts with the same mechanism.

## Non-goals

- Defining one required human authoring language for every service.
- Making AsyncAPI the canonical runtime model.
- Describing migration from earlier in-repo experiments.

## Decision

### 1) Canonical artifacts

Trellis defines two canonical JSON artifacts:

- `trellis.contract.v1` - one service contract manifest
- `trellis.catalog.v1` - the active set of contracts for a deployment

Both artifacts are pure JSON values. They are language-neutral and safe to persist, hash, validate, transmit, and use for code generation.

### 2) Contract lineage and implementation model

Every contract belongs to one stable contract lineage identified by `id`, and each
active digest is installed onto the service principal that implements it.

- Trellis-managed contracts such as `trellis.core@v1` and `trellis.auth@v1` are implemented by the `trellis` runtime service even when they are committed in the Trellis repo
- cloud/domain contracts live in the repo that implements the corresponding service behavior
- a single service principal may implement multiple logical contracts
- Trellis runtime libraries do not act as a handwritten central registry for all service APIs

### 3) Authoring model

The canonical source of truth for runtime and tooling is the authored contract definition.

For repository layout and tooling boundaries, Trellis treats generated
`trellis.contract.v1` JSON as a release and exchange artifact, not as a committed
source file. CI and release workflows should regenerate it from authored source
rather than review or ship it from git history.

- services may author contracts in their native language
- those authoring helpers are first-class workflow inputs, not hidden implementation details
- `trellis` verifies, packs, and uses generated manifests produced from those contract sources

The human-authored source may vary by language or team as long as it deterministically emits a valid manifest.

Examples:

- a TypeScript service may author a contract with `@qlever-llc/trellis-contracts`
- a Rust service may author a contract with Rust-side types/macros/build tooling
- a Python service may author a contract with Python-native tooling
- a service may author the manifest directly if desired, but that is not the default workflow

The architectural requirement is not a specific authoring language. The requirement is deterministic production of the canonical manifest.

### 4) JSON Schema dialect

All embedded schemas in a contract manifest MUST be JSON Schema compatible values using the same dialect Trellis validates at runtime.

For v1:

- dialect: JSON Schema Draft 2019-09
- schema fields MAY be either a JSON object schema or a boolean schema
- manifests MUST be self-contained; runtime processing MUST NOT require fetching remote `$ref` targets

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
  "uses": {},
  "rpc": {},
  "events": {},
  "subjects": {},
  "resources": {
    "kv": {
      "state": {
        "purpose": "Store service checkpoints",
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
| `displayName` | yes      | string | Human-facing contract name shown in tooling and approval UIs        |
| `description` | yes      | string | Human-facing explanation of the contract's purpose                  |
| `kind`        | yes      | string | Participant kind such as `service`, `app`, `cli`, or `browser`     |
| `uses`        | no       | object | Explicit cross-contract RPC/event/subject dependencies             |
| `rpc`         | no       | object | Map of logical RPC names to RPC operation descriptors              |
| `events`      | no       | object | Map of logical event names to event descriptors                    |
| `subjects`    | no       | object | Map of logical raw-subject names to subject descriptors            |
| `resources`   | no       | object | Map of declarative cloud resource requests                         |
| `errors`      | no       | object | Map of declared error types to error descriptors                   |

Rules:

- `format`, `id`, `displayName`, `description`, and `kind` are required.
- `displayName`, `description`, and `kind` are part of the canonical manifest and therefore part of the digest.
- runtime service identity, install routing, and authorization boundaries MUST NOT be inferred from manifest metadata.
- top-level object members not defined by the current runtime MAY be present for forward compatibility; runtimes MUST ignore unknown top-level fields they do not understand.

### 6) Contract identity

The contract `id` identifies one logical contract lineage.

Examples:

- `trellis.core@v1`
- `trellis.jobs@v1`
- `graph@v1`

Rules:

- `id` MUST be stable for semantically compatible revisions within the same major line
- a breaking contract revision MUST use a new `@vN` suffix
- within a deployment, at most one active digest may exist for a given `id`
- the `trellis` runtime service MUST reject activation of multiple different digests for the same active `id`

### Declared dependencies (`uses`)

Contracts MAY declare explicit dependencies on other contracts through a top-level `uses` object.

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

- dependencies are declared by logical contract `id` plus logical RPC/event/subject names, not by raw capability strings
- a service contract MUST NOT receive cross-contract runtime permissions unless that access is declared in `uses`
- install or upgrade MUST fail if a referenced contract is unavailable or if any referenced RPC, event, or subject name does not exist on that contract
- higher-level consent scopes for user-facing applications MAY be derived from `uses`, but runtime enforcement remains operation-level
- any user approval or consent record for a client contract MUST be bound to the exact contract digest, not merely to the contract `id`

### 7) RPC operation descriptor

Each `rpc` entry describes one logical request/reply operation.

Example:

```json
{
  "User.Find": {
    "version": "v1",
    "subject": "rpc.v1.User.Find",
    "inputSchema": { "type": "object" },
    "outputSchema": { "type": "object" },
    "capabilities": {
      "call": ["users.read"]
    },
    "errors": [{ "type": "ValidationError" }, { "type": "NotFoundError" }]
  }
}
```

Fields:

| Field               | Required | Meaning                                 |
| ------------------- | -------- | --------------------------------------- |
| `version`           | yes      | Version tag for the operation, `vN`     |
| `subject`           | yes      | Concrete NATS subject used for the RPC  |
| `inputSchema`       | yes      | JSON Schema for the request payload     |
| `outputSchema`      | yes      | JSON Schema for the success payload     |
| `capabilities.call` | no       | Capabilities required to invoke the RPC |
| `errors`            | no       | Declared serializable error types       |

Rules:

- the map key is the logical RPC name, for example `User.Find`
- `subject` SHOULD follow the convention `rpc.<version>.<LogicalName>`
- `capabilities.call` is an all-of requirement; the caller must hold every listed capability
- if `capabilities.call` is omitted, the RPC is callable without extra capability grants
- `errors` enumerates known typed error payloads but does not close the wire format to unknown future error types

### 8) Event descriptor

Each `events` entry describes one domain event published on a NATS subject.

Example:

```json
{
  "Partner.Changed": {
    "version": "v1",
    "subject": "events.v1.Partner.Changed.{/partner/id/origin}.{/partner/id/id}",
    "params": ["/partner/id/origin", "/partner/id/id"],
    "eventSchema": { "type": "object" },
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
| `eventSchema`            | yes      | JSON Schema for the event payload                      |
| `capabilities.publish`   | no       | Capabilities required to publish the event             |
| `capabilities.subscribe` | no       | Capabilities required to subscribe to the event        |

Rules:

- the map key is the logical event name, for example `Partner.Changed`
- `subject` SHOULD follow the convention `events.<version>.<LogicalName>[.<tokens...>]`
- template tokens use the form `{<json-pointer>}` and MUST reference values in the event payload
- if `params` is present, it MUST list the template pointers in subject order
- `capabilities.publish` and `capabilities.subscribe` are independent all-of requirements
- a wildcard authorization subject for an event is produced by replacing every template token with `*`

Example wildcard derivation:

- template: `events.v1.Partner.Changed.{/partner/id/origin}.{/partner/id/id}`
- wildcard: `events.v1.Partner.Changed.*.*`

### 9) Raw subject descriptor

Each `subjects` entry describes a raw NATS subject space that is part of the contract but is not modeled as a domain event.

Example:

```json
{
  "Jobs.Stream": {
    "subject": "trellis.jobs.>",
    "capabilities": {
      "publish": ["jobs.publish"],
      "subscribe": ["jobs.subscribe"]
    }
  }
}
```

Fields:

| Field                    | Required | Meaning                                          |
| ------------------------ | -------- | ------------------------------------------------ |
| `subject`                | yes      | Subject or subject pattern                       |
| `schema`                 | no       | JSON Schema for the payload if Trellis wants one |
| `capabilities.publish`   | no       | Capabilities required to publish                 |
| `capabilities.subscribe` | no       | Capabilities required to subscribe               |

Rules:

- raw subjects are used for transport surfaces such as Jobs streams, work queues, advisories, or other Trellis-native subject spaces
- unlike events, a raw subject descriptor may legitimately contain NATS wildcards such as `*` or `>`
- if a payload schema matters for clients or tooling, it SHOULD be declared in `schema`

### 10) Cloud resource requests

The optional top-level `resources` map declares cloud-provided resources that the service expects Trellis to provision or bind during install or upgrade.

Example:

```json
{
  "resources": {
    "kv": {
      "activity": {
        "purpose": "Store normalized activity entries",
        "required": true,
        "history": 1,
        "ttlMs": 0,
        "maxValueBytes": 262144
      }
    },
    "streams": {
      "jobs": {
        "purpose": "Append-only job lifecycle stream",
        "required": true,
        "subjects": ["trellis.jobs.>"],
        "retention": "limits",
        "storage": "file",
        "numReplicas": 3,
        "discard": "old",
        "maxMsgs": -1,
        "maxBytes": -1,
        "maxAgeMs": 0
      },
      "jobs_work": {
        "purpose": "Work queue derived from created and retried jobs",
        "required": true,
        "subjects": ["trellis.work.>"],
        "retention": "workqueue",
        "storage": "file",
        "numReplicas": 3,
        "sources": [
          {
            "fromAlias": "jobs",
            "filterSubject": "trellis.jobs.*.*.*.created",
            "subjectTransformDest": "trellis.work.$1.$2"
          }
        ]
      }
    }
  }
}
```

Rules:

- resource keys such as `activity` are logical aliases chosen by the service author
- aliases are part of the contract and are stable API surface for the service
- the contract requests logical resources; Trellis assigns physical names and backing infrastructure at install or upgrade time
- the v1 resource surface supports `resources.kv` and `resources.streams`
- a KV request declares:
  - `purpose`: required human-facing explanation of why the service needs the resource
  - `required`: whether activation depends on successful provisioning; default `true`
  - `history`: desired KV history depth; default `1`
  - `ttlMs`: desired bucket TTL in milliseconds; default `0`
  - `maxValueBytes`: optional desired per-value maximum in bytes
- a stream request declares:
  - `purpose`: required human-facing explanation of why the service needs the resource
  - `required`: whether activation depends on successful provisioning; default `true`
  - `subjects`: one or more subjects bound to the stream
  - `retention`: one of `limits`, `interest`, or `workqueue`
  - `storage`: `file` or `memory`; default `file`
  - `numReplicas`: desired replica count; default `1`
  - `discard`: `old` or `new`; default `old`
  - `maxMsgs`: message limit; default `-1`
  - `maxBytes`: byte limit; default `-1`
  - `maxAgeMs`: age limit in milliseconds; default `0`
  - `sources`: optional list of source-stream descriptors
- a source-stream descriptor declares:
  - `fromAlias`: another stream alias in the same contract
  - `filterSubject`: optional source filter subject
  - `subjectTransformDest`: optional transformed destination subject
- stream aliases are logical names, just like KV aliases; contracts do not hard-code physical stream names
- dynamic consumers are not part of the contract resource model in v1 and remain runtime-created
- install or upgrade approves the requested alias/type/spec, not general infrastructure-management credentials for the service

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

- the map key SHOULD match `type`
- operation-level `errors` entries reference error types by `type`
- the wire error envelope is open; runtimes MUST preserve unknown error payloads
- declared error schemas enable SDK generation and typed client helpers but do not prevent forward-compatible unknown error handling

### 12) Canonicalization and digest

Contracts are content-addressed by canonical JSON digest.

Canonicalization rules for v1:

- the manifest must be a pure JSON value
- numbers must be finite and must not use negative zero
- object keys are sorted lexicographically during canonicalization
- arrays preserve source order
- the canonical JSON string contains no insignificant whitespace

Digest rules for v1:

- algorithm: SHA-256 over the canonical JSON string
- encoding: base64url without padding

The digest is the deployment/runtime identity of one concrete contract artifact.

Consequences:

- different formatting does not change the digest
- semantically different manifests produce different digests
- catalogs and registration workflows refer to contracts by digest

### 13) Catalog format

A deployment exposes its active contract set as `trellis.catalog.v1`.

Shape:

```json
{
  "format": "trellis.catalog.v1",
  "contracts": [
    {
      "id": "graph@v1",
      "digest": "<base64url-sha256>"
    }
  ]
}
```

Catalog rules:

- the catalog contains only active contracts for the current deployment
- entries are keyed by digest and include `id`
- a catalog MUST NOT contain duplicate active `id` values
- catalog ordering is not semantically significant, but implementations SHOULD return a stable order for diffability and testing

Repository-layout clarification:

- `in-tree` versus `out-of-tree` is not an architectural distinction for service contracts
- Trellis-managed contracts such as `trellis.core@v1` and `trellis.auth@v1` are ordinary service contracts implemented by the `trellis` runtime service
- colocated service contracts MUST be treated the same way as service contracts committed in another repo
- a repo MAY carry additional manifests for local development, but they are not implicitly part of the active catalog just because they live nearby

### 14) Trellis discovery RPCs

The `trellis.core@v1` contract implemented by the `trellis` runtime service MUST include runtime discovery RPCs.

Required v1 operations:

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

Service install and upgrade are intentionally not part of the runtime discovery RPC set.

- initial service installation is a `trellis.auth@v1` admin operation exposed by the `trellis` runtime service that takes a service public key and a candidate contract
- service contract upgrade is a `trellis.auth@v1` admin operation exposed by the `trellis` runtime service that takes an existing service public key and a replacement contract
- UI and CLI implementations MAY present a human review screen before calling those admin RPCs
- services do not self-register contracts at runtime

#### `Trellis.Bindings.Get`

- returns the installed resource bindings visible to the caller service
- capability: `service`
- supports optional filtering by `contractId` or `digest`
- returns logical aliases with cloud-assigned physical binding details
- does not expose operator or platform management credentials

Binding rules:

- bindings remain keyed by contract alias so application code stays stable across environments
- KV bindings expose concrete bucket information plus the granted usage limits needed by the service runtime
- stream bindings expose the resolved physical stream `name` plus the installed stream config needed for operations such as consumer creation and inspection
- stream source bindings include both the logical `fromAlias` and the resolved upstream `streamName`
- services discover concrete resources through bindings rather than through general cloud-management credentials

### 15) Installation and activation rules

The `trellis` runtime service is the authority for the active contract set in a deployment.

The `trellis` runtime service MUST:

- validate manifests against `trellis.contract.v1`
- compute canonical digests
- store installed contracts by digest
- maintain the active contract set for the deployment
- reject active subject collisions across RPCs, events, and raw subjects
- reject duplicate active contract ids with different digests
- provision or bind required cloud resources before install or upgrade succeeds
- persist resource bindings so installed services can resolve them at runtime
- bind each installed contract digest to the service principal public key that implements it, including Trellis-owned contracts bootstrapped onto the `trellis` service principal
- remove the old submission/approval flow rather than preserving a compatibility path
- ensure any stored user approval or consent decision references the exact contract digest being approved

Install or upgrade validation MUST also:

- validate intra-contract resource references such as `streams.*.sources[*].fromAlias`
- reject impossible or unsafe resource combinations before provisioning begins
- provision stream resources idempotently when requested

Operationally, install or upgrade fails if any of these conditions is true:

- any RPC, event, or raw-subject string is already owned by a different active digest
- any required resource request cannot be provisioned or bound according to platform policy

Upgrade rule:

- when a service upgrades from one digest to another for the same contract `id`, the `trellis` runtime service MUST switch the active digest atomically so the deployment still has at most one active digest for that `id`

Subject collision rule:

- if two active contracts declare the same subject string, activation MUST fail unless they are the exact same contract digest

This keeps routing, discovery, and permission derivation unambiguous.

### 16) Authorization derivation

Authorization is derived from the active contract set.

For each active contract:

- RPCs contribute publish permissions for callers via `capabilities.call`
- events contribute publish permissions via `capabilities.publish`
- events contribute subscribe permissions via `capabilities.subscribe`
- raw subjects contribute publish permissions via `capabilities.publish`
- raw subjects contribute subscribe permissions via `capabilities.subscribe`
- `uses` contributes the exact cross-contract RPC/event/subject permissions the owning service may exercise at runtime

For each installed resource binding:

- Trellis MAY derive additional runtime permissions needed to use the bound resource
- those permissions are scoped to the installed physical resource binding, not to general management APIs for the whole cloud
- callers discover the concrete binding via `Trellis.Bindings.Get`

Rules:

- each capability list is an all-of requirement
- if a capability list is empty or omitted, that specific action does not require additional capability grants
- templated event subjects are authorized using wildcard subjects derived by replacing each template token with `*`
- raw subject entries are authorized using their declared subject or subject pattern directly
- service sessions receive cross-contract permissions only from explicit `uses` plus installed resource bindings; raw capability grants alone are not sufficient

Service-side RPC handling rule:

- a service may subscribe to RPC subjects for contracts installed on its authenticated service principal public key
- runtime ownership is determined by the install record for that public key, not by contract metadata
- the bootstrapped `trellis` runtime service follows the same rule; it simply starts with Trellis-owned contracts such as `trellis.core@v1` and `trellis.auth@v1`

This install-record-based subscription rule is separate from caller capability checks.

### 17) SDK derivation

SDKs derive from the canonical manifest, not from deployment-specific runtime state.

For TypeScript, a normal contract package SHOULD export:

- the defined contract module itself (for example `auth`, `core`, or `activity`)
- `use` - the dependency selector for `defineContract(...).uses`
- `API` - the derived `API.owned`, `API.used`, and `API.trellis` projections
- request/response/event TypeScript types
- `CONTRACT`
- `CONTRACT_ID`
- `CONTRACT_DIGEST`

For Rust, Python, and other languages, the same manifest is the input to language-specific generators or native runtime helpers.

The minimum required property is consistent semantics across languages:

- the same logical operation names
- the same subjects
- the same schemas
- the same declared capability requirements

If a contract declares `resources`, SDKs SHOULD expose the logical aliases and typed binding payloads needed to resolve them from `Trellis.Bindings.Get`.

- the same known error declarations

### 18) Runtime plugin projection

A contract may be projected into a runtime API module used by Trellis client/server libraries.

For v1 TypeScript runtimes, that projection is a defined contract module consumed by `contract.createClient(...)`, `createClient(contract, ...)`, and `contract.connectService(...)`.

Projection requirements:

- preserve logical RPC/event names
- preserve schemas needed for runtime validation
- preserve enough metadata for typed request, response, publish, and subscribe helpers
- fail fast on duplicate merged RPC/event keys

### 19) AsyncAPI export

AsyncAPI is a derived documentation format.

Trellis tooling SHOULD support exporting a contract or catalog to AsyncAPI-compatible documentation artifacts.

AsyncAPI is not the canonical runtime model because Trellis requires native representation of:

- RPC operations
- capability requirements
- raw subject spaces
- activation and catalog semantics

## Consequences

### Benefits

- API ownership stays with the implementing service.
- The `trellis` runtime service can implement multiple logical contracts without requiring extra manifest ownership metadata.
- The `trellis` runtime service derives auth and discovery behavior from the actual deployment contract set.
- TypeScript, Rust, Python, and other languages can derive SDKs from the same artifact.
- Jobs and other raw-subject features fit naturally into the same model.
- Documentation can be derived without distorting the runtime architecture.
- Trellis core no longer needs a handwritten global API registry for service APIs.

### Trade-offs

- Trellis must maintain a real contract schema, canonicalization, validation, and generation toolchain.
- Authoring source and canonical runtime artifact are distinct concepts.
- Deployment workflows need contract registration and activation.
- Trellis must validate explicit `uses` dependencies and bootstrap its own contracts without relying on contract metadata as an authorization boundary.
- Multi-language support requires generators and release pipelines.

## Notes

- This ADR defines the architecture and the v1 contract/catalog specification.
- Language-specific authoring helpers are implementation details around the canonical manifest.
- A separate ADR may define service-specific authoring ergonomics for a particular language if needed, but this ADR is the normative contract boundary.
