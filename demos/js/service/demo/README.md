# Demo Service

A simple demo Trellis service that exercies some of Trellis's features as Trellis testing tool.

When installed with the generated contract, the demo service also publishes
baseline `Health.Heartbeat` events automatically so it shows up in the console's
live health screen.

## Run

```sh
deno task -c demos/js/service/demo/deno.json start -- http://localhost:3000 <session-key-seed>
```
