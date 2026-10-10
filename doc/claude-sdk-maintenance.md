# Claude SDK maintenance

The Claude runtime (org roles, `agent exec --runtime claude`, `agent models --runtime claude`) uses `@anthropic-ai/claude-agent-sdk`, pinned to an exact version in `packages/@monomind/cli/package.json` and `src/utils/optional-deps.ts` (currently 0.3.289). The SDK is not installed with the CLI: it is installed on first use into `~/.monomind/deps`, from hash-pinned tarballs (`monomind deps install` does it on request). New Claude models require a recent SDK pin.

Which Claude Code binary runs is a separate choice. The SDK ships its own copy, but the runtime passes a usable installed `claude` to the SDK instead, and then installs the SDK without its bundled binary. The order is `--claude-path <absolute-file|bundled>`, `MONOMIND_CLAUDE_PATH`, `monomind config set claude.path`, then a system-installed `claude` found on its own. See [Org Runtime](concepts/org-runtime.md#21-claudeagentrunner-default) for the acceptance rules. Model discovery uses whichever binary was selected, so it falls back to the bundled copy only when no local Claude Code is selected.

The **Claude SDK refresh** GitHub Actions workflow runs weekly on Monday and can also be dispatched manually. It has two jobs. The first, `compute`, holds read-only permissions: it downloads the newest stable SDK and its platform tarballs, runs the bundled executable, regenerates the pin data and runs the pin tests. The second, `open-pr`, runs none of that code: it takes the regenerated files and opens or updates the PR. Third-party actions are pinned to commit SHAs. The PR carries the newest stable SDK version, the bundled Claude Code version, npm lockfile integrity data, executable SHA-256 hashes for every platform, and the workspace lockfile. It never merges or publishes automatically. Enable GitHub Actions' permission to create pull requests in repository settings for this workflow.

The generator downloads tarballs from the npm registry and verifies each against its lockfile integrity before hashing the SDK entry and platform executables. On Linux x64 it runs the verified bundled executable with `--version` to derive the Claude Code version; it does not infer that version from the SDK version number. Refresh fails before changing source files if a download, integrity check, expected package entry, or native version probe fails.

Run a refresh locally in an isolated Linux x64 checkout:

```sh
node scripts/claude-sdk-maintenance.mjs --update
pnpm install --lockfile-only --ignore-scripts
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec biome format --write packages/@monomind/cli/src/utils/optional-deps-locks.ts
pnpm exec vitest run tests/scripts/claude-sdk-maintenance.test.mjs
pnpm --filter @monoes/monomindcli exec vitest run src/__tests__/optional-deps-pins.test.ts src/__tests__/optional-deps.test.ts
```

Freshness is checked by `pnpm run check:claude-sdk`. By default it prints a warning when more than **five stable published versions** separate the pin from npm's `latest` tag (prereleases and versions beyond that tag do not count), and `--strict` turns that warning into a failure. A registry lookup failure fails the check instead of reporting a false fresh result. The CLI's `prepublishOnly` runs the same check with `--warn-only`, so a registry or network failure there prints a warning and does not block a publish. To require freshness yourself, run:

```sh
node scripts/claude-sdk-maintenance.mjs --max-behind 5 --strict
```

Review upstream release notes, regenerated integrity data, executable hashes, and the model discovery behavior before merging an update PR. A bump can change the `org_*` tool schemas the SDK emits; the sections-off fixtures are regenerated with it. The default GitHub Actions token does not trigger other PR workflows for its own bot commits; a reviewer should push the package version/changelog update (or reopen the PR with their own credentials) to trigger full CI. A pin bump should also follow the repository's package version and changelog release rules.
