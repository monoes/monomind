#!/bin/bash
# Alpha-prerelease publish script for @monoes/monomindcli.
#
# The root `monomind` package is a separate, thin wrapper (bin/cli.js +
# README + LICENSE) with a real npm dependency on this package — pnpm
# rewrites its `workspace:*` pin to a real version at publish time, so it
# self-publishes correctly on its own (`pnpm publish` from the repo root).
# This script used to also hand-build and republish a renamed copy of this
# package's own dist/ as "monomind"; that duplicated what the root package
# already does correctly and had gone stale (it still referenced this
# package's pre-rename "@monomind/cli" name), so it's been removed.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(dirname "$SCRIPT_DIR")"

cd "$CLI_DIR"

# dist/src/ui/* (dashboard, server, etc.) is hand-authored source under src/ui/
# copied into dist/ by the build step — it is no longer committed to git, so a
# stale or missing dist/ here would silently ship a broken/absent dashboard.
echo "=== Building ==="
npm run build

# Get current version
VERSION=$(node -p "require('./package.json').version")
echo "Publishing version: $VERSION"

echo ""
echo "=== Publishing @monoes/monomindcli@$VERSION (alpha tag) ==="
npm publish --tag alpha

echo ""
echo "=== Updating dist-tags ==="
npm dist-tag add @monoes/monomindcli@$VERSION alpha
npm dist-tag add @monoes/monomindcli@$VERSION latest

echo ""
echo "=== Published successfully ==="
echo "  @monoes/monomindcli@$VERSION (alpha, latest)"
echo ""
echo "Install with:"
echo "  npx @monoes/monomindcli@alpha"
echo ""
echo "To also publish the root 'monomind' wrapper package, run from the repo root:"
echo "  pnpm publish --no-git-checks"
