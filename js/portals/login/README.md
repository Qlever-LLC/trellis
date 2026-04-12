# Trellis Login Portal

Trellis-owned SvelteKit portal for browser auth UX and the default device
activation route.

The app has two distinct roles:

- `/_trellis/portal/login` renders auth-owned browser flow state from Trellis.
- `/_trellis/portal/activate` resumes a preserved `handoffId` after sign-in and
  starts `Auth.ActivateDevice` over the Trellis runtime.
- SvelteKit runtime assets are served under `/_trellis/assets/*` to keep the
  built-in portal's asset namespace inside the Trellis-owned prefix.

## Local dev

1. Start NATS and the Trellis auth/runtime services.
2. Copy `.env.example` to `.env` if needed.
3. `deno task dev`

The portal uses the current browser origin for auth URLs and expects NATS
WebSocket at `ws://localhost:8080`. NATS is required for `/activate` because the
activation route starts the device activation RPC over the Trellis runtime.
