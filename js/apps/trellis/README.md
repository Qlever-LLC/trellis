# Trellis App

SvelteKit control panel for a Trellis deployment.

Built with SvelteKit, Tailwind CSS v4 + DaisyUI, and `@trellis/svelte` for auth and NATS wiring.

## Local dev

1. Start NATS and the Trellis runtime service.
2. Copy `.env.example` to `.env` if needed.
3. `deno task dev`

Expects Auth at `http://localhost:3000` and NATS WebSocket at `ws://localhost:8080`.
