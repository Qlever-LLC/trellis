---
title: KV Resource Patterns
description: Trellis KV bucket naming, key-shape, TTL, and projection patterns.
order: 40
---

# Design: KV Resource Patterns

## Prerequisites

- [trellis-patterns.md](./trellis-patterns.md) - Trellis architecture and communication model

## Scope

This document defines Trellis KV resource patterns, especially for NATS KV bucket naming, key shape, TTL, and stream-derived projections.

## NATS KV

### Bucket Naming

Use `trellis_<domain>` with lowercase underscores.

Examples:

- `trellis_sessions`
- `trellis_jobs`
- `trellis_users`

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

| Query need | Key pattern | Lookup |
| --- | --- | --- |
| By ID only | `<id>` | direct get |
| By owner + ID | `<owner>.<id>` | `keys("<owner>.*")` |
| By category + owner + ID | `<cat>.<owner>.<id>` | `keys("<cat>.<owner>.*")` |
| By ID with qualifiers | `<cat>.<owner>.<id>` | `keys("*.*.<id>")` |

### TTL Tiers

| Tier | TTL | Use case |
| --- | --- | --- |
| Ephemeral | 5 min | OAuth state, pending auth, browser flows |
| Session | 24h | Sessions, active connections |
| Permanent | None | Users, services, reference data |

Set `max_age` at bucket creation and rewrite the full value on update when the TTL must refresh.

### Projections

| Pattern | Use when |
| --- | --- |
| Direct write | Simple CRUD, no audit trail needed |
| Stream projection | Need event history, replay, or cross-service visibility |

Projection rule:

- the stream is the source of truth
- KV is the read-optimized derived view

Consume the stream with a durable consumer and write the reduced state to KV.
