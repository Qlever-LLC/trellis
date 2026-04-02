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
- services receive deployment policy at installation and contract upgrade time
- authorization changes take effect immediately because auth derives subjects from active contracts and current grants

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

During transitions, some deployments may still carry role-shaped legacy strings such as `users:read`, but the architectural model is capability-oriented.

## Service-Only Requirements

Some operations require both:

- the needed capabilities
- a registered service identity

Auth enforces this using service identity plus the active contract set.

## Future Direction

Richer capability bundles and role composition remain deployment policy concerns, not protocol surface.
