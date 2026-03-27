# @qlever-llc/trellis-trellis

JavaScript Trellis client runtime. Provides contract-driven client helpers and runtime error types.

```typescript
const client = contract.createClient(nc, auth, opts);
const me = await client.requestOrThrow("Auth.Me", {});
```

Server connection helpers live in `@qlever-llc/trellis-server` to keep this package browser-safe.
