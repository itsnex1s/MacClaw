#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

npm --prefix "$ROOT_DIR" ci
npm --prefix "$ROOT_DIR" run check
cargo fmt --manifest-path "$ROOT_DIR/src-tauri/Cargo.toml" --check
cargo clippy --manifest-path "$ROOT_DIR/src-tauri/Cargo.toml" --all-targets -- -D warnings
