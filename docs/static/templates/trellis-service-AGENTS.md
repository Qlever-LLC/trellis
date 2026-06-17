# AGENTS.md

This repository contains a Trellis service. Follow these local rules before
making changes. Prefer the TypeScript or Rust AGENTS template for
single-language repositories; use this combined template for mixed-language
repositories.

## Start Here

- Use the Trellis source that matches this checkout's Trellis dependency.
- If Trellis dependencies are linked locally, first resolve the Trellis git
  root: `git -C <linked-package-path> rev-parse --show-toplevel`.
- Read Trellis AI guides relative to that git root, not relative to the linked
  package directory: `<trellis-repo-root>/docs/static/llms.txt`,
  `<trellis-repo-root>/docs/static/llms-full.txt`, and the relevant
  language-specific guide under `<trellis-repo-root>/docs/static/`.
- If no local Trellis path is linked, read the same files from the matching
  Trellis release branch:
  `https://raw.githubusercontent.com/qlever-llc/trellis/<release-branch>/docs/static/llms.txt`,
  `https://raw.githubusercontent.com/qlever-llc/trellis/<release-branch>/docs/static/llms-full.txt`,
  and the matching `llms-typescript.txt` or `llms-rust.txt` guide.
- Read the short guide at the start of any Trellis task. Read the full guide
  before changing contracts, service handlers, events, operations, generated
  SDKs, or outbox/inbox code. Then read the language-specific guide for this
  repository.

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
- When upgrading the Trellis version, compare this repository's `AGENTS.md`
  against the new Trellis template for that version and propose any missing
  guidance updates before changing broad local agent rules.

## TypeScript local rules

- Prefer generated `client.rpc`, `client.event`, `client.feed`, and
  `client.operation` for outbound calls.
- Register handlers with `service.handle`.
- Trellis does not provide application dependency injection. Handler arguments
  contain only Trellis-owned runtime data. Use normal JavaScript closures or
  factory patterns for application-owned dependencies such as databases,
  loggers, clocks, or domain clients. After contract changes, run the
  repository's Trellis generation command before typing extracted handlers. Use
  generated SDK aliases such as `OrdersCreateHandler` for extracted handlers.
- Register event listeners during startup with `service.event`, never inside
  handlers.
- Inside handlers, use the scoped `client` argument for outbound calls; event
  handlers can publish and prepare events but cannot listen.
- Use TypeBox for Trellis wire schemas and Zod for environment/config parsing.
- Use Trellis pagination helpers instead of bespoke list shapes. Offset list
  RPCs should use `PageRequestSchema`, `PageResponseSchema(...)`,
  `normalizePageQuery(...)`, and `buildPageResponse(...)`. Stable ID/keyset
  pages should use `CursorQuerySchema`, `CursorPageSchema(...)`,
  `normalizeCursorQuery(...)`, and `buildCursorPage(...)`.
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
- Language-specific Trellis AI guide:
- Format command:
- Typecheck or clippy command:
- Test command:
- Local run command:
- Database migration command:
