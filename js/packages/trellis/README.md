# @qlever-llc/trellis

JavaScript Trellis client runtime. Provides contract-driven client helpers and
runtime error types.

```typescript
import { defineAppContract, TrellisClient } from "@qlever-llc/trellis";

const app = defineAppContract(() => ({
  id: "example.app@v1",
  displayName: "Example App",
  description: "Example Trellis browser client.",
}));

const client = await TrellisClient.connect({
  trellisUrl: "https://trellis.example.com",
  contract: app,
});
const meResult = await client.request("Auth.Me", {});
const me = meResult.orThrow();
```

Service connection helpers live in `@qlever-llc/trellis/service*` to keep the
root package browser-safe. Browser login and portal-flow helpers live on
`@qlever-llc/trellis/auth` and `@qlever-llc/trellis/auth/browser`.
