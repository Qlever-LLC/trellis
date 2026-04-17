---
title: Service Development
description: Trellis service-author guidance for layout, lifecycle, and the jobs versus operations boundary.
order: 50
---

# Design: Service Development

## Prerequisites

- [trellis-patterns.md](./trellis-patterns.md) - Trellis architecture and
  communication model
- [type-system-patterns.md](./type-system-patterns.md) - schema and Result
  conventions
- [../operations/trellis-operations.md](./../operations/trellis-operations.md) -
  caller-visible async workflows
- [../jobs/trellis-jobs.md](./../jobs/trellis-jobs.md) - service-private jobs

## Design

Trellis services share a common development shape: a small bootstrap entrypoint,
explicit contract ownership, and a clean separation between caller-visible
operations and service-private jobs.

Before choosing a file layout, choose the participant kind and runtime helper.

### Participant kind and runtime helper

Repo folder names are local organization only. They do not determine Trellis
contract `kind`, install behavior, or which connect helper is correct.

| Contract kind          | Normal helper                 | Use when                                                                                                                         |
| ---------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `service`              | `TrellisService.connect(...)` | The participant owns installable RPCs, operations, events, or service-owned resources and runs as a deployment service principal |
| `device`               | `TrellisDevice.connect(...)`  | The participant authenticates through device activation using a preregistered device root secret                                 |
| `app`, `portal`, `cli` | `TrellisClient.connect(...)`  | The participant is a user-facing app, portal, or tool rather than an installed service                                           |

Rules:

- choose `kind` from the participant's identity and auth flow, not from the repo
  folder that contains the code
- code under `services/` may still correctly be `kind: "device"` when it is a
  repo-local demo, simulator, or utility that authenticates as a device
  principal
- a participant with no owned RPCs, operations, events, or resources is normal;
  do not invent owned APIs just to fit a service template
- only `kind: "service"` participants should use `TrellisService.connect(...)`,
  service install flows, and service-owned runtime handles such as `service.kv`,
  `service.store`, and `service.jobs`

### Directory structure

```text
services/<name>/
├── main.ts          # Bootstrap, handlers, shutdown
├── contract.ts      # Local contract definition
├── contracts/       # Optional contract module directory
├── config.ts        # Environment configuration
├── globals.ts       # Shared runtime state
├── deno.json        # Tasks, imports
└── <domain>.ts      # Business logic
```

The full template above is common for installable services. Smaller repo-local
participants such as demos or utilities may only need `main.ts`, `deno.json`,
and one contract module.

For TypeScript service contract source files under `contracts/`, the contract
module should default export the `defineServiceContract(...)` result so prepare
and generation can resolve it directly.

### Lifecycle

For `kind: "service"` participants:

```ts
import { TrellisService } from "@qlever-llc/trellis/host/deno";
import { myService } from "./contract.ts";

const service = await TrellisService.connect({
  trellisUrl: config.trellisUrl,
  contract: myService,
  name: "<name>",
  sessionKeySeed: config.sessionKeySeed,
  server: {},
});

const itemsKV = (await service.kv.items.open(ItemSchema)).take();
const uploadsStore = (await service.store.uploads.open()).take();
const stagedUpload = (await uploadsStore.waitFor("incoming/report.pdf", {
  timeoutMs: 10_000,
})).take();

await service.trellis.mount("SomeMethod", handler);
await service.trellis.event("SomeEvent", {}, eventHandler);

const catalog = await service.requestOrThrow("Trellis.Catalog", {});

Deno.addSignalListener("SIGTERM", async () => {
  await service.stop();
  Deno.exit(0);
});
```

### Minimal installable service example

```ts
import { Result } from "@qlever-llc/trellis";
import type { RpcName } from "@qlever-llc/trellis";
import type { ServiceRpcHandler } from "@qlever-llc/trellis/host";
import { defineServiceContract } from "@qlever-llc/trellis/contracts";
import { TrellisService } from "@qlever-llc/trellis/host/deno";
import {
  HealthResponseSchema,
  HealthRpcSchema,
} from "@qlever-llc/trellis/health";

const schemas = {
  HealthRequest: HealthRpcSchema,
  HealthResponse: HealthResponseSchema,
} as const;

export const serviceContract = defineServiceContract(
  { schemas },
  (ref) => ({
    id: "acme.echo@v1",
    displayName: "Echo Service",
    description: "A minimal installable Trellis service example.",
    rpc: {
      "Echo.Health": {
        version: "v1",
        input: ref.schema("HealthRequest"),
        output: ref.schema("HealthResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
    },
  }),
);

export default serviceContract;

export type Rpc<T extends RpcName<typeof serviceContract>> = ServiceRpcHandler<
  typeof serviceContract,
  T
>;

const service = await TrellisService.connect({
  trellisUrl,
  contract: serviceContract,
  name: "echo",
  sessionKeySeed,
  server: {},
});

export const health: Rpc<"Echo.Health"> = (_input, _context, trellis) => {
  return Result.ok({
    status: "healthy",
    service: "echo",
    timestamp: new Date().toISOString(),
    checks: [],
  });
};

await service.trellis.mount("Echo.Health", health);
```

Rules:

- a minimal installable service should own at least one public surface such as
  an RPC, operation, or event rather than existing only to call other services
- installable service code uses `TrellisService.connect(...)` and mounts only
  names from its owned contract surface
- the optional `server` block configures service-runtime concerns such as
  logging, default request timeout, event-consumer stream selection,
  no-responder retry behavior, and extra health checks
- `server.log` defaults to the package server logger; set it to `false` to
  disable runtime logging or provide a pino-compatible logger to use your own
- when the connected contract uses the shared `Health.Heartbeat` event,
  `TrellisService.connect(...)` publishes baseline heartbeats automatically and
  service code may enrich them through `service.health.setInfo(...)` and
  `service.health.add(...)`
- mounted RPC handlers should rely on Trellis-provided payload typing and
  validation rather than re-parsing the mounted payload just to recover types
- extracted service RPC handler aliases should come from
  `@qlever-llc/trellis/host` so the third parameter includes service-only
  helpers such as `kv`, `store`, and `transfer`
- mounted RPC handlers may be synchronous when they do not need `await`
- mounted RPC handlers may return declared local `TrellisError` subclasses
  directly when those errors are listed in the contract RPC `errors: [...]`
- service-local transportable RPC errors should be declared in the contract's
  top-level `errors` map through `defineError(...)` generated classes rather
  than by overloading shared built-in errors for domain-specific failures
- if the service later needs remote APIs, add them under `uses` through SDK
  `use(...)` helpers rather than by hand-writing remote contract ids or raw
  method strings

Behavior:

- `TrellisService.connect(...)` performs bootstrap, auth handshake, contract
  verification, runtime connection setup, and eager binding resolution
- if the contract is not installed, startup fails immediately
- resource handles such as `service.kv.*` and `service.store.*` resolve during
  bootstrap and are opened explicitly by service code before use
- transfer-session helpers are available through `service.transfer` when the
  service exposes file upload/download initiation RPCs
- when a contract requests `resources.jobs`, `TrellisService.connect(...)`
  resolves both `service.jobs` and the synthetic `service.streams.jobsWork`
  binding used by generic worker runtimes such as
  `startNatsWorkerHostFromBinding(...)`
- the shared jobs streams and projected-state KV are Trellis-owned
  infrastructure; service bootstrap should provision them automatically so a
  jobs-enabled service does not require a separate manual jobs install step
- when an RPC needs to start caller-visible follow-up work after a transfer,
  prefer `service.operation(...).accept(...)` plus
  `service.transfer.initiateUpload({ onStored(...) })` over ad-hoc background
  polling inside the RPC body
- the `trellis` control-plane service is the one bootstrap exception and may
  need lower-level runtime paths

### Jobs and operations

Use operations for caller-visible asynchronous workflows and jobs for
service-private execution.

Behavior:

- if a user or peer service needs to observe async work, expose an operation
  from the owning service contract
- if work is only an internal execution detail, use a job and keep it behind the
  service boundary
- operation APIs should expose `OperationRef`-style handles with `get()`,
  `wait()`, and optional `watch()`
- service-local jobs APIs should expose per-job-type handles with `create()`
  returning `JobRef`
- public APIs must not expose weak raw wire types except in explicit
  raw/debug/admin surfaces
- public service APIs should hang off connected runtime objects such as
  `service.jobs` and `service.operation(...)`

### Files and transfer

Services should treat `Files` as the public interface to service-owned `store`
resources.

Behavior:

- metadata and control actions such as list/head/delete remain ordinary
  contract-owned RPCs
- upload/download initiation remains contract-owned and returns transfer grants
- raw byte movement is executed through Trellis runtime helpers rather than
  hand-written service-specific chunk protocols
- service code uses `service.transfer` plus `service.store.<alias>` to back
  those public file APIs

Example:

```ts
const op = await billing.operation("Billing.Refund").start(input);
const done = await op.wait();

const job = await service.jobs.refundCharge.create({
  operationId: op.id,
  ...payload,
});
await job.wait();
```
