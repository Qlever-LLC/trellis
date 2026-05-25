# Trellis

Trellis is a contract-driven platform for building distributed services over
NATS JetStream. Contract definitions live with the code that owns them. Build
and release tooling derives canonical JSON artifacts, SDKs, authorization
scopes, and runtime wiring from those contract sources.

## Repository layout

```
conformance/    Shared JS/Rust test vectors (canonical JSON, auth proofs)
demos/          Shared demo app plus TypeScript and Rust service/device examples
docs/           Trellis documentation site (SvelteKit static site, published to GitHub Pages)
js/             TypeScript packages, services, and apps (Deno workspace)
rust/           Rust crates (public facades plus internal CLI, codegen, and runtime support)
generated/      Derived manifests and SDKs when generated locally (usually absent from a clean checkout)
deploy/         Deployment assets, including quadlets and NATS templates
design/         Trellis design docs
```

See `/guides/write-a-service/contract-artifacts` for regeneration details. See
`/guides/releasing-trellis` for repository testing, versioning, and release
checklists.

## Key concepts

- **Contracts** - service-owned contract definitions that emit canonical
  `trellis.contract.v1` JSON for release and exchange boundaries. See
  `design/contracts/trellis-contracts-catalog.md`.
- **Auth** - two-layer model: NATS transport auth plus Trellis session-key
  proofs with contract-gated approval. See `design/auth/trellis-auth.md`.
- **Jobs** - JetStream-backed job lifecycle with retry, progress tracking, and
  dead-letter handling. See `design/jobs/trellis-jobs.md`.
- **Operations** - caller-visible asynchronous workflows with durable state and
  watch semantics. See `design/operations/trellis-operations.md`.
- **CLI** - public `trellis` operator/runtime CLI plus a bootstrap-safe
  `trellis-generate` companion used by repo-local prepare and generation
  workflows. See `design/tooling/trellis-cli.md`.
- **Patterns** - top-level architecture boundaries and communication patterns.
  See `design/core/trellis-patterns.md`.

## Getting started

See the [Trellis docs](docs/) to get started.

Trellis service deployments need persistent writable storage at
`/var/lib/trellis` by default. The control-plane SQLite database defaults to
`/var/lib/trellis/trellis.sqlite` and can be moved with `storage.dbPath` in the
Trellis service config.

Trellis requires `nats-server` 2.10.0 or newer. Jobs rely on JetStream source
subject transforms and the filtered consumer create API permission model. Set
`nats.jetstream.replicas` in the Trellis service config to match the NATS
topology: `1` for standalone/local installs and typically `3` for production
clusters.

Current TypeScript runtime entrypoints:

- `TrellisClient.connect(...)` for browser and client runtimes
- `TrellisService.connect(...)` for services
- `TrellisDevice.connect(...)` for activated devices

For repository development workflows, prefer the repo-local prepare entrypoints:

- `cd js && deno task prepare`
- `cd js && deno task prepare:watch`
- `cargo xtask prepare`
- `cargo xtask prepare-watch`
- `cargo xtask build`
- `cargo xtask release check-versions`
- `cargo xtask release prepare --tag v0.9.0-rc.1`

Normal operators only need `trellis`; repo generation flows stay behind those
local tasks and wrappers.

If you build or install Rust binaries from this repo directly, run
`cargo xtask prepare` first so the generated Rust SDK crates under
`generated/packages/cargo/` exist. `cargo xtask build` is the convenient
Rust-side wrapper for `prepare` followed by the default Rust workspace build.
The default build excludes the live integration harness; run
`cargo xtask integration run` when you need that coverage. Use
`cargo xtask prepare-watch` during active contract development. Watch mode
watches broadly, ignores file changes that are not TypeScript, JavaScript, or
Rust source unless they are recognized project/discovery inputs, prepares only
affected contract entries when safe, falls back to full prepare for project
manifests and discovery-shape changes, and asks you to restart the watcher after
generator/tooling changes.

## Design documents

The Trellis design docs live in [design/](design/). Start with
`design/README.md` for the topic index.
