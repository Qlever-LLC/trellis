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
- service deployment and upgrade flows that use locally generated keys
- bootstrap-safe contract verification and SDK generation during repo builds

The command model separates those concerns across:

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
cd js && deno task prepare:watch
cargo xtask prepare
cargo xtask prepare-watch
cargo xtask build
```

Those tasks route to `trellis-generate`, which can run before the main `trellis`
CLI is buildable from a clean checkout. `cargo xtask prepare` shells into the
bootstrap generator from the Rust workspace. `deno task prepare` does the same
for the JS workspace.

During active contract development, `prepare:watch` and
`cargo xtask prepare-watch` keep the same prepare workflow running in the
background. Watch mode observes the chosen project root broadly, filters events
through `.gitignore`, and always ignores `.git/`, `.worktrees/`, and
`generated/` so repository scans and generated artifact writes do not loop back
into prepare. It also ignores file changes that are not TypeScript, JavaScript,
or Rust source unless they are recognized project/discovery inputs. When a batch
maps safely to known contract source entries, watch mode prepares only those
affected entries while preserving the full prepare plan order. It falls back to
full prepare for project manifests and discovery-shape changes. Generator or
tooling changes require restarting the watcher because the already-running
process is still using the old generator code. Change diagnostics are quiet by
default; direct `trellis-generate` callers may add `--changes` with `--watch` to
print the event paths plus the watch decision and reason.

Rust contributors should run `cargo xtask prepare` before `cargo build` or
`cargo install --path rust/crates/cli`, because the Rust workspace depends on
generated SDK crates under `generated/rust/sdks/`. `cargo xtask build` is a
convenience wrapper that runs `prepare` first and then invokes `cargo build`.

`trellis-generate` still owns the explicit source-to-artifact interface for repo
scripts, wrappers, and CI:

```text
trellis-generate
trellis-generate prepare [--watch [--changes]] [path]
trellis-generate discover <path>
trellis-generate generate manifest (--source <file> | --manifest <file> | --image <ref>) --out <file>
trellis-generate generate ts (--source <file> | --manifest <file> | --image <ref>) --out <dir>
trellis-generate generate rust (--source <file> | --manifest <file> | --image <ref>) --out <dir>
trellis-generate generate all (--source <file> | --manifest <file> | --image <ref>) --out-manifest <file> [--ts-out <dir>] [--rust-out <dir>]
trellis-generate self check [--prerelease]
trellis-generate self update [--prerelease]
```

These commands:

- resolve contract inputs from source modules, generated manifests, or OCI
  images
- validate canonical manifests against `trellis.contract.v1`
- compute canonical JSON and digests
- generate language SDKs from the resolved contract inputs
- preserve the current TypeScript generated surface where practical
- generate Rust SDK crates that target `trellis-client` and `trellis-service`
- use required contract `kind` metadata to decide discovery behavior: `service`
  generates manifest, TypeScript SDK, and Rust SDK artifacts; `app` generates
  manifest and TypeScript SDK artifacts; `agent` and `device` contracts are
  verified only
- when omitted, `prepare [path]` defaults to the current working directory
- discovery uses configured package/workspace entries and explicit contract
  source inputs; it does not implicitly scan `src/lib` for contracts

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
trellis auth approval revoke <identityEnvelopeId> [--user <origin.id>]
trellis deploy list <svc|dev> [--disabled]
trellis deploy show <svc/id|dev/id>
trellis deploy create <svc/id|dev/id> [--namespace <ns>...] [--review-mode <none|required>]
trellis deploy disable <svc/id|dev/id>
trellis deploy enable <svc/id|dev/id>
trellis deploy remove <svc/id|dev/id> [-f] [--cascade] [--purge] [--purge-resources] [--purge-unused-contracts]
trellis deploy instances <svc|dev|svc/id|dev/id> [--disabled] [--state <registered|activated|revoked|disabled>] [--show-metadata]
trellis deploy provision <svc/id|dev/id> [--instance-seed <seed>] [--name <name>] [--serial-number <serial>] [--model-number <model>] [--metadata <key=value>...]
trellis deploy activation list [--instance <id>] [--deployment <id>] [--state <activated|revoked>]
trellis deploy activation revoke <instanceId>
trellis deploy review list [--instance <id>] [--deployment <id>] [--state <pending|approved|rejected>]
trellis deploy review approve <id> [--reason <code>]
trellis deploy review reject <id> [--reason <code>]
trellis bootstrap nats --trellis-creds <path> --auth-creds <path> [--servers <servers>] [--jetstream-replicas <n>]
trellis bootstrap admin --origin <origin> --id <id> [--db-path <path>] [--capability <capability>...]
trellis keygen ...
trellis self check [--prerelease]
trellis self update [--prerelease]
trellis version
trellis completion <shell>
```

Operational command behavior:

- `trellis auth login <trellis-url>` is a normal contract-bearing client login,
  not a bootstrap bypass; it enters the auth-owned browser flow and continues
  through the resolved portal before storing local session material for later
  admin RPC calls; runtime transport details are discovered from the bind flow
  and persisted internally rather than exposed as normal CLI flags
- normal authenticated CLI commands reconnect with freshly generated runtime
  auth proofs derived from the stored session key, current contract digest, and
  `iat`; the current contract digest is runtime contract evidence, not a hash of
  human-facing display metadata; when the local CLI contract digest changes, the
  CLI starts the normal auth request flow with the full contract, may complete
  immediately when the existing identity envelope already covers the new
  boundary, otherwise prints the detached portal login URL, may render a QR
  code, does not auto-open a browser or start a localhost callback listener, and
  completes by polling the auth-owned flow before reconnecting NATS and issuing
  admin RPCs
- generic NATS authorization failures during authenticated command reconnects do
  not by themselves prove the stored local session was revoked; the CLI
  preserves local session material unless auth returns an explicit
  `session_not_found`, `revoked`, or `rejected` signal
- `trellis auth approval list` shows stored delegated approval decisions for app
  and CLI contracts from the `trellis` service; each row includes an
  `identityEnvelopeId` and contract evidence, with optional filtering by exact
  contract digest and by user for admin callers; the command pages through the
  bounded `Auth.Identities.List` RPC rather than requesting an unbounded list
- `trellis auth approval revoke` revokes the addressed identity envelope through
  `Auth.IdentityEnvelopes.Revoke` and revokes matching active delegated sessions
  in the `trellis` service; contract digest remains list/filter evidence, not
  the revocation key
- `trellis portal *` is no longer a public auth API surface. Built-in portals
  are implicit; custom portal routing is deployment-envelope metadata managed by
  operator tooling or Console surfaces that understand envelope state.
- `trellis deploy *` manages deployment-owned service and device deployments;
  service refs use `svc/<id>` and device refs use `dev/<id>`, with `deployment`,
  `deployments`, `dep`, and `d` as aliases for the top-level command
- deployment envelope expansion and shrink are Trellis Auth admin surfaces;
  until the CLI exposes first-class envelope commands, operators use the Console
  Envelopes page or generated `Auth.Envelopes.*` RPC clients to change service
  and device deployment authority
- `trellis deploy provision <dev/id>` is the ergonomic provisioning path for
  device development and deployment: it generates a root secret locally, derives
  the device keys, registers the instance with auth using activation-only secret
  material, optionally captures device metadata such as `name`, `serialNumber`,
  `modelNumber`, and deployment-specific opaque keys, and emits the provisioning
  bundle for the device or operator
- `trellis deploy instances *` is the lower-level instance inspection surface;
  the default device table promotes `name`, `serial`, and `model` columns when
  present, while `--show-metadata` reveals the remaining opaque metadata entries;
  instance and review list commands must pass an explicit page size to the
  underlying admin list RPC and may pass deployment/state filters
- `trellis deploy review *` manages pending device review decisions and is
  intended for `trellis.auth::device.review` automation services or admins
- service deployments own deployment envelopes, namespace allowance, and
  reversible deployment state
- service instances are concrete service principals under one deployment,
  including provisioning, inspection, and reversible lifecycle changes
- deployment create flows are intentionally metadata-light; human-facing
  contract names continue to come from contract evidence rather than from a
  separate deployment-local `displayName` or `description`
- deployments may rely on the built-in Trellis portal with no portal setup, or
  register one or more custom portals, choose separate login and device default
  custom portals, assign portals to specific browser contracts or device
  deployments, then create device deployments and provision device instances for
  activated-device flows; install automation may offer convenience wrappers, but
  the underlying actions remain explicit admin calls
- `trellis bootstrap nats` creates the shared event stream and Trellis-owned KV
  buckets needed before the runtime starts; these buckets are for OAuth state,
  pending auth, browser flows, active connection presence, and the public
  Trellis State API; `--jetstream-replicas` defaults to `1` for standalone
  installs and should match the target NATS topology, commonly `3` for
  production clusters
- `trellis bootstrap admin` bootstraps the initial admin user in Trellis service
  SQLite storage; by default it writes `/var/lib/trellis/trellis.sqlite` and
  seeds `admin`, `trellis.catalog.read`, and `trellis.contract.read` so the
  first console user can load discovery data
- `trellis keygen` remains an explicit offline utility for operators who want to
  separate key generation from install
- the runtime/operator CLI no longer exposes direct transport flags like
  `--servers` or `--creds` outside explicit bootstrap-only flows

Normal authenticated CLI behavior is contract-governed in the same architectural
sense as browser apps: the CLI presents a generated contract, approval is stored
in an identity envelope anchored to the CLI session public key, and Trellis auth
does not create normal client sessions without contract evidence that fits that
envelope.

### Explicitness rule

The CLI prefers explicit commands over vague orchestration commands.

Do not add commands like `trellis build project` with ambiguous behavior.

## Contract boundary

The developer-facing CLI boundary is the contract source.

- project roots keep contract sources next to `deno.json`, `deno.jsonc`,
  `package.json`, or `Cargo.toml`
- single-contract TypeScript/JavaScript projects may use a top-level
  `contract.ts` or `contract.js`, and that file default exports the contract
  module that `trellis-generate` should load
- multi-contract TypeScript/Deno projects use `contracts/*.ts`, and those files
  default export the contract module that `trellis-generate` should load
- Rust projects use `contracts/*.rs` source modules with a `contract_manifest()`
  function, or another explicitly selected function, returning
  `ContractManifest` or `Result<ContractManifest, ContractsError>`; those
  modules may build manifests with Rust code or wrap checked-in manifest JSON
- every contract source must declare a required `kind`
- the `trellis` runtime service may own multiple logical contracts such as
  `trellis.core@v1`, `trellis.auth@v1`, and `trellis.state@v1`
- `trellis-generate` emits canonical manifests into build output when a repo
  needs a release artifact
- app and service repos SHOULD wrap contract preparation into their normal
  `dev`, `build`, and CI tasks rather than making end users run separate
  manifest commands during routine browser-app development
- operators may expand deployment envelopes from generated manifests or OCI
  images that embed `/trellis/contract.json`
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
- `trellis-service`
- generated SDK crates for Trellis-owned contracts such as `trellis-sdk-core`
  and `trellis-sdk-auth`

The current CLI implementation uses generated Trellis-owned SDK crates directly
plus local helper modules for command parsing, auth session storage, contract
resolution, and self-update behavior.

## References

- `design/contracts/trellis-contracts-catalog.md`
- `design/contracts/trellis-rust-contract-libraries.md`
- `design/contracts/trellis-typescript-contract-authoring.md`
