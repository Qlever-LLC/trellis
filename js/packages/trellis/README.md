# @qlever-llc/trellis

JavaScript Trellis client runtime. Provides contract-driven client helpers and
runtime error types.

For AI-agent context, start with the generated package `TRELLIS.md` files and
the raw docs index:

- https://raw.githubusercontent.com/qlever-llc/trellis/main/docs/static/llms.txt
- https://raw.githubusercontent.com/qlever-llc/trellis/main/docs/static/llms-full.txt

```typescript
import { defineAppContract, TrellisClient } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";

const app = defineAppContract(() => ({
  id: "example.app@v1",
  displayName: "Example App",
  description: "Example Trellis browser client.",
  uses: {
    required: {
      auth: auth.use({ rpc: { call: ["Auth.Sessions.Me"] } }),
    },
  },
}));

const client = await TrellisClient.connect({
  trellisUrl: "https://trellis.example.com",
  contract: app,
});
const meResult = await client.rpc.auth.sessionsMe({});
const me = meResult.orThrow();
```

Generated SDKs expose surface-first facades: `client.rpc.<group>.<leaf>(input)`,
`client.event.<group>.<leaf>.publish(event)`,
`client.event.<group>.<leaf>.prepare(event)`,
`client.feed.<group>.<leaf>(input)`, and
`client.operation.<group>.<leaf>.start(input)`. Avoid older stringly
`client.request` or `client.publish` examples for generated contract APIs.

Prepared events support durable publish flows. `prepare(...)` returns a
`PreparedTrellisEvent`; services can persist prepared events in SQL or NATS KV
outbox repositories and later publish them with `client.publishPrepared(...)`,
dispatch them with `dispatchOutbox`, or run an `OutboxDispatcher` and call
`notify()` after an outbox transaction commits.

Durable service event consumption is contract-declared. Add an `eventConsumers`
group to the service contract and call the generated listener with
`{ group: "groupName" }`. Do not pass `durableName`; Trellis provisions the
physical JetStream consumer and grants only the bound consumer subjects to the
service token. Use `{ mode: "ephemeral", replay: "new" }` for live-only
listeners.

Service connection helpers live in `@qlever-llc/trellis/service*` to keep the
root package browser-safe. Browser login and portal-flow helpers live on
`@qlever-llc/trellis/auth` and `@qlever-llc/trellis/auth/browser`.

Service authors should not use the core package to recreate service bootstrap or
fetch resource bindings. Connect with `TrellisService.connect(...)` from
`@qlever-llc/trellis/service/deno` or `@qlever-llc/trellis/service/node` and use
the returned resource handles instead of calling `Trellis.Bindings.Get`,
constructing `TrellisService` or `StoreHandle`, or passing binding/resource data
into `Trellis` constructors.
