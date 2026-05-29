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
generated SDK crates under `generated/packages/cargo/`. `cargo xtask build` is a
convenience wrapper that runs `prepare` first and then invokes the default Rust
workspace build. That default build excludes the live integration harness; use
`cargo xtask integration run` for the full live suite.

`trellis-generate` still owns the explicit source-to-artifact interface for repo
scripts, wrappers, and CI:

```text
trellis-generate
trellis-generate prepare [--targets manifest,jsr,npm,cargo] [--no-npm] [--watch [--changes]] [path]
trellis-generate discover <path>
trellis-generate generate manifest (--source <file> | --manifest <file> | --image <ref>) --out <file>
trellis-generate generate jsr (--source <file> | --manifest <file> | --image <ref>) --out <dir>
trellis-generate generate npm (--source <file> | --manifest <file> | --image <ref>) --out <dir>
trellis-generate generate cargo (--source <file> | --manifest <file> | --image <ref>) --out <dir>
trellis-generate generate all (--source <file> | --manifest <file> | --image <ref>) --out-manifest <file> [--jsr-out <dir>] [--npm-out <dir>] [--cargo-out <dir>]
trellis-generate self check [--prerelease]
trellis-generate self update [--prerelease]
```

These commands:

- resolve contract inputs from source modules, generated manifests, or OCI
  images
- validate canonical manifests against `trellis.contract.v1`
- compute canonical JSON and digests
- generate package-manager-specific SDK artifacts from the resolved contract
  inputs
- preserve the current JSR TypeScript generated surface where practical
- generate npm JavaScript packages natively from generated TypeScript sources;
  npm output does not require Deno or `dnt`
- generate service/app-owned Cargo SDK crates that use the public `trellis`
  facade and its internal generator/runtime support
- use required contract `kind` metadata to decide discovery behavior: `service`
  generates manifest, JSR, npm, and Cargo artifacts; `app` generates manifest,
  JSR, and npm artifacts; `agent` and `device` contracts are verified, with Rust
  participant facades generated where applicable
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

The runtime/operator CLI uses a clean-break command model. Removed command
families such as `auth`, `deploy`, `deployment`, `deployments`, `dep`, `d`,
`bootstrap`, `self`, and `keygen` are not compatibility aliases. Public commands
prefer operator-facing resources (`users`, `svc`, `dev`) over implementation
namespaces.

```text
trellis login <url>
trellis logout
trellis whoami

trellis users list
trellis users show <user-id>
trellis users create [--name <name>] [--email <email>] [--username <username>] [--inactive] [--capability <key>...] [--group <key>...]
trellis users edit <user-id> [--active|--inactive] [--name <name>] [--email <email>] [--add-capability <key>...] [--remove-capability <key>...] [--set-capability <key>...] [--clear-capabilities] [--add-group <key>...] [--remove-group <key>...] [--set-group <key>...] [--clear-groups]

trellis identity grants list [--user <user-id>] [--digest <contractDigest>]
trellis identity grants revoke <identity-grant-id> [--user <user-id>]

trellis svc list [--disabled]
trellis svc <id> show
trellis svc <id> create [--namespace <ns>...]
trellis svc <id> apply (--source <path> | --manifest <path> | --image <ref>)
trellis svc <id> disable
trellis svc <id> enable
trellis svc <id> remove [-f] [--cascade] [--purge] [--purge-unused-contracts]
trellis svc <id> instances [--disabled]
trellis svc <id> provision [--instance-seed <seed>]
trellis svc <id> authority show
trellis svc <id> authority plan list [--state <pending|accepted|rejected|expired>] [--classification <update|migration>]
trellis svc <id> authority plan show <PLAN_ID>
trellis svc <id> authority accept-update <PLAN_ID> [--expected-desired-version <version>]
trellis svc <id> authority accept-migration <PLAN_ID> --acknowledgement <text> [--expected-desired-version <version>]
trellis svc <id> authority reject <PLAN_ID> [--reason <text>]
trellis svc <id> authority reconcile [--desired-version <version>]

trellis dev list [--disabled]
trellis dev <id> show
trellis dev <id> create [--review-mode <none|required>]
trellis dev <id> apply (--source <path> | --manifest <path> | --image <ref>)
trellis dev <id> disable
trellis dev <id> enable
trellis dev <id> remove [-f] [--cascade] [--purge] [--purge-unused-contracts]
trellis dev <id> instances [--state <registered|activated|revoked|disabled>] [--show-metadata]
trellis dev <id> provision [--name <name>] [--serial-number <serial>] [--model-number <model>] [--metadata <key=value>...]
trellis dev <id> authority show
trellis dev <id> authority plan list [--state <pending|accepted|rejected|expired>] [--classification <update|migration>]
trellis dev <id> authority plan show <PLAN_ID>
trellis dev <id> authority accept-update <PLAN_ID> [--expected-desired-version <version>]
trellis dev <id> authority accept-migration <PLAN_ID> --acknowledgement <text> [--expected-desired-version <version>]
trellis dev <id> authority reject <PLAN_ID> [--reason <text>]
trellis dev <id> authority reconcile [--desired-version <version>]
trellis dev <id> activations list [--instance <id>] [--state <activated|revoked>]
trellis dev <id> activations revoke <instance-id>
trellis dev <id> reviews list [--instance <id>] [--state <pending|approved|rejected>]
trellis dev <id> reviews approve <review-id> [--reason <code>]
trellis dev <id> reviews reject <review-id> [--reason <code>]

trellis local init --out <dir>
trellis infra apply --trellis-creds <path> --auth-creds <path> [--servers <servers>] [--jetstream-replicas <n>]
trellis infra check --trellis-creds <path> --auth-creds <path> [--servers <servers>]
trellis init admin --identity <provider>:<subject> [--db-path <path>]
trellis keys new [--seed <seed>] [--out <path>] [--pubout <path>]
trellis upgrade check [--prerelease]
trellis upgrade install [--prerelease]
trellis version
trellis completion <shell>
```

Operational command behavior:

- `trellis login <url>` is a normal contract-bearing client login, not a
  bootstrap bypass; it enters the auth-owned browser flow and continues through
  the resolved portal before storing local session material for later admin RPC
  calls; runtime transport details are discovered from the bind flow and
  persisted internally rather than exposed as normal CLI flags
- normal authenticated CLI commands reconnect with freshly generated runtime
  auth proofs derived from the stored session key, presented contract digest,
  and `iat`; the contract digest is the presented contract identity, not a hash
  of human-facing display metadata; when the local CLI contract digest changes,
  the CLI starts the normal auth request flow with the full contract, may
  complete immediately when existing identity authority already covers the new
  requested needs, otherwise prints the detached portal login URL, may render a
  QR code, does not auto-open a browser or start a localhost callback listener,
  and completes by polling the auth-owned flow before reconnecting NATS and
  issuing admin RPCs
- generic NATS authorization failures during authenticated command reconnects do
  not by themselves prove the stored local session was revoked; the CLI
  preserves local session material unless auth returns an explicit
  `session_not_found`, `revoked`, or `rejected` signal
- `trellis whoami` shows the currently stored admin session, and
  `trellis logout` revokes that session and clears local session state
- `trellis users list`, `trellis users show`, `trellis users create`, and
  `trellis users edit` manage Trellis users by Trellis `userId`; provider
  identities are not the normal user-scoped administration key
- `trellis users create` can seed direct capabilities and capability groups and
  creates a local password reset/setup link for the new user when account setup
  is required
- `trellis users edit` supports explicit add/remove/set/clear semantics for
  direct capabilities and capability groups so operators can make incremental or
  replacement changes without ambiguous merge behavior
- `trellis identity grants list` shows stored delegated identity grants for app
  and CLI contracts from the `trellis` service; each row includes an
  `identityGrantId` and presented contract digest, with optional filtering by
  exact contract digest and by user for admin callers; the command pages through
  the bounded identity-grant list RPC rather than requesting an unbounded list
- `trellis identity grants revoke` revokes the addressed identity grant through
  the identity-authority RPC surface and revokes matching active delegated
  sessions in the `trellis` service; contract digest remains list/filter
  evidence, not the revocation key
- `trellis portals *` is the admin-oriented login portal surface. It reflects
  the same `Auth.Portals.*` RPCs used by Console for listing visible portals,
  creating, updating, or removing non-built-in portal records, updating the
  built-in login portal policy, and managing login route selectors. The built-in
  login portal is visible, non-deletable, and not replaceable through portal
  upsert. Login settings include configured federated provider display and the
  `allowedFederatedProviders` policy; route ids are internal RPC keys rather
  than the primary operator-facing route shape.
- `trellis svc` manages service deployments and `trellis dev` manages device
  deployments. Both use resource-first command shape: the deployment ID appears
  before the action for single-resource operations, for example
  `trellis svc payments apply --manifest contract.json`.
- `trellis svc <id> apply` and `trellis dev <id> apply` resolve a contract
  proposal from source, manifest, or OCI image, call
  `Auth.DeploymentAuthority.Plan`, and require an explicit operator accept path
  for pending authority updates or migrations. `mutable-dev` same-contract
  replacement migrations may already be auto-accepted by bootstrap, but the plan
  remains visible in history. Accepting a plan mutates desired authority and
  schedules reconciliation; reconciliation is the only path that materializes
  resource and binding changes.
- `trellis <svc|dev> <id> authority plan list` discovers pending and historical
  authority plans, optionally filtered by `--state` or `--classification`, and
  `trellis <svc|dev> <id> authority plan show <PLAN_ID>` shows one plan for
  review before accepting or rejecting it.
- `trellis grants list [--deployment <id>]`,
  `trellis grants add --deployment <id> ...`, and
  `trellis grants remove --deployment <id> ...` inspect and mutate deployment
  grant overrides through `Auth.DeploymentAuthority.List`,
  `Auth.DeploymentAuthority.Get`, `Auth.DeploymentAuthority.GrantOverrides.Put`,
  `Auth.DeploymentAuthority.GrantOverrides.List`, and
  `Auth.DeploymentAuthority.GrantOverrides.Remove`. Grant overrides are modeled
  as deployment-owned policy rows rather than service or device subcommands.
  They use `contractId + origin` for web grants and
  `contractId + sessionPublicKey` for session-keyed grants.
- admin-triggered reconciliation uses `Auth.DeploymentAuthority.Reconcile` for
  repair, retry, or manual convergence. It is not the normal happy-path
  follow-up to every accept because accept already schedules reconciliation
  after commit.
- `trellis dev <id> provision` is the ergonomic provisioning path for device
  development and deployment: it generates a root secret locally, derives the
  device keys, registers the instance with auth using activation-only secret
  material, optionally captures device metadata such as `name`, `serialNumber`,
  `modelNumber`, and deployment-specific opaque keys, and emits the provisioning
  bundle for the device or operator
- `trellis svc <id> provision` provisions concrete service principals under one
  service deployment, optionally from an operator-provided instance seed
- `trellis svc <id> instances` and `trellis dev <id> instances` are the
  lower-level instance inspection surfaces; the default device table promotes
  `name`, `serial`, and `model` columns when present, while `--show-metadata`
  reveals the remaining opaque metadata entries; instance and review list
  commands must pass an explicit page size to the underlying admin list RPC and
  may pass deployment/state filters
- `trellis dev <id> reviews *` manages pending device review decisions and is
  intended for `trellis.auth::device.review` automation services or admins
- service deployments own deployment authority, namespace allowance, and
  reversible deployment state; runtimes receive only reconciled materialized
  authority
- service instances are concrete service principals under one deployment,
  including provisioning, inspection, and reversible lifecycle changes
- deployment create flows are intentionally metadata-light; human-facing
  contract names continue to come from reviewed contract metadata rather than
  from a separate deployment-local `displayName` or `description`
- deployments may rely on the built-in Trellis portal with no portal setup, or
  register one or more custom portals, choose login portal selectors for
  specific browser contracts and origins, and configure device portal routing
  through device deployment metadata; install automation may offer convenience
  wrappers, but the underlying actions remain explicit admin calls
- `trellis local init` is the ergonomic local development bootstrap. It
  generates a runnable bundle containing local NATS operator/account/JWT
  artifacts, Trellis/Auth service credentials, auth-callout signing and xkey
  seeds, sentinel credentials, `trellis/config.jsonc`, a local session seed, a
  local SQLite data directory, and a root manifest. The generated Trellis config
  is local-identity-first: it enables username/password login and does not
  require federated identity provider setup for the first local admin. The
  generated Trellis config uses relative file paths so the bundle can be moved
  as a directory, and command flags allow overriding the public Trellis origin
  plus native and websocket NATS URLs when containers map ports dynamically.
- `trellis infra apply` creates the shared event stream and Trellis-owned KV
  buckets needed before the runtime starts; these buckets are for OAuth state,
  pending auth, browser flows, active connection presence, and the public
  Trellis State API; `--jetstream-replicas` defaults to `1` for standalone
  installs and should match the target NATS topology, commonly `3` for
  production clusters
- `trellis infra check` reports whether the shared runtime infrastructure is
  ready for Trellis services without creating or updating streams or buckets
- the normal first-admin path is the auth-owned admin bootstrap flow printed by
  the Trellis server on first boot. That built-in portal creates a local
  username/password admin and assigns `capabilityGroups: ["admin"]` with no
  direct capabilities, so first-admin authority follows the same group model as
  later users. `trellis init admin --identity <provider>:<subject>` remains an
  offline initialization utility for explicit operator workflows, not the
  beginner local setup path.
- `trellis keys new` remains an explicit offline utility for operators who want
  to separate key generation from install
- `trellis upgrade check` and `trellis upgrade install` replace the previous
  `self` command family
- the runtime/operator CLI no longer exposes direct transport flags like
  `--servers` or `--creds` outside explicit infrastructure bootstrap flows

Normal authenticated CLI behavior is contract-governed in the same architectural
sense as browser apps: the CLI presents a generated contract, an identity grant
is stored in identity authority anchored to the CLI session public key, and
Trellis auth does not create normal client sessions without a presented contract
that fits that identity authority.

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
- multi-contract TypeScript/JavaScript projects use `contracts/*.ts` or
  `contracts/*.js`, and those files default export the contract module that
  `trellis-generate` should load
- Deno-configured TypeScript projects resolve source modules with Deno; Node
  package projects resolve TypeScript source modules with `tsx` and JavaScript
  source modules with Node
- generated JSR packages target Deno/JSR consumers, while generated npm packages
  target Node/npm consumers and are produced without requiring Deno
- npm package generation uses the Node TypeScript compiler (`tsc`), resolved
  from the project, `PATH`, or `TRELLIS_TSC_BIN`
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
- operators may plan authority updates or authority migrations from generated
  manifests or OCI images that embed `/trellis/contract.json`
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
lives in the public `trellis` and `trellis-contracts` packages plus dedicated
internal workspace crates:

- `trellis`
- `trellis-contracts`
- `trellis-codegen-ts`
- `trellis-codegen-rust`
- Trellis-owned generated SDK modules exposed under
  `trellis::sdk::{auth, core, health, jobs, state}`

The current CLI implementation uses the Trellis-owned SDK modules plus local
helper modules for command parsing, auth session storage, contract resolution,
and self-update behavior.

## References

- `design/contracts/trellis-contracts-catalog.md`
- `design/contracts/trellis-rust-contract-libraries.md`
- `design/contracts/trellis-typescript-contract-authoring.md`
