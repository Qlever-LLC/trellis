# Trellis Service Source Package

Server-side helpers for Trellis services.

- `@qlever-llc/trellis/service` — shared service core, types, and service
  helpers
- `@qlever-llc/trellis/service/node` — Node service adapter
- `@qlever-llc/trellis/service/deno` — Deno service adapter

Use the runtime-specific subpath when connecting a service.

Connected services keep provider registration under `service.handle`, typed from
the owned contract surface. Outbound calls use generated active facades such as
`service.rpc.<group>.<leaf>(...)`, `service.event.<group>.<leaf>.publish(...)`,
and `service.operation.<group>.<leaf>.start(...)`.
