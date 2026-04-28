# Trellis Login Portal

Trellis-owned SvelteKit portal for browser auth UX and the default device
activation route. The portal is deployment-owned browser routing, not a special
contract kind.

The app has two distinct roles:

- `/_trellis/portal/users/login` renders Trellis-owned browser auth flow state.
  Approval actions use the shared portal helpers and submit the auth endpoint's
  canonical `approved: boolean` request body.
- Provider choice and OAuth/OIDC redirect handling stay server-owned. The portal
  renders provider options from `GET /auth/flow/:flowId`; it does not carry
  provider secrets, redirect-base config, or auth runtime dependency wiring.
- Browser apps should return to their app-local login route when an active
  session is revoked or missing. The built-in portal remains the provider and
  approval UX that app-local login routes start or resume.
- Detached CLI agent reauthentication uses the same `flowId` portal state as
  browser apps. When the redirect target resolves back to the current portal
  page, the portal stays on its completion screen so the user can return to the
  terminal instead of looping back through browser navigation.
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
empty allowed-digest lineage entry. Trellis treats `allowedDigests` as a rollout
allow-list: the presented digest must be known for the lineage and allowed by the
deployment, but the list itself is not an active-catalog assertion for every
digest. Trellis fails the activation path instead of substituting another digest
when the presented digest is unknown, retired, or not allowed.

If a custom portal needs to call Trellis after login, model that follow-on
access with a normal `app` contract and a portal profile. Passive portals that
only render flow state do not need their own Trellis contract.

Approval decisions are keyed by the normalized contract identity digest. Portal
copy may show `displayName` and `description`, but edits to that display metadata
alone do not require users to approve a new app or agent identity.

Schema-affecting app changes are different: Trellis accepts same-lineage active
digests only when duplicate surfaces resolve to compatible schemas. Optional
additive fields on open object payloads can roll out together, but closed-object
additions or required-field changes produce a new digest that must be handled as
an incompatible contract change.
