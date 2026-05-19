# Testing And Release Plan

This document is the canonical Trellis testing and release checklist for humans
and agents. `design/` remains architecture and protocol documentation; this file
owns repository operating practice.

## Feature Testing Policy

Every feature, bug fix, or refactor must explicitly ask whether it needs
integration coverage.

Default to adding or updating integration tests when a change affects:

- public Trellis HTTP or RPC APIs
- NATS subjects, auth-callout, proofs, or transport permissions
- contracts, generated SDKs, manifests, or permission derivation
- service bootstrap, device activation, app identity-envelope approval, or
  deployment-envelope approval
- jobs, operations, events, feeds, state, resources, or transfer behavior
- Rust/TypeScript cross-runtime behavior

Unit tests are still appropriate for parser, schema, error, and small pure logic
cases. They do not replace integration coverage for externally visible runtime
behavior.

Before committing or ending an implementation cycle, run the focused checks that
match the files touched. If runtime or public behavior changed, also run the
full integration harness:

```bash
rtk cargo run --manifest-path xtask/Cargo.toml -- integration --skip-prepare --keep-workdir
```

If the full harness cannot be run, record the reason and the last focused checks
that did run.

## Release Policy

Release commits should be boring and mechanical. Before creating a release
commit:

1. Identify the previous release tag.
2. Review changes since that tag.
3. Verify `CHANGELOG.md` has a section for the release version.
4. Check that the changelog covers user-visible changes without becoming a raw
   commit dump.
5. Bump all release-managed Trellis versions together.
6. Run the full release verification set.

The changelog should emphasize utility for readers: new capabilities, changed
behavior, migration concerns, fixed user-visible bugs, and notable operational
or compatibility details. Avoid listing every internal helper, test fixture, or
mechanical refactor unless it affects users or operators.

## Version Policy

For now, all release-managed Trellis packages and crates use one version.
Version every release-managed package even if that package had no direct source
change in the release.

Use Rust xtask release tooling as the canonical version workflow:

```bash
rtk cargo run --manifest-path xtask/Cargo.toml -- release check-versions
rtk cargo run --manifest-path xtask/Cargo.toml -- release prepare --tag v0.9.0-rc.1
rtk cargo run --manifest-path xtask/Cargo.toml -- release bump --from 0.8.2 --to 0.9.0
rtk cargo run --manifest-path xtask/Cargo.toml -- release check-versions
```

`release bump` updates release-managed JS/Deno manifests and Rust Cargo
manifests while preserving file layout. App and demo manifests that
intentionally use `0.0.0` are skipped.

GitHub release workflows run the same Rust `release prepare`, `release verify`,
and `release write-notes` commands. Tag-specific build-version rewriting uses
`release prepare`; release notes are extracted from `CHANGELOG.md` by
`release write-notes`.

## Changelog Checks

Use the release tooling to check the release section and print files changed
since the previous tag for human review:

```bash
rtk cargo run --manifest-path xtask/Cargo.toml -- release changelog-check --version 0.9.0 --since v0.8.2
```

This command verifies that `CHANGELOG.md` has a non-empty release section and
prints the changed files since the supplied tag. Humans still own deciding
whether the changelog is complete and readable.

## Release Verification

Before the release commit, run at least:

```bash
rtk cargo run --manifest-path xtask/Cargo.toml -- release verify --version 0.9.0 --since v0.8.2
rtk deno fmt -c js/deno.json --check
rtk deno check -c js/deno.json js/packages/trellis/index.ts js/packages/trellis-svelte/src/index.ts js/packages/trellis-svelte/src/context.svelte.ts js/services/trellis/main.ts
rtk deno test -c js/deno.json -A
rtk cargo fmt --manifest-path rust/Cargo.toml --check
rtk cargo test --manifest-path rust/Cargo.toml --workspace
rtk cargo run --manifest-path xtask/Cargo.toml -- integration --skip-prepare --keep-workdir
```

Also run generated-artifact preparation when contracts, generated SDKs, runtime
surfaces, or release packaging can be affected:

```bash
rtk cargo run --manifest-path xtask/Cargo.toml -- prepare
rtk cargo run --manifest-path rust/xtask/Cargo.toml -- prepare
```

If a release has packaging changes, add the relevant npm/package smoke checks
and CLI release checks before committing.
