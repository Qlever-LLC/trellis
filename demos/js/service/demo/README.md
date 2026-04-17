# Demo Service

A demo Trellis service that exposes `Demo.Groups.List` and handles the
transfer-capable `Demo.Files.Upload` operation.

When installed with the generated contract, the demo service also publishes
baseline `Health.Heartbeat` events automatically so it shows up in the console's
live health screen.

## Setup

Before running the process, make sure the installed service contract matches the
current source and the service instance has refreshed bindings:

```sh
trellis service upgrade --service-key <service-key> --source ../demos/js/service/demo/contracts/demo_service.ts
```

If you changed service-owned resource declarations, restart Trellis before
starting the service so bootstrap recomputes the current resource bindings.

## Run

```sh
deno task -c demos/js/service/demo/deno.json start -- http://localhost:3000 <session-key-seed>
```

The demo service stages transferred bytes in `service.store.uploads`, emits
per-chunk transfer updates on the operation watch stream, and writes the staged
object to `/tmp` directly from the operation handler.
