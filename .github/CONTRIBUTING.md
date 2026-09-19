# Contributing to monomind

Thanks for helping. This guide covers how to set up the repo, make a change, and get it merged.

## Before you start

- **Bugs and features:** open an issue first using the [issue templates](https://github.com/monoes/monomind/issues/new/choose), unless the fix is small and obvious.
- **Security problems:** do not open a public issue. Follow [SECURITY.md](SECURITY.md).
- **Conduct:** everyone taking part agrees to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

You need **Node.js 22.12 or newer** (some dependencies require it, and `.npmrc` sets `engine-strict=true`), **pnpm 10**, and git.

```bash
git clone https://github.com/monoes/monomind.git
cd monomind
pnpm install
pnpm build
```

`pnpm install` also installs the repo's git hooks (`scripts/install-hooks.mjs`), including a secret scanner that blocks commits containing credentials.

## Repository layout

A pnpm workspace:

| Directory | npm package |
|---|---|
| `packages/@monomind/cli` | `@monoes/monomindcli` (the CLI and MCP server; most changes land here) |
| `packages/@monomind/{hooks,memory,monograph,routing,mcp}` | `@monoes/hooks`, `@monoes/memory`, `@monoes/monograph`, `@monoes/routing`, `@monoes/mcp` |
| `packages/@monoes/{monobrowse,monodesign}`, `packages/monofence-ai` | browser automation, design tooling, prompt-injection fence |
| `tests/` | cross-package tests |
| `doc/` | user documentation and the website |

Filter by the **npm name**, not the directory: `pnpm --filter @monoes/monomindcli test`.

Run the CLI from source with `node packages/@monomind/cli/bin/cli.js <command>`. It loads the built `dist/`, so run `pnpm build` (or `pnpm --filter @monoes/monomindcli build`) after changing TypeScript.

## Making a change

1. Branch from `main`.
2. **Write a failing test first**, then make it pass. Tests use [vitest](https://vitest.dev). Put them next to the code (`src/__tests__/`, `__tests__/`) or in `tests/`.
3. Keep changes focused: every changed line should trace to the issue. No drive-by refactors or reformatting.
4. Keep files under 500 lines, and give public functions typed signatures.
5. Update the docs for anything a user can see (commands, flags, MCP tools, config), in `README.md`, `doc/` and the package READMEs.
6. If you change a skill (`SKILL.md`), keep the copies in sync: `pnpm sync:claude-trees`.

## Checks

Run everything before opening a pull request:

```bash
pnpm verify
```

This builds, typechecks, lints (biome), checks doc references and that the skill copies are in sync, then runs every package's tests. The individual commands:

| Command | What it runs |
|---|---|
| `pnpm test:all:run` | all vitest suites |
| `pnpm --filter <package> test` | one package's tests |
| `pnpm lint` / `pnpm lint:fix` | biome lint and format check / auto-fix |
| `pnpm typecheck` | TypeScript |
| `pnpm test:security` | security regression tests |
| `pnpm docs:counts:check` | tool/command counts quoted in the docs |

Never weaken, skip (`.skip`/`.only`) or delete a test to make a change pass.

## Commits and pull requests

- Use [conventional commits](https://www.conventionalcommits.org): `fix(scope): …`, `feat(scope): …`, `docs: …`, `test: …`, `refactor: …`, `chore: …`. Add `!` for a breaking change and describe it in the body.
- Reference the issue in the commit body: `Fixes #123`.
- Fill in the [pull request template](PULL_REQUEST_TEMPLATE.md). Changes to server routes, auth, input handling, SSE/WebSocket, or file-system access also need the [security checklist](SECURITY_CHECKLIST.md).
- A maintainer reviews every pull request. CI (`.github/workflows/`) must pass.

## License

monomind is licensed under [Apache-2.0](../LICENSE). By contributing, you agree that your contributions are licensed under the same terms.
