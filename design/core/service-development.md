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

| Contract kind  | Normal helper                 | Use when                                                                                                                         |
| -------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `service`      | `TrellisService.connect(...)` | The participant owns installable RPCs, operations, events, or service-owned resources and runs as a deployment service principal |
| `device`       | `TrellisDevice.connect(...)`  | The participant authenticates through device activation using a preregistered device root secret                                 |
| `app`, `agent` | `TrellisClient.connect(...)`  | The participant is a user-facing app, CLI, native app, or delegated tool rather than an installed service                        |

Rules:

- choose `kind` from the participant's identity and auth flow, not from the repo
  folder that contains the code
- code under `services/` may still correctly be `kind: "device"` when it is a
  repo-local demo, simulator, or utility that authenticates as a device
  principal
- a participant with no owned RPCs, operations, events, or resources is normal;
  do not invent owned APIs just to fit a service template
- only `kind: "service"` participants should use `TrellisService.connect(...)`,
  service deployment flows, and service-owned runtime handles such as
  `service.kv`, `service.store`, and `service.jobs`
- resolved service resource bindings are runtime internals; service authors use
  the handles returned by `TrellisService.connect(...)` rather than fetching,
  constructing, or passing binding payloads themselves

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

For TypeScript service contract source files, use a top-level `contract.ts` for
single-contract services and `contracts/*.ts` only when the service owns
multiple contract modules. In either layout, the contract module should default
export the `defineServiceContract(...)` result so prepare and generation can
resolve it directly.

### Lifecycle

For `kind: "service"` participants:

```ts
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { myService } from "./contract.ts";

const service = await TrellisService.connect({
  trellisUrl: config.trellisUrl,
  contract: myService,
  name: "<name>",
  sessionKeySeed: config.sessionKeySeed,
  server: {},
});

const itemsKV = service.kv.items;
const uploadsStore = (await service.store.uploads.open()).take();
const stagedUpload = (await uploadsStore.waitFor("incoming/report.pdf", {
  timeoutMs: 10_000,
})).take();

await service.handle.rpc.some.method(handler);
await service.event.some.event.listen(eventHandler, {});

const catalog = await service.rpc.trellis.catalog({});
if (catalog.isErr()) {
  throw catalog.error;
}

const shutdown = async () => {
  try {
    await service.stop();
  } finally {
    Deno.removeSignalListener("SIGTERM", shutdown);
  }
};

Deno.addSignalListener("SIGTERM", shutdown);
```

Rules:

- service code MUST bootstrap through `TrellisService.connect(...)`; do not
  import the core SDK to recreate service bootstrap or call
  `Trellis.Bindings.Get` from application code
- service code MUST NOT construct `TrellisService`, `StoreHandle`, or resource
  handles directly, and MUST NOT pass resolved binding or resource data into
  `Trellis` constructors
- service shutdown handlers SHOULD release runtime resources, remove registered
  signal listeners, and let successful shutdown terminate naturally so
  `deno run --watch` can restart the program instead of exiting the watcher
- failed or timed-out shutdown paths MAY call `Deno.exit(1)` after logging the
  failure
- if a service also owns an HTTP listener, its shutdown path SHOULD bound the
  wait for listener drain before exiting rather than waiting indefinitely on
  long-lived keep-alive or streaming connections

### Application dependency binding

Services MAY bind application-owned dependencies once with `service.with(deps)`
and register handlers through the returned wrapper:

```ts
const app = service.with({ db, logger });

await app.handle.rpc.entity.list(async ({ input, context, client, deps }) => {
  deps.logger.info({ caller: context.caller }, "listing entities");
  return Result.ok(await listEntities(deps.db, input));
});
```

Bound dependencies are passed as `args.deps` in service-owned handler contexts,
including RPC, feed, operation, job, event listener, and health check/info
handlers. Trellis runtime context remains separate from application
dependencies: do not merge app dependencies into `context`, and do not pass
dependency bags as handler registration options.

Rules:

- `service.with(deps)` is optional; unbound service handler registration remains
  valid
- Trellis passes the dependency object through but does not own its lifecycle,
  clone it, initialize it, or dispose it
- multiple wrappers created from the same service keep independent dependency
  bindings
- the second and third arguments to registration methods remain surface-specific
  Trellis options such as event subject data and event listener options, not app
  dependency slots
- registration settings such as handler `timeoutMs`, registration-level
  cancellation, `onError`, middleware, or custom validation are deferred until
  the runtime has clear enforcement and interception semantics; do not expose
  fake settings that have no runtime behavior

### Service-local storage

Most services should keep durable domain storage behind their own service
boundary and expose behavior through contract-owned RPCs, operations, events,
and resource declarations. The Trellis control-plane service uses local SQLite
for its own durable runtime records.

Rules:

- service-local storage is an implementation detail unless the contract exposes
  a public API over it
- the Trellis control-plane SQLite database defaults to
  `/var/lib/trellis/trellis.sqlite` and is configurable as `storage.dbPath`
- Trellis service bootstrap owns opening the database, creating the schema, and
  constructing concrete storage modules
- prefer concrete storage modules for the service's actual record types rather
  than generic repository abstractions
- app-generated ULID row primary keys are used for SQL table identity; public
  and domain identifiers remain separate columns
- when a service uses an outbox to couple event publication to local durable
  state, commit the local state and outbox row in the same transaction, then
  signal any process-local dispatcher only after the transaction commits
- outbox dispatcher wakeups should be debounced and single-flight, but they are
  not the source of durability; services should retain explicit dispatch or
  recovery scans for missed signals and restarts

### Minimal installable service example

```ts
import { defineServiceContract, Result } from "@qlever-llc/trellis";
import type { RpcArgs, RpcResult } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
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

type Args = RpcArgs<typeof serviceContract, "Echo.Health">;
type Return = RpcResult<typeof serviceContract, "Echo.Health">;

const service = await TrellisService.connect({
  trellisUrl,
  contract: serviceContract,
  name: "echo",
  sessionKeySeed,
  server: {},
});

export async function health({ client }: Args): Promise<Return> {
  return Result.ok({
    status: "healthy",
    service: "echo",
    timestamp: new Date().toISOString(),
    checks: [],
  });
}

await service.handle.rpc.echo.health(health);
```

Rules:

- a minimal installable service should own at least one public surface such as
  an RPC, operation, or event rather than existing only to call other services
- installable service code uses `TrellisService.connect(...)` and mounts only
  names from its owned contract surface
- service resource handles come from the connected runtime; do not call
  `Trellis.Bindings.Get` or manually construct service, KV, store, or jobs
  handles in service-author code
- the optional `server` block configures service-runtime concerns such as
  logging, default request timeout, event-consumer stream selection,
  no-responder retry behavior, and extra health checks
- `server.log` defaults to the package server logger; set it to `false` to
  disable runtime logging or provide a pino-compatible logger to use your own
- service runtime NATS lifecycle logging is explicit rather than generic;
  disconnect, reconnect attempts, reconnect success, stale connections, and
  connection errors should each log a distinct message so operators can tell
  whether the service is recovering or stuck
- when the connected contract uses the shared `Health.Heartbeat` event,
  `TrellisService.connect(...)` publishes baseline heartbeats automatically and
  service code may enrich them through `service.health.setInfo(...)` and
  `service.health.add(...)`
- health heartbeats refresh freshness and operator-visible status only for the
  already accepted matching implementation offer; they must not create offers or
  change the offered digest
- graceful `service.stop()` marks the accepted offer stale for the same short
  grace window used after unplanned disconnects
- mounted RPC handlers should rely on Trellis-provided payload typing and
  validation rather than re-parsing the mounted payload just to recover types
- extracted service RPC handler aliases should come from
  `@qlever-llc/trellis/service` so handlers use the canonical object argument
  shape and receive the narrow injected `trellis` service runtime facade rather
  than the full `TrellisService`
- mounted RPC handlers may be synchronous when they do not need `await`
- mounted RPC handlers may return declared local `TrellisError` subclasses
  directly when those errors are listed in the contract RPC `errors: [...]`
- service-local transportable RPC errors should be declared in the contract's
  top-level `errors` map through `defineError(...)` generated classes rather
  than by overloading shared built-in errors for domain-specific failures
- if the service later needs remote APIs, add SDK `use(...)` helper results
  under `uses.required` or `uses.optional`; aliases directly under `uses` are
  invalid, and services must not hand-write remote contract ids or raw method
  strings
- if the service needs durable event processing, declare an explicit
  `eventConsumers` group. Use `eventConsumers.<group>.uses` to select subscribed
  dependency events by top-level `uses.required` or `uses.optional` alias, and
  use `eventConsumers.<group>.self` to select events owned by the same contract.
  A bare `uses.events.subscribe` grant authorizes live/ephemeral listening only;
  it does not create a durable cursor, but dependency durable consumption
  remains authority-backed by the top-level `uses` declaration.

Behavior:

- `TrellisService.connect(...)` performs bootstrap, auth handshake, contract
  verification, runtime connection setup, and eager binding resolution
- if Trellis does not know the requested digest, service bootstrap asks the
  runtime for the full manifest; the runtime retries with the canonical contract
  emitted by `defineServiceContract(...)` or the generated SDK module
- service bootstrap validates and analyzes the presented manifest as a contract
  proposal; invalid manifests fail immediately, while unknown required `uses`
  dependencies produce targeted dependency blockers unless deployment authority
  supplies an accepted dependency shape. Bootstrap does not derive authority
  from historical manifests.
- optional `uses` dependencies that are missing or whose requested surfaces are
  missing do not fail bootstrap planning and do not grant runtime authority;
  when they later resolve as active, they require an authority update or
  authority migration before a fresh reconnect receives that authority
- Trellis derives requested needs from the contract proposal and compares them
  to deployment authority desired state
- if desired authority is missing, bootstrap records an authority update or
  authority migration proposal for the delta and asks the service runtime to
  wait and retry until an admin accepts or rejects the proposal
- service-originated pending authority proposals are durable and deduplicated by
  the requested boundary so repeated starts with the same missing boundary
  coalesce into one pending authority update or migration
- if the service presents a different digest for the same `contractId` as the
  deployment's latest accepted digest or offer, Trellis validates same-lineage
  compatibility. Incompatible replacement is an authority migration. In `strict`
  mode, bootstrap records a pending migration plan and asks the service runtime
  to wait and retry until an admin accepts or rejects it. In `mutable-dev` mode,
  Trellis records and auto-accepts the same migration plan for unreleased
  iteration, then continues through normal desired-state and materialization
  checks.
- compatibility mode controls whether an incompatible same-contract migration
  requires manual approval or is auto-approved for development; it does not make
  contract history an authority source
- once deployment authority desired state covers the requested needs, bootstrap
  verifies that required `uses` dependencies resolve against effective active
  contracts or accepted dependency shapes. If a required dependency has neither,
  bootstrap returns a dependency-not-active blocker and the runtime waits and
  retries.
- if desired authority exists but materialization is incomplete, bootstrap
  returns reconciliation pending and the runtime waits and retries; bootstrap
  never provisions resources
- if a service presents a contract that no longer fits enabled deployment
  authority, bootstrap returns `contract_changed` rather than refreshing an old
  offer or issuing credentials for stale authority
- after the dependency closure is active or accepted and all required
  materialized resource bindings are present, bootstrap accepts or refreshes the
  implementation offer, persists instance runtime state, and returns transport
  and binding details to the service runtime
- all declared `resources.kv`, `resources.store`, top-level `jobs`, and
  top-level `eventConsumers` bindings are materialized authority resources. A
  service must not become ready with a silently skipped declared resource;
  `required: false` only makes the generated service handle optional.
- schema-backed KV handles such as `service.kv.<alias>` resolve during bootstrap
  as direct typed stores, while store handles such as `service.store.<alias>`
  are opened explicitly before use
- transfer-capable operations receive runtime-owned transfer contexts while
  service code continues to access staged files through `service.store.*`
- when a contract declares top-level `jobs`, `TrellisService.connect(...)`
  resolves a typed `service.jobs` facade for job creation, handler registration,
  and worker startup
- when a contract declares `eventConsumers`, `TrellisService.connect(...)`
  receives the reconciled event-consumer bindings during bootstrap. Register
  listeners during startup through
  `service.event.<group>.<leaf>.listen(..., { group })`; handler-injected
  clients are outbound-only and cannot register long-lived listeners. Service
  code must not choose or create a JetStream `durableName` for contract event
  processing; runtime durable consumers are Trellis-provisioned only.
- grouped durable event consumers start only after every event in the group has
  a registered handler, preserving the contract-declared group as the unit of
  ordering and replay.
- the shared jobs streams are Trellis-owned infrastructure; reconciliation
  creates or adopts all declared job bindings before jobs-enabled services
  become ready. Bootstrap resolves those materialized bindings. Jobs admin
  projections are internal to the Jobs admin runtime.
- the latest presented contract is not the ongoing source of truth for already
  accepted resources; deployment authority owns desired state until an authority
  update or authority migration changes it
- when an RPC needs to start caller-visible follow-up work after a transfer,
  prefer a transfer-capable operation over an RPC-started workflow
- the `trellis` control-plane service is the one bootstrap exception and may use
  Trellis-internal bootstrap paths; that exception is not part of the public
  service-author surface

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
  returning `JobRef`, synchronous handler registration through
  `service.jobs.<queue>.handle(...)`, and service-owned worker lifecycle through
  `service.wait()` / `service.stop()`
- public APIs must not expose weak raw wire types except in explicit
  raw/debug/admin surfaces
- public service APIs should hang off connected runtime objects such as
  `service.jobs`, `service.operation.<group>.<leaf>`, and
  `service.handle.operation.<group>.<leaf>`

### Files and transfer

Services should treat `Files` as the public interface to service-owned `store`
resources.

Behavior:

- metadata and control actions such as list/head/delete remain ordinary
  contract-owned RPCs
- byte transfer belongs on transfer-capable operations rather than separate
  initiation RPCs
- raw byte movement is executed through Trellis runtime helpers rather than
  hand-written service-specific chunk protocols
- service code uses `service.store.<alias>` plus operation transfer contexts to
  back those public file APIs

Example:

```ts
const op = await billing.operation.billing.refund.start(input);
const done = await op.wait();

const job = await service.jobs.refundCharge.create({
  operationId: op.id,
  ...payload,
});
return op.defer();
```

The job handler resumes the caller-visible operation through the
operation-scoped service control helper. It must not reach into private runtime
fields.

```ts
service.jobs.refundCharge.handle(async ({ job }) => {
  const op = await service.handle.operation.billing.refund
    .control(job.payload.operationId)
    .orThrow();

  await op.progress({ step: "capturing", message: "Capturing refund" })
    .orThrow();
  await op.complete({ refundId: "rf_123" }).orThrow();

  return Result.ok({ completed: true });
});
```
