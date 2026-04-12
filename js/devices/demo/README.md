# Demo Device

Small TypeScript device that activates against Trellis, connects with its device identity, and logs the authenticated connection details.

## Run

```sh
deno task start -- http://localhost:3000 "<root-secret>"
```

Optional offline activation:

```sh
export TRELLIS_DEVICE_CONFIRMATION_CODE=ABC12345
```

The device contract lives in `contracts/demo_device.ts` and can be used with `trellis devices profiles create`.
