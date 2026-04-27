# Trellis App

SvelteKit control panel for a Trellis deployment.

Built with SvelteKit, Tailwind CSS v4 + DaisyUI, and
`@qlever-llc/trellis-svelte` for auth and NATS wiring.

## Local dev

1. Start NATS and the Trellis runtime service.
2. Copy `.env.example` to `.env` if needed.
3. `deno task prepare`
4. `deno task dev`

Expects Auth at `http://localhost:3000` and NATS WebSocket at
`ws://localhost:8080`.

`prepare` refreshes generated Trellis contract artifacts. The local Trellis
context binds `createTrellisApp` to the console contract and derives
`TrellisConsoleClient` with `TrellisClientFor<typeof contract>`, so console
pages call `getTrellis()` with explicit RPC, event, and state types without
importing a generated `client.ts` facade.
