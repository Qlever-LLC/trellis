# Shared Test Vectors

This directory contains language-neutral test vectors that are consumed by both the TypeScript and Rust implementations.

Use this directory for values that should stay byte-for-byte identical across runtimes:

- `canonical-json/` - canonical serialization and digest vectors
- `auth-proof/` - session-key proof and domain-signature vectors

Do not put package-local snapshot tests here. If a fixture is only used by one implementation, keep it next to that implementation's tests instead.
