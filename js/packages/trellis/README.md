# @qlever-llc/trellis

JavaScript Trellis client runtime. Provides contract-driven client helpers and
runtime error types.

```typescript
import { defineAppContract, TrellisClient } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";

const app = defineAppContract(() => ({
  id: "example.app@v1",
  displayName: "Example App",
  description: "Example Trellis browser client.",
  uses: {
    required: {
      auth: auth.use({ rpc: { call: ["Auth.Sessions.Me"] } }),
    },
  },
}));

const client = await TrellisClient.connect({
  trellisUrl: "https://trellis.example.com",
  contract: app,
});
const meResult = await client.rpc.auth.sessionsMe({});
const me = meResult.orThrow();
```

Service connection helpers live in `@qlever-llc/trellis/service*` to keep the
root package browser-safe. Browser login and portal-flow helpers live on
`@qlever-llc/trellis/auth` and `@qlever-llc/trellis/auth/browser`.
