# Activity App

SvelteKit operator view for the Activity service. Displays the audit projection feed.

Uses `@trellis/svelte` for browser auth, NATS connectivity, and RPC wiring to `Auth.*` and `Activity.*`.

## Local dev

1. Start NATS, the Trellis runtime, and the Activity service.
2. Copy `.env.example` to `.env` if needed.
3. `deno task dev`

Expects Auth at `http://localhost:3000` and NATS WebSocket at `ws://localhost:8080`.
