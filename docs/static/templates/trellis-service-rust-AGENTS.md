# AGENTS.md

This repository contains Rust apps or services built on Trellis. Use Trellis
runtime facades, generated SDKs, descriptors, and contracts; do not work around
Trellis by hand-building NATS subjects, envelopes, or JSON wire payloads.

## Start Here

- Use the Trellis source that matches this checkout's Trellis dependency.
- If Trellis dependencies are linked locally, first resolve the Trellis git
  root: `git -C <linked-package-path> rev-parse --show-toplevel`.
- Read Trellis AI guides relative to that git root, not relative to the linked
  package directory: `<trellis-repo-root>/docs/static/llms.txt`,
  `<trellis-repo-root>/docs/static/llms-full.txt`, and
  `<trellis-repo-root>/docs/static/llms-rust.txt`.
- If no local Trellis path is linked, read the same files from the matching
  Trellis release branch:
  `https://raw.githubusercontent.com/qlever-llc/trellis/<release-branch>/docs/static/llms.txt`,
  `https://raw.githubusercontent.com/qlever-llc/trellis/<release-branch>/docs/static/llms-full.txt`,
  and
  `https://raw.githubusercontent.com/qlever-llc/trellis/<release-branch>/docs/static/llms-rust.txt`.
- Read the short guide for every Trellis task. Read the full and Rust guides
  before changing contracts, service handlers, events, operations, generated
  SDKs, or outbox/inbox code.
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
- When upgrading the Trellis version, compare this repository's `AGENTS.md`
  against the new Trellis template for that version and propose any missing
  guidance updates before changing broad local agent rules.
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
- Expected public or RPC failures should use declared errors or ordinary Rust
  `Result` values rather than panics.

## Rust Rules

- Prefer generated participant facades and generated SDK client methods when
  available.
- Use descriptor APIs such as `publish::<Descriptor>(...)`,
  `subscribe::<Descriptor>()`, and `operation::<Operation>().start(...)` when a
  generated facade is not available.
- Register service providers through generated `service.handle()` facades where
  available.
- Use public `trellis` runtime facades and `trellis-contracts` contract-model
  APIs. Do not depend on unpublished low-level runtime crates from application
  code.
- Do not extract or construct raw `async_nats::Client` handles for normal
  application communication.
- Direct descriptor publish is the default. Use prepared events only when event
  publication must be coupled to local durable state.
- Use SQL outbox/inbox stores when they must participate in a SQL transaction.
  Use NATS KV stores only when no unrelated database transaction must be atomic
  with the event record.
- Runtime durable event consumers are Trellis-provisioned from contract
  `eventConsumers`; do not create or name arbitrary JetStream durable consumers
  in service code.
- Keep public APIs documented with Rustdoc when they are meant for other crates.

## Fill In For This Repository

- Contract source:
- Generated SDK/artifact command:
- Format command:
- Clippy command:
- Test command:
- Local run command:
- Database migration command:
- Local Trellis checkout or release branch:
