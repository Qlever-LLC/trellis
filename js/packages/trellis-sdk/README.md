# @qlever-llc/trellis-sdk

First-party generated SDKs for Trellis-owned contracts.

```typescript
import { auth, core } from "@qlever-llc/trellis-sdk";

export const uses = {
  auth: auth.useDefaults(),
  core: core.use({
    rpc: {
      call: ["Trellis.Catalog"],
    },
  }),
};
```

This package is the public home for Trellis-owned contract SDKs such as auth,
core, activity, and state.
