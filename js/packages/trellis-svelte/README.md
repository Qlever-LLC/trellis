# @qlever-llc/trellis-svelte

Svelte integration for Trellis browser applications.

Provides `TrellisProvider` for app-level wiring, along with reactive helpers for auth state, NATS connection state, and Trellis client state.

Prefer `getTrellisFor(contract)` in app code so the client stays typed from the same contract passed to `TrellisProvider`.

Uses the contract/runtime model from `@qlever-llc/trellis-contracts` and `@qlever-llc/trellis`.
