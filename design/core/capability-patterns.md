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

This document defines Trellis capability naming, contract-authored capability
metadata, and role/capability usage patterns.

## Capability Model

Contracts declare capability requirements on RPCs, operations, events, and feeds. The
owning contract may also declare human-facing metadata for each owned capability
so approval UIs can explain the requested authority without inventing a separate
scope catalog. Deployments grant capabilities through roles, groups, portal
profiles, instance grant policies, or external identity mappings.

Rules:

- contracts declare required capabilities on owned and used surfaces
- contracts SHOULD declare top-level metadata for every capability they own
- deployments assign capability bundles to users and services
- deployments MAY also assign auth-owned dynamic capability overlays through
  instance grant policies keyed by browser-app contract lineage and optional app
  origin
- services receive deployment policy at installation and contract upgrade time
- authorization changes take effect immediately because auth derives subjects from active contracts and current grants
- auth-owned self-service RPCs may intentionally require zero granted
  capabilities when ordinary authenticated user context is sufficient, such as
  `Auth.Me` and `Auth.Logout`
- user, service, session, and grant projections store capability keys as strings;
  approval payloads carry capability metadata objects keyed by those strings

Instance grant policies are deployment policy, not user-owned grants. They must
not be copied onto the user projection, and they may be revoked dynamically so
affected delegated sessions must reconnect and re-evaluate current policy.

## Capability Naming

Capability names have two forms:

- local capability names are authored inside the owning contract, for example
  `users.read` or `jobs.admin.read`
- global capability keys are emitted into canonical manifests and grant records
  as `<contract namespace>::<local capability>`, for example
  `trellis.jobs::jobs.admin.read`

The contract namespace is the contract `id` with a trailing major-version suffix
removed. For example, both `trellis.jobs@v1` and `trellis.jobs@v2` map to the
capability namespace `trellis.jobs`. This keeps grants stable across intentional
major contract-version upgrades when the capability meaning is preserved.

Rules:

- contract authors SHOULD write local capability names in source contract files
  and let authoring helpers emit global keys
- direct manifest authors SHOULD write global keys in canonical
  `trellis.contract.v1` manifests
- if a capability reference matches a declared top-level capability, tooling
  projects it to the global key in the emitted manifest
- undeclared platform or external capability strings such as `service` and
  `admin` remain raw strings and are not rewritten
- capability metadata belongs to the owning contract; other contracts reference
  used APIs by logical `uses` selections, not by redeclaring another contract's
  capability metadata
- changing capability metadata changes what users are asked to approve and
  therefore changes the contract digest

| Pattern | Example | Meaning | Who Can Claim |
| --- | --- | --- | --- |
| `<namespace>::<domain>.<action>` | `trellis.auth::users.read` | Can read users | Users, Services |
| `<namespace>::<domain>.<action>` | `graph::partners.write` | Can mutate partners | Users, Services |
| `service` | — | Backend service principal | Services only |
| `admin` | — | Administrative access | Users, Services |
| `<namespace>::<domain>.<action>` | `trellis.jobs::jobs.admin.read` | Read jobs admin data | Users, Services |
| `<namespace>::<domain>.<action>` | `trellis.jobs::jobs.admin.mutate` | Mutate jobs admin state | Users, Services |
| `<namespace>::<domain>.<action>` | `trellis.jobs::jobs.admin.stream` | Observe jobs admin streams | Users, Services |

Deployments may still encounter role-shaped strings such as `users:read`, but
the architectural model is capability-oriented. New Trellis-owned contract
capabilities should use dotted local names and global `::` projection rather than
colon-shaped role names.

## Service-Only Requirements

Some operations require both:

- the needed capabilities
- a registered service identity

Auth enforces this using service identity plus the active contract set.

## Future Direction

Richer capability bundles and role composition remain deployment policy concerns, not protocol surface.
