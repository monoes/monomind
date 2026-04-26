#!/bin/bash
# Publish script for @monomind/cli
# Publishes to both @monomind/cli@alpha AND monomind@alpha

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(dirname "$SCRIPT_DIR")"

cd "$CLI_DIR"

# Get current version
VERSION=$(node -p "require('./package.json').version")
echo "Publishing version: $VERSION"

# 1. Publish @monomind/cli with alpha tag
echo ""
echo "=== Publishing @monomind/cli@$VERSION (alpha tag) ==="
npm publish --tag alpha

# 2. Publish to monomind with alpha tag
echo ""
echo "=== Publishing monomind@$VERSION (alpha tag) ==="

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Copy necessary files
cp -r dist bin src package.json README.md "$TEMP_DIR/"

# Change package name to unscoped
cd "$TEMP_DIR"
sed -i 's/"name": "@monomind\/cli"/"name": "monomind"/' package.json

# Publish with alpha tag
npm publish --tag alpha

echo ""
echo "=== Updating dist-tags ==="

# Update all tags to point to the new version
npm dist-tag add @monomind/cli@$VERSION alpha
npm dist-tag add @monomind/cli@$VERSION latest
npm dist-tag add monomind@$VERSION alpha
npm dist-tag add monomind@$VERSION latest

echo ""
echo "=== Published successfully ==="
echo "  @monomind/cli@$VERSION (alpha, latest)"
echo "  monomind@$VERSION (alpha, latest)"
echo ""
echo "Install with:"
echo "  npx monomind@alpha"
echo "  npx @monomind/cli@latest"
