# Rust Demo

This workspace contains Rust Field Ops demo participants that are kept separate
from the TypeScript demo so they resemble out-of-tree Rust consumers.

- `contracts/service.rs`: Rust-authored service contract manifest.
- `contracts/device.rs`: Rust-authored device contract manifest.
- `generated/packages/cargo/demo-service`: generated Rust demo service SDK.
- `service`: Rust Field Ops service.
- `device`: Rust field-device wizard CLI.

The Rust and TypeScript demo contracts are expected to produce the same
canonical service/device manifests and digests. The parity test lives in
`rust/tools/generate/tests/demo_contract_parity_test.rs`.

## Prepare

From the repository root:

```sh
cargo run --manifest-path rust/tools/generate/Cargo.toml --bin trellis-generate -- prepare demos/rust
cargo test --manifest-path rust/tools/generate/Cargo.toml --test demo_contract_parity_test
cargo test --manifest-path demos/rust/Cargo.toml --workspace
```

## Service

Print the generated service contract identity:

```sh
cargo run --manifest-path demos/rust/Cargo.toml -p trellis-rust-demo-service -- --contract
```

Run with authenticated Trellis service bootstrap after the service deployment is
created and provisioned. The deployment envelope can be expanded before startup,
or the service can present its manifest during bootstrap and wait while the
resulting expansion request is approved:

```sh
cargo run --manifest-path demos/rust/Cargo.toml -p trellis-rust-demo-service -- \
  --trellis-url http://localhost:3000 \
  --seed <instance-seed>
```

Enable request, operation, job, and transfer diagnostics with `RUST_LOG`:

```sh
RUST_LOG=trellis_rust_demo_service=debug,trellis_service=debug,trellis_jobs=debug \
  cargo run --manifest-path demos/rust/Cargo.toml -p trellis-rust-demo-service -- \
  --trellis-url http://localhost:3000 \
  --seed <instance-seed>
```

Use the `instanceSeed` field from
`trellis --format json deploy provision
svc/demo.field-ops` as
`<instance-seed>`.

Authenticated mode does not need `--nats-url`; Trellis returns the runtime NATS
servers during bootstrap. The authenticated service opens the resolved
`siteSummaries` KV bucket for site summaries and the resolved `uploads` object
store for evidence bytes. Without bootstrap arguments, the service exits after
confirming which run modes are available.

## Device

Run the wizard with offline sample data:

```sh
cargo run --manifest-path demos/rust/Cargo.toml -p trellis-rust-demo-device
```

Run with existing user/session credentials:

```sh
cargo run --manifest-path demos/rust/Cargo.toml -p trellis-rust-demo-device -- \
  --nats-url nats://127.0.0.1:4222 \
  --sentinel-jwt <sentinel-jwt> \
  --sentinel-seed <sentinel-seed> \
  --session-key-seed <session-key-seed>
```

Run through the service-bootstrap helper path:

```sh
cargo run --manifest-path demos/rust/Cargo.toml -p trellis-rust-demo-device -- \
  --service-bootstrap \
  --trellis-url http://localhost:3000 \
  --session-key-seed <session-key-seed>
```

Run through the demo-local activated-device flow:

```sh
cargo run --manifest-path demos/rust/Cargo.toml -p trellis-rust-demo-device -- \
  --device \
  --trellis-url http://localhost:3000
```

The first run creates a private JSON store at `.trellis-demo-device.json`,
starts device activation, and prints the activation URL, public identity key,
and local confirmation code. After approval, rerun with the confirmation code to
mark the local state activated and connect:

```sh
cargo run --manifest-path demos/rust/Cargo.toml -p trellis-rust-demo-device -- \
  --device \
  --device-confirm-code <confirmation-code>
```

Later `--device` runs reuse the stored root secret and refresh connect info from
Trellis. The store intentionally persists only the root secret, Trellis URL, and
activation state; sentinel credentials and NATS topology are refreshed in
memory. Use `--device-store <path>` or `TRELLIS_DEVICE_STORE` for a different
file.

The Rust device CLI uses the generated participant facade for online `fieldOps`
RPCs and operations, generated state helpers for `selectedSite` and
`draftInspections`, generated transfer helpers for evidence upload/download, and
generated event-subscription helpers for service events.

## Current Gaps

- live authenticated service/device smoke coverage against a running Trellis
  stack
- live verification of worker-host queue consumption for service-private jobs;
  authenticated mode starts a `refreshSiteSummary` worker host when the jobs
  work stream and `siteSummaries` KV binding are available, while raw
  local/tests keep the synchronous inline path
- reusable public `TrellisDevice.connect(...)`-style persistence abstraction;
  the current root-secret persistence is demo-local
