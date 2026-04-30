---
title: Auth Operations
description: Operational guidance for running Trellis auth in production, including HA, rate limits, and key rotation.
order: 60
---

# Design: Auth Operations

## Prerequisites

- [trellis-auth.md](./trellis-auth.md) - auth architecture and trust model
- [auth-protocol.md](./auth-protocol.md) - internal state and auth-callout
  protocol

## Scope

This document defines the operational and deployment guidance for Trellis auth.

It covers:

- configuration defaults
- deployment checklist
- HA and availability concerns
- secrets handling
- rate limiting
- key rotation
- accepted operational risks

## Configuration

### TTL Defaults

| Config key        | Default | Description                         |
| ----------------- | ------- | ----------------------------------- |
| `ttlMs.sessions`  | 24h     | Session expires after inactivity    |
| `ttlMs.natsJwt`   | 1h      | NATS JWT expiry; triggers reconnect |

Relationship: `ttlMs.natsJwt < ttlMs.sessions`.

Reducing `ttlMs.natsJwt` increases reconnect frequency but does not change RPC
replay window.

### Per-service Secrets

| Config key             | Description            |
| ---------------------- | ---------------------- |
| `sessionKeySeedFile`   | Base64url Ed25519 seed file |
| `client.natsServers`   | NATS server URL(s)     |
| `nats.sentinelCredsPath` | Path to sentinel creds |

Additional `trellis` service config:

| Config key                | Description                 |
| ------------------------- | --------------------------- |
| `nats.auth.credsPath`     | Auth account credentials    |
| `nats.trellis.credsPath`  | Trellis account credentials |
| `storage.dbPath`          | SQLite auth/control-plane DB |

### Store TTLs

| Store                  | TTL               |
| ---------------------- | ----------------- |
| sessions               | SQL rows, expired from `ttlMs.sessions` |
| users                  | None              |
| oauthStates            | 5 min             |
| pendingAuth            | 5 min             |
| deviceActivationFlows  | 30 min            |
| deviceActivations      | None              |
| deviceInstances        | None              |
| deviceProfiles         | None              |
| portals                | None              |
| portalLoginSelections  | None              |
| portalDeviceSelections | None              |
| portalDefaults         | None              |
| services               | None              |
| connections            | 2h                |

## Deployment Checklist

Cluster-wide required state:

- SQLite auth/control-plane database (`storage.dbPath`)
- services tables
- sessions table
- OAuth state store
- pending auth store
- device activation flow store
- device activation record store
- device instance store
- device deployment store
- portal store
- login portal selection store
- device portal selection store
- default portal setting store
- connection store

Production requirements:

- TLS enabled
- NTP enabled for services
- auth callout deployed HA
- `auth_callout_error_allow = false`
- rate limiting configured

## Operational Concerns

- run multiple `trellis` auth-callout instances with shared KV state
- the `trellis` service is a critical dependency for all authenticated
  operations and must be deployed HA
- the `trellis` service requires `$SYS.ACCOUNT.TRELLIS.DISCONNECT` subscribe and
  `$SYS.REQ.SERVER.*.KICK` publish permissions
- no other services should receive broad `$SYS.*` access

Secrets that MUST NOT be logged:

- `authToken`
- NATS `auth_token` payload
- session key seeds
- RPC `proof` header

`sessionKey` itself may be logged because it is an identifier rather than a
credential.

## Connection Revocation Model

Connection revocation is performed by kicking live NATS clients, deleting
connection-presence KV state, and deleting SQL-backed sessions.

Illustrative behavior:

```ts
async function revokeSession(sessionKey: string) {
  const connections = await connectionsKv.keys(`${sessionKey}.*.*`);
  for await (const connKey of connections) {
    const { serverId, clientId } = await connectionsKv.get(connKey);
    await nc.request(
      `$SYS.REQ.SERVER.${serverId}.KICK`,
      JSON.stringify({ cid: clientId }),
    );
    await connectionsKv.delete(connKey);
  }

  await sessionsSql.deleteBySessionKey(sessionKey);
}
```

Kicking connections instead of revoking JWTs avoids account-JWT bloat.

## Rate Limiting

Rate limiting is a production gate.

Minimum targets:

- the auth callout, per source IP or equivalent edge identity
- `/auth/requests`
- `/auth/login/:provider`
- `/auth/callback/:provider`
- `/auth/flow/:flowId`
- `/auth/flow/:flowId/approval`
- `/auth/flow/:flowId/bind`
- `/auth/devices/activate`
- `/auth/devices/activate/wait`
- `/auth/devices/connect-info`

Deployments should not go live without configured limits. HTTP auth limits must
use an address or edge identity supplied by the trusted runtime/proxy boundary;
client-controlled forwarding headers such as `x-forwarded-for` are not a safe
rate-limit identity by themselves.

## Key Rotation

### TRELLIS account signing key

1. Generate new key
2. Add it as an additional signing key
3. Push updated account JWT
4. Update the `trellis` service
5. Wait for JWT expiry
6. Remove the old key
7. Destroy old material

### Service session key

1. Generate new keypair
2. Register the new public key
3. Deploy the new seed
4. Remove the old key after rollout

### Sentinel credentials

1. Generate new sentinel user via NSC
2. Update `trellis` config
3. Restart `trellis`
4. Restart dependent services with updated creds
5. Remove the old sentinel user

## Accepted Risks

### RPC Message Replay

Risk: a signed request can be replayed while the session is still valid.

Mitigations:

- TLS required
- non-extractable keys in browsers
- per-message signatures bound to subject and payload
- session revocation invalidates future replays

Accepted because:

- replay requires insider access or prior capture
- replay can only reproduce the same request, not forge a new one
- the protocol remains simpler than nonce-based or timestamp-per-request designs
- applications can layer idempotency keys where needed

### XSS Session Abuse

Risk: active XSS can invoke signing operations while the page is compromised.

Mitigations:

- non-extractable browser keys prevent key theft
- CSP and standard XSS mitigations remain primary defenses

Accepted because non-extractable keys still reduce blast radius compared with
extractable browser secrets.

## Non-Goals

- redefining the auth protocol or public auth API
- defining TypeScript or Rust package surfaces
