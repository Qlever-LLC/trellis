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
- optional `<Service>.Stats` RPC
- OpenTelemetry tracing
- structured logging

Health example:

```ts
const server = await TrellisServer.connect("graph", {
  auth,
  natsServers: config.client.natsServers,
  log,
  healthChecks: {
    db: () => db.ping(),
  },
});
```

Stats example:

```ts
server.mount("Graph.Stats", async () => {
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

`TrellisServer.connect()` initializes OpenTelemetry automatically using the service name.

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
