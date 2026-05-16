# Generated Artifacts

`generated/` is disposable build output. It is ignored by git and recreated by repo-local prepare tasks that run `trellis-generate` behind the scenes.

For TypeScript contract sources, prepare resolves either a top-level
`contract.ts` or `contract.js` for single-contract projects, or
`contracts/*.ts` for multi-contract layouts, from the file's default export.
Authors do not need to add named `CONTRACT` exports just for generation.
For TypeScript authoring, schema and error registries belong in the first
`define*Contract(...)` argument, while contract-owned capability metadata belongs
in the returned contract body beside `id`, `displayName`, and `description`.

Outputs include:

- contract manifests under `generated/contracts/manifests/`
- generated JSR TypeScript packages under `generated/packages/jsr/`
- generated npm JavaScript packages under `generated/packages/npm/`
- generated Cargo crates under `generated/packages/cargo/`
- Rust build output under `generated/packages/cargo/*/target/`

JSR packages include `client.ts` facade types for consumers. Service contracts
generate JSR, npm, and Cargo SDK packages; app contracts generate JSR and npm SDK
packages so Svelte/browser code can import concrete client facade types. Device
and agent contracts are verified, with Rust participant facades generated where
applicable.

Refresh the outputs with the repo workflow entrypoints:

- `cd js && deno task prepare`
- `cargo xtask prepare`
- `cargo xtask build`

`trellis` is the runtime/operator CLI. Normal users should not need machine-global generator setup to refresh these artifacts.

The Rust workspace treats the generated SDK crates under `generated/packages/cargo/` as
build inputs. Run `cargo xtask prepare` before `cargo build` or `cargo install`
from this repository. When you just want the normal Rust build workflow, prefer
`cargo xtask build`, which runs `prepare` first and then invokes `cargo build`.
