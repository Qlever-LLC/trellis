---
title: Trellis CLI
description: CLI design for the operator/runtime and package-manager `trellis` CLI.
order: 10
---

# Design: Trellis CLI

## Prerequisites

- [../contracts/trellis-api-participants.md](./../contracts/trellis-api-participants.md) -
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

Trellis uses one public `trellis` CLI for runtime, operator, and package-manager
workflows. Contract generation is an internal library invoked by
`trellis install` after locked dependencies are staged.

Canonical native `trellis.api.v1` and `trellis.participant.v1` JSON remains an
exchange artifact, but it is generated output rather than a committed source
file.

### Command structure

```text
trellis <command> [subcommand] [options]
```

Repository development uses the same package-manager boundary:

```text
cargo xtask install
cd ts && deno task install
cargo xtask build
```

`cargo xtask install` runs the repository's fixed project DAG.
`cargo xtask
build` installs first and then invokes the default Rust workspace
build. Live client-library integration is language-owned and is run outside
`cargo xtask build`: use `deno task -c ts/deno.json test:integration` for the
TypeScript suite and
`cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration -- --nocapture`
for the Rust suite. Both suites are governed by the `kind: "client"` cases in
`integration/client-test-matrix.json`; every supported client language must
cover every client matrix case against a live Trellis runtime.

Installation:

- resolve contract inputs from source modules, generated APIs, or OCI images
- validate canonical native API artifacts against native `trellis.api.v1` and
  `trellis.participant.v1`
- compute canonical JSON and digests
- generate language-specific SDK artifacts inside the consuming project
- generate service/app-owned Cargo SDK crates that use the public `trellis`
  facade and its internal generator/runtime support
- use required contract `kind` metadata to decide discovery behavior: `service`
  generates API, TypeScript, and Cargo artifacts; `app` generates API and
  TypeScript artifacts; `agent` and `device` contracts are verified, with Rust
  participant facades generated where applicable
- discovery uses configured package/workspace entries and explicit contract
  source inputs; it does not implicitly scan `src/lib` for contracts

The CLI may accept explicit package and crate naming flags when the default name
inference is not enough for a repository.

### Operational commands

The runtime/operator CLI uses a clean-break command model. Removed command
families such as `auth`, `deploy`, `deployment`, `deployments`, `dep`, `d`,
`bootstrap`, `self`, and `keygen` are not compatibility aliases. Public commands
prefer operator-facing resources (`users`, `svc`, `dev`) over implementation
namespaces.

These command surfaces describe the intended operator model. The current Rust
`trellis-server` HTTP runtime exposes only `/healthz` and `/readyz`; auth,
portal, and CLI login flows require a runtime path that explicitly includes the
auth and portal services.

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
trellis svc <id> apply (--source <path> | --api <path> | --image <ref>)
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
trellis dev <id> apply (--source <path> | --api <path> | --image <ref>)
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

trellis init config --out <dir> [--name <name>] [--server-name <name>]
trellis-server [--config <path>] [--system] [--local-nats[=<path>]] [--nats-download] [--dev] [--verbose] [--reset-admin] [all|platform|jobs|health|eventlog]
trellis-server check [--config <path>] [--system] [--local-nats[=<path>]] [--nats-download] [--dev] [--verbose] [all|platform|jobs|health|eventlog]
trellis infra trust init --out <dir> --authority <authority> [--force]
trellis infra trust rotate-issuer --dir <dir> [--revoke <issuer-key-id>]
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
  `trellis svc payments apply --api contract.json`.
- `trellis svc <id> apply` and `trellis dev <id> apply` resolve a contract
  proposal from source, native API, or OCI image, call
  `Auth.DeploymentAuthority.Plan`, and require an explicit operator accept path
  for updates that grant new capabilities or add resource aliases, plus strict
  migrations. Safe updates and `mutable-dev` migrations may already be
  auto-accepted by bootstrap, but accepted plans remain visible in history.
  Accepting a plan mutates desired authority and schedules reconciliation;
  reconciliation is the only path that materializes resource and binding
  changes.
- `trellis <svc|dev> <id> authority plan list` discovers pending and historical
  authority plans, optionally filtered by `--state` or `--classification`, and
  `trellis <svc|dev> <id> authority plan show <PLAN_ID>` shows one plan for
  review before accepting or rejecting it.
- the retired top-level `trellis grants` command tree is rejected. Trusted
  browser authority is portal/application policy managed through
  `Auth.Portals.GrantOverrides.*`; deployment authority changes continue through
  immutable plan review and acceptance.
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
- `trellis init config` is the Trellis configuration/bootstrap generator. It
  generates a runnable bundle containing Rust-native NATS operator/account/JWT
  artifacts, Trellis/Auth service credentials, auth-callout signing and xkey
  seeds, sentinel credentials, `config.toml`, and a SQLite data directory. It
  generates this material in-process using Rust NATS JWT/NKEY libraries, without
  shelling out to external generators. The generated Rust runtime config is
  local-identity-first: it enables username/password login and does not require
  federated identity provider setup for the first admin. The generated Trellis
  config uses relative file paths so the bundle can be moved as a directory, and
  command flags allow overriding the public Trellis origin plus native and
  websocket NATS URLs when containers map ports dynamically. The generated
  Trellis display name defaults to `Trellis`; the NATS operator name also
  defaults to `Trellis`; the system account defaults to `SYS`; and the generated
  NATS `server_name` defaults to a slug derived from the Trellis name, with
  `--server-name` available for an explicit NATS server-name override. The
  generated bundle also includes a private `session.seed` file (32-byte
  event-session seed) at the bundle root, referenced from `config.toml`.
- `trellis-server [OPTIONS] [MODE]` is the server process entrypoint; `trellis`
  has no server subcommand. Plain startup uses `[nats].servers` from config and
  never spawns or downloads NATS. `--local-nats` resolves `nats-server` from
  `PATH`, `--local-nats=<path>` validates and uses that exact executable, and
  `--nats-download` explicitly downloads and verifies the pinned release.
  `--dev` selects user paths, PATH NATS, verbose attached output, and no weaker
  security behavior. `--system` selects `/etc/trellis`, `/var/lib/trellis`,
  `/var/cache/trellis`, `/run/trellis`, and `/var/log/trellis`; otherwise XDG
  user paths apply. Read-only local NATS source lives under the config root,
  while mutable state, runtime files, downloads, and logs use their
  corresponding profile roots. Supported modes remain `all`, `platform`, `jobs`,
  `health`, and `eventlog`.
- the runtime OCI image ships the `trellis` CLI and the pinned nats-server baked
  in at `/usr/local/bin/nats-server` (downloaded and checksum-verified at image
  build time against `conformance/nats-binaries.json`, never at container
  runtime); `nsc` is NOT in the image because the Rust bootstrap generates all
  NATS material natively. The image's `ENTRYPOINT` stays `trellis-server` for
  the external-NATS/quadlet deployment path, which is unchanged. Single-
  container managed deployments run the server with a read-only config volume
  and writable state volume:

  ```sh
  docker volume create trellis-state
  # Generate the bundle into the writable volume first (once), as the image's
  # non-root user:
  docker run --rm --user 10001:10001 --entrypoint trellis \
    --volume trellis-state:/var/lib/trellis ghcr.io/qlever-llc/trellis:latest \
    init config --out /var/lib/trellis/bundle
  # The bundle's runtime SQLite dir must exist so it can overlay the read-only mount:
  docker run --rm --user 10001:10001 --entrypoint mkdir \
    --volume trellis-state:/var/lib/trellis ghcr.io/qlever-llc/trellis:latest \
    -p /var/lib/trellis/bundle/data
  docker run --rm --name trellis --read-only --tmpfs /tmp \
    --tmpfs /run/trellis:uid=10001,gid=10001,mode=0700 \
    --tmpfs /var/log/trellis:uid=10001,gid=10001,mode=0700 \
    --user 10001:10001 --publish 3000:3000 \
    --volume trellis-state:/var/lib/trellis \
    --volume trellis-state/bundle:/etc/trellis:ro \
    --volume trellis-state/bundle/data:/etc/trellis/data \
    --entrypoint trellis-server ghcr.io/qlever-llc/trellis:latest \
    --system all --local-nats=/usr/local/bin/nats-server
  ```

  The bundle is mounted read-only; omitted SQLite paths use the system profile's
  `/var/lib/trellis` data root. All mutable NATS files go to
  `/var/lib/trellis/nats`; the bundle's `nats/` directory (config, credentials,
  resolver preloads) is only read. The image never downloads nats-server at
  container runtime. Quadlet/external-NATS deployments keep running
  `trellis-server` unchanged with their own NATS container.
- runtime startup safely converges only the Trellis-owned resources selected by
  its mode. Platform owns the canonical event stream and Auth KV registries,
  Jobs owns its three streams, Health owns its transport stream, and Event Log
  owns the canonical event stream. `all` converges their deduplicated union
- `trellis-server check --config <path> <mode>` is the server-owned preflight
  for the same positive mode-derived resource set. Missing selected-mode
  resources fail; missing unrelated resources do not. The default mode is `all`,
  and the JSON report contains the same selected checks used by startup
- `trellis infra trust init` and `trellis infra trust rotate-issuer` remain
  focused offline tooling for file-backed authorization roots, issuer
  certificates, manifests, and immutable history. They do not apply or check
  runtime streams, KV buckets, or databases
- the normal first-admin path is the auth-owned admin bootstrap flow printed by
  the Trellis server on first boot. That built-in portal creates a local
  username/password admin and assigns `capabilityGroups: ["admin"]` with no
  direct capabilities, so first-admin authority follows the same group model as
  later users. `trellis init admin --identity <provider>:<subject>` remains an
  offline initialization utility for explicit operator workflows, not the
  beginner local setup path. The Rust Platform runtime owns the bootstrap route,
  embedded portal, and first-admin account-flow completion.
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

### Project API dependency files

The CLI project model reads `trellis.toml` API dependencies keyed by stable API
ID, with a Semantic Version requirement and exactly one source: a local
canonical artifact path or a named OCI registry. Registry configuration is a
named host/repository prefix with an optional project default. `trellis.lock`
records exact release and semantic API digests; remote entries also record the
exact OCI manifest digest. Release and OCI distribution identity remain package
metadata; runtime evidence remains stable API ID plus semantic digest.

`trellis add`, `trellis rm`, and `trellis update` resolve local paths or the
highest matching Semantic Version OCI tag and write an exact lock. Remote
artifacts are canonical `trellis.api.v1` JSON layers in deterministic OCI image
manifests. `trellis install` is lock-stable: remote installs pull by OCI digest,
validate the manifest, layer, API identity, release, and semantic digest, and
use a content-addressed global cache. It then follows the same consumer-local
SDK generation path as local dependencies under disposable `.trellis/` output.
It never executes a dependency producer's source and never changes project
files. `trellis publish` publishes project-owned canonical APIs, reuses
Docker-compatible credentials, keeps release tags immutable, requires
monotonically increasing releases, and uses `compare_api_replacement` to reject
incompatible releases under an existing stable API ID. Dependency SDKs are
generated before the consumer's own participant source is evaluated, while
participant evidence continues to pin only API ID plus semantic digest.

## Contract boundary

The developer-facing CLI boundary is the contract source.

- project roots keep contract sources next to `deno.json`, `deno.jsonc`,
  `package.json`, or `Cargo.toml`
- single-contract TypeScript/JavaScript projects may use a top-level
  `contract.ts` or `contract.js`, and that file default exports the contract
  module that installation loads
- multi-contract TypeScript/JavaScript projects use `contracts/*.ts` or
  `contracts/*.js`, and those files default export the contract module that
  installation loads
- Deno-configured TypeScript projects resolve source modules with Deno; Node
  package projects resolve TypeScript source modules with `tsx` and JavaScript
  source modules with Node
- generated TypeScript SDKs are private project-local installation output
- Rust projects use `contracts/*.rs` source modules with native API and
  participant artifact functions; those modules build artifacts with Rust code
  or wrap checked-in native API JSON
- every contract source must declare a required `kind`
- the `trellis` runtime service may own multiple logical contracts such as
  `trellis.core@v1`, `trellis.auth@v1`, and `trellis.state@v1`
- installation emits canonical native API artifacts into project-local output
- app and service repos SHOULD wrap `trellis install` into their normal `dev`,
  `build`, and CI tasks rather than making end users run separate manifest
  commands during routine browser-app development
- operators may plan authority updates or authority migrations from generated
  native API artifacts or OCI images that embed `/trellis/api.json`
- OCI images may override that default path with the `io.trellis.contract.path`
  label

`.trellis/` contains derived native artifacts and SDKs only. TypeScript
consumers import `@trellis/apis/<lineage>` and Rust consumers import
`trellis_apis::<module>`.

## Implementation

The Rust implementation uses:

- `clap` for command parsing and help text
- `clap_complete` for shell completions
- `miette` for diagnostics
- `tracing` and `tracing-subscriber` for logging
- `comfy-table` for human-readable tabular output
- Rust crates for operator flows, contract validation, packing, and code
  generation

The CLI owns explicit operational and package-manager command execution.
Repo-specific build workflows remain wrapper scripts or tasks around those
explicit commands. Shared logic lives in the public `trellis` and
`trellis-contracts` packages plus dedicated internal workspace crates:

- `trellis`
- `trellis-contracts`
- `trellis-codegen-ts`
- `trellis-codegen-rust`
- the internal `trellis-generation` library

The current CLI implementation uses internal Trellis SDK modules plus local
helper modules for command parsing, auth session storage, contract resolution,
and self-update behavior.

## References

- `design/contracts/trellis-api-participants.md`
- `design/contracts/trellis-rust-contract-libraries.md`
- `design/contracts/trellis-typescript-contract-authoring.md`
