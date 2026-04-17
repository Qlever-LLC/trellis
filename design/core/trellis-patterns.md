---
title: Trellis Patterns
description: High-level Trellis architecture, platform boundaries, service categories, and communication patterns.
order: 10
---

# Design: Trellis Patterns

## Prerequisites

None.

## Context

Trellis is a distributed system for aggregating, processing, and distributing organizational data. Services communicate exclusively over NATS.

This document establishes the top-level cross-cutting system patterns for:

- service boundaries
- communication patterns
- platform boundaries
- the relationship between subsystem-specific pattern docs

Detailed coding, storage, type-system, observability, frontend, and capability guidance is split into companion documents.

## Architecture

### Service Categories

| Category | Purpose | Examples |
| --- | --- | --- |
| Infrastructure | Platform capabilities for all services | Auth, Jobs |
| Ingest | Pull external data, emit domain events | Zendesk, FoodLogiQ |
| Repository | Persist and query domain data | Graph, Search |
| Processing | Transform, enrich, derive knowledge | Classification |
| Egress | Push data to external systems | Laserfiche |

Categories describe primary responsibility. Any service may still subscribe to events for cache invalidation or local state.

### Platform Boundary

Trellis platform code and cloud/domain code are intentionally separate.

Rules:

- the Trellis platform repo owns protocol/runtime libraries, the `trellis` runtime service, jobs, Trellis-owned contracts, and contract tooling
- cloud repos own domain services, domain contracts, apps, and domain models unless a model is required by a Trellis-owned contract or shared Trellis runtime library
- `@qlever-llc/trellis` is a runtime library, not a central registry for every service API
- service APIs are defined with the service that owns them and consumed through contract packages

#### Category Responsibilities

| Category | Mounts RPCs | Publishes Events | Subscribes Events | Owns Storage |
| --- | --- | --- | --- | --- |
| Infrastructure | Yes | Maybe | Maybe | KV and platform infra |
| Ingest | No | Yes | Maybe | Sync state |
| Repository | Yes | Maybe | Yes | Yes |
| Processing | Maybe | Yes | Yes | No |
| Egress | No | No | Yes | Sync state |

### Communication Patterns

#### Events

Events announce state changes. Publishers fire and forget.

Subject naming:

```text
events.v1.<Domain>.<...tokens>
```

Examples:

```text
events.v1.Partner.Changed.<origin>.<id>
events.v1.Identity.Changed.<origin>.<id>
events.v1.Document.Uploaded.<contentType>.<partnerId>
```

Rules:

- add subject tokens only when consumers need selective subscription and the cardinality is bounded and stable
- token order matters; put the most-filtered tokens first
- event handlers must be idempotent because delivery is at-least-once

#### RPCs

RPCs query data or perform bounded synchronous operations. Caller-visible long-running workflows use operations.

Subject naming is domain-based rather than service-based:

```text
rpc.v1.User.Find
rpc.v1.Partner.List
rpc.v1.Documents.Search
```

Rules:

- callers use method names, not raw subjects, in normal code
- the API schema maps methods to transport subjects
- implementation details may change without changing caller-visible method names

#### Operations

Operations are caller-visible asynchronous workflows with durable state, explicit progress, and watchable completion.

Subject naming:

```text
operations.v1.<Domain>.<...tokens>
```

Rules:

- use operations when the caller must observe progress or wait across reconnects
- use RPCs for bounded synchronous work and jobs for service-private execution machinery
- operation control and watch semantics are defined in [../operations/trellis-operations.md](./../operations/trellis-operations.md)

#### Raw subjects

Some subsystem-owned subject spaces are not `events.v1.*`, `rpc.v1.*`, or `operations.v1.*`. They exist for infrastructure coordination, stream projections, and service-private transport contracts.

Rules:

- raw subjects must still be contract-owned when they are part of a public or cross-service boundary
- Trellis-owned runtime protocols may still use raw subjects behind a contract-owned public API; file transfer chunk subjects are an example of this pattern
- subsystem docs should define the semantics and naming rules for any raw subject space they introduce
- examples include jobs stream subjects and other platform-owned control surfaces described in companion docs

## Companion Documents

This document defines the high-level system style. Detailed companion docs are split by concern:

- [platform-libraries.md](./platform-libraries.md) - package responsibilities and core runtime/library guidance
- [files-transfer-patterns.md](./files-transfer-patterns.md) - public files API and operation-native transfer patterns over NATS
- [kv-resource-patterns.md](./kv-resource-patterns.md) - KV naming, keys, TTLs, and projections
- [store-resource-patterns.md](./store-resource-patterns.md) - service-owned blob store resource patterns and runtime semantics
- [type-system-patterns.md](./type-system-patterns.md) - schemas, validation, `Result`, and errors
- [service-development.md](./service-development.md) - service layout, lifecycle, and jobs vs operations usage
- [observability-patterns.md](./observability-patterns.md) - health, stats, docs, tracing, and request correlation
- [frontend-svelte-patterns.md](./frontend-svelte-patterns.md) - Svelte frontend guidance
- [capability-patterns.md](./capability-patterns.md) - capability naming and deployment policy patterns
