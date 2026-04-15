# Trellis Host Source Package

Server-side helpers for Trellis services.

- `@qlever-llc/trellis/host` — shared host core, types, and service helpers
- `@qlever-llc/trellis/host/node` — Node host adapter
- `@qlever-llc/trellis/host/deno` — Deno host adapter

Use the runtime-specific subpath when connecting a service.

Connected services keep `mount(...)` typed from `contract.API.owned`, while outbound calls stay typed from `contract.API.trellis`. Use `service.requestOrThrow(...)` for the common throw-on-error path, or `service.trellis.request(...)` when you need the raw `Result`.
