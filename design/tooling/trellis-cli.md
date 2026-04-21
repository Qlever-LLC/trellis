---
title: Trellis CLI
description: CLI design for the operator/runtime `trellis` CLI plus the repo-local `trellis-generate` prepare workflow.
order: 10
---

# Design: Trellis CLI

## Prerequisites

- [../contracts/trellis-contracts-catalog.md](./../contracts/trellis-contracts-catalog.md) -
  canonical contract and catalog model
- [../contracts/trellis-typescript-contract-authoring.md](./../contracts/trellis-typescript-contract-authoring.md) -
  source-first TypeScript contract authoring
- [../contracts/trellis-rust-contract-libraries.md](./../contracts/trellis-rust-contract-libraries.md) -
  Rust SDK and participant generation direction

## Context

Trellis needs clear command boundaries for:

- operational bootstrap and admin commands
- service install and upgrade flows that use locally generated keys
- bootstrap-safe contract verification and SDK generation during repo builds

The repository previously split those concerns across:

- an ad hoc Rust CLI for a few operational commands
- a separate Rust verification binary for live catalog digest checks
- TypeScript and Deno scripts for SDK generation

That split made the system harder to understand, especially when normal users
were shown machine-global generation commands that should really have stayed in
repo-local build workflows.

## Design

Trellis uses two tools with different audiences:

- `trellis` is the runtime/operator CLI
- `trellis-generate` is the bootstrap-safe developer/build companion used by
  repo-local prepare workflows

Canonical `trellis.contract.v1` JSON remains an exchange artifact, but it is
generated output rather than a committed source file.

### Command structure

```text
trellis <command> [subcommand] [options]
```

The preferred developer interfaces are repo-local prepare tasks, not direct
machine-global generator commands:

```text
cd js && deno task prepare
cargo xtask prepare
cargo xtask build
```

Those tasks route to `trellis-generate`, which can run before the main `trellis`
CLI is buildable from a clean checkout. `cargo xtask prepare` shells into the
bootstrap generator from the Rust workspace. `deno task prepare` does the same
for the JS workspace.

Rust contributors should run `cargo xtask prepare` before `cargo build` or
`cargo install --path rust/crates/cli`, because the Rust workspace depends on
generated SDK crates under `generated/rust/sdks/`. `cargo xtask build` is a
convenience wrapper that runs `prepare` first and then invokes `cargo build`.

`trellis-generate` still owns the explicit source-to-artifact interface for repo
scripts, wrappers, and CI:

```text
trellis-generate
trellis-generate discover <path>
trellis-generate generate manifest (--source <file> | --manifest <file> | --image <ref>) --out <file>
trellis-generate generate ts (--source <file> | --manifest <file> | --image <ref>) --out <dir>
trellis-generate generate rust (--source <file> | --manifest <file> | --image <ref>) --out <dir>
trellis-generate generate all (--source <file> | --manifest <file> | --image <ref>) --out-manifest <file> [--ts-out <dir>] [--rust-out <dir>]
```

These commands:

- resolve contract inputs from source modules, generated manifests, or OCI
  images
- validate canonical manifests against `trellis.contract.v1`
- compute canonical JSON and digests
- generate language SDKs from the resolved contract inputs
- preserve the current TypeScript generated surface where practical
- generate Rust SDK crates that target `trellis-client` and `trellis-server`
- use required contract `kind` metadata to decide discovery behavior: `service`
  generates manifest and SDK artifacts, while `app`, `agent`, and `device`
  contracts are verified only

Normal docs should not teach `trellis generate` or
`trellis contracts build/verify`. Those workflows belong to `trellis-generate`
and are normally reached through repo-local wrappers instead of direct end-user
invocation.

The CLI may accept explicit package and crate naming flags when the default name
inference is not enough for a repository.

### Operational commands

The CLI keeps and cleans up the existing operational commands:

```text
trellis auth login <trellis-url>
trellis auth logout
trellis auth status
trellis auth approval list [--user <origin.id>] [--digest <contractDigest>]
trellis auth approval revoke <contractDigest> [--user <origin.id>]
trellis auth grant list
trellis auth grant set <contractId|path> [--capability <capability>...] [--allow-origin <origin>...]
trellis auth grant disable <contractId>
trellis portal list
trellis portal create <portalId> <entryUrl> [--app-contract-id <contractId>]
trellis portal disable <portalId>
trellis portal login default
trellis portal login set-default (--builtin | --portal <portalId>)
trellis portal login list
trellis portal login set <contractId> (--builtin | --portal <portalId>)
trellis portal login clear <contractId>
trellis portal device default
trellis portal device set-default (--builtin | --portal <portalId>)
trellis portal device list
trellis portal device set <profileId> (--builtin | --portal <portalId>)
trellis portal device clear <profileId>
trellis device profile list [--contract <contractId>] [--disabled]
trellis device profile create <id> [--review-mode <none|required>]
trellis device profile apply <id> (--source <file> | --manifest <file> | --image <ref>) [-f]
trellis device profile unapply <id> <contractId> [--digest <digest>...]
trellis device profile disable <id>
trellis device profile enable <id>
trellis device profile remove <id> [-f]
trellis device instance provision <id> [--name <name>] [--serial-number <serial>] [--model-number <model>] [--metadata <key=value>...]
trellis device instance list [--profile <id>] [--state <registered|activated|revoked|disabled>] [--show-metadata]
trellis device instance disable <id>
trellis device instance enable <id>
trellis device instance remove <id> [-f]
trellis device activation list [--instance <id>] [--profile <id>] [--state <activated|revoked>]
trellis device activation revoke <id>
trellis device activation review list [--instance <id>] [--profile <id>] [--state <pending|approved|rejected>]
trellis device activation review approve <id> [--reason <code>]
trellis device activation review reject <id> [--reason <code>]
trellis bootstrap nats ...
trellis bootstrap admin ...
trellis keygen ...
trellis service profile list [--disabled]
trellis service profile create <id> [--namespace <ns>...]
trellis service profile apply <id> (--source <file> | --manifest <file> | --image <ref>) [-f]
trellis service profile unapply <id> <contractId> [--digest <digest>...]
trellis service profile disable <id>
trellis service profile enable <id>
trellis service profile remove <id> [-f]
trellis service instance provision <id> [--instance-seed <seed>]
trellis service instance list [--profile <id>] [--disabled]
trellis service instance disable <id>
trellis service instance enable <id>
trellis service instance remove <id> [-f]
trellis self check [--prerelease]
trellis self update [--prerelease]
trellis version
trellis completion <shell>
```

Operational command behavior:

- `trellis auth login <trellis-url>` is a normal contract-bearing client login, not a
  bootstrap bypass; it enters the auth-owned browser flow and continues through
  the resolved portal before storing local session material for later admin RPC
  calls; runtime transport details are discovered from the bind flow and
  persisted internally rather than exposed as normal CLI flags
- normal authenticated CLI commands reconnect with freshly generated runtime auth
  proofs derived from the stored session key, current contract digest, and
  `iat`; when the local agent contract digest changes, the CLI starts the normal
  auth request flow with the full agent contract, may complete immediately when
  the existing delegated grant already covers the new contract, otherwise prints
  the detached portal login URL, may render a QR code, does not auto-open a
  browser or start a localhost callback listener, and completes by polling the
  auth-owned flow before reconnecting NATS and issuing admin RPCs
- `trellis portal *` manages registered custom portal web apps used to replace
  the built-in Trellis portal for login flows, device flows, or both; an
  optional `app-contract-id` attaches a normal browser app contract for portals
  that later call Trellis as the logged-in user
- `trellis portal login *` manages deployment-owned login portal policy,
  including the deployment login default and any contract-specific selections
- `trellis portal device *` manages deployment-owned device portal policy,
  including the deployment device default and any profile-specific selections
- `trellis auth approval list` shows stored delegated approval decisions for app
  and agent contracts from the `trellis` service, with server-side filtering by
  exact contract digest and optionally by user when the caller is an admin
- `trellis auth approval revoke` removes a stored `user <-> contractDigest`
  decision, removes reconnect authority for that delegated app or agent grant,
  and revokes matching active delegated sessions in the `trellis` service
- `trellis auth grant *` manages deployment-wide delegated grant policies keyed
  by app or agent contract lineage; `set` may resolve the lineage from either a
  contract id or a local contract source path, may optionally restrict matching
  browser origins for app callers, and causes affected delegated sessions to
  reconnect so auth re-evaluates current policy
- `trellis device profile *` manages device classes, allowed digests, and review
  policy for activated devices; profile creation is separate from contract
  application, so `apply` and `unapply` manage the allowed digest set after the
  profile exists; portal selection for devices is managed under
  `trellis portal device *`
- `trellis device instance provision` is the ergonomic provisioning path for
  device development and deployment: it generates a root secret locally, derives
  the device keys, registers the instance with auth using activation-only secret
  material, optionally captures device metadata such as `name`, `serialNumber`,
  `modelNumber`, and deployment-specific opaque keys, and emits the provisioning
  bundle for the device or operator
- `trellis device instance *` is the lower-level instance inspection and
  lifecycle surface; the default table promotes `name`, `serial`, and `model`
  columns when present, while `--show-metadata` reveals the remaining opaque
  metadata entries
- `trellis device activation review *` manages pending device review decisions
  and is intended for `device.review` automation services or admins
- `trellis service profile *` manages deployment-owned service profile policy:
  contract digest allowance, namespace allowance, and reversible profile state
- `trellis service instance *` manages concrete service principals under one
  profile, including provisioning, inspection, and reversible lifecycle changes
- profile create flows are intentionally metadata-light; human-facing contract
  names continue to come from the applied contract manifests rather than from a
  separate profile-local `displayName` or `description`
- deployments may rely on the built-in Trellis portal with no portal setup, or
  register one or more custom portals, optionally choose separate login and
  device default custom portals, assign portals to specific browser contracts or
  device profiles, then create device profiles and provision device instances
  for activated-device flows; install automation may offer convenience wrappers,
  but the underlying actions remain explicit admin calls
- `trellis bootstrap nats` creates the shared stream and auth-owned KV buckets
  needed before the runtime starts; this is an explicit super-user path that
  talks directly to NATS with credentials
- `trellis bootstrap admin` bootstraps the initial admin user in auth's local
  user projection; by default it seeds `admin`, `trellis.catalog.read`, and
  `trellis.contract.read` so the first console user can load discovery data
- `trellis keygen` remains an explicit offline utility for operators who want to
  separate key generation from install
- the runtime/operator CLI no longer exposes direct transport flags like
  `--servers` or `--creds` outside explicit bootstrap-only flows

Normal authenticated CLI behavior is contract-governed in the same architectural
sense as browser apps: the CLI authenticates as an `agent` participant with a
generated agent contract, approval is stored against the exact contract digest,
and Trellis auth does not create normal client sessions without such a
contract.

### Explicitness rule

The CLI prefers explicit commands over vague orchestration commands.

Do not add commands like `trellis build project` with ambiguous behavior.

## Contract boundary

The developer-facing CLI boundary is the contract source.

- project roots keep contract sources in a sibling `contracts/` directory next
  to `deno.json`, `deno.jsonc`, `package.json`, or `Cargo.toml`
- TypeScript/Deno projects use `contracts/*.ts`, and those files default export
  the contract module that `trellis-generate` should load
- Rust projects use `contracts/*.rs` wrappers that export `CONTRACT` or
  `CONTRACT_JSON` via `include_str!(...)`, usually backed by a sibling manifest
  JSON file in the same `contracts/` directory
- every contract source must declare a required `kind`
- the `trellis` runtime service may own multiple logical contracts such as
  `trellis.core@v1`, `trellis.auth@v1`, and `trellis.state@v1`
- `trellis-generate` emits canonical manifests into build output when a repo
  needs a release artifact
- app and service repos SHOULD wrap contract preparation into their normal
  `dev`, `build`, and CI tasks rather than making end users run separate
  manifest commands during routine browser-app development
- operators may install or upgrade from generated manifests or OCI images that
  embed `/trellis/contract.json`
- OCI images may override that default path with the `io.trellis.contract.path`
  label

`generated/` contains derived manifests and SDKs only.

## Implementation

The Rust implementation uses:

- `clap` for command parsing and help text
- `clap_complete` for shell completions
- `miette` for diagnostics
- `tracing` and `tracing-subscriber` for logging
- `comfy-table` for human-readable tabular output
- Rust crates for operator flows, contract validation, packing, and code
  generation

The CLI owns explicit operational command execution, while `trellis-generate`
owns bootstrap-safe contract and SDK workflows. Repo-specific build workflows
remain wrapper scripts or tasks around those explicit commands. Shared logic
lives in dedicated Rust crates:

- `trellis-contracts`
- `trellis-codegen-ts`
- `trellis-codegen-rust`
- `trellis-client`
- `trellis-server`
- generated SDK crates for Trellis-owned contracts such as `trellis-sdk-core`
  and `trellis-sdk-auth`

The current CLI implementation uses generated Trellis-owned SDK crates directly
plus local helper modules for command parsing, auth session storage, contract
resolution, and self-update behavior.

## References

- `design/contracts/trellis-contracts-catalog.md`
- `design/contracts/trellis-rust-contract-libraries.md`
- `design/contracts/trellis-typescript-contract-authoring.md`
