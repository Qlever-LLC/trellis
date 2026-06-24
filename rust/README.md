# Rust

Rust crates for the Trellis platform.

The public Cargo authoring packages are `trellis` and `trellis-contracts`.
Low-level crates in this workspace support the platform implementation,
generators, CLIs, and tests; they are not the stable package surface that normal
Rust services and apps should author against. Internal workspace crates are
marked `publish = false`; runtime implementation for public authoring lives
behind modules of the public `trellis` facade.

**Crates in this repository:**

| Crate                     | Purpose                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `trellis-auth`            | Unpublished compatibility/test package for auth helpers          |
| `trellis-auth-adapters`   | Unpublished compatibility/test package for auth adapters         |
| `trellis`                 | Curated public Rust facade for clients and services              |
| `trellis-cli`             | Operator CLI crate for the `trellis` binary                      |
| `trellis-client`          | Unpublished compatibility package for `trellis_rs::client`       |
| `trellis-codegen-rust`    | Internal Rust SDK code generation                                |
| `trellis-codegen-ts`      | Internal TypeScript SDK code generation                          |
| `trellis-contracts`       | Contract manifest model and validation                           |
| `trellis-core-bootstrap`  | Internal bootstrap helpers for infrastructure state              |
| `trellis-generate-runner` | Internal helper for invoking the bootstrap-safe generator        |
| `trellis-jobs`            | Unpublished compatibility/test package for `trellis_rs::jobs`    |
| `trellis-local-bootstrap` | Internal local Trellis/NATS bootstrap bundle generation          |
| `trellis-service`         | Unpublished compatibility/test package for `trellis_rs::service` |
| `trellis-service-jobs`    | Internal service-side jobs integration helpers                   |

See `../design/tooling/trellis-cli.md` and
`../design/contracts/trellis-rust-contract-libraries.md`.

Rust SDK crates are generated as disposable build output rather than tracked
workspace crates.

Generated SDK and participant crates include a package-local `TRELLIS.md` for AI
agents. Those files summarize the contract id, kind, crate/package name, owned
RPC/event/feed/operation descriptors, facade methods, and used dependency
surfaces. Use them together with the raw docs index:

- https://raw.githubusercontent.com/qlever-llc/trellis/main/docs/static/llms.txt
- https://raw.githubusercontent.com/qlever-llc/trellis/main/docs/static/llms-full.txt

Current Rust service code should prefer descriptor and facade APIs:
`trellis_client.call::<RpcDescriptor>(...)`,
`trellis_client.publish::<EventDescriptor>(...)`,
`trellis_client.subscribe::<EventDescriptor>()`,
`trellis_client.feed::<FeedDescriptor>(input)`,
`trellis_client.operation::<Operation>().start(...)`, generated client wrappers
such as `.rpc().group().method(...)`, and service registration through
`handle().rpc().group().method(handler)` where generated.

Prepared event support includes `PreparedTrellisEvent`,
`prepare_event::<Descriptor>(...)`, `publish_prepared`, and
`dispatch_outbox_once`. Durable stores include `OutboxStore`, `InboxStore`,
`SqliteOutboxStore`, `SqliteInboxStore`, `PostgresOutboxStore`,
`PostgresInboxStore`, `NatsKvOutboxStore`, and `NatsKvInboxStore`.

Rust client event subscriptions are live/ephemeral by default. Service-level
durable event processing is a contract/resource concern: declare
`eventConsumers` in the canonical service manifest so Trellis provisions the
consumer binding and grants exact bound JetStream subjects. Rust service code
should not create arbitrary durable event consumers for contract event
processing.

The bootstrap-safe `trellis-generate` helper lives under `rust/tools/generate/`
and is used by repo-local generation and clean-checkout workflows.

Run `cargo xtask prepare` from the repository root to execute that repo-local
prepare workflow through Cargo. For JS-first repo workflows, use
`cd js && deno task prepare`.

Before `cargo build` or `cargo install --path rust/crates/cli`, run
`cargo xtask prepare` so the generated Rust SDK crates under
`generated/packages/cargo/` exist. If you are doing a normal Rust build from the
repo, prefer `cargo xtask build`, which runs `prepare` first and then invokes
the default Rust workspace build. Rust client-library integration coverage lives
in the public `trellis` facade crate and runs with:

```sh
cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration -- --nocapture
```

That Rust suite is a peer of the TypeScript/Deno suite
(`deno task -c js/deno.json test:integration`) and must conform to the shared
client cases in `integration/test-matrix.json`.

## Known 0.9.x Rust Gaps

The Trellis design docs describe the intended platform semantics. TypeScript
runtime surfaces currently cover more of that model than Rust in a few areas:

- Rust service operations use process-local `InMemoryOperationRuntime` storage;
  restart-durable operation storage is planned for a later minor release.
- Rust operation signal descriptors and validation are narrower than the shared
  operation model.
- Rust client operation snapshots expose the fields currently needed by the Rust
  runtime but are narrower than the full shared snapshot model.
