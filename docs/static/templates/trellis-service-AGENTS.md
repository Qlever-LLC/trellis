# AGENTS.md

This repository contains an out-of-tree Trellis service. Follow these local
rules before making changes.

## Trellis AI references

- Short Trellis AI guide:
  https://raw.githubusercontent.com/qlever-llc/trellis/main/docs/static/llms.txt
- Full Trellis AI guide:
  https://raw.githubusercontent.com/qlever-llc/trellis/main/docs/static/llms-full.txt

Read the short guide at the start of any Trellis task. Read the full guide
before changing contracts, service handlers, events, operations, generated SDKs,
or outbox/inbox code.

## Local project rules

- Keep changes minimal and scoped to the requested service behavior.
- Do not edit generated files by hand. Change the source contract and run the
  documented generation command instead.
- Use generated Trellis APIs instead of hand-built subjects, envelopes, or JSON
  wire payloads.
- Use operations for caller-visible async workflows. Use jobs for
  service-private background execution.
- Prefer idempotent event handlers. Add inbox tracking only for non-idempotent
  side effects.
- Use prepared events plus an outbox when an event enqueue must commit
  atomically with service-local durable state.
- Do not add compatibility shims or migrations unless the task asks for them or
  existing deployed data requires them.

## TypeScript local rules

- Prefer generated `client.rpc`, `client.event`, `client.feed`, and
  `client.operation` for outbound calls.
- Register handlers with `service.handle`.
- Register event listeners during startup with `service.event`, never inside
  handlers.
- Inside handlers, use the scoped `client` argument for outbound calls; event
  handlers can publish and prepare events but cannot listen.
- Use TypeBox for Trellis wire schemas and Zod for environment/config parsing.
- Run the repository's format, typecheck, test, and Trellis generation commands
  before reporting completion.

## Rust local rules

- Prefer generated descriptors and generated client/facade methods.
- Use descriptor APIs such as `trellis_client.publish::<Descriptor>(...)`,
  `trellis_client.subscribe::<Descriptor>()`, and
  `trellis_client.operation::<Operation>().start(...)`.
- Register providers through generated `service.handle()` facades where
  available.
- Run `cargo fmt`, `cargo clippy`, `cargo test`, and the repository's Trellis
  generation command before reporting completion.

## Fill in for this repository

- Contract source:
- Generated SDK/artifact command:
- Format command:
- Typecheck or clippy command:
- Test command:
- Local run command:
- Database migration command:
