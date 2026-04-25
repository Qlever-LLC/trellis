# JS Demo

This workspace contains one consolidated Field Ops demo:

- `demos/js/service`: an installable Field Ops service.
- `demos/js/device`: an activated field-device TUI.
- `demos/js/app`: a browser Field Ops Console.
- `demos/js/shared`: sample data and helpers used by the demo participants.

The demo is product-oriented instead of split by Trellis primitive. Assignments,
sites, reports, evidence, activity, and workspace state each call out the
Trellis concept they exercise.

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
`demos/js/device/contract.ts`, or `demos/js/app/contract.ts`.

## Create And Start The Service

Create one service profile from `demos/js/service/contract.ts`, provision one
service instance, then start the service with the provisioned instance seed.

```sh
trellis service profile create demo.field-ops
trellis service profile apply demo.field-ops --source demos/js/service/contract.ts
trellis service instance provision demo.field-ops --format json
deno task -c demos/js/deno.json service http://localhost:3000 <instance-seed>
```

Use the `instanceSeed` field from the provision JSON as `<instance-seed>`.

## Create And Start The Device

Create one device profile from `demos/js/device/contract.ts`, provision one
device instance, then start the TUI with the provisioned root secret.

```sh
trellis device profile create demo.field-device
trellis device profile apply demo.field-device --source demos/js/device/contract.ts
trellis device instance provision demo.field-device --format json
deno task -c demos/js/deno.json device http://localhost:3000 <root-secret>
```

Use the `rootSecret` field from the provision JSON as `<root-secret>`.

The first run for a new root secret prints an activation URL and QR code. Open
the URL, approve the device, and let the TUI continue. Later runs with the same
root secret should reconnect without another approval step.

## Start The Browser App

Start the Svelte Field Ops Console after prepare has generated the app SDK.

```sh
deno task -c demos/js/deno.json app
```

For ad hoc runs against a non-default Trellis URL, set the env var from the
shell:

```sh
PUBLIC_TRELLIS_URL=http://localhost:3000 deno task -c demos/js/deno.json app
```

## Product Routes And Trellis Callouts

The browser app routes are named for product concepts, with each page calling
out the Trellis surface it demonstrates:

- `Dashboard`: overview of the Field Ops workflow.
- `Assignments`: `Assignments.List` and `Sites.Get` RPC requests.
- `Sites`: `Sites.List` and `Sites.Get` RPC requests plus the `Sites.Refresh`
  operation.
- `Reports`: `Reports.Generate` operation progress, completion, and cancel.
- `Evidence`: `Evidence.Upload` transfer-capable operation.
- `Activity`: live event subscriptions.
- `Workspace`: device or app state for saved operator context.

The device TUI exposes the same concepts as menu actions: list assignments, view
the selected site, refresh a site, generate a report, upload evidence, watch
activity events briefly, and save or list draft state.

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

Remove the instances and profiles you created when you are done:

```sh
trellis service instance remove <service-instance-id> -f
trellis service profile remove demo.field-ops -f
trellis device instance remove <device-instance-id> -f
trellis device profile remove demo.field-device -f
```

Use each provision JSON's `instanceId` field for `<service-instance-id>` and
`<device-instance-id>`.
