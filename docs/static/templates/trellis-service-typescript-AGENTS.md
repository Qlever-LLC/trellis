# AGENTS.md

This repository contains JavaScript or TypeScript apps or services built on
Trellis. Use Trellis APIs, generated SDKs, and contracts; do not work around
Trellis by hand-building NATS subjects, envelopes, or JSON wire payloads.

## Start Here

- Use the Trellis source that matches this checkout's Trellis dependency.
- If Trellis dependencies are linked locally, first resolve the Trellis git
  root: `git -C <linked-package-path> rev-parse --show-toplevel`.
- Read Trellis AI guides relative to that git root, not relative to the linked
  package directory: `<trellis-repo-root>/docs/static/llms.txt`,
  `<trellis-repo-root>/docs/static/llms-full.txt`, and
  `<trellis-repo-root>/docs/static/llms-typescript.txt`.
- If no local Trellis path is linked, read the same files from the matching
  Trellis release branch, where `<release-tag>` is the Trellis version tag such
  as `v0.11.0-rc.2`:
  `https://raw.githubusercontent.com/Qlever-LLC/trellis/refs/heads/release/<release-tag>/docs/static/llms.txt`,
  `https://raw.githubusercontent.com/Qlever-LLC/trellis/refs/heads/release/<release-tag>/docs/static/llms-full.txt`,
  and
  `https://raw.githubusercontent.com/Qlever-LLC/trellis/refs/heads/release/<release-tag>/docs/static/llms-typescript.txt`.
- Read the short guide for every Trellis task. Read the full and TypeScript
  guides before changing contracts, service handlers, events, operations,
  generated SDKs, outbox/inbox code, or browser app wiring.
- Do not read the whole Trellis `design/` tree by default. Start with the
  smallest relevant doc set.

## Repo-Wide Rules

- Keep changes minimal and aligned with the existing architecture.
- This repo owns domain services, apps, and domain models. Trellis runtime,
  protocol, SDK generation, and Trellis-owned contracts belong in Trellis.
- If a Trellis API cannot support the task, stop and explain the gap instead of
  bypassing Trellis with custom transport code.
- Before adding compatibility shims, aliases, dual-read/write paths, or
  migrations, ask whether compatibility is wanted unless deployed data requires
  it.
- Services communicate through Trellis contract surfaces. Use RPCs, operations,
  events, feeds, state, files, jobs, KV, and store handles instead of direct
  cross-service storage or raw transport access.
- Do not edit generated files by hand. Change the source contract or schema and
  run the documented generation command.
- Use operations for caller-visible async workflows. Use jobs for
  service-private background execution.
- Prefer idempotent event handlers. Add inbox tracking only for non-idempotent
  side effects.
- Use prepared events plus an outbox when event enqueue must commit atomically
  with service-local durable state.
- Expected public or RPC failures should use declared errors or `Result`-style
  values rather than thrown exceptions.
- Keep types honest: no `@ts-nocheck`, no `as any`, and no `as unknown as`.

## TypeScript Rules

- Prefer generated `client.rpc`, `client.event`, `client.feed`,
  `client.operation`, `client.state`, and transfer helpers.
- Service code must bootstrap with `TrellisService.connect(...)`; do not fetch
  bindings manually, construct resource handles, or import low-level runtime
  internals for service startup.
- Contract files should default-export the result of the matching
  `defineServiceContract(...)`, `defineAppContract(...)`,
  `defineAgentContract(...)`, or `defineDeviceContract(...)` helper.
- Import normal contract helpers from `@qlever-llc/trellis`. Use explicit
  subpaths only for runtime-specific helpers, generated SDKs, browser auth,
  device activation, telemetry, or advanced contract tooling.
- Register RPC, feed, operation, job, event, and health handlers during startup.
- Register service handlers with `service.handle`. Register event listeners with
  `service.event`, not inside handlers.
- Use `service.with(deps)` once during startup when handlers need app-owned
  dependencies, and read them from `args.deps`.
- Inside handlers, use the scoped `client` argument for outbound calls.
- Use TypeBox for Trellis RPC, event, operation, feed, state, and resource wire
  schemas. Use Zod for environment, config, files, and other runtime inputs.
- Public request schemas should tolerate unknown extra fields unless rejecting
  them is required for security or correctness.
- Use Trellis pagination helpers instead of bespoke list response shapes.

## Frontend Rules

- For Svelte or SvelteKit apps, identify the nearest directory with
  `svelte.config.*` before running commands.
- Read the Trellis Svelte guide before wiring `createTrellisApp`,
  `TrellisProvider`, generated SDK aliases, Vite aliases, or `svelte-check` path
  maps.
- Use Trellis browser auth helpers for login and logout redirects. Do not
  hard-code IdP logout URLs or call `Auth.Sessions.Logout` from the active
  browser app connection for normal sign-out.

## Fill In For This Repository

- Contract source:
- Generated SDK/artifact command:
- Format command:
- Lint command:
- Typecheck/check command:
- Test command:
- Local run command:
- Database migration command:
- Frontend check/build command:
- Local Trellis checkout or release branch:
