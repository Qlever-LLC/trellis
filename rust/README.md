# Rust

Rust crates for the Trellis platform.

**Crates in this repository:**

| Crate                  | Purpose                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `trellis-auth`         | Browser login and admin-session helpers for Rust clients                |
| `trellis-auth-adapters`| Auth integration adapters shared by Trellis services                    |
| `trellis-cli`          | Operator CLI for auth, bootstrap, and service install/upgrade |
| `trellis-client`       | Rust client runtime                                                     |
| `trellis-codegen-rust` | Rust SDK code generation                                                |
| `trellis-codegen-ts`   | TypeScript SDK code generation                                          |
| `trellis-contracts`    | Contract manifest model and validation                                  |
| `trellis-core-bootstrap` | Bootstrap helpers for Trellis-owned infrastructure state             |
| `trellis-jobs`         | Shared jobs runtime and admin support                                   |
| `trellis-server`       | Rust server runtime                                                     |
| `trellis-service-jobs` | Service-side jobs integration helpers                                   |

See `../design/tooling/trellis-cli.md` and `../design/contracts/trellis-rust-contract-libraries.md`.

Rust SDK crates are generated as disposable build output rather than tracked workspace crates.

The bootstrap-safe `trellis-generate` helper lives under `rust/tools/generate/` and
is used by repo-local generation and clean-checkout workflows.

Run `cargo xtask prepare` from the repository root to execute that repo-local
prepare workflow through Cargo. For JS-first repo workflows, use `cd js && deno task prepare`.
