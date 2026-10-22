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
