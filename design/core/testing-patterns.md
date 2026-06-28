---
title: Testing Patterns
description: Trellis testing policy for live integration coverage, matrix parity, and rare retained unit tests.
order: 90
---

# Design: Testing Patterns

## Prerequisites

- [trellis-patterns.md](./trellis-patterns.md) - Trellis architecture and
  runtime boundaries
- [../contracts/trellis-contracts-catalog.md](./../contracts/trellis-contracts-catalog.md) -
  contract-owned surfaces and permission derivation

## Design

Trellis behavior is distributed runtime behavior. Tests that prove Trellis
runtime behavior must use a live Trellis control plane and real TypeScript and
Rust client/service paths.

### Live-First Rule

Use live integration tests for Trellis behavior. This includes behavior observed
through HTTP routes, generated RPCs, operations, jobs, feeds, events, transfer,
state, resources, auth, bootstrap, device activation, service deployment,
catalog, permissions, NATS subjects, storage-backed runtime state, retry,
rollback, restart, and failure handling.

Do not prove Trellis behavior with fake NATS, fake Hono, fake storage, fake
runtime, fake auth, fake generated clients, or fake control-plane responders.
Those tests create a second implementation of Trellis and drift from the
runtime.

When a behavior is not reachable through current public test helpers, extend the
test library with the smallest named live-test surface needed to produce or
observe the behavior. Prefer case-scoped helpers in `trellis-test` over generic
chaos frameworks. Examples include a one-shot failure hook, a control-plane
SQLite inspection helper, or a JetStream inspection helper.

### Matrix Parity

Runtime behavior that exists in both TypeScript and Rust must have matching live
coverage in both languages before related unit coverage is deleted or considered
retired.

Rules:

- add or update `integration/test-matrix.json` for language-neutral behavior
- register the TypeScript case in the relevant JS integration support registry
- register the Rust case in the Rust integration support registry
- mark a row complete only when both TypeScript and Rust live tests pass
- do not use TypeScript-only service-integration coverage as retirement evidence
  for Trellis behavior that Rust can observe too

### Unit Test Boundary

Unit tests are the exception. Keep them only when the behavior is not Trellis
runtime behavior:

- pure parser, codec, canonicalization, crypto vector, schema pointer, or error
  serialization checks
- package export/import, publishing, generated artifact, or type-surface smoke
  checks
- CLI argument parsing and release-tool planning checks
- tiny UI copy or page-state helpers

If a unit test needs fake Trellis runtime pieces to pass, it probably belongs in
live integration. Delete it after live TS/Rust coverage proves the same
behavior, or replace it with a smaller pure-function test if a real pure
invariant remains.

Retained unit tests should document why they are not live integration tests. The
comment should name the pure invariant, not say that the behavior is merely
"private" or "not public". Current Trellis behavior is the behavior to protect;
the question is whether it is runtime-observable and therefore belongs in live
integration.

### Verification Practice

During development, run the smallest live fixture or case that proves the
change. Before completing a runtime or protocol change, run the matching
TypeScript and Rust live cases plus matrix conformance. Release verification
still owns the full unfiltered integration suites.
