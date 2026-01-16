#!/bin/bash
# Publish script for @monobrain/cli
# Publishes to both @monobrain/cli@alpha AND monobrain@alpha

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(dirname "$SCRIPT_DIR")"

cd "$CLI_DIR"

# Get current version
VERSION=$(node -p "require('./package.json').version")
echo "Publishing version: $VERSION"

# 1. Publish @monobrain/cli with alpha tag
echo ""
echo "=== Publishing @monobrain/cli@$VERSION (alpha tag) ==="
npm publish --tag alpha

# 2. Publish to monobrain with alpha tag
echo ""
echo "=== Publishing monobrain@$VERSION (alpha tag) ==="

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Copy necessary files
cp -r dist bin src package.json README.md "$TEMP_DIR/"

# Change package name to unscoped
cd "$TEMP_DIR"
sed -i 's/"name": "@monobrain\/cli"/"name": "monobrain"/' package.json

# Publish with alpha tag
npm publish --tag alpha

echo ""
echo "=== Updating dist-tags ==="

# Update all tags to point to the new version
npm dist-tag add @monobrain/cli@$VERSION alpha
npm dist-tag add @monobrain/cli@$VERSION latest
npm dist-tag add monobrain@$VERSION alpha
npm dist-tag add monobrain@$VERSION latest

echo ""
echo "=== Published successfully ==="
echo "  @monobrain/cli@$VERSION (alpha, latest)"
echo "  monobrain@$VERSION (alpha, latest)"
echo ""
echo "Install with:"
echo "  npx monobrain@alpha"
echo "  npx @monobrain/cli@latest"
