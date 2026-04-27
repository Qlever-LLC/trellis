---
title: Platform Libraries
description: Responsibilities and boundaries for the core Trellis runtime, auth, contracts, jobs, and telemetry libraries.
order: 20
---

# Design: Platform Libraries

## Prerequisites

- [trellis-patterns.md](./trellis-patterns.md) - Trellis architecture and
  platform boundaries
- [type-system-patterns.md](./type-system-patterns.md) - Result, schema, and
  error conventions
- [../auth/trellis-auth.md](./../auth/trellis-auth.md) - auth subsystem design

## Scope

This document defines the responsibilities of the core Trellis platform
libraries.

## Core Libraries

| Library                            | Purpose                                                                                                                         | Use when                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `@qlever-llc/trellis`              | Canonical core Trellis runtime package: client/device helpers, Result helpers, transfer helpers, and everyday contract builders | Frontend apps, services, CLI tools                     |
| `@qlever-llc/trellis/health`       | Health schemas, helper functions, and health-check result types                                                                 | Contracts, devices, services, lightweight clients      |
| `@qlever-llc/trellis/service`      | Service-side runtime facade, extracted handler types, and service-only helpers                                                  | Backend services                                       |
| `@qlever-llc/trellis/service/node` | Node service adapter                                                                                                            | External Node services                                 |
| `@qlever-llc/trellis/service/deno` | Deno service adapter                                                                                                            | In-repo Deno services                                  |
| `@qlever-llc/trellis/auth`         | Full auth helper and auth protocol surface, including browser bind helpers                                                      | Apps, services, docs, tests                            |
| `@qlever-llc/trellis/auth/browser` | Browser-only auth and portal-flow helper facade                                                                                 | Browser apps, custom portals                           |
| `@qlever-llc/trellis/contracts`    | Advanced contract-model, canonicalization, and low-level contract authoring surface                                             | SDK generation, docs, advanced tooling                 |
| `@qlever-llc/trellis/sdk/*`        | First-party generated SDK modules for Trellis-owned contracts                                                                   | Apps and services that consume Trellis-owned contracts |
| `@qlever-llc/trellis/tracing`      | Specialized Trellis tracing facade                                                                                              | Runtime libraries and services                         |
| `@qlever-llc/trellis-svelte`       | Svelte-specific Trellis browser integration with a Trellis-only public surface                                                  | Svelte applications                                    |

## Library Rules

- `@qlever-llc/trellis` is the canonical app and service package for Trellis
  TypeScript development
- service APIs are defined with the service that owns them and are consumed
  through contract packages
- server helpers live on explicit Trellis subpaths
- first-party SDKs for Trellis-owned contracts live under explicit
  `@qlever-llc/trellis/sdk/*` subpaths
- contract modules that only need health schemas should prefer root health
  re-exports or `@qlever-llc/trellis/health`
- framework adapters such as `@qlever-llc/trellis-svelte` remain separate
  packages
- platform packages should expose stable ergonomic surfaces and hide
  transport/bootstrap details
- browser-safe public runtime APIs and the kind-specific contract builders
  belong on `@qlever-llc/trellis`
- the root package should expose Trellis-owned lifecycle handles such as
  `TrellisConnection`, not raw transport handles such as `NatsConnection`
- browser-only login and portal-flow helpers belong on
  `@qlever-llc/trellis/auth` and the narrower `@qlever-llc/trellis/auth/browser`
  facade
- service-only resource handles and bootstrap helpers belong on
  `@qlever-llc/trellis/service*`
- `@qlever-llc/trellis/service` is a service-author surface and must not
  re-export low-level runtime/server internals
- public TypeScript jobs helpers belong on `@qlever-llc/trellis` and
  `@qlever-llc/trellis/service*`, not on a standalone jobs package

## `@qlever-llc/trellis`

Canonical TypeScript entrypoint for contract-driven RPC, operation, event, and
transfer-grant-driven file communication. The root package is browser-safe, does
not eagerly load generated SDKs, exports the normal kind-specific contract
builders plus health helpers, and keeps host-specific service helpers on
`@qlever-llc/trellis/service*` subpaths.

### Browser Client

Browser auth uses a session key stored in IndexedDB plus a bind flow. For
SvelteKit apps, prefer higher-level helpers such as `@qlever-llc/trellis-svelte`
when available.

### Deno / Node Client

```ts
import { defineAgentContract, TrellisClient } from "@qlever-llc/trellis";
import { graph } from "@acme/graph-contract";
import { auth } from "@qlever-llc/trellis/sdk/auth";

export const agent = defineAgentContract(() => ({
  id: "acme.graph-agent@v1",
  displayName: "Graph Agent",
  description:
    "Query the graph service and inspect auth state as delegated tooling.",
  uses: {
    auth: auth.useDefaults(),
    graph: graph.use({ rpc: { call: ["Graph.Query"] } }),
  },
}));

export default agent;

const client = await TrellisClient.connect({
  trellisUrl: "https://trellis.example.com",
  contract: agent,
  name: "graph-agent",
});
```

Use `TrellisClient.connect(...)` for the normal runtime bootstrap path.

### Server

```ts
import { Result } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { graph } from "@acme/graph-contract";

const service = await TrellisService.connect({
  trellisUrl: "https://trellis.example.com",
  contract: graph,
  name: "graph",
  sessionKeySeed: config.sessionKeySeed,
  server: {
    log,
  },
});

await service.trellis.mount("User.Find", async ({ input }) => {
  const user = await db.findUser(input.userId);
  if (!user) return Result.err(new NotFoundError("User"));
  return Result.ok({ user });
});

await service.trellis.mount("Graph.Health", () => {
  return Result.ok({ status: "healthy" as const });
});
```

Rules:

- RPCs are timeout-bounded
- operations and events are contract-driven rather than raw-subject-driven in
  normal app code
- admin jobs access should use `Jobs.*` RPCs declared through the jobs SDK
  rather than a client-side `trellis.jobs()` helper
- service handlers mounted from contract-owned RPCs receive typed payloads from
  Trellis and may return either `Result` or `Promise<Result>`
- transfer execution belongs to transfer-capable operations and is initiated by
  the higher-level `operation(...).input(...).transfer(...).start()` helper
- both sides use explicit `Result` conventions rather than exception-driven
  remote error handling

### Server-Owned Runtime Helpers

`@qlever-llc/trellis/service` owns the service-only runtime surface.

Rules:

- service code should use `service.kv`, `service.store`, and `service.jobs`
  rather than a nested `service.resources.*` runtime shape
- schema-backed service KV resources are exposed directly as typed
  `service.kv.<alias>` and handler `trellis.kv.<alias>` stores; only store
  resources use `.open()`
- jobs-enabled services should declare top-level contract `jobs` and use
  `service.jobs.<queue>` plus `service.wait()` / `service.stop()` rather than
  raw worker-runtime helpers or stream bindings
- transfer-aware operation contexts belong on the server runtime surface for
  transfer-capable operations
- extracted service RPC handler aliases that need service-only helpers belong on
  `@qlever-llc/trellis/service*`, not the browser-safe root package, so handler
  types expose the canonical object argument shape and narrow injected `trellis`
  facade for `kv`, `store`, and transfer-aware operation contexts

## `@qlever-llc/trellis/sdk/*`

Provides the first-party generated SDKs for Trellis-owned contracts such as
auth, core, activity, jobs, health, and state. Import the specific subpath for
the Trellis-owned contract you need, for example
`import { auth } from "@qlever-llc/trellis/sdk/auth"` and
`import { core } from "@qlever-llc/trellis/sdk/core"`.

- public apps and peer services should not resolve those service-owned handles
  directly

## `@qlever-llc/trellis-svelte`

Provides the app-level browser adapter for Svelte applications.

Rules:

- browser apps should define one small app-local Trellis module and re-export
  typed helpers for the rest of the app
- app-local Trellis modules should import the app contract's generated client
  facade from `generated/js/sdks/<contract>/client.ts` after `prepare`
- `TrellisProvider` is the primary browser integration surface; app code should
  pass an app-owned `trellisApp` created with
  `createTrellisApp<typeof contract, GeneratedClient>({ contract, trellisUrl })`
- `TrellisProvider` delegates runtime bootstrap and reconnect to
  `TrellisClient.connect(...)`; auth behavior is configured through provider
  auth options or `onAuthRequired`
- `trellis-svelte` should keep the typed Trellis client and reactive connection
  adapter scoped to app-owned context rather than exposing a synthetic runtime
  bag
- the public Svelte surface is app-scoped: apps should re-export local
  `getTrellis()` and `getConnection()` helpers from their app-local Trellis
  module
- `@qlever-llc/trellis-svelte` MUST NOT expose raw NATS clients, NATS connection
  state, or other transport-owned handles as public API
- normal pages and components should not recreate auth state; they should read
  the live Trellis client and connection context through app-scoped helpers
- `getTrellis()` and `getConnection()` are Svelte context getters; components
  must call them during component initialization and reuse the returned client
  or connection adapter from event handlers, effects, and async helpers
- app-facing auth helpers should not require raw URL plumbing or placeholder
  positional arguments from app code; they should expose an options-shaped API
  with sensible redirect defaults
- app-facing auth helpers should accept opaque portal context so apps and custom
  portals can coordinate runtime UX without hard-coding portal-specific
  parameters
- custom portal apps should have a small Svelte-friendly `createPortalFlow(...)`
  wrapper layered over the browser auth/portal helpers from
  `@qlever-llc/trellis/auth` or the narrower `@qlever-llc/trellis/auth/browser`
  facade
- `onAuthRequired` remains available for apps that need custom routing or side
  effects when the client requires auth
- app-local helper modules should usually export the contract, the fixed
  `trellisUrl` when callers need it outside provider setup, and local
  `getTrellis()` / `getConnection()` wrappers around an app-owned `trellisApp`
- `getTrellis()` should return the generated client facade directly so page code
  sees explicit RPC, operation, event, and state members instead of deep runtime
  generic aliases
- dynamic auth-instance selection remains a valid advanced case, but the default
  public browser-app API should optimize for the fixed-instance path rather than
  forcing every app through explicit auth-state construction
- browser-app integrations should not require a `serviceName` prop; if a client
  label is needed for telemetry, it should derive from contract metadata or
  internal defaults

## `@qlever-llc/trellis/auth`

Provides the full auth helper, schema, protocol, and browser bind surface. The
browser-only portal/login helper facade also lives at
`@qlever-llc/trellis/auth/browser`. See:

- [../auth/trellis-auth.md](./../auth/trellis-auth.md)
- [../auth/auth-typescript-api.md](./../auth/auth-typescript-api.md)
- [../auth/auth-rust-api.md](./../auth/auth-rust-api.md)

## `@qlever-llc/trellis/tracing`

Provides the specialized Trellis tracing facade used by runtime libraries and
services without widening the root package. See
[observability-patterns.md](./observability-patterns.md).

## Jobs Surfaces

Service-private jobs are part of the Trellis runtime surface rather than a
standalone TypeScript package.

- TypeScript service-local jobs live on connected service runtimes as
  `service.jobs`
- TypeScript admin jobs access uses `Jobs.*` RPCs declared through
  `@qlever-llc/trellis/sdk/jobs`
- subsystem semantics and language-specific details live in:
  - [../jobs/trellis-jobs.md](./../jobs/trellis-jobs.md)
  - [../jobs/jobs-typescript-api.md](./../jobs/jobs-typescript-api.md)
  - [../jobs/jobs-rust-api.md](./../jobs/jobs-rust-api.md)

## `@qlever-llc/trellis/contracts`

Provides the advanced contract-model, manifest validation, canonicalization, SDK
generation, and documentation export surface behind the root package's curated
contract re-exports. See:

- normal contract source files may import the kind-specific helper they need
  from `@qlever-llc/trellis`
- advanced tooling, SDK generation, and low-level contract-model consumers
  should use `@qlever-llc/trellis/contracts`

- [../contracts/trellis-contracts-catalog.md](./../contracts/trellis-contracts-catalog.md)
- [../contracts/contracts-typescript-api.md](./../contracts/contracts-typescript-api.md)
- [../contracts/contracts-rust-api.md](./../contracts/contracts-rust-api.md)
