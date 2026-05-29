---
title: KV Resource Patterns
description: Trellis KV bucket naming, key-shape, TTL, and projection patterns.
order: 40
---

# Design: KV Resource Patterns

## Prerequisites

- [trellis-patterns.md](./trellis-patterns.md) - Trellis architecture and
  communication model

## Scope

This document defines the Trellis KV resource pattern for service-requested NATS
KV stores: contract declaration, bucket naming, key shape, TTL, and
stream-derived projections.

## NATS KV

### Contract Declaration

Service-owned KV resources are schema-backed requested needs under
`resources.kv`. Accepted KV requests become deployment authority desired state.
Reconciliation is the only path that creates, updates, removes, or adopts
materialized KV buckets and bindings.

Example:

```ts
resources: {
  kv: {
    activity: {
      purpose: "Store normalized activity entries",
      schema: ref.schema("AuditEntry"),
      required: true,
      history: 1,
      ttlMs: 0,
    },
  },
}
```

Rules:

- each `resources.kv.<alias>` entry must declare `schema: ref.schema("...")`
- the referenced schema must exist in the contract's top-level `schemas` map
- `required` defaults to `true`; it controls whether generated service code sees
  the alias as required or optional
- all accepted KV resources must be materialized; Trellis does not silently omit
  `required: false` KV resources when reconciliation is unavailable or fails
- Trellis validates KV declarations from the presented contract proposal against
  deployment authority, but physical bucket identity is scoped to the
  deployment/profile and contract lineage rather than the digest so compatible
  service updates preserve data
- service bootstrap resolves `service.kv.<alias>` and injected handler
  `client.kv.<alias>` as direct typed KV stores; service code does not call
  `.open(schema)`

### Authority Update And Migration Classification

Safe KV authority updates include:

- adding a new KV alias
- increasing `history` or `maxValueBytes`
- changing `purpose` without changing runtime behavior
- changing `required` when it does not remove already materialized access

Dangerous KV authority migrations include:

- removing or renaming a KV alias
- reducing `history`, `ttlMs`, or `maxValueBytes`
- changing the schema in a way that may reject existing values or change their
  meaning
- adopting an existing bucket with incompatible ownership, retention, or schema
  expectations

### Bucket Naming

Use service-scoped names with lowercase underscores. Contract-requested service
KV buckets use `svc_<service>_<alias>` (or an equivalent Trellis-assigned
physical name with that scope) rather than shared `trellis_*` names. Bucket
names should describe the service-owned resource purpose rather than an
implementation table or domain model that belongs behind a service boundary.

Examples:

- `svc_activity_activity`
- `svc_billing_job_cache`
- `svc_documents_upload_index`

### Key Structure

Use `.` delimiters for wildcard support:

```text
<domain>.<qualifiers...>.<identifier>
```

Rules:

- key segments must be NATS subject-safe
- use base64url without padding for binary-derived segments
- use ULIDs for identifiers unless there is a better reason not to

Examples:

- `github.12345.abc123`
- `graph.transcription.01ARZ3NDEK`

Design keys for expected query patterns:

| Query need               | Key pattern          | Lookup                    |
| ------------------------ | -------------------- | ------------------------- |
| By ID only               | `<id>`               | direct get                |
| By owner + ID            | `<owner>.<id>`       | `keys("<owner>.*")`       |
| By category + owner + ID | `<cat>.<owner>.<id>` | `keys("<cat>.<owner>.*")` |
| By ID with qualifiers    | `<cat>.<owner>.<id>` | `keys("*.*.<id>")`        |

### TTL Tiers

| Tier      | TTL     | Use case                                                      |
| --------- | ------- | ------------------------------------------------------------- |
| Ephemeral | minutes | OAuth state, pending auth, browser flows, short-lived indexes |
| Presence  | hours   | Active connection or worker presence records                  |
| Permanent | None    | Reference data or derived views that are refreshed explicitly |

Set `max_age` at bucket creation and rewrite the full value on update when the
TTL must refresh.

### Projections

| Pattern           | Use when                                                |
| ----------------- | ------------------------------------------------------- |
| Direct write      | Simple CRUD, no audit trail needed                      |
| Stream projection | Need event history, replay, or cross-service visibility |

Projection rule:

- the stream is the source of truth
- KV is the read-optimized derived view

Consume the stream with a durable consumer and write the reduced state to KV.
