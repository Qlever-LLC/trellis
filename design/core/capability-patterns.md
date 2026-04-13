---
title: Capability Patterns
description: Capability naming, assignment, and deployment policy patterns across Trellis contracts and auth.
order: 70
---

# Design: Capability Patterns

## Prerequisites

- [trellis-patterns.md](./trellis-patterns.md) - Trellis architecture and communication model
- [../auth/trellis-auth.md](./../auth/trellis-auth.md) - identity, approval, and enforcement model
- [../contracts/trellis-contracts-catalog.md](./../contracts/trellis-contracts-catalog.md) - contract-level capability declarations

## Scope

This document defines Trellis capability naming and role/capability usage patterns.

## Capability Model

Contracts declare per-operation capability requirements. Deployments grant those capabilities through roles, groups, or external identity mappings.

Rules:

- contracts declare required capabilities
- deployments assign capability bundles to users and services
- deployments MAY also assign auth-owned dynamic capability overlays through
  instance grant policies keyed by browser-app contract lineage and optional app
  origin
- services receive deployment policy at installation and contract upgrade time
- authorization changes take effect immediately because auth derives subjects from active contracts and current grants
- auth-owned self-service RPCs may intentionally require zero granted
  capabilities when ordinary authenticated user context is sufficient, such as
  `Auth.Me`, `Auth.Logout`, and `Auth.RenewBindingToken`

Instance grant policies are deployment policy, not user-owned grants. They must
not be copied onto the user projection, and they may be revoked dynamically so
affected delegated sessions must reconnect and re-evaluate current policy.

## Capability Naming

| Pattern | Example | Meaning | Who Can Claim |
| --- | --- | --- | --- |
| `<domain>.<action>` | `users.read` | Can read users | Users, Services |
| `<domain>.<action>` | `partners.write` | Can mutate partners | Users, Services |
| `service` | — | Backend service principal | Services only |
| `admin` | — | Administrative access | Users, Services |
| `<domain>.<action>` | `jobs.admin.read` | Read jobs admin data | Users, Services |
| `<domain>.<action>` | `jobs.admin.mutate` | Mutate jobs admin state | Users, Services |
| `<domain>.<action>` | `jobs.admin.stream` | Observe jobs admin streams | Users, Services |

Deployments may still encounter role-shaped strings such as `users:read`, but the architectural model is capability-oriented.

## Service-Only Requirements

Some operations require both:

- the needed capabilities
- a registered service identity

Auth enforces this using service identity plus the active contract set.

## Future Direction

Richer capability bundles and role composition remain deployment policy concerns, not protocol surface.
