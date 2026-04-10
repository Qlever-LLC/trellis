---
title: Trellis CLI
description: CLI design for contract builds, SDK generation, verification, and source- or image-based service installation.
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

Trellis needs one supported CLI entrypoint for:

- operational bootstrap and admin commands
- service install and upgrade flows that use locally generated keys
- contract verification
- SDK generation

The repository previously split those concerns across:

- an ad hoc Rust CLI for a few operational commands
- a separate Rust verification binary for live catalog digest checks
- TypeScript and Deno scripts for SDK generation

That split made the system harder to understand, harder to reuse from other
repos, and inconsistent with the source-first contract architecture.

## Design

Trellis uses a Rust `trellis` CLI as the only supported contract and SDK build
entrypoint.

The CLI works from contract sources during development and from release
artifacts during install and upgrade. Canonical `trellis.contract.v1` JSON
remains an exchange artifact, but it is generated output rather than a committed
source file.

### Command structure

```text
trellis <command> [subcommand] [options]
```

The preferred source-to-artifact interface is the top-level `generate` command
family:

```text
trellis generate manifest (--source <file> | --manifest <file> | --image <ref>) --out <file>
trellis generate ts (--source <file> | --manifest <file> | --image <ref>) --out <dir>
trellis generate rust (--source <file> | --manifest <file> | --image <ref>) --out <dir>
trellis generate all (--source <file> | --manifest <file> | --image <ref>) --out-manifest <file> [--ts-out <dir>] [--rust-out <dir>]
```

These commands:

- resolve contract inputs from source modules, generated manifests, or OCI
  images
- validate canonical manifests against `trellis.contract.v1`
- compute canonical JSON and digests
- generate language SDKs from the resolved contract inputs
- preserve the current TypeScript generated surface where practical
- generate Rust SDK crates that target `trellis-client` and `trellis-server`

The CLI also retains compatibility aliases and utility surfaces that map to the
same underlying workflows:

```text
trellis contracts build --source <file> --out-manifest <file> [--ts-out <dir>] [--rust-out <dir>]
trellis contracts verify (--source <file> | --manifest <file> | --image <ref>)
trellis contracts pack [--manifest <file> ...] [--source <file> ...] [--image <ref> ...] --output <file>
trellis contracts verify-live --servers <servers> --creds <path> --session-seed <seed> [--limit <n>]
trellis sdk generate ts (--source <file> | --manifest <file> | --image <ref>) --out <dir>
trellis sdk generate rust (--source <file> | --manifest <file> | --image <ref>) --out <dir>
trellis sdk generate all (--source <file> | --manifest <file> | --image <ref>) --ts-out <dir> --rust-out <dir>
```

`trellis contracts build` and `trellis sdk generate ...` remain compatibility
aliases for repos and scripts that have not yet moved to `trellis generate ...`.
`trellis contracts pack` remains an explicit artifact utility rather than the
primary runtime discovery workflow.

The CLI may accept explicit package and crate naming flags when the default name
inference is not enough for a repository.

### Operational commands

The CLI keeps and cleans up the existing operational commands:

```text
trellis auth login ...
trellis auth logout
trellis auth status
trellis auth approvals list [--user <origin.id>] [--digest <contractDigest>]
trellis auth approvals revoke --digest <contractDigest> [--user <origin.id>]
trellis portals list
trellis portals create --portal-id <id> --entry-url <url> [--app-contract-id <contractId>]
trellis portals disable --portal-id <id>
trellis portals logins default show
trellis portals logins default set (--builtin | --portal-id <portalId>)
trellis portals logins list
trellis portals logins set --contract-id <contractId> (--builtin | --portal-id <portalId>)
trellis portals logins clear --contract-id <contractId>
trellis portals workloads default show
trellis portals workloads default set (--builtin | --portal-id <portalId>)
trellis portals workloads list
trellis portals workloads set --profile <profileId> (--builtin | --portal <portalId>)
trellis portals workloads clear --profile <profileId>
trellis workloads profiles list [--contract <contractId>] [--disabled]
trellis workloads profiles create --profile <id> --contract <contractId|path> [--review-mode <none|required>]
trellis workloads profiles disable --profile <id>
trellis workloads provision --profile <id>
trellis workloads instances list [--profile <id>] [--state <registered|activated|revoked|disabled>]
trellis workloads instances disable --instance <id>
trellis workloads activations list [--instance <id>] [--profile <id>] [--state <activated|revoked>]
trellis workloads activations revoke --instance <id>
trellis workloads reviews list [--instance <id>] [--profile <id>] [--state <pending|approved|rejected>]
trellis workloads reviews decide --review <id> (--approve | --reject) [--reason <code>]
trellis bootstrap nats ...
trellis bootstrap admin ...
trellis keygen ...
trellis service list
trellis service install (--source <file> | --manifest <file> | --image <ref>) [-f]
trellis service upgrade (--source <file> | --manifest <file> | --image <ref>) [--service-key <public-key>|--seed <seed>] [-f]
```

Operational command behavior:

- `trellis auth login` is a normal contract-bearing client login, not a
  bootstrap bypass; it enters the auth-owned browser flow and continues through
  the resolved portal before storing local session material for later admin
  RPC calls
- `trellis portals *` manages registered custom portal web apps used to replace
  the built-in Trellis portal for login flows, workload flows, or both; an
  optional `app-contract-id` attaches a normal browser app contract for portals
  that later call Trellis as the logged-in user
- `trellis portals logins *` manages deployment-owned login portal policy,
  including the deployment login default and any contract-specific selections
- `trellis portals workloads *` manages deployment-owned workload portal policy,
  including the deployment workload default and any profile-specific selections
- `trellis auth approvals list` shows stored app approval decisions from the
  `trellis` service, with server-side filtering by exact contract digest and
  optionally by user when the caller is an admin
- `trellis auth approvals revoke` removes a stored `user <-> contractDigest`
  decision and causes matching active delegated sessions to be revoked by the
  `trellis` service
- `trellis workloads profiles *` manages workload classes, allowed digests, and
  review policy for activated workloads; when given a local contract source,
  profile creation also registers that contract digest in the catalog so
  workload-only contracts do not need a service install step; portal selection
  for workloads is managed under `trellis portals workloads *`
- `trellis workloads provision` is the ergonomic provisioning path for workload
  development and deployment: it generates a root secret locally, derives the
  workload keys, registers the instance with auth using activation-only secret
  material, and emits the provisioning bundle for the device or operator
- `trellis workloads instances *` remains the lower-level instance inspection and
  disable surface
- `trellis workloads reviews *` manages pending workload review decisions and is
  intended for `workload.review` automation services or admins
- deployments may rely on the built-in Trellis portal with no portal setup, or
  register one or more custom portals, optionally choose separate login and
  workload default custom portals, assign portals to specific browser contracts
  or workload profiles, then create workload profiles and provision workload
  instances for activated-workload flows; install automation may offer
  convenience wrappers, but the underlying actions remain explicit admin calls
- `trellis bootstrap nats` creates the shared stream and auth-owned KV buckets
  needed before the runtime starts; it also updates existing bucket TTLs to
  match auth config values such as `ttlMs.bindingTokens.bucket`; this is an
  explicit super-user path that talks directly to NATS with credentials
- `trellis bootstrap admin` bootstraps the initial admin user in auth's local
  user projection; by default it seeds `admin`, `trellis.catalog.read`, and
  `trellis.contract.read` so the first console user can load discovery data
- `trellis service install` resolves a contract from source, a generated
  manifest, or an OCI image, generates the Ed25519 seed locally by default,
  shows an operator review, and sends only the public key and canonical contract
  to the `trellis` service's auth admin surface
- `trellis service upgrade` resolves the new contract revision from source, a
  generated manifest, or an OCI image and updates the contract bound to an
  existing service public key; `--seed` or `--service-key` may be used when the
  target service is ambiguous
- `trellis keygen` remains an explicit offline utility for operators who want to
  separate key generation from install

Normal authenticated CLI behavior is contract-governed in the same architectural
sense as browser apps: the CLI has a generated participant contract, approval is
stored against the exact contract digest, and Trellis auth does not create
normal client sessions without such a contract.

### Explicitness rule

The CLI prefers explicit commands over vague orchestration commands.

Do not add commands like `trellis build project` with ambiguous behavior.

## Contract boundary

The developer-facing CLI boundary is the contract source.

- service repos own their contract modules alongside implementation code
- the `trellis` runtime service may own multiple logical contracts such as
  `trellis.core@v1` and `trellis.auth@v1`
- the CLI generates canonical manifests into build output when it needs a
  release artifact
- app and service repos SHOULD wrap contract build or verify work into their normal `dev`, `build`, and CI tasks rather than making end users run separate manifest commands during routine browser-app development
- operators may install or upgrade from generated manifests or OCI images that
  embed `/trellis/contract.json`
- OCI images may override that default path with the `io.trellis.contract.path`
  label

`generated/` contains derived manifests and SDKs only.

## Implementation

The Rust CLI implementation uses:

- `clap` for command parsing and help text
- `clap_complete` for shell completions
- `miette` for diagnostics
- `tracing` and `tracing-subscriber` for logging
- `comfy-table` for human-readable tabular output
- Rust crates for contract validation, packing, and code generation

The CLI owns explicit contract and SDK command execution. Repo-specific build
workflows remain wrapper scripts or tasks around those explicit commands. Shared
logic lives in dedicated Rust crates:

- `trellis-contracts`
- `trellis-codegen-ts`
- `trellis-codegen-rust`
- `trellis-client`
- `trellis-server`
- generated SDK crates for Trellis-owned contracts such as `trellis-sdk-core`
  and `trellis-sdk-auth`
- a generated local participant facade crate for the CLI
  (`trellis-cli-participant`), built from the CLI participant manifest plus
  explicit alias-to-SDK mappings

The CLI's own runtime contract access should primarily flow through that
participant facade rather than by wiring multiple SDK clients directly into the
CLI binary.

## References

- `design/contracts/trellis-contracts-catalog.md`
- `design/contracts/trellis-rust-contract-libraries.md`
- `design/contracts/trellis-typescript-contract-authoring.md`
