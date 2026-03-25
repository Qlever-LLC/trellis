This directory contains generated artifacts that are part of Trellis' public surface.

Tracked in git:
- contract manifests under `generated/contracts/manifests/`
- generated TypeScript SDK source under `generated/js/sdks/`
- generated Rust SDK source crates under `generated/rust/sdks/`

Ignored:
- npm build output under `generated/js/sdks/*/npm/`
- Rust build output under `generated/rust/sdks/*/target/`
- other local tool byproducts

Refresh generated files with:

```sh
deno task -c js/services/trellis/deno.json build:sdk
deno task -c js/services/activity/deno.json build:sdk
```
