# @qlever-llc/trellis-sdk-auth

Generated Trellis SDK for contract `trellis.auth@v1`.

## Usage

```ts
import { defineContract } from "@qlever-llc/trellis";
import { auth } from "@qlever-llc/trellis-sdk-auth";

const app = defineContract({
  id: "example.app@v1",
  displayName: "Example App",
  description: "User-facing app for the example deployment.",
  kind: "app",
  uses: {
    dependency: auth.use({
      rpc: { call: ["Auth.GetInstalledContract"] },
    }),
  },
});

const client = app.createClient(nc, authSession);
```

## Contents

- `auth`: generated contract module with `CONTRACT_ID`, `CONTRACT_DIGEST`, `CONTRACT`, `API`, and `use(...)`
- `API`: nested contract API views with `API.owned`, `API.used`, and `API.trellis`
- `types.ts`: TypeScript types derived from JSON Schemas
- `schemas.ts`: Raw JSON Schemas (as `as const` objects)
- `contract.ts`: embedded contract metadata and typed `use(...)` helper
