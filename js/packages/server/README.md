# @qlever-llc/trellis-server

Server-side helpers for Trellis services.

- `@qlever-llc/trellis-server` — shared server core, types, and health helpers
- `@qlever-llc/trellis-server/node` — Node runtime adapter
- `@qlever-llc/trellis-server/deno` — Deno runtime adapter

Use the runtime-specific subpath when connecting a service.

Connected services keep `mount(...)` typed from `contract.API.owned`, while outbound calls stay typed from `contract.API.trellis`. Use `service.requestOrThrow(...)` for the common throw-on-error path, or `service.trellis.request(...)` when you need the raw `Result`.
