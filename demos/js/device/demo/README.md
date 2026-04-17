# Demo Device

Small TypeScript device that activates against Trellis, connects with its
device identity, fetches demo groups, and uploads a local file to the demo
service.

## Setup

The demo device now uses the auth-owned activation flow model. When activation
is required, Trellis returns a short portal URL containing only `flowId`.

Before running the device, make sure:

1. the demo device contract has been applied to the device profile used by the
   preregistered device instance
2. the demo service contract has been installed or upgraded for the actual
   running demo service instance
3. the demo service process is running successfully

Example profile setup:

```sh
trellis device profile apply demo --source ../demos/js/device/demo/contracts/demo_device.ts
trellis service upgrade --service-key <service-key> --source ../demos/js/service/demo/contracts/demo_service.ts
```

## Run

```sh
deno task -c demos/js/device/demo/deno.json start -- http://localhost:3000 "<root-secret>" /path/to/file.txt
```

After connecting, the device starts the `Demo.Files.Upload` operation, transfers
the file through `op.transfer(...)`, and watches both transfer progress and the
final operation result while the service writes the staged object to `/tmp`.

Optional offline activation:

```sh
export TRELLIS_DEVICE_CONFIRMATION_CODE=ABC12345
```
