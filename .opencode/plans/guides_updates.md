# Plan: Improve Trellis Guides and Design Docs

This plan details updates to fix pedagogical issues and conflicts identified across the `guides/` and `design/` directories.

## Rust Implementation Fixes

1. **Connection Initialization:** Update `connect_service` in `writing-rust-services` to correctly use `orders_participant::connect_service(opts).await?.facade()` instead of the TypeScript-style `connect_service(contract, name, opts)`.
2. **Alias-Based Hierarchy:** Invert the call chain for event subscription in `writing-rust-services` from `.events().auth()` to `.auth().events()`, matching `contracts-rust-api.md`.
3. **Owned Surface Registration:** Scope RPC handlers in `writing-rust-services` to the owned surface: `.owned().router().mount()`.
4. **Operation Caller Context:** Add the generated facade instantiation in `using-operations-rust` (e.g., `client.orders().operation(...)`) to clarify where the caller object comes from.
5. **Operation-to-Job Logic:** Rewrite the flawed `attach()` logic in `using-operations-rust`. Remove `attach()`, enqueue the job, and update the final job to explicitly complete the operation.

## CLI & Tooling Fixes

6. **Missing Jobs Commands:** Add `trellis jobs workers [--service <name>]` to the Operational Commands reference block in `design/tooling/trellis-cli.md`.
7. **Missing Install Flags:** Update the command signature for `trellis service install` in `design/tooling/trellis-cli.md` to reflect the supported flags: `[--display-name <name>]`, `[--description <desc>]`, `[--namespace <ns>]`, `[--inactive]`.
8. **Workload Revocation Command:** Add the explicit command to Step 7 in the `workloads` guide: `trellis workloads activations revoke --instance <id>`.
9. **Workload Review Command:** Add the explicit command to Step 4 in the `workloads` guide showing admins how to approve gated workloads: `trellis workloads reviews decide --review <review-id> --approve`.
10. **Profile Creation Warning:** Add a warning in Step 6 of the `workloads` guide that `trellis workloads profiles create` is destructive and overwrites `allowedDigests`, requiring users to manually merge the previous digest in the command if they wish to keep old versions active.
11. **Toolchain Standardization:** Update the `creating-custom-portal` guide to use purely Deno tools (`deno run -A npm:sv create my-portal`, `deno task build`) to avoid lockfile and environment confusion.

## Core Concepts & Pedagogical Fixes

12. **Operations vs. Jobs:** Add a warning to `administering-jobs` clarifying that jobs are strict service-internal machinery, and developers should use Operations for caller-visible workflows.
13. **Portal Polling Terminology:** Change "polls" to "fetches" in `guides/src/routes/guides/concepts/+page.svx` regarding the portal state flow endpoint (`GET /auth/flow/:flowId`).
14. **Unhandled UI States:** Add an explicit `{:else if portal.state?.status === "redirect"}` and a defensive `{:else}` block to the Svelte template in `creating-custom-portal`.
15. **Approval Screen Context:** Add a line to the `approval_required` block in `creating-custom-portal` to display the authenticated user's ID/name to prevent authorization confusion.
