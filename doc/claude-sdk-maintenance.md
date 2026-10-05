# Claude SDK maintenance

Claude model discovery uses the Claude Code binary bundled with the pinned Agent SDK unless a local Claude Code installation is selected. New models require a recent SDK pin.

The **Claude SDK refresh** GitHub Actions workflow runs weekly on Monday and can also be dispatched manually. It opens or updates a PR with the newest stable SDK version, the bundled Claude Code version, npm lockfile integrity data, executable SHA-256 hashes for every platform, and the workspace lockfile. It never merges or publishes automatically. Enable GitHub Actions' permission to create pull requests in repository settings for this workflow.

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

Both publish entry points check SDK freshness before publishing. The default warns when more than **five stable published versions** separate the pin from npm's `latest` tag. Prereleases and versions beyond that tag do not count. Registry lookup failures stop the check instead of reporting a false fresh result. To require freshness, run:

```sh
node scripts/claude-sdk-maintenance.mjs --max-behind 5 --strict
```

Review upstream release notes, regenerated integrity data, executable hashes, and the model discovery behavior before merging an update PR. The default GitHub Actions token does not trigger other PR workflows for its own bot commits; a reviewer should push the package version/changelog update (or reopen the PR with their own credentials) to trigger full CI. A pin bump should also follow the repository's package version and changelog release rules.
