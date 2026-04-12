# @qlever-llc/trellis-svelte

Svelte integration for Trellis browser applications.

Provides `TrellisProvider` for app-level wiring, along with reactive helpers for auth state, NATS connection state, and Trellis client state.

Use `TrellisProvider` as the primary integration surface:

- pass `trellisUrl`, `contract`, and `loginPath`
- read the live client with `getTrellis<typeof contract>()`
- use `createAuthState(...)` only for lower-level sign-in flows when needed

Uses the contract/runtime model from `@qlever-llc/trellis/contracts` and `@qlever-llc/trellis`.
