#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" == "--" ]]; then
  shift
fi

if [[ -n "${TRELLIS_CLI_BIN:-}" ]]; then
  exec "$TRELLIS_CLI_BIN" "$@"
fi

if [[ "${TRELLIS_USE_BOOTSTRAP:-}" == "1" ]]; then
  exec cargo run --manifest-path "$repo_root/rust/bootstrap/Cargo.toml" -- "$@"
fi

if [[ -x "$repo_root/rust/target/debug/trellis" ]]; then
  exec "$repo_root/rust/target/debug/trellis" "$@"
fi

if [[ -x "$repo_root/rust/target/release/trellis" ]]; then
  exec "$repo_root/rust/target/release/trellis" "$@"
fi

if [[ -f "$repo_root/rust/bootstrap/Cargo.toml" ]]; then
  exec cargo run --manifest-path "$repo_root/rust/bootstrap/Cargo.toml" -- "$@"
fi

exec cargo run --manifest-path "$repo_root/rust/Cargo.toml" -p trellis-cli --bin trellis -- "$@"
