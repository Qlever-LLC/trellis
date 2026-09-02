---
title: Capability Patterns
description: Capability naming, assignment, and deployment policy patterns across Trellis contracts and auth.
order: 70
---

# Design: Capability Patterns

## Prerequisites

- [trellis-patterns.md](./trellis-patterns.md) - Trellis architecture and
  communication model
- [../auth/trellis-auth.md](./../auth/trellis-auth.md) - identity, approval, and
  enforcement model
- [../contracts/trellis-api-participants.md](./../contracts/trellis-api-participants.md) -
  contract-level capability declarations

## Scope

This document defines Trellis capability naming, contract-authored capability
metadata, and role/capability usage patterns.

## Capability Model

APIs declare machine capability allows and human-facing consent metadata.
Participants select required and optional concrete surfaces, and proposal
resolution derives their concrete capability upper bound. Accepted authority
stores the resulting capability view.

Rules:

- contracts declare required capabilities on owned and used surfaces
- event subscription capabilities authorize the logical event surface. Durable
  service event consumers require an additional `eventConsumers` resource
  binding and receive least-privilege JetStream consumer permissions from that
  binding rather than from broader capability grants.
- contracts SHOULD declare top-level metadata for every capability they own
- deployments assign capability bundles to users and services
- capability groups are recursive administrative macros, not runtime authority
- trusted portal policy is keyed by exact `portalId + participantId` and selects
  only concrete capabilities from the participant's proposal
- services receive deployment policy through deployment authority
  materialization and current materialized authority
- authorization changes take effect after accepted authority is materialized;
  runtime auth derives transport permissions from current authority, exact API
  descriptors, and resource evidence
- auth-owned self-service RPCs may intentionally require zero granted
  capabilities when ordinary authenticated user context is sufficient, such as
  `Auth.Sessions.Me` and `Auth.Sessions.Logout`
- user, service, session, and grant projections store capability keys as
  strings; approval payloads carry capability metadata objects keyed by those
  strings

Portal policy is not user-owned authority. Trusted autoapproval commits the
selected concrete capabilities through the ordinary identity-authority
transaction and records separate portal provenance. Policy changes revoke
affected contexts and kick their exact active connections without revoking the
underlying sessions.

## Capability Naming

Capability names have two forms:

- local capability names are authored inside the owning contract, for example
  `users.read` or `stream`
- global capability keys are emitted into canonical native API artifacts and
  grant records as `<contract namespace>::<local capability>`, for example
  `trellis.jobs::read`

The contract namespace is the contract `id` with a trailing major-version suffix
removed. For example, both `trellis.jobs@v1` and `trellis.jobs@v2` map to the
capability namespace `trellis.jobs`. This keeps grants stable across intentional
major contract-version upgrades when the capability meaning is preserved.

The `trellis.*` namespace is reserved where Trellis owns a platform definition:
canonical API IDs and capability namespaces, the internal auth-runtime
participant, and other explicitly reserved platform participants or deployments.
Those definitions are admitted only by exact ID and canonical digest.
`trellis-app.*` is not reserved: shipped clients such as `trellis-app.cli@v1`,
`trellis-app.console@v1`, and `trellis-app.portal@v1` are ordinary app
participants. Their IDs grant nothing; effective authority comes from exact
participant presentation plus an accepted authority decision.

Rules:

- contract authors SHOULD write local capability names in source contract files
  and let authoring helpers emit global keys
- local capability names MUST NOT start with the owning contract namespace plus
  `.`, so `trellis.core@v1` declares `catalog.read` rather than
  `trellis.core.catalog.read`
- direct manifest authors SHOULD write global keys in canonical native
  `trellis.api.v1` and `trellis.participant.v1` manifests
- if a capability reference matches a declared top-level capability, tooling
  projects it to the global key in the emitted manifest
- Trellis-owned `trellis.*` APIs and capabilities, and explicitly reserved
  `trellis.*` participants and deployments, require exact built-in artifacts;
  ordinary shipped clients use non-reserved `trellis-app.*` participant IDs
- principal kinds such as service and bootstrap administrator are domain
  identity properties, not role-shaped capabilities
- `admin` is a built-in read-only capability-group macro for selecting the
  platform-defined, proposal-bounded administrator bundle; `trellis.auth::admin`
  marks effective administrator identity, while granular capabilities such as
  `trellis.auth::capabilities.delegate` authorize machine actions
- capability metadata belongs to the owning contract; other contracts reference
  used APIs by logical `uses` selections, not by redeclaring another contract's
  capability metadata
- admin capability catalogs come from Trellis platform capabilities plus
  authority-owned projected capability definitions, not from the active catalog
  alone
- changing machine capability allows changes the semantic API digest; changing
  consent wording alone does not

| Pattern                          | Example                               | Meaning              | Who Can Claim   |
| -------------------------------- | ------------------------------------- | -------------------- | --------------- |
| `<namespace>::<domain>.<action>` | `trellis.auth::users.read`            | Can read users       | Users, Services |
| `<namespace>::<domain>.<action>` | `graph::partners.write`               | Can mutate partners  | Users, Services |
| `<namespace>::<action>`          | `trellis.jobs::read`                  | Read jobs data       | Users           |
| `<namespace>::<action>`          | `trellis.jobs::mutate`                | Mutate jobs state    | Users           |
| `<namespace>::<action>`          | `trellis.jobs::stream`                | Observe jobs streams | Users           |
| `<namespace>::<domain>.<action>` | `trellis.auth::admin`                 | Marks administrator  | Users           |
| `<namespace>::<domain>.<action>` | `trellis.auth::capabilities.delegate` | Delegate authority   | Users           |

Deployments may still encounter role-shaped strings such as `users:read`, but
the architectural model is capability-oriented. New Trellis-owned contract
capabilities should use dotted local names and global `::` projection rather
than colon-shaped role names.

## Service-Only Requirements

Some operations require both:

- the needed capabilities
- a registered service identity

Auth enforces this using service identity plus a presented contract compatible
with the materialized authority.

## Future Direction

Richer capability bundles and role composition remain deployment policy
concerns, not protocol surface.
