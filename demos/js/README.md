# JS Demo

This workspace contains one consolidated Field Ops demo:

- `demos/js/service`: an installable Field Ops service.
- `demos/js/device`: an activated field-device TUI.
- `demos/js/app`: a browser Field Inspection Desk.
- `demos/js/shared`: sample data and helpers used by the demo participants.

The demo is product-oriented instead of split by Trellis primitive. The browser
app is framed as a coordinator desk for daily inspection work: review the queue,
check site status, run reports, attach image evidence, watch live activity, and
save operator notes. Each page still includes a secondary Trellis callout for
the platform concept it exercises.

## Before You Start

1. Make sure Trellis is running at `http://localhost:3000`.
2. Make sure the `trellis` CLI is logged in as an admin.
3. If the browser app should use a non-default Trellis URL, set
   `PUBLIC_TRELLIS_URL` in `demos/js/app/.env`. The default is
   `http://localhost:3000`.
4. Prepare generated contracts and SDKs once:

```sh
deno task -c demos/js/deno.json prepare
```

During active contract or browser-app work, keep generated demo SDKs fresh with
the watch task instead:

```sh
deno task -c demos/js/deno.json prepare:watch
```

The prepare step generates the service SDK used by both `demos/js/app` and
`demos/js/device`. Rerun prepare after changing `demos/js/service/contract.ts`,
`demos/js/device/contract.ts`, or `demos/js/app/contract.ts`. Trellis computes
approval identity from the normalized contract interface: editing display-only
metadata such as `displayName` or `description` updates portal/catalog copy but
does not force a new browser, CLI, or device approval digest.

## Create And Start The Service

Create one service deployment from `demos/js/service/contract.ts`, provision one
service instance, then start the service with the provisioned instance seed.

```sh
trellis deploy create svc/demo.field-ops
trellis deploy apply svc/demo.field-ops --source demos/js/service/contract.ts
trellis --format json deploy provision svc/demo.field-ops
deno task -c demos/js/deno.json service http://localhost:3000 <instance-seed>
```

Use the `instanceSeed` field from the provision JSON as `<instance-seed>`.

## Create And Start The Device

Create one device deployment from `demos/js/device/contract.ts`, provision one
device instance, then start the TUI with the provisioned root secret.

```sh
trellis deploy create dev/demo.field-device
trellis deploy apply dev/demo.field-device --source demos/js/device/contract.ts
trellis --format json deploy provision dev/demo.field-device
deno task -c demos/js/deno.json device http://localhost:3000 <root-secret>
```

Use the `rootSecret` field from the provision JSON as `<root-secret>`.

The first run for a new root secret prints an activation URL and QR code. Open
the URL, approve the device, and let the TUI continue. Later runs with the same
root secret should reconnect without another approval step.

## Start The Browser App

Start the Svelte Field Inspection Desk after prepare has generated the app SDK.
The app keeps local Trellis package and generated SDK aliases explicitly in
`demos/js/app/svelte.config.js`; `vite.config.js` should not duplicate those
local package mappings.

```sh
deno task -c demos/js/deno.json app
```

If you change the app contract's requested RPC, operation, event, or state
surface, the next browser sign-in may require approval for the new digest. If you
only rename the demo app or adjust its description, existing approval remains
valid because that metadata is not part of the contract identity digest.

For ad hoc runs against a non-default Trellis URL, set the env var from the
shell:

```sh
PUBLIC_TRELLIS_URL=http://localhost:3000 deno task -c demos/js/deno.json app
```

## Field Desk Routes And Trellis Callouts

The browser app routes are stable, but the UI presents them as one inspection
desk workflow:

- `Dashboard`: today's field board with queue, status, evidence, and live feed
  context.
- `Assignments`: inspection queue backed by `Assignments.List` and `Sites.Get`
  RPC requests.
- `Sites`: site status board backed by `Sites.List` and `Sites.Get` RPC requests
  plus the `Sites.Refresh` operation.
- `Reports`: report run workflow with `Reports.Generate` operation progress,
  completion, and cancel.
- `Evidence`: evidence locker with `Evidence.Upload` send transfer and
  `Evidence.Download` receive transfer previews.
- `Activity`: live feed using event subscriptions.
- `Workspace`: operator notes backed by app/device state.

The device TUI exposes the same concepts as menu actions: list assignments, view
the selected site, refresh a site, generate a report, upload evidence, watch
activity events briefly, and save or list draft state.

Both the browser app and activated device declare `read` for operations they
watch and `cancel` only for `Reports.Generate`. This mirrors runtime permission
derivation: `call` starts an operation, but it does not grant operation-control
subjects by itself.

## Jobs Are Private Implementation

Jobs are demonstrated behind the `Sites.Refresh` operation. The caller starts
and watches the public operation; the service uses its private
`refreshSiteSummary` job internally to do the work. There is intentionally no
public job polling API in this demo.

## Event Subscription Demo

The app `Activity` route subscribes to `Activity.Recorded` and
`Reports.Published` with ephemeral event handlers. The device TUI has a matching
activity-watch menu option for a short terminal subscription. Report generation,
evidence upload, and site refresh workflows publish service events that these
subscribers can display.

## Cleanup

Revoke activated device access and disable the deployments you created when you are done:

```sh
trellis deploy activation revoke <device-instance-id>
trellis deploy disable svc/demo.field-ops
trellis deploy disable dev/demo.field-device
```

Use each provision JSON's `instanceId` field for `<service-instance-id>` and
`<device-instance-id>`.
