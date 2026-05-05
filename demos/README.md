# Trellis Demos

This directory contains the Field Ops demo across separate browser UI,
TypeScript participants, and Rust participants. The layout keeps each demo as
close to out-of-tree development as possible while remaining in this repository.

- `demos/app`: the shared Svelte Field Inspection Desk browser app, with its own
  Deno config.
- `demos/js/service`: the TypeScript Field Ops service.
- `demos/js/device`: the TypeScript activated field-device TUI.
- `demos/js/shared`: sample data and helpers for the TypeScript participants.
- `demos/js`: the Deno workspace for TypeScript demo participants.
- `demos/rust`: the Rust Field Ops service and field-device TUI Cargo workspace.

The TypeScript and Rust service/device contracts are authored in source code and
are checked for canonical parity in the Rust generator tests. The shared browser
app consumes the generated demo service SDK from `demos/js/generated`.

## Browser App

The browser app is intentionally separate from both the service and device
participants. It consumes generated demo service SDKs and can be used with the
TypeScript or Rust service/device implementations.

```sh
deno task -c demos/app/deno.json prepare
deno task -c demos/app/deno.json check
deno task -c demos/app/deno.json dev
```

## TypeScript Demo

The TypeScript demo is the full end-to-end runtime path today. It includes:

- service deployment apply/provision flow through the `trellis` CLI
- activated device approval and reconnect flow
- browser app sign-in and SDK calls
- operations, operation progress, cancel, events, state, send transfers, receive
  transfer previews, and private jobs behind public operations

See `demos/js/README.md` for the complete walkthrough.

## Rust Demo

Rust demo tasks:

```sh
cargo run --manifest-path rust/tools/generate/Cargo.toml -- prepare demos/rust
cargo test --manifest-path demos/rust/Cargo.toml --workspace
cargo run --manifest-path demos/rust/Cargo.toml -p trellis-rust-demo-service
cargo run --manifest-path demos/rust/Cargo.toml -p trellis-rust-demo-device
```

The Rust service mounts generated `trellis.demo-service@v1` RPC and operation
handlers and can run either through authenticated service bootstrap or the raw
local NATS developer loop. The Rust device can run offline, with user/session
credentials, or through a demo-local activated-device persistence flow; online
actions use the generated participant `fieldOps` and state facades, including
send/receive transfer helpers. In authenticated service mode, site summaries use
the resolved service-owned `siteSummaries` KV bucket and evidence bytes use the
resolved service-owned `uploads` object store.

Remaining Rust gaps are narrower than the TypeScript path: live activated-device
authenticated smoke coverage, live verification of worker-host job consumption,
and reusable public device persistence ergonomics beyond the demo-local file.

See `demos/rust/README.md` for Rust-specific setup, supported modes, and current
limitations.
