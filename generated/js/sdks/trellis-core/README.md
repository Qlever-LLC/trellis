# @qlever-llc/trellis-sdk-trellis-core

Generated Trellis SDK for contract `trellis.core@v1`.

## Usage

```ts
import { defineContract } from "@qlever-llc/trellis-trellis";
import { trellisCore } from "@qlever-llc/trellis-sdk-trellis-core";

const app = defineContract({
  id: "example.app@v1",
  displayName: "Example App",
  description: "User-facing app for the example deployment.",
  kind: "app",
  uses: {
    dependency: trellisCore.use({
      rpc: { call: ["Trellis.Bindings.Get"] },
    }),
  },
});

const client = app.createClient(nc, authSession);
```

## Contents

- `trellisCore`: generated contract module with `CONTRACT_ID`, `CONTRACT_DIGEST`, `CONTRACT`, `API`, and `use(...)`
- `API`: nested contract API views with `API.owned`, `API.used`, and `API.trellis`
- `types.ts`: TypeScript types derived from JSON Schemas
- `schemas.ts`: Raw JSON Schemas (as `as const` objects)
- `contract.ts`: embedded contract metadata and typed `use(...)` helper
