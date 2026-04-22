# Trellis Service Source Package

Server-side helpers for Trellis services.

- `@qlever-llc/trellis/service` — shared service core, types, and service helpers
- `@qlever-llc/trellis/service/node` — Node service adapter
- `@qlever-llc/trellis/service/deno` — Deno service adapter

Use the runtime-specific subpath when connecting a service.

Connected services keep `mount(...)` typed from `contract.API.owned`, while outbound calls stay typed from `contract.API.trellis`. Prefer `service.request(...)` when you want the raw `Result`, and use `await service.request(...).orThrow()` as the throw-on-error outlet when that fits the caller.
