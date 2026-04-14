# Demo Service

Installable TypeScript service that exposes a `Demo.Groups.List` RPC and a `Demo.Files.InitiateUpload` RPC backed by a service store.

When a caller uploads a file through the returned transfer grant, the service reads the stored bytes and prints the file contents to its logs.

## Run

```sh
deno task start -- http://localhost:3000 <service-name> <session-key-seed>
```
