#!/bin/bash
# Publish all @monovector/* WASM packages to npm
# Usage: bash scripts/publish-monovector.sh
# Requires: npm login + @monovector org created at https://www.npmjs.com/org/create

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PACKAGES=(learning-wasm exotic-wasm attention-wasm gnn-wasm ruvllm-wasm rvagent-wasm)

for pkg in "${PACKAGES[@]}"; do
  PKG_DIR="$REPO_ROOT/packages/@monovector/$pkg/pkg"
  echo "Publishing @monovector/$pkg from $PKG_DIR..."
  (cd "$PKG_DIR" && npm publish --access public)
  echo "  ✓ @monovector/$pkg published"
done

echo ""
echo "All WASM packages published."
echo "Verify: npm view @monovector/learning-wasm dist-tags --json"
