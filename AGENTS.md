# AGENTS.md

## Start Here

- Use `design/README.md` to choose the smallest relevant design-doc set for the
  task.
- Do not load the entire `design/` tree by default.
- Treat `design/` as architecture/protocol/invariant documentation, not as the
  TypeScript or Rust API reference. Public TS APIs should be documented with
  JSDoc for generated docs, and public Rust APIs should be documented with
  Rustdoc.
- Use the `guides` site `/api` surface to discover generated TypeScript docs and
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
- When changes affect contracts, generated SDKs, or runtime surfaces that depend
  on generated artifacts, run `cd js && deno task prepare` and
  `cd rust && cargo xtask prepare` as part of verification.
- If changes make design/** or guides/** out of date with the implementation,
  then please propose changes to those documents and ask before applying them.
  This way we can catch accidental design drift.

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
- Frontend conventions: `design/core/frontend-svelte-patterns.md`
