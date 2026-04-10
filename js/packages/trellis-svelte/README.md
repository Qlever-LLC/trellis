# @qlever-llc/trellis-svelte

Svelte integration for Trellis browser applications.

Provides `TrellisProvider` for app-level wiring, along with reactive helpers for auth state, NATS connection state, and Trellis client state.

Prefer `createTrellisApp(...)` for app-scoped auth creation and typed `app.getTrellis()` access without passing the contract around at every call site.

Uses the contract/runtime model from `@qlever-llc/trellis/contracts` and `@qlever-llc/trellis`.
