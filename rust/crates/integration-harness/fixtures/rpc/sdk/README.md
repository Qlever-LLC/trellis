# harness-rpc

Generated Trellis SDK for contract `trellis.integration-harness.rpc@v1`. See
`TRELLIS.md` for AI-agent-oriented contract and facade guidance.

## Usage

```ts
import { defineAppContract, TrellisClient } from "@qlever-llc/trellis";
import { sdk as dependency } from "harness-rpc";

const app = defineAppContract(() => ({
  id: "example.app@v1",
  displayName: "Example App",
  description: "User-facing app for the example deployment.",
  uses: {
    required: {
      dependency: dependency.use({
        rpc: { call: ["Harness.Rust.CallerContext"] },
      }),
    },
  },
}));

const client = await TrellisClient.connect({
  trellisUrl: "https://trellis.example.com",
  contract: app,
});
```

## Contents

- `sdk`: generated contract module with `CONTRACT_ID`, `CONTRACT_DIGEST`,
  `CONTRACT`, `API`, and `use(...)`
- `API`: nested contract API views with `API.owned` and `API.used`
- `client.ts`: generated surface-first facades such as
  `client.rpc.<group>.<leaf>(input)`,
  `client.event.<group>.<leaf>.publish(event)`, and
  `client.operation.<group>.<leaf>.start(input)`
- `TRELLIS.md`: self-contained guidance for agents using this package from
  out-of-tree services
- `types.ts`: TypeScript types derived from JSON Schemas
- `schemas.ts`: Raw JSON Schemas (as `as const` objects)
- `contract.ts`: embedded contract metadata and typed `use(...)` helper
