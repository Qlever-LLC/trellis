# Client Integration Matrix

`client-test-matrix.json` is the shared parity contract for Trellis client
library integration tests. Each case describes a public client-library behavior
that every supported client language must implement and pass.

## Matrix Rules

- Case IDs are stable semantic IDs in the form `<fixture>.<case>`.
- The `fixture` groups focused local runs; it is not language-specific.
- The matrix must not contain a `languages` field, language skips, or
  language-specific required lists.
- `coverage` values preserve the existing release-guide coverage vocabulary.

## Adding A Case

1. Add the case to `client-test-matrix.json` first.
2. Run the JS and Rust matrix conformance tests.
3. Implement the matching case ID in both language-owned suites.
4. Keep the same semantic case ID in both local manifests.

The conformance tests should report the new case as missing until both suites
declare it. Removing or renaming a case is a breaking test-contract change and
should be called out in review.

## Focused Runs

Focused integration execution is intended to be driven from the shared matrix by
fixture, case ID, or coverage ID. Later migration phases will add language-owned
runners for commands such as focused `rpc` fixture runs, single-case runs, and
coverage-filtered runs.

## Release Parity

Release verification should run the TypeScript/Deno and Rust integration suites
as peer checks against this matrix. There are no per-language opt-ins: a matrix
case failing in one language is a client-library or runtime bug to fix.
