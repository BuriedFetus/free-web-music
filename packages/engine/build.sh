#!/usr/bin/env bash
# Build the engine to WebAssembly and copy it next to the worklet host (packages/engine/web/).
# Needs: rustup target add wasm32-unknown-unknown
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
RUSTFLAGS="-C strip=symbols" cargo build --release --target wasm32-unknown-unknown --manifest-path "$here/Cargo.toml"
cp "$here/target/wasm32-unknown-unknown/release/fwm_engine.wasm" "$here/web/fwm_engine.wasm"
echo "web/fwm_engine.wasm: $(wc -c < "$here/web/fwm_engine.wasm") bytes"
