---
name: release-scratch
description: "Scratch projects, tarball installs and the registry-contamination proof for release builder and QA roles."
tags: ["operations","devops"]
tools: []
license: Apache-2.0
source: https://github.com/monoes/monomind
---
# Scratch installs (builder, QA roles)

- Tarballs live in `$GATE/tarballs/<short-sha>`, the clean install in `$GATE/install-<short-sha>`, the bin at `$GATE/install-<short-sha>/node_modules/.bin/monomind`. QA uses ONLY that bin for the round's SHA.
- Scratch projects: `$HOME/mrg-tmp/<check>-<short-sha>` (no dot-directories: monograph's watcher ignores dot-segments and Chrome's socket path must fit 108 bytes), with `HOME=$HOME/mrg-tmp/home-<short-sha>` for everything except live agent trials, which use the real HOME (logins live there). Scratch git repos: `git -c user.name=qa -c user.email=qa@example.invalid`.
- Install THIS round's build, never the registry's. Before a release the local packages carry the same version as npm, so installing one tarball silently resolves its monomind siblings from the registry, i.e. the previous release's code (2.16.9 drill, #349). Install ALL tarballs in ONE `npm install`, or the paths printed by `node scripts/pack-workspace-closure.mjs . <outDir>` run in SRC.
- Prove it before running anything and put the check in your evidence; it must print nothing, any line printed is a registry package, so reinstall:
  `jq -r '.packages | to_entries[] | select(.key | test("node_modules/(monomind|monofence-ai|@monoes/[^/]+)$")) | select((.value.resolved // "") | startswith("file:") | not) | .key' node_modules/.package-lock.json`
- Destructive commands only in these scratch projects (core rules). Your shell cannot write to ORG_ROOT: a write error there means you are in the wrong directory.
- Live org drills (#699): a role cannot `org sign` and `org run` refuses an unsigned org. Drills work only when the OPERATOR enabled `org.allowDrillSigning` in `~/.monomind/operator-settings.json` (off by default; you cannot set it, and an env var or file of yours does nothing). Then give the drill a key of its own. The throwaway project must be a plain directory under `$HOME/mrg-tmp` (NOT a git repo, none above it either), then in the SAME Bash call: `cd <project> && export MONOMIND_ORGRT_OPERATOR_DIR=$PWD/drill-operator && monomind org sign <org> --yes && timeout -k 30 480 monomind org run <org> --task '…' -y`. `org sign` allows this from a role only with that variable pointing inside a non-git project; the signature and key live in that directory, are read only by processes given the same variable, and never apply to the real operator directory or a real org. Never use it on ORG_ROOT, SRC or any git checkout (it refuses). A drill that cannot sign (setting off, or any refusal) is a FINDING reported with the exact error, never a SKIP and never worked around.
