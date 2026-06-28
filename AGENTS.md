# AGENTS.md

## Start Here

- Use `design/README.md` to choose the smallest relevant design-doc set for the
  task.
- Do not load the entire `design/` tree by default.
- Treat `design/` as architecture/protocol/invariant documentation, not as the
  TypeScript or Rust API reference. Public TS APIs should be documented with
  JSDoc for generated docs, and public Rust APIs should be documented with
  Rustdoc.
- Use the `docs` site `/api` surface to discover generated TypeScript docs and
  Rustdoc locations, but treat source as authoritative for exact current APIs.
  For TypeScript, verify exact public signatures against public entrypoints and
  their JSDoc. For Rust, verify exact APIs against Rustdoc generated from the
  current crate source, especially when a crate is listed as pending on `/api`.
- If design docs and source disagree, treat source as the current as-built
  behavior and design docs as intended behavior; call out the drift instead of
  silently relying on stale docs.
- When working in a Svelte project, identify the project root first by finding
  the nearest ancestor directory that contains `svelte.config.*`.
- If that Svelte project root contains a `DESIGN.md`, read it before making UI,
  layout, styling, or component-structure changes in that project, and treat it
  as the local design contract.

## Repo-Wide Engineering Rules

- Keep changes minimal and aligned with the existing architecture.
- Do not add small or narrowly scoped helper functions that are rarely called.
  Inline the logic until it is repeated enough to justify extraction.
- Before adding aliases, migration code, compatibility shims, or dual-read or
  dual-write behavior for a breaking change, ask whether a compatibility path is
  actually wanted. Prefer a clean break unless the user asks for compatibility
  or persisted data or shipped behavior requires it.
- Preserve the platform boundary from `design/core/trellis-patterns.md`: the
  Trellis platform repo owns runtime, protocol, tooling, and Trellis-owned
  contracts; cloud repos own domain services, apps, and domain models unless a
  Trellis-owned contract or shared runtime library needs them.
- Services communicate over NATS. Public cross-service surfaces should stay
  contract-owned and follow the subject and boundary rules in
  `design/core/trellis-patterns.md`.
- Service authors should treat resolved service resource bindings as Trellis
  runtime internals. Services must connect with `TrellisService.connect(...)`
  and use the returned `service.kv`, `service.store`, and `service.jobs`
  handles; do not import the core SDK for service bootstrap, call
  `Trellis.Bindings.Get`, construct `TrellisService` or `StoreHandle`, or pass
  binding/resource payloads into `Trellis` constructors.
- Use operations for caller-visible async workflows and jobs for service-private
  execution. See `design/core/service-development.md` and
  `design/operations/trellis-operations.md`.
- Follow the type-system rules in `design/core/type-system-patterns.md`: no
  `@ts-nocheck`, no `as any`, no `as unknown as`; prefer stronger honest public
  types over misleading compatibility.
- Use TypeBox for RPC, event, and operation wire schemas. Use Zod for
  environment and config parsing.
- Expected public or RPC failures should use `Result`-style modeling rather than
  thrown exceptions.
- Exported public functions, classes, and methods need JSDoc. See
  `design/core/observability-patterns.md`.
- Format files as part of the normal edit loop, before type checks and tests.
  For JS, TS, Svelte, JSON, Markdown, CSS, and SVG files, run
  `rtk deno fmt -c js/deno.json <changed files>`. For Rust files, run
  `rtk cargo fmt --manifest-path rust/Cargo.toml --package <crate>` when the
  crate is known, or `rustfmt --edition 2021 <changed .rs files>` for narrow
  file-scoped edits. If generated artifacts are affected, run prepare first and
  then verify generated Rust formatting with
  `rtk cargo fmt --manifest-path rust/Cargo.toml --all --check`. Do not
  bulk-format unrelated drift unless the user asks for that cleanup; report it
  separately.
- When changes affect contracts, generated SDKs, or runtime surfaces that depend
  on generated artifacts, run `cd js && deno task prepare` and
  `cd rust && cargo xtask prepare` as part of verification.
- Follow `docs/src/routes/guides/releasing-trellis/+page.svx` for testing and
  release practice and `design/core/testing-patterns.md` for test design.
  Trellis runtime-observable behavior belongs in live TypeScript and Rust
  integration tests, not fake NATS, fake Hono, fake storage, fake runtime, fake
  auth, or fake generated-client units. Unit tests should be rare and limited to
  pure parser/codec/crypto/schema/type/export/tooling/UI helper checks. When
  live coverage needs a hook, extend `trellis-test` with the smallest named
  helper rather than enriching a fake.
- Release work must keep release-managed Trellis versions consistent through the
  Rust xtask release commands, verify `CHANGELOG.md` against changes since the
  previous release, and run the release verification checklist before the
  release commit.
- If changes make design/** or docs/** out of date with the implementation, then
  please propose changes to those documents and ask before applying them. This
  way we can catch accidental design drift.
- Keep `docs/static/llms.txt`, `docs/static/llms-full.txt`,
  `docs/static/llms-typescript.txt`, and `docs/static/llms-rust.txt` current
  when Trellis features, service-author workflows, public TypeScript APIs,
  public Rust APIs, generated SDK behavior, contract authoring, runtime
  surfaces, operations, jobs, resources, state, files, events, or
  prepare/tooling workflows change. These files are user-facing guidance for
  service repos that consume Trellis; do not include Trellis-repo-only
  instructions unless the same command or rule is also the intended service-repo
  pattern.

## Frontend Rules

- For Svelte work, follow `design/core/frontend-svelte-patterns.md`.
- For nested Svelte apps in this repo, prefer project-local design guidance from
  the nearest Svelte-root `DESIGN.md` in addition to the shared frontend rules.
- Prefer Svelte 5 runes, private `#state`, public getters, and methods that own
  state mutation.

## Specialist Skills

- Use `rust-best-practices` before substantial Rust edits or Rust code review.
- Use `svelte-code-writer` and `svelte-core-bestpractices` for Svelte components
  or Svelte modules.
- Use `daisyui` when working in a project that uses daisyUI.

## Common Reading Paths

- Architecture and boundaries: `design/core/trellis-patterns.md`
- Type system and errors: `design/core/type-system-patterns.md`
- Service layout and jobs vs operations: `design/core/service-development.md`
- Auth architecture, protocol, and wire APIs: `design/auth/trellis-auth.md`,
  `design/auth/auth-protocol.md`, `design/auth/auth-api.md`
- Device activation: `design/auth/device-activation.md`
- Operations design: `design/operations/trellis-operations.md`
- Jobs design: `design/jobs/trellis-jobs.md`
- TypeScript contract authoring:
  `design/contracts/trellis-typescript-contract-authoring.md`
- Rust contract generation/facades:
  `design/contracts/trellis-rust-contract-libraries.md`
- Contract catalog, manifests, and permission derivation:
  `design/contracts/trellis-contracts-catalog.md`
- State semantics and migrations: `design/core/state-patterns.md`
- Observability, correlation, and JSDoc expectations:
  `design/core/observability-patterns.md`
- Testing policy and live integration parity: `design/core/testing-patterns.md`
- Frontend conventions: `design/core/frontend-svelte-patterns.md`
