# Generated Artifacts

`generated/` is disposable build output. It is ignored by git and recreated by repo-local prepare tasks that run `trellis-generate` behind the scenes.

Outputs include:

- contract manifests under `generated/contracts/manifests/`
- generated TypeScript SDK source under `generated/js/sdks/`
- generated Rust SDK source crates under `generated/rust/sdks/`
- npm build output under `generated/js/sdks/*/npm/`
- Rust build output under `generated/rust/sdks/*/target/`

Refresh the outputs with the repo workflow entrypoints:

- `cd js && deno task prepare`
- `cargo xtask prepare`

`trellis` is the runtime/operator CLI. Normal users should not need machine-global generator setup to refresh these artifacts.
