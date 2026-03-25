# @trellis/server

Server-side helpers for Trellis services. The root package is runtime-neutral.

- `@trellis/server` — shared server core and runtime adapter types
- `@trellis/server/deno` — Deno NATS transport adapter (workspace source tree)
- `@trellis/server/node` — Node adapter (npm-published)

Use the environment-specific entrypoint when connecting a service runtime.
