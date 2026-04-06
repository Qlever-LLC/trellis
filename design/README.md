---
title: Trellis Design Index
description: How the Trellis design docs are organized and which documents to read for a given task.
---

# Trellis Design Index

Use this index to find the smallest set of design docs needed for a task.

Do not load the entire `design/` folder by default. Start with one topic area, then follow only the linked prerequisites that matter for the task at hand.

## Core Platform Docs

| Document | Read When | Why |
| --- | --- | --- |
| `core/trellis-patterns.md` | You need Trellis-wide architecture rules | Service categories, platform boundaries, communication patterns |
| `auth/trellis-auth.md` | You are changing auth architecture | Identity model, approval model, service install model, auth subsystem boundaries |
| `auth/device-activation.md` | You are changing device registration or device activation | Request/review flow, confirmation code, profiles, online activation |
| `contracts/trellis-contracts-catalog.md` | You are changing manifests, codegen inputs, or permission derivation | Canonical contract format, `uses`, subject ownership, activation rules |

## Subsystem Design Docs

| Document | Read When | Why |
| --- | --- | --- |
| `operations/trellis-operations.md` | You are designing caller-visible async workflows | Operations model, auth model, internal control protocol, watch semantics |
| `jobs/trellis-jobs.md` | You are designing service-private background execution | Jobs model, stream/KV projection, retries, worker lifecycle, admin model |
| `contracts/trellis-typescript-contract-authoring.md` | You are changing TypeScript contract architecture | TS contract-driven model, `defineContract(...)`, `uses`, derived API views |
| `contracts/trellis-rust-contract-libraries.md` | You are changing Rust contract architecture | Rust participant facades, alias model, generation rules |
| `tooling/trellis-cli.md` | You are changing Trellis CLI behavior or contract tooling workflows | CLI command architecture, install and upgrade flows, contract generation |

## Cross-Cutting Pattern Docs

| Document | Read When | Why |
| --- | --- | --- |
| `core/platform-libraries.md` | You are changing library/package boundaries | Package ownership and runtime responsibilities |
| `core/storage-patterns.md` | You are changing KV keys, TTLs, or projections | Storage naming and projection rules |
| `core/type-system-patterns.md` | You are changing schemas, Result, or error modeling | Shared type-system and validation rules |
| `core/service-development.md` | You are implementing service code or service runtime ergonomics | Service layout, lifecycle, jobs vs operations |
| `core/observability-patterns.md` | You are changing tracing, correlation, health, or docs guidance | Observability and request-correlation rules |
| `core/frontend-svelte-patterns.md` | You are changing Svelte frontend conventions | Trellis frontend state patterns |
| `core/capability-patterns.md` | You are changing capability naming or deployment-role guidance | Capability taxonomy and assignment guidance |

## Protocol, API, And Runtime Surface Docs

These documents define the public protocol, API, and runtime-facing surfaces. Read them when you are implementing or reviewing library/runtime/codegen ergonomics.

| Document | Surface | Read When |
| --- | --- | --- |
| `contracts/contracts-typescript-api.md` | TypeScript contract/runtime surface | Implementing or reviewing TS contract authoring or TS contract-driven runtime ergonomics |
| `contracts/contracts-rust-api.md` | Rust contract/runtime surface | Implementing or reviewing Rust contract/runtime ergonomics |
| `auth/auth-protocol.md` | Auth protocol surface | Implementing auth callout, proofs, reply validation, or auth state model |
| `auth/auth-api.md` | Auth public API | Implementing `/auth/*`, `operations.v1.Auth.*`, `rpc.v1.Auth.*`, or auth events |
| `auth/auth-typescript-api.md` | TypeScript auth API | Implementing or reviewing TS browser/service auth helpers |
| `auth/auth-rust-api.md` | Rust auth API | Implementing or reviewing Rust CLI/service auth helpers |
| `auth/auth-operations.md` | Auth operations/runbook | Operating auth in production, rotation, rate limits, HA |
| `operations/operations-typescript-api.md` | TypeScript operations API | Implementing or reviewing TS operation clients/services |
| `operations/operations-rust-api.md` | Rust operations API | Implementing or reviewing Rust operation clients/services |
| `jobs/jobs-typescript-api.md` | TypeScript jobs API | Implementing or reviewing TS jobs service/admin APIs |
| `jobs/jobs-rust-api.md` | Rust jobs API | Implementing or reviewing Rust jobs service/admin APIs |

## Suggested Read Paths

### Implement Trellis operations in TypeScript

1. `operations/trellis-operations.md`
2. `operations/operations-typescript-api.md`
3. `auth/trellis-auth.md`
4. `contracts/trellis-contracts-catalog.md`

### Implement Trellis operations in Rust

1. `operations/trellis-operations.md`
2. `operations/operations-rust-api.md`
3. `auth/trellis-auth.md`
4. `contracts/trellis-contracts-catalog.md`

### Implement Trellis jobs in TypeScript

1. `jobs/trellis-jobs.md`
2. `jobs/jobs-typescript-api.md`
3. `core/service-development.md`
4. `operations/trellis-operations.md` only if the jobs attach to public operations
5. `contracts/trellis-contracts-catalog.md` when changing job-owned resources, bindings, or provisioning surfaces

### Implement Trellis jobs in Rust

1. `jobs/trellis-jobs.md`
2. `jobs/jobs-rust-api.md`
3. `core/service-development.md`
4. `operations/trellis-operations.md` only if the jobs attach to public operations
5. `contracts/trellis-contracts-catalog.md` when changing job-owned resources, bindings, or provisioning surfaces

### Work on type systems or errors

1. `core/type-system-patterns.md`
2. relevant subsystem design doc
3. relevant language surface doc

### Work on storage, KV, or projections

1. `core/storage-patterns.md`
2. relevant subsystem design doc

### Work on service layout or runtime ergonomics

1. `core/service-development.md`
2. relevant subsystem design doc
3. relevant language surface doc

### Work on tracing, docs, or request correlation

1. `core/observability-patterns.md`
2. relevant subsystem design doc

### Work on capability naming or deployment policy

1. `core/capability-patterns.md`
2. `auth/trellis-auth.md`
3. `contracts/trellis-contracts-catalog.md`

### Change manifests, codegen, or discovery

1. `contracts/trellis-contracts-catalog.md`
2. `contracts/trellis-typescript-contract-authoring.md` or `contracts/trellis-rust-contract-libraries.md`
3. `contracts/contracts-typescript-api.md` or `contracts/contracts-rust-api.md`
4. relevant subsystem design doc and language surface doc

### Implement TypeScript contract/runtime surfaces

1. `contracts/trellis-typescript-contract-authoring.md`
2. `contracts/contracts-typescript-api.md`
3. `contracts/trellis-contracts-catalog.md`

### Implement Rust contract/runtime surfaces

1. `contracts/trellis-rust-contract-libraries.md`
2. `contracts/contracts-rust-api.md`
3. `contracts/trellis-contracts-catalog.md`

### Change auth or operation watch behavior

1. `auth/trellis-auth.md`
2. `auth/auth-protocol.md`
3. `operations/trellis-operations.md`
4. relevant language surface doc if the public API changes

### Implement auth protocol or auth callout

1. `auth/trellis-auth.md`
2. `auth/auth-protocol.md`
3. `contracts/trellis-contracts-catalog.md`

### Implement auth HTTP or RPC APIs

1. `auth/trellis-auth.md`
2. `auth/auth-api.md`
3. `auth/auth-protocol.md`
4. `auth/device-activation.md` if device activation is involved

### Implement TypeScript auth surfaces

1. `auth/trellis-auth.md`
2. `auth/auth-typescript-api.md`
3. `auth/auth-api.md`
4. `auth/auth-protocol.md`

### Implement Rust auth surfaces

1. `auth/trellis-auth.md`
2. `auth/auth-rust-api.md`
3. `auth/auth-api.md`
4. `auth/auth-protocol.md`

### Operate Trellis auth in production

1. `auth/trellis-auth.md`
2. `auth/auth-operations.md`
3. `auth/auth-protocol.md`

## Notes For AI And Reviewers

- load subsystem design docs for architecture
- load language surface docs for public API details
- load auth/contracts docs only when the task crosses those boundaries
- prefer task-specific reading paths over broad context dumps
