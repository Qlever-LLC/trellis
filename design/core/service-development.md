---
title: Service Development
description: Trellis service-author guidance for layout, lifecycle, and the jobs versus operations boundary.
order: 50
---

# Design: Service Development

## Prerequisites

- [trellis-patterns.md](./trellis-patterns.md) - Trellis architecture and communication model
- [type-system-patterns.md](./type-system-patterns.md) - schema and Result conventions
- [../operations/trellis-operations.md](./../operations/trellis-operations.md) - caller-visible async workflows
- [../jobs/trellis-jobs.md](./../jobs/trellis-jobs.md) - service-private jobs

## Design

Trellis services share a common development shape: a small bootstrap entrypoint, explicit contract ownership, and a clean separation between caller-visible operations and service-private jobs.

### Directory structure

```text
services/<name>/
├── main.ts          # Bootstrap, handlers, shutdown
├── contract.ts      # Service-owned contract definition
├── config.ts        # Environment configuration
├── globals.ts       # Shared runtime state
├── deno.json        # Tasks, imports
└── <domain>.ts      # Business logic
```

### Lifecycle

```ts
import { TrellisService } from "@qlever-llc/trellis/server/deno";
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

await service.trellis.mount("SomeMethod", handler);
await service.trellis.event("SomeEvent", {}, eventHandler);

const catalog = await service.requestOrThrow("Trellis.Catalog", {});

Deno.addSignalListener("SIGTERM", async () => {
  await service.stop();
  Deno.exit(0);
});
```

Behavior:

- `TrellisService.connect(...)` performs bootstrap, NATS connection, auth handshake, contract verification, and eager binding resolution
- if the contract is not installed, startup fails immediately
- resource handles such as `service.kv.*` and `service.store.*` resolve during bootstrap and are opened explicitly by service code before use
- transfer-session helpers are available through `service.transfer` when the service exposes file upload/download initiation RPCs
- the `trellis` control-plane service is the one bootstrap exception and may need lower-level runtime paths

### Jobs and operations

Use operations for caller-visible asynchronous workflows and jobs for service-private execution.

Behavior:

- if a user or peer service needs to observe async work, expose an operation from the owning service contract
- if work is only an internal execution detail, use a job and keep it behind the service boundary
- operation APIs should expose `OperationRef`-style handles with `get()`, `wait()`, and optional `watch()`
- service-local jobs APIs should expose per-job-type handles with `create()` returning `JobRef`
- public APIs must not expose weak raw wire types except in explicit raw/debug/admin surfaces
- public service APIs should hang off connected runtime objects such as `service.jobs` and `service.operation(...)`

### Files and transfer

Services should treat `Files` as the public interface to service-owned `store` resources.

Behavior:

- metadata and control actions such as list/head/delete remain ordinary contract-owned RPCs
- upload/download initiation remains contract-owned and returns transfer grants
- raw byte movement is executed through Trellis runtime helpers rather than hand-written service-specific chunk protocols
- service code uses `service.transfer` plus `service.store.<alias>` to back those public file APIs

Example:

```ts
const op = await billing.operation("Billing.Refund").start(input);
const done = await op.wait();

const job = await service.jobs.refundCharge.create({ operationId: op.id, ...payload });
await job.wait();
```
