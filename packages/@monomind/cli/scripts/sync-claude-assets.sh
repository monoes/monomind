#!/usr/bin/env bash
# Syncs distributable .claude assets (skills, commands, agents, helpers) from
# the monorepo root into this package so they're included in the npm tarball.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$SCRIPT_DIR/.."
ROOT_DIR="$PKG_DIR/../../.."
SRC="$ROOT_DIR/.claude"
DEST="$PKG_DIR/.claude"

mkdir -p "$DEST"

for dir in skills commands agents helpers; do
  if [ -d "$SRC/$dir" ]; then
    rm -rf "$DEST/$dir"
    # Copy while excluding runtime .monomind subdirectories
    rsync -a --exclude='.monomind/' "$SRC/$dir/" "$DEST/$dir/"
    echo "  synced .claude/$dir"
  fi
done

echo "sync-claude-assets: done"
