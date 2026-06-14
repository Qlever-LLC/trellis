# @qlever-llc/trellis-test

Deno-first integration test helpers for Trellis service repositories.

```ts
import { TrellisService } from "@qlever-llc/trellis/service";
import { TrellisTestRuntime } from "@qlever-llc/trellis-test";

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
