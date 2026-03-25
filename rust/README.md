# Rust

Rust crates for the Trellis platform.

**Active crates:**

| Crate                  | Purpose                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `trellis-cli`          | Contract verification, catalog packing, SDK generation, service install |
| `trellis-auth`         | Browser login and admin-session helpers for Rust clients                |
| `trellis-cli-participant` | Local participant facade for the Rust CLI                         |
| `trellis-sdk-auth`     | Shared typed Rust SDK for `trellis.auth@v1`                             |
| `trellis-sdk-core`     | Shared typed Rust SDK for `trellis.core@v1`                             |
| `trellis-contracts`    | Contract manifest model and validation                                  |
| `trellis-codegen-ts`   | TypeScript SDK code generation                                          |
| `trellis-codegen-rust` | Rust SDK code generation                                                |
| `trellis-client`       | Rust client runtime                                                     |
| `trellis-server`       | Rust server runtime                                                     |

See [ADR: CLI](../design/adr-trellis-cli.md) and [ADR: Rust Contract Libraries](../design/adr-trellis-rust-contract-libraries.md).

For Rust participant code, prefer the local participant facade crate over directly stitching together multiple SDK crates. The CLI itself follows that pattern through `trellis-cli-participant`, which now uses a checked-in manifest plus build-time generated facade modules.
