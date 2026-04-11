# @qlever-llc/trellis-contracts

TypeScript contract authoring helpers and runtime metadata types for Trellis contracts.

Provides the `defineContract(...)` API for authoring contracts in TypeScript and consuming generated SDK metadata. Repo-local `trellis-generate` workflows, usually through `deno task prepare` or `cargo xtask prepare`, build canonical manifest artifacts and generated SDKs from contract source.

See [Trellis TypeScript Contract Authoring Design](../../../design/contracts/trellis-typescript-contract-authoring.md).
