# Activity Service

Trellis-native audit projection service. Consumes auth events and exposes an
activity feed.

- Subscribes to `Auth.Connect`, `Auth.Disconnect`, `Auth.SessionRevoked`,
  `Auth.ConnectionKicked`
- Stores entries in the `trellis_activity` KV bucket
- Exposes `Activity.List` and `Activity.Get` RPCs
- Emits `Activity.Recorded` events

## Local bootstrap

1. Create a deployment, apply the contract, and provision an instance with the
   CLI:

```sh
trellis deploy create svc/trellis-activity
trellis deploy apply svc/trellis-activity --source ./contracts/trellis_activity.ts
trellis deploy provision svc/trellis-activity
```

2. Start the service:

```sh
ACTIVITY_SESSION_KEY_SEED="<seed from provision>"
NATS_SERVERS=localhost
NATS_SENTINEL_CREDS=../../../.local/nats/sentinel.creds
deno task dev
```

See [docs/runbook-local-dev.md](../../../docs/runbook-local-dev.md) for full
local setup.
