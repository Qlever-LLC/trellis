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

## Design

Trellis keeps a small set of platform-wide patterns so services can stay isolated by ownership while still sharing a consistent communication model. The core boundary is simple: platform code lives in the Trellis repo, cloud/domain code lives with the owning service, and all cross-service communication happens over NATS through contracts.

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

### Communication patterns

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

## Companion Documents

This document defines the high-level system style. Detailed companion docs are split by concern:

- [platform-libraries.md](./platform-libraries.md) - package responsibilities and core runtime/library guidance
- [storage-patterns.md](./storage-patterns.md) - KV naming, keys, TTLs, and projections
- [type-system-patterns.md](./type-system-patterns.md) - schemas, validation, `Result`, and errors
- [service-development.md](./service-development.md) - service layout, lifecycle, and jobs vs operations usage
- [observability-patterns.md](./observability-patterns.md) - health, stats, docs, tracing, and request correlation
- [frontend-svelte-patterns.md](./frontend-svelte-patterns.md) - Svelte frontend guidance
- [capability-patterns.md](./capability-patterns.md) - capability naming and deployment policy patterns

## Benefits

- Trellis keeps architecture guidance separate from language and implementation details
- service boundaries stay explicit across platform and domain code
- communication patterns remain consistent across subsystems
- readers can load only the guidance relevant to the task at hand

## Operational tradeoffs

- guidance is spread across more documents
- maintainers must keep companion docs aligned with subsystem design docs and language-surface docs
