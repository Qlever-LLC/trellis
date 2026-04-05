# ADR: Trellis CLI

## Context

Trellis needs one supported CLI entrypoint for:

- operational bootstrap and admin commands
- service install and upgrade flows that use locally generated keys
- contract verification
- SDK generation

The repository previously split those concerns across:

- an ad hoc Rust CLI for a few operational commands
- a separate Rust verification binary for live catalog digest checks
- TypeScript/Deno scripts for TS SDK generation

That split made the system harder to understand, harder to reuse from other repos,
and inconsistent with the source-first contract architecture.

## Design

Trellis uses a single Rust CLI as the supported entrypoint for contract work, service installation, and operational admin commands. The same CLI is also the natural place for future device-activation tooling, so the command tree stays explicit and narrow rather than growing a second orchestration path.

Trellis uses a Rust `trellis` CLI as the only supported contract and SDK build
entrypoint.

The preferred source-to-artifact interface is `trellis generate`; the existing
`contracts` and `sdk` command trees remain compatibility aliases for now.

The CLI works from contract sources during development and from release artifacts
during install and upgrade. Canonical `trellis.contract.v1` JSON remains an
exchange artifact, but it is generated output rather than a committed source file.

### Command structure

```text
trellis <command> [subcommand] [options]
```

### Generate commands

```text
trellis generate manifest (--source <file> | --manifest <file> | --image <ref>) --out <file>
trellis generate ts (--source <file> | --manifest <file> | --image <ref>) --out <dir>
trellis generate rust (--source <file> | --manifest <file> | --image <ref>) --out <dir>
trellis generate all --source <file> --out-manifest <file> [--ts-out <dir>] [--rust-out <dir>]
```

Responsibilities:

- resolve contract inputs from source modules, generated manifests, or OCI images
- validate canonical manifests against `trellis.contract.v1`
- compute canonical JSON and digests

- generate language SDKs from resolved contract inputs
- preserve the current TS generated surface where practical
- generate initial Rust SDK crates targeting `trellis-client` and `trellis-server`
- keep the old live digest verification behavior under the main CLI
- when generating from a manifest or image outside a versioned workspace, accept an explicit `--artifact-version`

Legacy compatibility commands remain available for verification and packaging:

```text
trellis contracts build --source <file> --out-manifest <file> [--ts-out <dir>] [--rust-out <dir>]
trellis contracts verify (--source <file> | --manifest <file> | --image <ref>)
trellis contracts verify-live --servers <servers> --creds <path> --session-seed <seed> [--limit <n>]
trellis sdk generate facade ...
```

The legacy `trellis contracts ...` and `trellis sdk ...` commands remain as
compatibility aliases until downstream repos migrate.

The CLI may also accept explicit package/crate naming flags when the default name
inference is not enough for a repository.

### Operational commands

The CLI keeps and cleans up the existing operational commands:

```text
trellis auth login ...
trellis auth logout
trellis auth status
trellis auth approvals list [--user <origin.id>] [--digest <contractDigest>]
trellis auth approvals revoke --digest <contractDigest> [--user <origin.id>]
trellis bootstrap nats ...
trellis bootstrap admin ...
trellis keygen ...
trellis service install (--source <file> | --manifest <file> | --image <ref>) [-f]
trellis service upgrade (--source <file> | --manifest <file> | --image <ref>) [--service-key <public-key>|--seed <seed>] [-f]
```

Rules for service admin commands:

- `trellis auth login` is a normal contract-bearing client login, not a bootstrap bypass; it uses the auth-owned approval flow for the CLI contract before storing local session material for later admin RPC calls, and Trellis returns the browser/client websocket endpoints that belong to the instance being used
- `trellis auth approvals list` shows stored app approval decisions from the `trellis` service, with server-side filtering by exact contract digest and optionally by user when the caller is an admin
- `trellis auth approvals revoke` removes a stored `user <-> contractDigest` decision and causes matching active delegated sessions to be revoked by the `trellis` service
- `trellis bootstrap nats` creates the shared stream and Auth-owned KV buckets needed before the runtime starts; this is an explicit super-user path that talks directly to NATS with creds
- `trellis bootstrap admin` bootstraps the initial admin user in Auth's local user projection; by default it seeds `admin`, `trellis.catalog.read`, and `trellis.contract.read` so the first console user can load discovery data, and it remains an explicit super-user path outside the normal Trellis auth flow
- `trellis service install` resolves a contract from source, a generated manifest, or an OCI image, generates the Ed25519 seed locally by default, shows an operator review, and sends only the public key and canonical contract to the `trellis` service's `trellis.auth@v1` admin surface
- `trellis service upgrade` resolves the new contract revision from source, a generated manifest, or an OCI image and updates the contract bound to an existing service public key; `--seed` or `--service-key` may be used when the target service is ambiguous
- `trellis keygen` remains available as an explicit offline utility for operators who want to separate key generation from install

Normal authenticated CLI behavior must be contract-governed in the same architectural sense as browser apps: the CLI has a generated participant contract, approval is stored against the exact contract digest, and Trellis auth should not create normal client sessions without such a contract.

### Explicitness rule

The CLI must prefer explicit commands over vague orchestration commands.

Do not add commands like `trellis build project` with ambiguous behavior.

## Contract boundary

The developer-facing CLI boundary is the contract source.

- service repos own their contract modules alongside implementation code
- the `trellis` runtime service may own multiple logical contracts such as
  `trellis.core@v1` and `trellis.auth@v1`
- the CLI generates canonical manifests into build output when it needs a release artifact
- operators may install or upgrade from generated manifests or OCI images that embed `/trellis/contract.json`
- OCI images may override that default path with the `io.trellis.contract.path` label

`generated/` contains derived manifests and SDKs only, and is ignored by git.

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
- generated SDK crates for Trellis-owned contracts such as `trellis-sdk-core` and `trellis-sdk-auth`, emitted as build output rather than tracked workspace crates

The CLI's own runtime contract access should primarily flow through the low-level client runtime plus small local auth/core helpers, rather than by wiring generated SDK crates directly into the CLI binary.

CI should build the CLI once when possible and reuse that binary for repeated generation steps inside a workflow.

This direction intentionally accepts a few implementation constraints: Trellis will carry more Rust code for packaging and code generation, `--source` resolution still assumes the service repo can be loaded through Deno where that path is used, and the Rust SDK/runtime surface may remain thinner than the mature TypeScript path while it catches up.

## Consequences

### Benefits

- one supported CLI entrypoint for contract and SDK workflows
- one supported CLI entrypoint for secure service installation and contract upgrade
- consistent behavior across in-repo and out-of-repo services
- source-first tooling boundary across languages, with generated manifests as the shared exchange artifact
- easier future distribution and reuse from non-Deno repos
- fewer duplicated implementations across Rust and Deno scripts

## References

- `design/adr-trellis-contracts-catalog.md`
- `docs/plans/2026-03-19-rust-cli-contracts-and-sdks.md`
