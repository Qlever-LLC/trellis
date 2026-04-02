# Trellis

Trellis is a contract-driven platform for building distributed services over NATS JetStream. Contract definitions live with the code that owns them. Build and release tooling derives canonical JSON artifacts, SDKs, authorization scopes, and runtime wiring from those contract sources.

## Repository layout

```
conformance/    Shared JS/Rust test vectors (canonical JSON, auth proofs)
guides/         Trellis documentation site (SvelteKit static site, published to GitHub Pages)
js/             TypeScript packages, services, and apps (Deno workspace)
rust/           Rust crates (CLI, codegen, client/server, contract model)
generated/      Derived manifests and SDKs (ignored; regenerate with `trellis generate`)
docs/           Supporting docs, including generated artifact guidance
deploy/         Deployment assets, including quadlets and NATS templates
design/         Architecture decision records and design docs
```

See `docs/generated-artifacts.md` for regeneration details.

## Key concepts

- **Contracts** — service-owned contract definitions that emit canonical `trellis.contract.v1` JSON for release and exchange boundaries. See [ADR: Contracts & Catalog](design/adr-trellis-contracts-catalog.md).
- **Auth** — two-layer model: NATS nKey transport auth + Trellis Ed25519 session keys with contract-gated approval. See [ADR: Auth](design/adr-trellis-auth.md).
- **Jobs** — JetStream-backed job lifecycle with retry, progress tracking, and dead-letter handling. See [ADR: Jobs](design/adr-trellis-jobs.md).
- **CLI** — single Rust binary for contract builds, SDK generation, verification, and source/image-based service installation. See [ADR: CLI](design/adr-trellis-cli.md).
- **Patterns** — event-driven architecture with JetStream streams as source of truth and KV as derived projections. See [ADR: Patterns](design/adr-trellis-patterns.md).

## Getting started

See the [Trellis guides](guides/) to get started.

## Design documents

All architecture decisions live in [design/](design/).
