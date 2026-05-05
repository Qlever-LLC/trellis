# Field Inspection Desk Product Context

## Register

product

## Product Purpose

Field Inspection Desk is a demo browser client for Trellis. Trellis is the
product server and platform; Field Inspection Desk is the sample client
application that shows how a disciplined field-operations command surface can
compose Trellis RPC, operations, events, transfer, and state into one inspection
workflow.

The product story is an executive operations desk for utility inspections:
dispatch work, inspect site context, reconcile site status, upload evidence,
generate reports, watch live activity, and preserve operator workspace notes.

The demo client should look product-quality while staying clear that it is
powered by Trellis, not the Trellis product itself.

## Brand Position

Field Inspection Desk borrows the Trellis Executive Systems palette and
disciplined visual language, but it has its own client identity. The client logo
should communicate field coordination, structured inspection lanes, and
browser-based command workflows. Trellis appears as an endorsement and
connection target: "Powered by Trellis" or "Trellis server".

Brand cues from the reference board:

- Deep Ink and Oxford Blue create authority and precision.
- Copper is the distinctive Trellis accent for emphasis, active state, and
  priority action. It should be represented by the app `accent` token, not the
  `primary` token.
- Warm Gray and Stone keep the product approachable and tactile.
- Espresso is reserved for restrained dark contrast.
- Typography should feel geometric, calm, and executive. Use Inter for the
  product UI, with Söhne as a brand-board compatible alternate when available.
- The Field Inspection Desk mark should be distinct from the Trellis T mark, but
  compatible with the same structural geometry.

## Client Identity

Client name: Field Inspection Desk.

Short label: Inspection Desk.

Logo direction: a compact field-grid mark with a copper inspection pin or
checkpoint, built from thin geometric rules. It should read as an app/client
mark, not the Trellis server logo.

Relationship language:

- Powered by Trellis.
- Connected to Trellis server.
- Trellis-backed workflow data.
- Demo client for Trellis.

Avoid language that implies Field Inspection Desk is the Trellis product or
server.

## Primary Users

- Developers evaluating Trellis browser app patterns.
- Platform engineers validating generated app contracts and SDK ergonomics.
- Product stakeholders reviewing a concrete Trellis workflow.
- Demo operators running the local end-to-end sample during development or
  presentations.
- Executive buyers who need the demo to communicate trust, structure, and
  operational maturity quickly.

## User Mindset

Users need to understand what each Trellis primitive does in a realistic
workflow. They should be able to distinguish sample scenario framing from live
data returned by the Trellis runtime.

Common user questions include:

- Which parts of this screen are live Trellis data?
- Which route demonstrates RPC, operations, events, transfer, or state?
- What should I click next to exercise the demo workflow?
- What failed, and is the failure a config issue, a service issue, or an empty
  demo state?
- Is this the Trellis product, or a demo client connected to Trellis?

## Product Principles

- Teach through workflow, not isolated API examples.
- Make sample fixture data explicitly labeled.
- Present live Trellis responses as operational truth only when they are
  actually loaded from Trellis.
- Keep actions direct and reversible where possible.
- Prefer calm, structured panels over decorative dashboard tiles.
- Use copper sparingly for decisive emphasis: primary action, current route,
  active progress, and brand signature. Keep Deep Ink as the primary brand
  color.
- Preserve standard app affordances: navigation, forms, tables, progress,
  alerts, and empty states.
- Keep the client and server relationship clear: Field Inspection Desk is the
  demo client; Trellis is the server/platform.

## Tone And Copy

Tone should be executive, practical, and precise. It should sound like an
operations briefing, not marketing copy.

Use concise labels such as "Assignments.List", "Sites.Refresh",
"Evidence.Upload", and "Reports.Generate" when they clarify what the route
demonstrates. Avoid hype. Avoid implying static demo fixtures are live runtime
state.

Preferred phrases:

- Field Inspection Desk.
- Demo client for Trellis.
- Powered by Trellis.
- Connected to Trellis server.
- Inspection command.
- Workflow capability.

## Strategic Priorities

1. Reliable local demo behavior.
2. Clear distinction between sample scenario chrome and live Trellis-backed
   data.
3. Clear distinction between Field Inspection Desk as demo client and Trellis as
   product server.
4. Safe lifecycle handling for operations, event streams, transfers, and
   previews.
5. Accessible workflow controls and status announcements.

## Anti-References

Field Inspection Desk should not resemble:

- The Trellis server product itself.
- A generic SaaS analytics dashboard.
- A playful utility or field-service app.
- A marketing landing page with decorative metrics.
- A control plane that claims live truth from hardcoded fixture data.
- A code sample page where the workflow is secondary to API names.
- A visually heavy card collage with no clear primary task.
- A neon, glass, or cyber dashboard that conflicts with the executive systems
  brand.

## Design Relationship

`DESIGN.md` is the implementation contract for this app. When in doubt, prefer
the option that makes the demo more structured, more honest, more accessible,
and clearer about the Field Inspection Desk client to Trellis server
relationship.
