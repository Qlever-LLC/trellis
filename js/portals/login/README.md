# Trellis Login Portal

Trellis-owned SvelteKit portal for browser auth UX and the default device
activation route.

The app has two distinct roles:

- `/_trellis/portal/login` renders auth-owned browser flow state from Trellis.
- `/_trellis/portal/activate` resumes a preserved `flowId` after sign-in and
  starts `Auth.ActivateDevice` over the Trellis runtime.
- SvelteKit runtime assets are served under `/_trellis/assets/*` to keep the
  built-in portal's asset namespace inside the Trellis-owned prefix.

## Local dev

1. Start NATS and the Trellis auth/runtime services.
2. Copy `.env.example` to `.env` if needed.
3. Set `PUBLIC_TRELLIS_URL` to the Trellis service origin if you are not using the
   example `.env` value.
4. `deno task dev`

`PUBLIC_TRELLIS_URL` is the authoritative Trellis auth/runtime base URL for the
portal in both dev and build output. The portal now fails fast if that public
env var is missing instead of inferring the browser origin.

The example `.env` is suitable for standalone local dev against a Trellis
service on `http://localhost:3000`. You can also override it directly from the
shell, for example:

```bash
PUBLIC_TRELLIS_URL=http://localhost:3000 deno task dev
```

Static builds also require `PUBLIC_TRELLIS_URL` at build time:

```bash
PUBLIC_TRELLIS_URL=http://localhost:3000 deno task build
```

NATS WebSocket still defaults to `ws://localhost:8080`. NATS is required for
`/_trellis/portal/devices/activate` because that route starts the device
activation RPC over the Trellis runtime.
