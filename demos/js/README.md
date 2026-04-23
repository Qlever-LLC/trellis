# JS Demos

These demos are small, terminal-first examples of one Trellis surface at a time.

Service demos follow the public service-author path with
`TrellisService.connect(...)`. They do not use Trellis-internal bootstrap
helpers.

The browser demo app under `demos/js/app` now follows the app-local
`trellis-svelte` pattern:

- it creates one app-owned `contexts` bundle with
  `createTrellisProviderContexts<typeof contract>()`
- it passes that bundle into `TrellisProvider`
- it re-exports local `getTrellis()`, `getAuth()`, and `getConnectionState()`
  helpers from `src/lib/trellis-context.svelte.ts`

Supported demos:

- `rpc`: simple request/response RPCs
- `operation`: progress + cancel + completion for one operation
- `transfer`: upload bytes into a transfer-capable operation
- `kv`: read schema-backed service-owned KV data through RPC
- `jobs`: queue a background job and poll its status
- `state`: read and write device-owned state

## Before You Start

1. Make sure Trellis is running at `http://localhost:3000`.
2. Make sure the `trellis` CLI is logged in as an admin.
3. Prepare the demo workspace:

```sh
deno task -c demos/js/deno.json prepare
```

If you are editing a specific demo, run that demo's focused `check:prepared`
task instead of the workspace-wide `check` task.

## First Device Activation

Every device demo prints an activation URL the first time you run it with a new
`rootSecret`.

1. Open the printed URL in your browser.
2. Approve the device.
3. Let the device process continue.

After that, rerunning the same demo with the same `rootSecret` should connect
without another approval step.

The device demos now call the Deno-only `checkDeviceActivation(...)` helper
before `TrellisDevice.connect(...)`. That helper persists local activation state
in a Deno-backed state file keyed by Trellis origin plus device identity, so
rerunning the same demo can resume the same activation attempt across restarts
before the first successful connect.

## RPC Demo

Create and start the service:

```sh
trellis service profile create demo.rpc
trellis service profile apply demo.rpc --source demos/js/rpc/service/contract.ts
trellis service instance provision demo.rpc --format json
deno task -c demos/js/rpc/service/deno.json start http://localhost:3000 <instance-seed>
```

Use the `instanceSeed` field from the provision JSON as `<instance-seed>`.

Create and run the device:

```sh
trellis device profile create demo.rpc
trellis device profile apply demo.rpc --source demos/js/rpc/device/contract.ts
trellis device instance provision demo.rpc --format json
deno task -c demos/js/rpc/device/deno.json start http://localhost:3000 <root-secret>
```

Use the `rootSecret` field from the provision JSON as `<root-secret>`.

Expected result:

- the service prints `Inspection RPC service`
- the device prints `Assigned inspections:` and `Site summaries:`

## Operation Demo

Create and start the service:

```sh
trellis service profile create demo.operation
trellis service profile apply demo.operation --source demos/js/operation/service/contract.ts
trellis service instance provision demo.operation --format json
deno task -c demos/js/operation/service/deno.json start http://localhost:3000 <instance-seed>
```

Use the `instanceSeed` field from the provision JSON as `<instance-seed>`.

Create and run the device:

```sh
trellis device profile create demo.operation
trellis device profile apply demo.operation --source demos/js/operation/device/contract.ts
trellis device instance provision demo.operation --format json
deno task -c demos/js/operation/device/deno.json start http://localhost:3000 <root-secret>
```

Use the `rootSecret` field from the provision JSON as `<root-secret>`.

Expected result:

- the service prints `Inspection operation service`
- the device shows one cancelled flow and one completed flow
- the device prints `completion flow output`

## Transfer Demo

Create and start the service:

```sh
trellis service profile create demo.transfer
trellis service profile apply demo.transfer --source demos/js/transfer/service/contract.ts
trellis service instance provision demo.transfer --format json
deno task -c demos/js/transfer/service/deno.json start http://localhost:3000 <instance-seed>
```

Use the `instanceSeed` field from the provision JSON as `<instance-seed>`.

Create and run the device:

```sh
trellis device profile create demo.transfer
trellis device profile apply demo.transfer --source demos/js/transfer/device/contract.ts
trellis device instance provision demo.transfer --format json
deno task -c demos/js/transfer/device/deno.json start http://localhost:3000 <root-secret> /path/to/file.bin
```

Use the `rootSecret` field from the provision JSON as `<root-secret>`.

Expected result:

- the service prints `Inspection transfer service`
- the device prints `upload accepted`, progress updates, `transfer completed`, and `terminal output`

## KV Demo

Create and start the service:

```sh
trellis service profile create demo.kv
trellis service profile apply demo.kv --source demos/js/kv/service/contract.ts
trellis service instance provision demo.kv --format json
deno task -c demos/js/kv/service/deno.json start http://localhost:3000 <instance-seed>
```

Use the `instanceSeed` field from the provision JSON as `<instance-seed>`.

Create and run the device:

```sh
trellis device profile create demo.kv
trellis device profile apply demo.kv --source demos/js/kv/device/contract.ts
trellis device instance provision demo.kv --format json
deno task -c demos/js/kv/device/deno.json start http://localhost:3000 <root-secret>
```

Use the `rootSecret` field from the provision JSON as `<root-secret>`.

Expected result:

- the service prints `Inspection KV service`
- the device prints `Site summaries fetched over RPC:` and `Detailed summary via RPC`

## Jobs Demo

Create and start the service:

```sh
trellis service profile create demo.jobs
trellis service profile apply demo.jobs --source demos/js/jobs/service/contract.ts
trellis service instance provision demo.jobs --format json
deno task -c demos/js/jobs/service/deno.json start http://localhost:3000 <instance-seed>
```

Use the `instanceSeed` field from the provision JSON as `<instance-seed>`.

Create and run the device:

```sh
trellis device profile create demo.jobs
trellis device profile apply demo.jobs --source demos/js/jobs/device/contract.ts
trellis device instance provision demo.jobs --format json
deno task -c demos/js/jobs/device/deno.json start http://localhost:3000 <root-secret>
```

Use the `rootSecret` field from the provision JSON as `<root-secret>`.

Expected result:

- the service prints `Inspection jobs service`
- the device prints `Queued refresh ...`
- the device polls until the refresh reaches `completed`

If the jobs service is offline or the capability is unavailable, the device now
prints a Trellis-native request failure such as `Trellis could not reach the
requested capability. (trellis.request.unavailable)` plus a retry hint instead
of an unhandled stack trace.

## State Demo

Create and run the device:

```sh
trellis device profile create demo.state
trellis device profile apply demo.state --source demos/js/state/device/contract.ts
trellis device instance provision demo.state --format json
deno task -c demos/js/state/device/deno.json start http://localhost:3000 <root-secret>
```

Use the `rootSecret` field from the provision JSON as `<root-secret>`.

Expected result:

- the device prints `Selected site state`
- the device prints `Draft inspection state`
- the device prints `Listed device state`

## Cleanup

Remove the instances and profiles you created when you are done:

```sh
trellis service instance remove <instance-id> -f
trellis service profile remove <profile-id> -f
trellis device instance remove <instance-id> -f
trellis device profile remove <profile-id> -f
```

Use the `instanceId` field from each provision JSON as `<instance-id>`. The
`<profile-id>` values are the profile names you created in the runbook, such as
`demo.rpc`, `demo.operation`, `demo.transfer`, `demo.kv`, `demo.jobs`, and
`demo.state`.
