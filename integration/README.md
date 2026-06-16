# Client Integration Matrix

`client-test-matrix.json` is the shared parity contract for Trellis client
library integration tests. Each case describes a public client-library behavior
that every supported client language must implement and pass.

## Matrix Rules

- Case IDs are stable semantic IDs in the form `<fixture>.<case>`.
- The `fixture` groups focused local runs; it is not language-specific.
- The matrix must not contain a `languages` field, language skips, or
  language-specific required lists.
- The matrix must not contain a schema-version field. The clean-break JSON shape
  is the contract.
- `coverage` values preserve the existing release-guide coverage vocabulary.
- Every case must include a language-neutral `scenario` with `participants`,
  `given`, `when`, and `then` sections.
- Every matrix case must map to one live TypeScript/Deno test and one live Rust
  test. Unit, descriptor-only, mock-only, or ignored tests do not satisfy matrix
  coverage.

## Adding A Case

1. Add the case to `client-test-matrix.json` first.
2. Run the JS and Rust matrix conformance tests.
3. Implement the matching case ID in both language-owned suites.
4. Keep the same semantic case ID in both local manifests.

The conformance tests should report the new case as missing until both suites
declare it. Removing or renaming a case is a breaking test-contract change and
should be called out in review.

## Focused Runs

Focused TypeScript/Deno runs are driven from the shared matrix:

```sh
deno task -c js/deno.json test:integration -- --fixture rpc
deno task -c js/deno.json test:integration -- --case rpc.client-calls-service-success
deno task -c js/deno.json test:integration -- --coverage cross-runtime-rpc
```

Focused Rust runs use Cargo's normal test filtering with the function names
registered in `rust/crates/trellis/tests/integration/support/cases.rs`:

```sh
cargo test --manifest-path rust/Cargo.toml -p trellis-rs --test integration rpc_client_calls_service_success -- --nocapture
```

## Release Parity

Release verification should run the TypeScript/Deno and Rust integration suites
as peer checks against this matrix. There are no per-language opt-ins: a matrix
case failing in one language is a client-library or runtime bug to fix.
