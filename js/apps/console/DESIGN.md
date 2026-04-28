# Trellis Console — DESIGN.md (Stitch-Optimized)

## PURPOSE

This file defines the visual, structural, and behavioral rules for generating
Trellis Console UI.

Trellis Console is a **distributed runtime control plane**.

All generated UI MUST follow this specification.

---

## PRIMARY DESIGN INTENT

Trellis Console is built for **operators managing live systems**, not for
analytics or exploration.

The UI MUST optimize for:

1. Rapid scanning
2. State awareness
3. Operational decision making

The UI MUST NOT resemble:

- analytics dashboards
- marketing SaaS tools
- data visualization products

---

## HARD CONSTRAINTS (DO NOT VIOLATE)

- DO NOT use charts as primary UI
- DO NOT create large card grids
- DO NOT exceed 4 primary panels on screen
- DO NOT introduce new colors outside defined tokens
- DO NOT use decorative UI elements
- DO NOT use excessive whitespace

---

## LAYOUT SYSTEM

### Global Layout

ALWAYS use:

- Left: persistent navigation (drawer)
- Top: command bar (search, connection state, user)
- Main: structured panels

---

### Overview Page Layout (REQUIRED STRUCTURE)

Order MUST be:

1. Runtime Topology (horizontal strip)
2. Metrics Strip (inline, NOT cards)
3. Main Grid:
   - Left (primary): Service Instances table
   - Right (secondary): stacked panels
4. Bottom: Recent Activity

---

### Panel Hierarchy

Panels are classified as:

- Primary: tables (dominant visual weight)
- Secondary: summaries (health, jobs, warnings)

Rules:

- Only ONE primary panel per screen
- Secondary panels MUST be stacked, not grid-distributed
- Avoid equal visual weight across panels

---

## COMPONENT SYSTEM (DAISYUI RULES)

### REQUIRED COMPONENTS

Use DaisyUI primitives:

- Layout: `drawer`, `navbar`, `card`
- Controls: `btn`, `badge`, `input`
- Data: `table`, `progress`

---

### ALLOWED CUSTOMIZATION

Only override DaisyUI when:

- Density is too low
- Spacing is too loose
- Visual weight is too high

Allowed overrides:

- Reduce card shadow
- Tighten table row height
- Adjust spacing

---

### FORBIDDEN CHANGES

- Do not replace Daisy primitives
- Do not introduce custom component systems
- Do not create alternative button or badge styles

---

## DENSITY RULES (CRITICAL)

### Tables

- Row height: 44–52px
- Identifiers MUST NOT wrap
- Use monospace for identifiers
- Fixed column layout

### Cards

- Minimal shadow
- Thin border
- Header height: ~56px

### Spacing

- Tight vertical rhythm
- Consistent horizontal padding
- No large empty areas

---

## STATUS SYSTEM (STRICT)

### Status Mapping

| Status    | Daisy Class   |
| --------- | ------------- |
| Healthy   | badge-success |
| Degraded  | badge-warning |
| Unhealthy | badge-error   |
| Offline   | badge-neutral |

---

### Rules

- ALWAYS use badges for status
- NEVER invent new colors
- Use moderate saturation (not bright/neon)

---

## DATA PRESENTATION RULES

### Identifiers

MUST use monospace for:

- instance IDs
- contract names
- subjects / RPC paths

---

### Tables

- Left aligned text
- Compact headers
- Uppercase headers
- Small font size for headers

---

### Metadata

- Secondary text only
- Muted color
- Smaller font size

---

## SCREEN DEFINITIONS

### Overview (REFERENCE IMPLEMENTATION)

MUST include:

- Service Instances table (primary)
- Live Health panel
- Jobs snapshot
- Contract warnings
- Recent activity

---

### Health Events

Structure:

- Participants table (primary)
- Heartbeat stream (secondary)

---

### Contracts

Structure:

- Split pane layout (REQUIRED)
  - Left: contract list
  - Right: contract detail

Detail MUST include:

- RPC methods
- Events
- KV resources
- Store and jobs resources
- Derived NATS publish/subscribe rules
- Required capabilities

Contracts UI MUST NOT imply v1 supports caller-authored raw subject declarations
or arbitrary stream resource requests. Runtime NATS subjects may be displayed as
derived permissions only.

---

### Jobs

Structure:

- Table only (primary)

MUST include:

- job state badges
- filtering by service

---

### Device Reviews

Structure:

- Review list (primary)
- Side panel (secondary)

MUST include:

- approve / reject actions
- metadata visibility toggle

---

## VISUAL STYLE

### Base Colors (Daisy Tokens)

- Background: `--b2`
- Panels: `--b1`
- Borders: `--b3`
- Text: `--bc`

---

### Status Colors

- Success: `--su`
- Warning: `--wa`
- Error: `--er`
- Info: `--in`

---

### Effects

- Minimal shadows
- Prefer borders over elevation
- Subtle lattice/mesh motifs allowed ONLY in background areas

---

## INTERACTION RULES

- Hover states MUST be subtle
- Table rows highlight on hover
- Buttons use `ghost` or `outline`
- No heavy animation

---

## ANTI-PATTERNS (STRICTLY FORBIDDEN)

- Charts or graphs as primary UI
- Large card grids
- Uneven spacing
- Decorative UI elements
- Marketing-style layouts

---

## GENERATION GUIDELINES (FOR AI SYSTEMS)

When generating UI:

1. Start from layout structure
2. Place primary table first
3. Add only necessary secondary panels
4. Apply density rules
5. Apply status system
6. Validate against anti-patterns

If uncertain:

> Prefer simpler, denser, more structured UI

---

## SUMMARY

Trellis Console is:

> A structured, dense, operator-first control plane UI

All generated UI MUST reinforce:

- clarity
- hierarchy
- consistency
- operational efficiency
