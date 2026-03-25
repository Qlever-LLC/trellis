# Activity Service

Trellis-native audit projection service. Consumes auth events and exposes an activity feed.

- Subscribes to `Auth.Connect`, `Auth.Disconnect`, `Auth.SessionRevoked`, `Auth.ConnectionKicked`
- Stores entries in the `trellis_activity` KV bucket
- Exposes `Activity.List` and `Activity.Get` RPCs
- Emits `Activity.Recorded` events

## Local bootstrap

1. Install with the CLI:

```sh
trellis service install --source ./contracts/trellis_activity.ts
```

2. Start the service:

```sh
ACTIVITY_SESSION_KEY_SEED="<seed from install>"
NATS_SERVERS=localhost
NATS_SENTINEL_CREDS=../../../.local/nats/sentinel.creds
deno task dev
```

See [docs/runbook-local-dev.md](../../../docs/runbook-local-dev.md) for full local setup.
