# Field Inspection Desk Design Contract

## Purpose

This file defines the visual, structural, and behavioral rules for the Field
Inspection Desk demo client.

Field Inspection Desk is not the Trellis product server. It is a Trellis-backed
demo client that uses the Executive Systems palette and disciplined layout
language to show a realistic inspection workflow.

## Scene And Theme

A demo operator is presenting an inspection command workflow on a laptop in a
bright conference room. The surface is mostly light and warm, with Deep Ink used
for the client mark, primary text, and contained structural anchors rather than
the page background. Copper provides sparse action emphasis. The mood is calm,
serious, and prepared for executive review.

## Brand Palette

Use the reference palette as the source of truth:

- Deep Ink: `#101828`, primary dark surface and wordmark color.
- Oxford Blue: `#243B53`, secondary dark surface and chart/line color.
- Copper: `#B86B35`, brand accent, active state, primary action, and route
  emphasis.
- Warm Gray: `#F5F3EF`, app background and paper surface.
- Stone: `#C8C2B8`, borders, dividers, muted panels.
- Espresso: `#2A2521`, dark neutral contrast.

Use daisyUI semantic tokens with these roles:

- `primary`: Deep Ink.
- `secondary`: Oxford Blue.
- `accent`: Copper.
- `neutral`: Espresso.
- `base-*`: Warm Gray and paper surfaces.

Copper must stay sparse and intentional. Use `accent` classes for copper CTAs,
selected navigation details, progress emphasis, and brand signatures. Do not map
Copper to `primary`. Do not introduce unrelated saturated colors except semantic
status colors.

## Client Logo

Field Inspection Desk needs its own demo-client logo.

The mark should be:

- Distinct from the Trellis T mark.
- Built from a compact field grid and one copper checkpoint/pin.
- Usable at 32px in the app shell and larger on the landing page.
- Paired with the wordmark "Field Inspection Desk".
- Paired with relationship copy such as "Powered by Trellis" or "Demo client for
  Trellis".

Do not use the Trellis wordmark as the primary app/client logo. Trellis should
appear as the server/platform relationship.

## Typography

- Product UI preferred family: Inter.
- Brand-board compatible alternate: Söhne.
- Fallbacks: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe
  UI, sans-serif.
- Headings should be bold, geometric, and tightly tracked.
- Labels should use uppercase letterspacing similar to the brand board.
- Keep one primary UI font, but vary role, weight, size, spacing, and mono
  identifiers so the interface does not feel typographically flat.
- Body text should stay compact and readable, usually 65 to 75 characters for
  prose.
- Use mono only for operation IDs, contract names, and technical identifiers.

## Layout System

- Keep content surfaces warm, paper-like, and lightly bordered.
- Do not let system dark mode invert the demo. The default presentation should
  remain the light executive palette from the reference app rendering.
- Use a full-height left navigation shell on app routes. The page body is the
  primary workspace container.
- Avoid turning the main workspace into an array of cards. Prefer one integrated
  document-like body with intentional sections, rule lines, tables, and compact
  modules.
- Use Deep Ink for contained structural anchors and client mark contrast, not as
  the dominant page background.
- Prefer thin structural rules, compact panels, and chart-like system blocks
  over generic card stacks.
- Avoid nested cards and card-like panels inside panels. Use dividers, table
  sections, definition lists, and low-contrast rows inside primary surfaces.
- Vary spacing by role: page shells can breathe, data rows stay compact, and
  controls need enough hit-area and wrap room.
- Page headers should feel like executive briefings: clear title, concise
  purpose, and one route or Trellis capability label.
- Tables are the primary surface for loaded Trellis records.
- Summary metrics are allowed when they look like system overview modules, not
  decorative hero metrics.
- Fixture scenario panels must be labeled as sample/demo data.

## Component Rules

- Prefer daisyUI primitives: `navbar`, `menu`, `card`, `btn`, `badge`, `alert`,
  `table`, `progress`, `stats`, `file-input`, `select`, `input`, `textarea`.
- Use `card` only when a module truly needs object-like containment, such as a
  media preview. Do not use cards as the default page layout unit.
- Customize through shared CSS classes before repeating long utility strings.
- Use `shadow-sm` or brand-specific soft shadows only. Avoid heavy glow and
  glass effects.
- Use Deep Ink for primary brand surfaces and major text.
- Use Oxford Blue for secondary system surfaces and chart-like elements.
- Use Copper through `accent` classes for selected navigation details, primary
  CTAs, active progress, and critical brand marks.
- Use badges for status and compact metadata, but keep teaching-note badges
  visually secondary.
- Do not make non-action UI look clickable.

## Data Honesty

- Data loaded from Trellis may be presented as current state.
- Hardcoded scenario data must be labeled as `Sample scenario`, `Demo fixture`,
  or equivalent.
- Empty states should explain whether there is no live data, the service is
  unavailable, or the user has not started the workflow yet.
- Do not label static activity as live activity.

## Interaction Rules

- Operation and event streams must stop or ignore updates after route teardown.
- Long-running actions need loading/disabled states.
- Repeated start buttons must not create duplicate subscriptions or operation
  watchers.
- File-transfer status must describe the in-flight file, not a later-selected
  file.
- Stale async responses must not overwrite newer user selections.

## Accessibility Rules

- Every route needs a descriptive `<title>`.
- Progress bars need accessible labels.
- Dynamic event feeds should use `aria-live="polite"` where appropriate.
- Table action columns need readable header text, visually hidden if necessary.
- Repeated row actions need contextual `aria-label` values.
- Row-label `<th>` cells should include `scope="row"`.
- Copper text on warm backgrounds must maintain contrast. Use Deep Ink for
  primary text.

## Copy Rules

- Use concise executive-operations language.
- Teaching notes should clarify the Trellis primitive being demonstrated.
- Avoid hype, casual phrasing, and vague dashboard copy.
- Avoid em dashes.
- Keep relationship copy clear: Field Inspection Desk is the demo client,
  Trellis is the server/platform.

## Summary

Field Inspection Desk should be:

- recognizably a demo client powered by Trellis
- honest about live versus fixture data
- useful as a local demo
- accessible during a walkthrough
- structured without heavy decoration
- clearly connected to Trellis primitives through workflow tasks
