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

| Library                             | Purpose                                                                                                                      | Use when                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `@qlever-llc/trellis`               | Canonical core Trellis runtime package: client helpers, Result helpers, common auth helpers, and curated contract re-exports | Frontend apps, services, CLI tools                     |
| `@qlever-llc/trellis/server`        | Runtime-neutral server core                                                                                                  | Backend services                                       |
| `@qlever-llc/trellis/server/health` | Health schemas and health-check helpers without the service bootstrap surface                                                | Contract modules, docs, lightweight server code        |
| `@qlever-llc/trellis/server/node`   | Node server runtime adapter                                                                                                  | External Node services                                 |
| `@qlever-llc/trellis/server/deno`   | Deno server runtime adapter                                                                                                  | In-repo Deno services                                  |
| `@qlever-llc/trellis/auth`          | Full auth helper and auth protocol surface                                                                                   | Apps, services, docs, tests                            |
| `@qlever-llc/trellis/contracts`     | Preferred contract authoring plus full contract-model and canonicalization surface                                           | Services, SDK generation, docs                         |
| `@qlever-llc/trellis/sdk/*`         | First-party generated SDK modules                                                                                            | Apps and services that consume Trellis-owned contracts |
| `@qlever-llc/trellis-svelte`        | Svelte-specific Trellis integration                                                                                          | Svelte applications                                    |
| `@qlever-llc/trellis-telemetry`     | Shared tracing helpers                                                                                                       | Runtime libraries and services                         |
| `@qlever-llc/trellis-jobs`          | Job creation and processing                                                                                                  | Service-private retryable work                         |

## Library Rules

- `@qlever-llc/trellis` is the canonical app and service package for Trellis
  TypeScript development
- service APIs are defined with the service that owns them and are consumed
  through contract packages
- server helpers and first-party SDKs live on explicit Trellis subpaths rather
  than the root entrypoint
- contract modules that only need health schemas should prefer
  `@qlever-llc/trellis/server/health` over `@qlever-llc/trellis/server`
- framework adapters such as `@qlever-llc/trellis-svelte` remain separate
  packages
- platform packages should expose stable ergonomic surfaces and hide
  transport/bootstrap details
- browser-safe public runtime APIs belong on `@qlever-llc/trellis`; service-only
  resource handles and bootstrap helpers belong on `@qlever-llc/trellis/server*`

## `@qlever-llc/trellis`

Canonical TypeScript entrypoint for contract-driven RPC, operation, event, and
transfer-grant-driven file communication. The root package is browser-safe,
does not eagerly load generated SDKs, and keeps runtime-specific server
helpers on `@qlever-llc/trellis/server*` subpaths.

### Browser Client

Browser auth uses a session key stored in IndexedDB plus a bind flow. For
SvelteKit apps, prefer higher-level helpers such as `@qlever-llc/trellis-svelte`
when available.

### Deno / Node Client

```ts
import { TrellisClient } from "@qlever-llc/trellis";
import { defineCliContract } from "@qlever-llc/trellis/contracts";
import { graph } from "@acme/graph-contract";
import { auth } from "@qlever-llc/trellis/sdk/auth";

export const cli = defineCliContract(() => ({
  id: "acme.graph-cli@v1",
  displayName: "Graph CLI",
  description: "Query the graph service and inspect auth state.",
  uses: {
    auth: auth.useDefaults(),
    graph: graph.use({ rpc: { call: ["Graph.Query"] } }),
  },
}));

export default cli;

const client = await TrellisClient.connect({
  trellisUrl: "https://trellis.example.com",
  contract: cli,
  name: "cli-tool",
});
```

Use `TrellisClient.connect(...)` for the normal runtime bootstrap path.

### Server

```ts
import { Result } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/server/deno";
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

await service.trellis.mount("User.Find", async (input) => {
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
- service handlers mounted from contract-owned RPCs receive typed payloads from
  Trellis and may return either `Result` or `Promise<Result>`
- upload/download transfer execution is initiated by contract-owned RPCs and
  completed through `trellis.transfer(grant)`
- both sides use explicit `Result` conventions rather than exception-driven
  remote error handling

### Server-Owned Runtime Helpers

`@qlever-llc/trellis/server` owns the service-only runtime surface.

Rules:

- service code should use `service.kv`, `service.store`, and `service.jobs`
  rather than a nested `service.resources.*` runtime shape
- file-transfer session helpers belong on the server runtime surface as
  `service.transfer`
- extracted service RPC handler aliases that need service-only helpers belong on
  `@qlever-llc/trellis/server*`, not the browser-safe root package
- public apps and peer services should not resolve those service-owned handles
  directly

## `@qlever-llc/trellis-svelte`

Provides the app-level browser adapter for Svelte applications.

Rules:

- browser apps should define one small app-local Trellis module and re-export
  typed helpers for the rest of the app
- `TrellisProvider` is the primary browser integration surface; app code should
  pass `trellisUrl`, `contract`, and `loginPath`
- app code does not provide runtime transport topology; `TrellisProvider`
  resolves connection details from Trellis auth during bind or renew
- `TrellisProvider` restores auth state, handles auth callbacks, calls
  `TrellisClient.connect(...)`, and exposes auth and the live Trellis runtime
  through Svelte context
- normal pages and components should not recreate auth state; they should read
  the live runtime from context through app-scoped helpers
- app-facing auth helpers should not require raw URL plumbing or placeholder
  positional arguments from app code; they should expose an options-shaped API
  with sensible redirect defaults
- app-facing auth helpers should accept opaque portal context so apps and custom
  portals can coordinate runtime UX without hard-coding portal-specific
  parameters
- custom portal apps should have a small Svelte-friendly `createPortalFlow(...)`
  wrapper layered over framework-neutral portal helpers from
  `@qlever-llc/trellis`
- `loginPath` is the default auth-required redirect target; if `onAuthRequired`
  is omitted, the provider redirects to `loginPath?redirectTo=...`
- `onAuthRequired` remains available as an override for apps that need custom
  routing or side effects
- bind failures should be renderable through a `bindError(result)` snippet;
  `onBindError` remains available for imperative reactions
- app-local helper modules should usually export the contract, the fixed
  `trellisUrl` when there is one, and a typed `getTrellis()` wrapper around
  Svelte context
- dynamic auth-instance selection remains a valid advanced case, but the default
  public browser-app API should optimize for the fixed-instance path rather than
  forcing every app through explicit auth-state construction
- browser-app integrations should not require a `serviceName` prop; if a client
  label is needed for telemetry, it should derive from contract metadata or
  internal defaults

## `@qlever-llc/trellis/auth`

Provides the full auth helper, schema, and protocol surface behind the root
package's curated auth re-exports. See:

- [../auth/trellis-auth.md](./../auth/trellis-auth.md)
- [../auth/auth-typescript-api.md](./../auth/auth-typescript-api.md)
- [../auth/auth-rust-api.md](./../auth/auth-rust-api.md)

## `@qlever-llc/trellis-telemetry`

Provides shared tracing helpers used by runtime libraries and services. See
[observability-patterns.md](./observability-patterns.md).

## `@qlever-llc/trellis-jobs`

Provides service-private job creation and processing. See:

- [../jobs/trellis-jobs.md](./../jobs/trellis-jobs.md)
- [../jobs/jobs-typescript-api.md](./../jobs/jobs-typescript-api.md)
- [../jobs/jobs-rust-api.md](./../jobs/jobs-rust-api.md)

## `@qlever-llc/trellis/contracts`

Provides the preferred contract authoring surface plus the full contract-model,
manifest validation, canonicalization, SDK generation, and documentation export
surface behind the root package's curated contract re-exports. See:

- contract source files should prefer importing the specialized contract helper
  they need from `@qlever-llc/trellis/contracts` so codegen and manifest
  verification do not load the runtime package unnecessarily

- [../contracts/trellis-contracts-catalog.md](./../contracts/trellis-contracts-catalog.md)
- [../contracts/contracts-typescript-api.md](./../contracts/contracts-typescript-api.md)
- [../contracts/contracts-rust-api.md](./../contracts/contracts-rust-api.md)
