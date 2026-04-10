# Demo Workload

Small TypeScript workload that activates against Trellis, connects with its workload identity, and logs the authenticated connection details.

## Run

```sh
deno task start -- http://localhost:3000 "<root-secret>"
```

Optional offline activation:

```sh
export TRELLIS_WORKLOAD_CONFIRMATION_CODE=ABC12345
```

The workload contract lives in `contracts/demo_workload.ts` and can be used with `trellis workloads profiles create`.
