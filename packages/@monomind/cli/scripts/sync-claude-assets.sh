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
    cp -r "$SRC/$dir" "$DEST/$dir"
    echo "  synced .claude/$dir"
  fi
done

# Bundle @monomind/graph dist so graphify-freshen.cjs works from npm installs
GRAPH_SRC="$ROOT_DIR/packages/@monomind/graph"
GRAPH_DEST="$PKG_DIR/bundled-graph"
if [ -d "$GRAPH_SRC/dist" ]; then
  rm -rf "$GRAPH_DEST"
  mkdir -p "$GRAPH_DEST"
  cp -r "$GRAPH_SRC/dist" "$GRAPH_DEST/dist"
  cp "$GRAPH_SRC/package.json" "$GRAPH_DEST/package.json"
  echo "  synced bundled-graph"
fi

echo "sync-claude-assets: done"
