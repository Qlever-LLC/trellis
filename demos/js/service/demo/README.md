# Demo Service

A demo Trellis service that exposes `Demo.Groups.List`, starts
`Demo.Files.Process`, and runs a jobs worker that processes uploaded files.

When installed with the generated contract, the demo service also publishes
baseline `Health.Heartbeat` events automatically so it shows up in the console's
live health screen.

## Setup

Before running the process, make sure the installed service contract matches the
current source and the service instance has refreshed bindings:

```sh
trellis service upgrade --service-key <service-key> --source ../demos/js/service/demo/contracts/demo_service.ts
```

If you changed jobs resources or other service-owned resource declarations,
restart Trellis before starting the service so bootstrap recomputes the current
resource bindings.

## Run

```sh
deno task -c demos/js/service/demo/deno.json start -- http://localhost:3000 <session-key-seed>
```

The demo's file-processing worker uses Trellis jobs. Under the built-in jobs
model, Trellis provisions the shared jobs infrastructure during service
bootstrap, so no separate jobs install step is required before starting the demo
service.

The demo worker expects both:

- `service.jobs`
- the synthetic `service.streams.jobsWork` binding resolved from
  `resources.jobs`

If startup fails with a missing `jobsWork` binding, restart Trellis and retry so
service bootstrap can refresh the installed resource bindings.
