# Trellis Contract Guide: trellis.integration-harness.rpc@v1

This file is generated for AI agents and out-of-tree Trellis services.

## Global Trellis Context

- llms.txt:
  https://raw.githubusercontent.com/qlever-llc/trellis/main/docs/static/llms.txt
- llms-full.txt:
  https://raw.githubusercontent.com/qlever-llc/trellis/main/docs/static/llms-full.txt

## Package

- package: `harness-rpc`
- contract id: `trellis.integration-harness.rpc@v1`
- kind: `Service`

## TypeScript Facades

Use generated surface-first APIs. Do not use old stringly `client.request` or
`client.publish` examples.

Owned service surfaces:

- RPC `Harness.Rust.CallerContext`:
  `client.rpc.harness.rustCallerContext(input)`; service handler
  `service.handle.rpc.harness.rustCallerContext(handler)`
- RPC `Harness.Rust.Ping`: `client.rpc.harness.rustPing(input)`; service handler
  `service.handle.rpc.harness.rustPing(handler)`
- RPC `Harness.Rust.TraceContext`: `client.rpc.harness.rustTraceContext(input)`;
  service handler `service.handle.rpc.harness.rustTraceContext(handler)`
- RPC `Harness.Ts.CallerContext`: `client.rpc.harness.tsCallerContext(input)`;
  service handler `service.handle.rpc.harness.tsCallerContext(handler)`
- RPC `Harness.Ts.Ping`: `client.rpc.harness.tsPing(input)`; service handler
  `service.handle.rpc.harness.tsPing(handler)`
- RPC `Harness.Ts.TraceContext`: `client.rpc.harness.tsTraceContext(input)`;
  service handler `service.handle.rpc.harness.tsTraceContext(handler)`

Used dependency surfaces:

- alias `auth` uses contract `trellis.auth@v1`
- RPC `Auth.Requests.Validate` from `trellis.auth@v1`:
  `client.rpc.auth.requestsValidate(input)`
- alias `health` uses contract `trellis.health@v1`
- Event publish `Health.Heartbeat` from `trellis.health@v1`:
  `client.event.health.heartbeat.publish(event) / .prepare(event)`

Prepared events:

- For owned or publishable event surfaces,
  `client.event.<group>.<leaf>.prepare(event)` returns a `PreparedTrellisEvent`.
- Publish prepared events with `client.publishPrepared(prepared)` or persist
  them in an outbox and dispatch later with service outbox/inbox helpers.
