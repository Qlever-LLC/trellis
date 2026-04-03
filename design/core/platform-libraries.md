---
title: Platform Libraries
description: Responsibilities and boundaries for the core Trellis runtime, auth, contracts, jobs, and telemetry libraries.
order: 20
---

# Design: Platform Libraries

## Prerequisites

- [trellis-patterns.md](./trellis-patterns.md) - Trellis architecture and platform boundaries
- [type-system-patterns.md](./type-system-patterns.md) - Result, schema, and error conventions
- [../auth/trellis-auth.md](./../auth/trellis-auth.md) - auth subsystem design

## Scope

This document defines the responsibilities of the core Trellis platform libraries.

## Core Libraries

| Library | Purpose | Use when |
| --- | --- | --- |
| `@qlever-llc/trellis` | Client runtime for RPC, operations, and events | Frontend apps, CLI tools |
| `@qlever-llc/trellis-server` | Runtime-neutral server core | Backend services |
| `@qlever-llc/trellis-server/node` | Node server runtime adapter | External Node services |
| `@qlever-llc/trellis-server/deno` | Deno server runtime adapter | In-repo Deno services |
| `@qlever-llc/trellis-result` | Result type for explicit failure handling | Any function that can fail |
| `@qlever-llc/trellis-auth` | Session key management and auth helpers | Services, apps, CLI tools |
| `@qlever-llc/trellis-auth/protocol` | Public auth/admin wire DTOs | Apps, services, docs, tests |
| `@qlever-llc/trellis-contracts` | Contract authoring and shared protocol primitives | Services, SDK generation, docs |
| `@qlever-llc/trellis-telemetry` | Shared tracing helpers | Runtime libraries and services |
| `@qlever-llc/trellis-jobs` | Job creation and processing | Service-private retryable work |

## Library Rules

- `@qlever-llc/trellis` is a runtime library, not a central registry for every service API
- service APIs are defined with the service that owns them and are consumed through contract packages
- auth, contracts, jobs, and telemetry remain separate packages with explicit responsibilities
- platform packages should expose stable ergonomic surfaces and hide transport/bootstrap details

## `@qlever-llc/trellis`

Client runtime for contract-driven RPC, operation, and event communication over NATS. Auth is injected from auth packages rather than hard-coded into the runtime.

### Browser Client

Browser auth uses a session key stored in IndexedDB plus a bind flow. For SvelteKit apps, prefer higher-level helpers such as `@qlever-llc/trellis-svelte` when available.

### Deno / Node Client

```ts
import { defineContract } from "@qlever-llc/trellis-contracts";
import { auth } from "@qlever-llc/trellis-sdk-auth";
import { graph } from "@acme/graph-contract";

const cli = defineContract({
  id: "acme.graph-cli@v1",
  displayName: "Graph CLI",
  description: "Query the graph service and inspect auth state.",
  kind: "cli",
  uses: {
    auth: auth.use({ rpc: { call: ["Auth.Me"] } }),
    graph: graph.use({ rpc: { call: ["Graph.Query"] } }),
  },
});

const client = createClient(cli, nc, authSession, {
  name: "cli-tool",
});
```

### Server

```ts
import { connect } from "@nats-io/transport-deno";
import { TrellisServer } from "@qlever-llc/trellis-server";

const nc = await connect({ servers: config.nats.servers });
const server = TrellisServer.create("graph", nc, auth, { log });

server.mount("User.Find", async (input, ctx) => {
  const user = await db.findUser(input.userId);
  if (!user) return Result.err(new NotFoundError("User"));
  return Result.ok({ user });
});
```

Rules:

- RPCs are timeout-bounded
- operations and events are contract-driven rather than raw-subject-driven in normal app code
- both sides use explicit `Result` conventions rather than exception-driven remote error handling

## `@qlever-llc/trellis-result`

Provides explicit `Result<T, E>` handling. See [type-system-patterns.md](./type-system-patterns.md).

## `@qlever-llc/trellis-auth`

Provides session key loading, signing, bind flow helpers, and shared auth support code. See:

- [../auth/trellis-auth.md](./../auth/trellis-auth.md)
- [../auth/auth-typescript-api.md](./../auth/auth-typescript-api.md)
- [../auth/auth-rust-api.md](./../auth/auth-rust-api.md)

## `@qlever-llc/trellis-telemetry`

Provides shared tracing helpers used by runtime libraries and services. See [observability-patterns.md](./observability-patterns.md).

## `@qlever-llc/trellis-jobs`

Provides service-private job creation and processing. See:

- [../jobs/trellis-jobs.md](./../jobs/trellis-jobs.md)
- [../jobs/jobs-typescript-api.md](./../jobs/jobs-typescript-api.md)
- [../jobs/jobs-rust-api.md](./../jobs/jobs-rust-api.md)

## `@qlever-llc/trellis-contracts`

Provides contract tooling for manifest validation, canonicalization, SDK generation, and documentation export. See:

- [../contracts/trellis-contracts-catalog.md](./../contracts/trellis-contracts-catalog.md)
- [../contracts/contracts-typescript-api.md](./../contracts/contracts-typescript-api.md)
- [../contracts/contracts-rust-api.md](./../contracts/contracts-rust-api.md)
