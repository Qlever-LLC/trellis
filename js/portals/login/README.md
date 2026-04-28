# Trellis Login Portal

Trellis-owned SvelteKit portal for browser auth UX and the default device
activation route. The portal is deployment-owned browser routing, not a special
contract kind.

The app has two distinct roles:

- `/_trellis/portal/users/login` renders Trellis-owned browser auth flow state.
  Approval actions use the shared portal helpers and submit the auth endpoint's
  canonical `approved: boolean` request body.
- `/_trellis/portal/devices/activate` resumes a preserved `flowId` after sign-in
  and starts the `Auth.ActivateDevice` operation over the Trellis runtime.
- SvelteKit runtime assets are served under `/_trellis/assets/*` to keep the
  built-in portal's asset namespace inside the Trellis-owned prefix.

## Local dev

1. Start NATS and the Trellis runtime/control-plane service.
2. Copy `.env.example` to `.env` if you want to override local defaults.
3. Set `PUBLIC_TRELLIS_URL` to the Trellis runtime/control-plane service origin
   if it is not `http://localhost:3000`.
4. `deno task dev`

`PUBLIC_TRELLIS_URL` is the authoritative Trellis runtime/control-plane service
base URL for the portal in both dev and build output. Standalone local builds
default to `http://localhost:3000` when it is unset. Trellis
runtime/control-plane service builds inject the configured public origin.

The example `.env` is suitable for standalone local dev against the Trellis
runtime/control-plane service on `http://localhost:3000`. You can also override
it directly from the shell, for example:

```bash
PUBLIC_TRELLIS_URL=http://localhost:3000 deno task dev
```

Static builds can also override `PUBLIC_TRELLIS_URL` at build time:

```bash
PUBLIC_TRELLIS_URL=http://localhost:3000 deno task build
```

NATS WebSocket still defaults to `ws://localhost:8080`. NATS is required for
`/_trellis/portal/devices/activate` because that route starts and watches the
`Auth.ActivateDevice` operation over the Trellis runtime. Device connect info is
served separately by `POST /auth/devices/connect-info`.

For device activation to succeed, the portal contract digest must be allowed on
the relevant device deployment through `appliedContracts[].allowedDigests` or an
empty allowed-digest lineage entry.

If a custom portal needs to call Trellis after login, model that follow-on
access with a normal `app` contract and a portal profile. Passive portals that
only render flow state do not need their own Trellis contract.
