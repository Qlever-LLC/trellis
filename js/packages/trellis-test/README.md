# @qlever-llc/trellis-test

Deno-first integration test helpers for Trellis service repositories.

```ts
import { TrellisService } from "@qlever-llc/trellis/service";
import {
  assertEventCaptured,
  TrellisTestRuntime,
} from "@qlever-llc/trellis-test";

await using runtime = await TrellisTestRuntime.start({
  trellis: {
    command: {
      cmd: Deno.execPath(),
      args: ["run", "-A", "/path/to/cosmic-cactus/js/services/trellis/main.ts"],
    },
  },
});

const serviceKey = await runtime.registerService({
  name: "entity",
  contract: entityContract,
});

const service = await TrellisService.connect({
  trellisUrl: runtime.trellisUrl,
  contract: entityContract,
  name: "entity",
  sessionKeySeed: serviceKey.seed,
  telemetry: false,
}).orThrow();
```

App/client participants can connect through the same generated contract surfaces
used by service repositories:

```ts
const client = await runtime.connectClient({
  name: "entity-test-client",
  contract: entityClientContract,
});
```

Live event assertions should use generated event surfaces and
`runtime.captureEvents(...)`. Start the capture before publishing the event:

```ts
await using capture = await runtime.captureEvents({
  name: "entity-event-capture",
  contract: entityContract,
  events: ["Entity.Changed", "Entity.Indexed", "Entity.Failed"],
});

await client.event.entity.changed.publish({
  id: "entity-1",
  value: "updated",
}).orThrow();

const changed = await assertEventCaptured(
  capture,
  "Entity.Changed",
  (record) => record.payload.id === "entity-1",
);

assertEquals(changed.payload.value, "updated");
console.log(changed.event, changed.context.id, changed.receivedAt);
```

The package also includes generic assertions for multi-event expectations,
negative event checks, terminal jobs and operations, and `Result`-style RPC
values:

```ts
import {
  assertEventsCaptured,
  assertJobCompleted,
  assertNoEventCaptured,
  assertOperationCompleted,
  assertRpcEventuallyOk,
  assertRpcOk,
} from "@qlever-llc/trellis-test";

await assertEventsCaptured(capture, [
  {
    event: "Entity.Changed",
    predicate: (record) => record.payload.id === "entity-1",
  },
  "Entity.Indexed",
]);

await assertNoEventCaptured(capture, "Entity.Failed");

const rpcValue = await assertRpcOk(client.rpc.entity.get({ id: "entity-1" }), {
  id: "entity-1",
});

const projected = await assertRpcEventuallyOk(
  runtime,
  () => client.rpc.entity.get({ id: "entity-1" }),
  { id: "entity-1", indexed: true },
);

const jobRef = await service.jobs.entitySync.create({ id: rpcValue.id })
  .orThrow();
const job = await assertJobCompleted(jobRef, {
  synced: true,
});

const operation = await client.operation.entity.rebuild.start({
  id: rpcValue.id,
})
  .orThrow();
await assertOperationCompleted(operation, {
  indexed: true,
});
console.log(projected.id, job.id);
```

For lower-level `TrellisClient.connect(...)` tests, create client key material
and spread the returned auth continuation options:

```ts
const key = await runtime.registerClient({
  name: "entity-test-client",
  contract: entityClientContract,
});

const clientAuth = runtime.clientAuth(key);
const client = await TrellisClient.connect({
  trellisUrl: runtime.trellisUrl,
  name: "entity-test-client",
  contract: entityClientContract,
  ...clientAuth,
}).orThrow();
```

Authority automation accepts update plans by default. Isolated mutable-dev tests
that intentionally exercise safe migration plans can opt in globally or per
approval:

```ts
await using runtime = await TrellisTestRuntime.start({
  trellis: { command: trellisCommand },
  authority: { autoAccept: ["update", "migration"] },
});

const approval = await runtime.contracts.approve({
  contract,
  allowPlanClassifications: ["update", "migration"],
});
console.log(approval.classification);
```

The runtime starts an isolated NATS/JetStream container with generated Trellis
accounts, credentials, auth-callout config, a fresh SQLite database, and a real
Trellis control-plane process. Tests must provide `trellis.command` explicitly.

Tests should connect services and clients through the normal public Trellis
APIs.

For example, point `trellis.command` at a local Trellis checkout or modified
control-plane service:

```ts
await using runtime = await TrellisTestRuntime.start({
  trellis: {
    command: {
      cmd: Deno.execPath(),
      args: [
        "run",
        "-A",
        "/path/to/cosmic-cactus/js/services/trellis/main.ts",
      ],
    },
  },
});
```

The public API intentionally does not accept an existing NATS URL. Use this
package when a test needs an isolated integration environment rather than a
shared development runtime.
