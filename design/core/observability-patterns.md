---
title: Observability Patterns
description: Health, stats, documentation, tracing, and request-correlation patterns for Trellis services.
order: 60
---

# Design: Observability Patterns

## Prerequisites

- [trellis-patterns.md](./trellis-patterns.md) - Trellis architecture and
  communication model
- [type-system-patterns.md](./type-system-patterns.md) - Result and error
  conventions

## Scope

This document defines Trellis observability, documentation, tracing, and
request-correlation patterns.

## Service Observability

Every service exposes:

- `<Service>.Health` RPC
- baseline `Health.Heartbeat` event publishing through the shared Trellis health
  contract
- optional `<Service>.Stats` RPC
- OpenTelemetry tracing
- structured logging

Activated devices publish `Health.Heartbeat` through the same shared contract.
Connected service and device participants receive a Trellis-defined baseline
health use for `trellis.health@v1`; it is modeled as the grouped
`uses.required.health` dependency in emitted manifests, not as a flat health
alias, and contract authors do not manually repeat it.

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
  `TrellisService.connect(...)` and Rust `TrellisClient::connect_service(...)`
  publish baseline heartbeats automatically
- if the connected device contract uses the shared `Health.Heartbeat` event,
  `TrellisDevice.connect(...)` and Rust `TrellisClient::connect_device(...)`
  publish baseline heartbeats automatically
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
await service.handle.rpc.graph.stats(async () => {
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

`TrellisService.connect()` initializes OpenTelemetry automatically using the
service name.

Span naming:

- RPC client: `rpc.client.<MethodName>`
- RPC server: `rpc.server.<MethodName>`
- Event publish: `event.publish.<Domain>.<Action>`
- Event handle: `event.handle.<Domain>.<Action>`
- Job handle: `job.handle.<service>.<queue>`

Required attributes:

- `rpc.system`
- `rpc.method`
- `messaging.destination`

Library support rule:

- libraries performing I/O must accept trace context, create child spans, and
  propagate context
- `TrellisError` subclasses should include `traceId` when tracing is active
- if a runtime has not installed an OpenTelemetry tracer provider, RPC error
  responses should still attach `traceId` from a valid inbound `traceparent`
  header before the error leaves the server span boundary

## Request Correlation

RPCs and jobs include a `requestId` for correlation and audit. Domain events
carry their own `header.id` and trace context; they do not currently emit a
separate `request-id` NATS header unless they are job lifecycle events.

Rules:

- the client supplies a unique `request-id` for signed RPCs; auth includes it in
  the RPC proof and replay-cache key
- after auth validation, the server may use the request id as correlation
  context but must still treat logs/traces as observability data, not as a
  source of authorization policy
- request IDs propagate across downstream RPC and job flows
- logs and traces include `requestId`

Propagation:

| Context                        | `request-id` value                           |
| ------------------------------ | -------------------------------------------- |
| RPC handler                    | generated on receipt                         |
| RPC response                   | echoed from handler                          |
| Domain event                   | not set; use event `header.id` and trace     |
| Job created from RPC/event/job | inherited when available; otherwise new ULID |
| Job lifecycle event            | copied from `job.context.requestId`          |
| Scheduled or cron job/event    | new ULID for jobs; event `header.id` only    |

Job correlation:

- job creation records `job.context.requestId`, `job.context.traceId`,
  `job.context.traceparent`, and optional `job.context.tracestate`
- if no active trace exists when a job is created, the runtime creates a fresh
  W3C trace context rather than leaving the job untraced
- every job lifecycle publish includes matching `request-id`, `traceparent`, and
  `tracestate` NATS headers when present
- workers expose immutable job context to handlers and create job handling spans
  from that context where the language runtime supports tracing

Auth/admin control-plane correlation:

- built-in auth/admin RPCs follow the same inbound `traceparent` extraction as
  application RPCs
- traced admin errors include the request trace ID in serialized Trellis error
  data so operators can correlate failed control-plane calls with logs and spans
- the integration harness covers both a successful traced `Auth.Sessions.Me`
  call and a traced failing `Auth.Users.Get` call through live NATS/auth-callout

Event deduplication:

- domain events include `Nats-Msg-Id: <event.header.id>`
- JetStream deduplicates within its configured window
- this protects against duplicate publication on retries and reconnects
