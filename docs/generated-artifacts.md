# Generated Artifacts

`generated/` is disposable build output. It is ignored by git and recreated by repo-local prepare tasks that run `trellis-generate` behind the scenes.

For TypeScript contract sources, prepare resolves either a top-level
`contract.ts` or `contract.js` for single-contract projects, or
`contracts/*.ts` for multi-contract layouts, from the file's default export.
Authors do not need to add named `CONTRACT` exports just for generation.

Outputs include:

- contract manifests under `generated/contracts/manifests/`
- generated TypeScript SDK source under `generated/js/sdks/`
- generated Rust SDK source crates under `generated/rust/sdks/`
- npm build output under `generated/js/sdks/*/npm/`
- Rust build output under `generated/rust/sdks/*/target/`

TypeScript SDKs include `client.ts` facade types for consumers. Service
contracts generate TypeScript and Rust SDKs; app contracts generate TypeScript
SDKs so Svelte/browser code can import concrete client facade types. Device and
agent contracts are verified but do not produce SDK artifacts by default.

Refresh the outputs with the repo workflow entrypoints:

- `cd js && deno task prepare`
- `cargo xtask prepare`
- `cargo xtask build`

`trellis` is the runtime/operator CLI. Normal users should not need machine-global generator setup to refresh these artifacts.

The Rust workspace treats the generated SDK crates under `generated/rust/sdks/` as
build inputs. Run `cargo xtask prepare` before `cargo build` or `cargo install`
from this repository. When you just want the normal Rust build workflow, prefer
`cargo xtask build`, which runs `prepare` first and then invokes `cargo build`.
