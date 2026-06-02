#!/bin/bash
set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGES=(learning-wasm exotic-wasm attention-wasm gnn-wasm ruvllm-wasm rvagent-wasm)
for pkg in "${PACKAGES[@]}"; do
  echo "Building @monovector/$pkg..."
  (cd "$REPO_ROOT/packages/@monovector/$pkg" && npm run build)
  echo "  Done: $pkg"
done
echo "All WASM packages built."
