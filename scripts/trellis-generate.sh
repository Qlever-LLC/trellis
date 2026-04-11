#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" == "--" ]]; then
  shift
fi

if [[ -n "${TRELLIS_GENERATE_BIN:-}" ]]; then
  exec "$TRELLIS_GENERATE_BIN" "$@"
fi

exec cargo run --manifest-path "$repo_root/rust/tools/generate/Cargo.toml" --bin trellis-generate -- "$@"
