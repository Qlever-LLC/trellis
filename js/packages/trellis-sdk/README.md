# @qlever-llc/trellis-sdk

First-party generated SDKs for Trellis-owned contracts.

```typescript
import { auth } from "@qlever-llc/trellis-sdk/auth";
import { core } from "@qlever-llc/trellis-sdk/core";

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
