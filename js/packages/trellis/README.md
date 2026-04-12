# @qlever-llc/trellis

JavaScript Trellis client runtime. Provides contract-driven client helpers and runtime error types.

```typescript
import { TrellisClient } from "@qlever-llc/trellis";
import { defineContract } from "@qlever-llc/trellis/contracts";
import { auth } from "@qlever-llc/trellis/sdk/auth";

const app = defineContract({
  id: "example.app@v1",
  displayName: "Example App",
  description: "Example Trellis browser client.",
  kind: "app",
  uses: {
    auth: auth.useDefaults(),
  },
});

const client = await TrellisClient.connect({
  trellisUrl: "https://trellis.example.com",
  contract: app,
});
const me = await client.requestOrThrow("Auth.Me", {});
```

Server connection helpers live in `@qlever-llc/trellis/server*` to keep the root package browser-safe.
