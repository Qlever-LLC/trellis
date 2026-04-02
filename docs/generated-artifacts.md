# Generated Artifacts

`generated/` is disposable build output. It is ignored by git and recreated by `trellis generate` or the repo tasks that wrap it.

Outputs include:

- contract manifests under `generated/contracts/manifests/`
- generated TypeScript SDK source under `generated/js/sdks/`
- generated Rust SDK source crates under `generated/rust/sdks/`
- npm build output under `generated/js/sdks/*/npm/`
- Rust build output under `generated/rust/sdks/*/target/`

Refresh the outputs with the repo build tasks, or call `trellis generate` directly for a specific contract source/manifest/image.
