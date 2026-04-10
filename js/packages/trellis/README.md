# @qlever-llc/trellis

JavaScript Trellis client runtime. Provides contract-driven client helpers and runtime error types.

```typescript
import { defineContract } from "@qlever-llc/trellis";
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

const client = app.createClient(nc, authSession, opts);
const me = await client.requestOrThrow("Auth.Me", {});
```

Server connection helpers live in `@qlever-llc/trellis/server*` to keep the root package browser-safe.
