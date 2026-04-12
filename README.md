# Trellis

Trellis is a contract-driven platform for building distributed services over NATS JetStream. Contract definitions live with the code that owns them. Build and release tooling derives canonical JSON artifacts, SDKs, authorization scopes, and runtime wiring from those contract sources.

## Repository layout

```
conformance/    Shared JS/Rust test vectors (canonical JSON, auth proofs)
guides/         Trellis documentation site (SvelteKit static site, published to GitHub Pages)
js/             TypeScript packages, services, and apps (Deno workspace)
rust/           Rust crates (CLI, codegen, client/server, contract model)
generated/      Derived manifests and SDKs when generated locally (usually absent from a clean checkout)
docs/           Supporting docs, including generated artifact guidance
deploy/         Deployment assets, including quadlets and NATS templates
design/         Trellis design docs
```

See `docs/generated-artifacts.md` for regeneration details.

## Key concepts

- **Contracts** - service-owned contract definitions that emit canonical `trellis.contract.v1` JSON for release and exchange boundaries. See `design/contracts/trellis-contracts-catalog.md`.
- **Auth** - two-layer model: NATS transport auth plus Trellis session-key proofs with contract-gated approval. See `design/auth/trellis-auth.md`.
- **Jobs** - JetStream-backed job lifecycle with retry, progress tracking, and dead-letter handling. See `design/jobs/trellis-jobs.md`.
- **Operations** - caller-visible asynchronous workflows with durable state and watch semantics. See `design/operations/trellis-operations.md`.
- **CLI** - public `trellis` operator/runtime CLI plus a bootstrap-safe `trellis-generate` companion used by repo-local prepare and generation workflows. See `design/tooling/trellis-cli.md`.
- **Patterns** - top-level architecture boundaries and communication patterns. See `design/core/trellis-patterns.md`.

## Getting started

See the [Trellis guides](guides/) to get started.

Current TypeScript runtime entrypoints:

- `TrellisClient.connect(...)` for browser and client runtimes
- `TrellisService.connect(...)` for services
- `TrellisWorkload.connect(...)` for activated workloads

For repository development workflows, prefer the repo-local prepare entrypoints:

- `cd js && deno task prepare`
- `cargo xtask prepare`

Normal operators only need `trellis`; repo generation flows stay behind those local tasks and wrappers.

## Design documents

The Trellis design docs live in [design/](design/). Start with `design/README.md` for the topic index.
