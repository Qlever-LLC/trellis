---
title: Observability Patterns
description: Health, stats, documentation, tracing, and request-correlation patterns for Trellis services.
order: 60
---

# Design: Observability Patterns

## Prerequisites

- [trellis-patterns.md](./trellis-patterns.md) - Trellis architecture and communication model
- [type-system-patterns.md](./type-system-patterns.md) - Result and error conventions

## Scope

This document defines Trellis observability, documentation, tracing, and request-correlation patterns.

## Service Observability

Every service exposes:

- `<Service>.Health` RPC
- optional `Health.Heartbeat` event publishing through the shared Trellis health contract
- optional `<Service>.Stats` RPC
- OpenTelemetry tracing
- structured logging

Activated devices may also publish `Health.Heartbeat` through the same shared
contract when their device contract declares the appropriate `uses.health`
permission.

Health example:

```ts
const service = await TrellisService.connect({
  trellisUrl: config.trellisUrl,
  contract: graph,
  name: "graph",
  sessionKeySeed: config.sessionKeySeed,
  server: {
    log,
    healthChecks: {
      db: () => db.ping(),
    },
  },
});

service.health.setInfo({
  version: build.version,
  info: { region: config.region },
});

service.health.add("db", async () => ({
  status: (await db.ping()) ? "ok" : "failed",
  info: { engine: "postgres" },
}));
```

Heartbeat behavior:

- if the connected service contract uses the shared `Health.Heartbeat` event,
  `TrellisService.connect(...)` publishes baseline heartbeats automatically
- if the connected device contract uses the shared `Health.Heartbeat` event,
  `TrellisDevice.connect(...)` publishes baseline heartbeats automatically
- baseline heartbeats include runtime metadata, instance identity, publish
  interval, and a built-in NATS connectivity check
- `service.health.setInfo(...)` and `service.health.add(...)` extend service
  heartbeat payloads at publish time using callback-based state snapshots; the
  same helper surface is also available on device connections
- the Trellis console can subscribe to these heartbeats directly and show both a
  live feed and an in-browser current-participant view without a separate
  aggregator

Stats example:

```ts
await service.trellis.mount("Graph.Stats", async () => {
  return Result.ok({
    users: { count: await db.countUsers() },
    partners: { count: await db.countPartners() },
  });
});
```

## Documentation

Exported functions, classes, and methods require JSDoc.

Required fields:

- brief purpose description
- `@param` for each parameter
- `@returns` description
- `@throws` or `@errors` for error conditions
- `@example` for complex usage

Skip JSDoc for private helpers when the code is self-evident and for tests.

## Tracing

`TrellisService.connect()` initializes OpenTelemetry automatically using the service name.

Span naming:

- RPC client: `rpc.client.<MethodName>`
- RPC server: `rpc.server.<MethodName>`
- Event publish: `event.publish.<Domain>.<Action>`
- Event handle: `event.handle.<Domain>.<Action>`

Required attributes:

- `rpc.system`
- `rpc.method`
- `messaging.destination`

Library support rule:

- libraries performing I/O must accept trace context, create child spans, and propagate context
- `TrellisError` subclasses should include `traceId` when tracing is active

## Request Correlation

Every RPC and event includes a `requestId` for correlation and audit.

Rules:

- the server generates a new ULID for each incoming RPC
- client-supplied `request-id` headers are ignored for authority
- request IDs propagate across downstream RPC and event flows
- logs and traces include `requestId`

Propagation:

| Context | `request-id` value |
| --- | --- |
| RPC handler | generated on receipt |
| RPC response | echoed from handler |
| Event from RPC | inherited from triggering RPC |
| Event from event handler | inherited from triggering event |
| Scheduled or cron event | new ULID |

Event deduplication:

- events include `Nats-Msg-Id: <requestId>`
- JetStream deduplicates within its configured window
- this protects against duplicate publication on retries and reconnects
