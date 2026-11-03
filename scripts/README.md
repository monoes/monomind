# scripts/

Index of repo utility scripts. Groups: **release** (publish guards), **ci** (lint and drift checks), **assets** (generated files), **growth** (marketing assets), **dev** (local tooling). Do not move or rename a script without updating its caller.

| Script | Group | Purpose | Called from |
|---|---|---|---|
| `add-capability-template.ts` | dev | Print a `capability:` frontmatter block for an agent file | manual |
| `archive-superseded-chunks.mjs` | dev | Archive orphaned `doc:` chunk rows from the memory store | manual |
| `build-fs.mjs` | dev | Cross-platform fs helpers for package build scripts | package `build` scripts, `tests.yml` |
| `check-cli-pack.mjs` | release | Assert the CLI tarball ships the skills `init` needs | `publish-smoke-test.yml`, cli `package.json` |
| `check-doc-refs.mjs` | ci | Verify source links in `doc/` resolve | root `package.json` |
| `check-monograph-exports.mjs` | release | Verify every name the CLI imports from monograph is exported | monograph `prepublishOnly` |
| `check-overrides-source.mjs` | ci | Keep dependency overrides in `pnpm-workspace.yaml` only | root `package.json` |
| `check-package-bumps.mjs` | release | Changed package source needs a version bump | root `package.json` |
| `check-publish-versions.mjs` | release | Umbrella shim pins the real CLI version | root `package.json`, release org |
| `check-published-pins.mjs` | release | `workspace:*` pins resolve to published versions | root `package.json` |
| `check-workspace-protocol.mjs` | release | Sibling deps must use `workspace:` | root `package.json` |
| `check-workspace-publish.mjs` | release | Packages with `workspace:` deps must publish via pnpm | monodesign and hooks `prepublishOnly` |
| `claude-sdk-maintenance.mjs` | ci | Refresh the pinned Claude SDK | `claude-sdk-refresh.yml` |
| `commit-msg-issue-refs.mjs` | dev | Advisory: `(#N)` refs do not close issues | `.githooks/commit-msg` |
| `doc-counts-shared.mjs`, `doc-counts-source.mjs` | ci | Helpers for `generate-doc-counts.mjs` | `generate-doc-counts.mjs` |
| `export-ettin-onnx.py` | assets | Export the Ettin ONNX model with its head baked in | manual (cited by `memory-bridge-backend.ts`) |
| `generate-agent-avatars.mjs` (+ `-palette`, `-roster`) | assets | Generate 120 SVG agent avatars and sprite sheet | manual |
| `generate-channel-profile-assets.sh` | growth | Generate mascot avatars and banners per channel | manual |
| `generate-doc-counts.mjs` | ci | Regenerate or `--check` doc counts | `tests.yml`, release org |
| `generate-retired-file-hashes.mjs` | assets | Regenerate `init/retired-files-data.ts` | manual |
| `growth-content-calendar.mjs` | growth | Render the public content calendar | manual |
| `growth-profile-kit.mjs` | growth | Render `channel-profiles.html` | manual |
| `install-hooks.mjs` | dev | Set `core.hooksPath` and register the CHANGELOG merge driver | root `prepare` |
| `install.sh` | dev | Standalone installer | users |
| `lint-agent-refs.mjs` | ci | Lint agent and skill references | `tests.yml`, root `package.json` |
| `lint-skills.mjs` | ci | Validate `monomind <cmd>` examples in skills | `tests.yml` |
| `lint-tool-refs.mjs` | ci | Lint MCP tool and CLI command references | `tests.yml`, root `package.json` |
| `measure-init-listing.mjs` | dev | Measure the listing an `init` preset installs | manual, `tests/repo/init-listing-budget.test.ts` |
| `merge-changelog.mjs` | dev | Git merge driver for `CHANGELOG.md` | `.gitattributes` via git config |
| `pack-workspace-closure.mjs` | release | Pack a package plus its workspace deps | `publish-smoke-test.yml` |
| `pick-eval.mjs` | ci | Offline agent and skill picking eval | `pnpm run pick:eval` |
| `release-lock.mjs` | release | One release org run per clone | release org |
| `sections-hardening-mutation.mjs`, `sections-hardening-mutations.mjs` | ci | Mutation check of the release-build guards | tests |
| `sync-claude-trees.mjs` | ci | Mirror `.claude/` to the other asset trees | `tests.yml`, root `package.json` |
| `ua-enrich.mjs`, `ua-import.mjs` | dev | Enrich or import the monograph with understand-anything data | edit hook (`.claude/helpers`), manual |
| `validate-capability-metadata.ts` | dev | Validate agent capability frontmatter | `tests/scripts/validate-capability-metadata.test.ts` |
| `verify-appliance.sh` | dev | Appliance capability verification suite (ADR-058) | manual |
| `worktree-session.sh` | dev | Start, finish or list git worktree sessions | manual |
