# Demo Device

Small TypeScript device that activates against Trellis, connects with its device identity, fetches demo groups, prompts for a local file path, and uploads that file to the demo service.

## Run

```sh
deno task -c demos/js/device/demo/deno.json start -- http://localhost:3000 "<root-secret>"
```

After connecting, enter a local file path when prompted. The device uploads the file to the demo service, which logs the file contents.

Optional offline activation:

```sh
export TRELLIS_DEVICE_CONFIRMATION_CODE=ABC12345
```

The device contract lives in `contracts/demo_device.ts` and can be used with `trellis devices profiles create`.
