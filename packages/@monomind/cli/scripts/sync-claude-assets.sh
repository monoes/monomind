#!/usr/bin/env bash
# DISABLED — do not run.
#
# This script used to rsync root .claude/ -> packages/@monomind/cli/.claude/
# (with rm -rf delete semantics) so the package tarball would include the
# assets. That direction is now DESTRUCTIVE: the canonical, complete copy of
# the shipped .claude assets lives in packages/@monomind/cli/.claude, and the
# monorepo root .claude contains only a small subset (4 of 25 skill dirs).
# Running the old sync would wipe most of the shippable skills/agents/commands.
#
# Decision (2026-07): guard with a hard error instead of reversing direction —
# nothing should be mirroring these trees anymore. If you need to change the
# shipped assets, edit packages/@monomind/cli/.claude directly.
set -e

echo "ERROR: sync-claude-assets.sh is disabled." >&2
echo "The canonical .claude assets live in packages/@monomind/cli/.claude." >&2
echo "The old root->CLI rsync would delete most shipped skills. Edit the CLI copy directly." >&2
exit 1
