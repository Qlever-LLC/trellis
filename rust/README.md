# Rust

Rust crates for the Trellis platform.

**Crates in this repository:**

| Crate                         | Purpose                                                     |
| ----------------------------- | ----------------------------------------------------------- |
| `trellis-auth`                | Browser login and admin-session helpers for Rust clients    |
| `trellis-auth-adapters`       | Auth integration adapters shared by Trellis services        |
| `trellis-cli`                 | Operator CLI for auth, bootstrap, and service deployments   |
| `trellis-client`              | Rust client runtime                                         |
| `trellis-codegen-rust`        | Rust SDK code generation                                    |
| `trellis-codegen-ts`          | TypeScript SDK code generation                              |
| `trellis-contracts`           | Contract manifest model and validation                      |
| `trellis-core-bootstrap`      | Bootstrap helpers for Trellis-owned infrastructure state    |
| `trellis-generate-runner`     | Helper crate for invoking the bootstrap-safe generator      |
| `trellis-integration-harness` | End-to-end integration harness used by release verification |
| `trellis-jobs`                | Shared jobs runtime and admin support                       |
| `trellis-local-bootstrap`     | Local Trellis/NATS bootstrap bundle generation              |
| `trellis-service`             | Rust service runtime                                        |
| `trellis-service-jobs`        | Service-side jobs integration helpers                       |

See `../design/tooling/trellis-cli.md` and
`../design/contracts/trellis-rust-contract-libraries.md`.

Rust SDK crates are generated as disposable build output rather than tracked
workspace crates.

The bootstrap-safe `trellis-generate` helper lives under `rust/tools/generate/`
and is used by repo-local generation and clean-checkout workflows.

Run `cargo xtask prepare` from the repository root to execute that repo-local
prepare workflow through Cargo. For JS-first repo workflows, use
`cd js && deno task prepare`.

Before `cargo build` or `cargo install --path rust/crates/cli`, run
`cargo xtask prepare` so the generated Rust SDK crates under
`generated/packages/cargo/` exist. If you are doing a normal Rust build from the
repo, prefer `cargo xtask build`, which runs `prepare` first and then invokes
the default Rust workspace build. The default build excludes the live
`trellis-integration-harness`; run `cargo xtask integration` for that suite.

## Known 0.9.x Rust Gaps

The Trellis design docs describe the intended platform semantics. TypeScript
runtime surfaces currently cover more of that model than Rust in a few areas:

- Rust service operations use process-local `InMemoryOperationRuntime` storage;
  restart-durable operation storage is planned for a later minor release.
- Rust operation signal descriptors and validation are narrower than the shared
  operation model.
- Rust client operation snapshots expose the fields currently needed by the Rust
  runtime but are narrower than the full shared snapshot model.
