---
title: Trellis Design Index
description: How the Trellis design docs are organized and which documents to read for a given task.
---

# Trellis Design Index

Use this index to find the smallest set of design docs needed for a task.

Do not load the entire `design/` folder by default. Start with one topic area,
then follow only the linked prerequisites that matter for the task at hand.

## Documentation Scope

The `design/` tree records Trellis architecture, protocol semantics, durable
invariants, lifecycle rules, and public Trellis-owned wire compatibility. It is
not the primary API reference for TypeScript or Rust packages.

- task-oriented usage docs live in the `guides/` site
- TypeScript API reference should be generated from JSDoc on public entrypoints
- Rust API reference should be generated from Rustdoc and linked from the docs
  site
- exact language helper signatures should stay in code docs unless they are part
  of a protocol or wire-compatibility contract
- design docs may summarize language-facing direction, but should avoid copying
  full API reference material from code

## Quick Participant Examples

These headings are intentionally named for fast human and AI lookup.

- Minimal installable service example:
  `core/service-development.md#minimal-installable-service-example`
- Minimal activated device example:
  `auth/device-activation.md#minimal-activated-device-example`
- When choosing between them, read
  `core/service-development.md#participant-kind-and-runtime-helper` first

## Core Platform Docs

| Document                                 | Read When                                                            | Why                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `core/trellis-patterns.md`               | You need Trellis-wide architecture rules                             | Service categories, platform boundaries, communication patterns                     |
| `auth/trellis-auth.md`                   | You are changing auth architecture                                   | Identity model, approval model, service deployment model, auth subsystem boundaries |
| `auth/device-activation.md`              | You are changing device preregistration or device activation         | Known-device activation flow, connect info, profiles, online activation             |
| `contracts/trellis-contracts-catalog.md` | You are changing manifests, codegen inputs, or permission derivation | Canonical contract format, `uses`, subject ownership, activation rules              |

## Subsystem Design Docs

| Document                                             | Read When                                                           | Why                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `operations/trellis-operations.md`                   | You are designing caller-visible async workflows                    | Operations model, auth model, internal control protocol, watch semantics          |
| `jobs/trellis-jobs.md`                               | You are designing service-private background execution              | Jobs model, stream/KV projection, retries, worker lifecycle, admin model          |
| `contracts/trellis-typescript-contract-authoring.md` | You are changing TypeScript contract architecture                   | TS contract-driven model, specialized contract helpers, `uses`, derived API views |
| `contracts/trellis-rust-contract-libraries.md`       | You are changing Rust contract architecture                         | Rust participant facades, alias model, generation rules                           |
| `tooling/trellis-cli.md`                             | You are changing Trellis CLI behavior or contract tooling workflows | CLI command architecture, install and upgrade flows, contract generation          |

## Cross-Cutting Pattern Docs

| Document                           | Read When                                                          | Why                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `core/platform-libraries.md`       | You are changing library/package boundaries                        | Package ownership and runtime responsibilities                                                |
| `core/files-transfer-patterns.md`  | You are changing the public files API or operation-native transfer | Contract-owned file metadata APIs, transfer-capable operations, and runtime helper boundaries |
| `core/state-patterns.md`           | You are changing the public shared state API                       | Named store declarations, runtime state semantics, admin inspection, and TTL behavior         |
| `core/kv-resource-patterns.md`     | You are changing KV buckets, keys, TTLs, or projections            | KV naming, TTL, and projection rules                                                          |
| `core/store-resource-patterns.md`  | You are changing service-owned blob store resources                | Store resource shape, runtime semantics, and auth boundaries                                  |
| `core/type-system-patterns.md`     | You are changing schemas, Result, or error modeling                | Shared type-system and validation rules                                                       |
| `core/service-development.md`      | You are implementing service code or service runtime ergonomics    | Service layout, lifecycle, jobs vs operations                                                 |
| `core/observability-patterns.md`   | You are changing tracing, correlation, health, or docs guidance    | Observability and request-correlation rules                                                   |
| `core/frontend-svelte-patterns.md` | You are changing Svelte frontend conventions                       | Trellis frontend state patterns                                                               |
| `core/capability-patterns.md`      | You are changing capability naming or deployment-role guidance     | Capability taxonomy and assignment guidance                                                   |

## Protocol, API, And Runtime Surface Docs

These documents define the public protocol, API, and runtime-facing surfaces.
Read them when you are implementing or reviewing library/runtime/codegen
ergonomics.

| Document                                             | Surface                     | Read When                                                                                                |
| ---------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `auth/auth-protocol.md`                              | Auth protocol surface       | Implementing auth callout, proofs, reply validation, or auth state model                                 |
| `auth/auth-api.md`                                   | Auth public wire API        | Implementing `/auth/*`, `operations.v1.Auth.*`, `rpc.v1.Auth.*`, or auth events                          |
| `auth/trellis-auth.md`                               | Auth system/runtime design  | Implementing auth helper semantics, sessions, approvals, portals, or runtime auth                        |
| `auth/device-activation.md`                          | Device activation design    | Implementing known-device activation, connect info, or activation review flows                           |
| `operations/trellis-operations.md`                   | Operations design           | Implementing caller-visible async workflows in TypeScript or Rust                                        |
| `jobs/trellis-jobs.md`                               | Jobs design                 | Implementing service-private background execution or jobs admin surfaces                                 |
| `contracts/trellis-typescript-contract-authoring.md` | TypeScript contract design  | Implementing TS contract authoring or TS contract-driven runtime ergonomics                              |
| `contracts/trellis-rust-contract-libraries.md`       | Rust contract design        | Implementing Rust generated SDKs, facades, descriptors, or runtime ergonomics                            |
| `core/state-patterns.md`                             | State design                | Implementing contract-owned state declarations, runtime state semantics, or migrations                   |
| `core/files-transfer-patterns.md`                    | Files and transfer design   | Implementing service-owned files APIs and operation-native transfer behavior                             |
| `/api` in the guides site                            | Generated language API docs | Looking up exact TypeScript signatures, Rustdoc links, pending Rustdoc crates, or generated SDK surfaces |

## Suggested Read Paths

### Implement Trellis operations in TypeScript

1. `operations/trellis-operations.md`
2. `auth/trellis-auth.md`
3. `contracts/trellis-contracts-catalog.md`
4. `/api` for exact TypeScript signatures

### Implement Trellis operations in Rust

1. `operations/trellis-operations.md`
2. `auth/trellis-auth.md`
3. `contracts/trellis-contracts-catalog.md`
4. `/api` for Rustdoc links

### Implement Trellis jobs in TypeScript

1. `jobs/trellis-jobs.md`
2. `core/service-development.md`
3. `operations/trellis-operations.md` only if the jobs attach to public
   operations
4. `contracts/trellis-contracts-catalog.md` when changing job-owned resources,
   bindings, or provisioning surfaces
5. `/api` for exact TypeScript signatures

### Implement Trellis jobs in Rust

1. `jobs/trellis-jobs.md`
2. `core/service-development.md`
3. `operations/trellis-operations.md` only if the jobs attach to public
   operations
4. `contracts/trellis-contracts-catalog.md` when changing job-owned resources,
   bindings, or provisioning surfaces
5. `/api` for Rustdoc links

### Work on type systems or errors

1. `core/type-system-patterns.md`
2. relevant subsystem design doc
3. `/api` for exact language API signatures when needed

### Work on KV resources or projections

1. `core/kv-resource-patterns.md`
2. relevant subsystem design doc

### Work on store resources

1. `core/store-resource-patterns.md`
2. `contracts/trellis-contracts-catalog.md`
3. `/api` if the public runtime API changes

### Work on contract state

1. `core/state-patterns.md`
2. `contracts/trellis-contracts-catalog.md`
3. `contracts/trellis-typescript-contract-authoring.md` when changing TS
   authoring
4. `/api` for exact TypeScript state helper signatures

### Work on files or transfer

1. `core/files-transfer-patterns.md`
2. `core/store-resource-patterns.md`
3. relevant subsystem design doc or `/api` for exact language signatures

### Work on service layout or runtime ergonomics

1. `core/service-development.md`
2. relevant subsystem design doc
3. `/api` for exact language signatures when needed

### Implement an installable service in TypeScript

1. `core/service-development.md`
2. `contracts/trellis-typescript-contract-authoring.md`
3. `contracts/trellis-contracts-catalog.md`
4. `core/platform-libraries.md`
5. `/api` for exact TypeScript signatures

### Implement an activated device in TypeScript

1. `auth/device-activation.md`
2. `auth/trellis-auth.md`
3. `contracts/trellis-typescript-contract-authoring.md`
4. `contracts/trellis-contracts-catalog.md`
5. `core/platform-libraries.md`
6. `/api` for exact TypeScript signatures

### Work on tracing, docs, or request correlation

1. `core/observability-patterns.md`
2. relevant subsystem design doc

### Work on capability naming or deployment policy

1. `core/capability-patterns.md`
2. `auth/trellis-auth.md`
3. `contracts/trellis-contracts-catalog.md`

### Change manifests, codegen, or discovery

1. `contracts/trellis-contracts-catalog.md`
2. `contracts/trellis-typescript-contract-authoring.md` or
   `contracts/trellis-rust-contract-libraries.md`
3. relevant subsystem design doc
4. `/api` for exact generated SDK or runtime APIs

### Implement TypeScript contract/runtime surfaces

1. `contracts/trellis-typescript-contract-authoring.md`
2. `contracts/trellis-contracts-catalog.md`
3. `/api` for exact TypeScript signatures

### Implement Rust contract/runtime surfaces

1. `contracts/trellis-rust-contract-libraries.md`
2. `contracts/trellis-contracts-catalog.md`
3. `/api` for Rustdoc links

### Change auth or operation watch behavior

1. `auth/trellis-auth.md`
2. `auth/auth-protocol.md`
3. `operations/trellis-operations.md`
4. `/api` if the public language API changes

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
2. `auth/auth-api.md`
3. `auth/auth-protocol.md`
4. `/api` for exact TypeScript signatures

### Implement Rust auth surfaces

1. `auth/trellis-auth.md`
2. `auth/auth-api.md`
3. `auth/auth-protocol.md`
4. `/api` for Rustdoc links

### Operate Trellis auth in production

1. `auth/trellis-auth.md`
2. `auth/auth-operations.md`
3. `auth/auth-protocol.md`

## Notes For AI And Reviewers

- load subsystem design docs for architecture
- use `/api` in the guides site for exact TypeScript and Rust API details
- load auth/contracts docs only when the task crosses those boundaries
- prefer task-specific reading paths over broad context dumps
- choose docs by participant kind (`service`, `device`, `app`, `agent`) rather
  than by repo folder name
- search for the exact headings `Minimal installable service example` and
  `Minimal activated device example` before inventing a new participant shape
