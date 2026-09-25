# Publishing to npm

> Restored from the pre-regeneration CLAUDE.md (git HEAD). CLAUDE.md is now generator output, so this operational runbook lives here instead — edit it directly, do not paste it back into CLAUDE.md.

**These 9 packages are real.** Each has exactly one source directory in this repo and is
the only correct thing to publish. Anything on the npm account that is not in this table
is not a live package — see "Deprecated aliases" below.

| npm name | Source directory | Role |
| --- | --- | --- |
| `monomind` | repo root | **Umbrella shim only** — no code of its own; pins and re-execs the CLI |
| `@monoes/monomindcli` | `packages/@monomind/cli/` | The real CLI engine (all commands, MCP server, `.claude` tree) |
| `@monoes/monograph` | `packages/@monomind/monograph/` | Knowledge graph |
| `@monoes/memory` | `packages/@monomind/memory/` | Memory backend library |
| `@monoes/hooks` | `packages/@monomind/hooks/` | Hook registry + 9 on-demand workers |
| `@monoes/mcp` | `packages/@monomind/mcp/` | MCP server framework |
| `@monoes/routing` | `packages/@monomind/routing/` | Semantic routing |
| `@monoes/monobrowse` | `packages/@monoes/monobrowse/` | CDP browser automation |
| `@monoes/monodesign` | `packages/@monoes/monodesign/` | Design intelligence |
| `monofence-ai` | `packages/monofence-ai/` | AI-manipulation defense |

### Deprecated aliases — never publish these again

- **`@monoes/monomind`** (last: 1.18.11) — stub that pinned `monomind` at an exact old version.
- **`@monoes/monofence-ai`** (last: 1.0.0) — stub that pinned `monofence-ai@1.0.0`.

Both were hand-published one-offs with no source directory here, both went stale, and both
are now `npm deprecate`d pointing at their unscoped counterparts. They are intentionally
left published (unpublishing would break anyone who pinned them). If you find yourself
about to publish a "scoped alias", don't — there is no such pattern in this repo.

### `monomind` is a shim, not a second copy of the CLI

Until 2.7.12, root `package.json` shipped the entire CLI payload (`dist/`, `bin/`,
`.claude/`) *in addition to* `@monoes/monomindcli` shipping the same thing — ~27 MB of
duplicate bytes per release, and two packages that had to be version-bumped in lockstep or
silently diverge. Root now ships only `bin/cli.js` + README + LICENSE (~11 kB) and declares
`"@monoes/monomindcli": "<exact version>"` as its single dependency.

Do not re-add `packages/@monomind/cli/**` to the root `files` array.

`bin/cli.js` resolves the CLI by scanning `require.resolve.paths()` on the filesystem
rather than calling `require.resolve()` on the package — the CLI's `exports` map gates
every specifier, and older published versions export `"."` with only an `import` condition,
which makes CJS `require.resolve()` throw `ERR_PACKAGE_PATH_NOT_EXPORTED`. The filesystem
scan keeps a new umbrella working against an older installed CLI.

## Publishing to npm

`monomind` is a shim that pins `@monoes/monomindcli` exactly. Two numbers must
agree, and the pin itself is generated — never hand-written:

- root `package.json` → `version`
- `packages/@monomind/cli/package.json` → `version`
- root `package.json` → `dependencies["@monoes/monomindcli"]` is **`workspace:*`**,
  which pnpm rewrites to the CLI's exact version when it builds the tarball

`npm run check:versions` (wired into root `prepublishOnly`) blocks the publish on
drift, on a hand-written pin, and on publishing root with the wrong tool.

**Publish both the CLI and root with `pnpm publish`, never `npm publish`.** npm
does not understand the workspace protocol — it copies package.json verbatim, so
a published tarball would depend on the literal string `workspace:*`, which no
consumer can resolve. Nothing looks wrong at publish time; the package simply
installs for nobody. Root has always used `workspace:*` to pin the CLI. Since
issue #130, the CLI package *itself* also uses `workspace:*` for five sibling
deps (`@monoes/monograph`, `@monoes/hooks`, `@monoes/mcp`, `@monoes/memory`,
`@monoes/routing`) — both packages are affected, not just root. Each has its own
`prepublishOnly` guard (`scripts/check-publish-versions.mjs` for root,
`packages/@monomind/cli/scripts/check-workspace-deps.mjs` for the CLI) that
blocks a non-pnpm publish (override with `MONOMIND_ALLOW_NPM_PUBLISH=1` only if
you are certain).

**Publish the CLI before the umbrella,** and do not push the version bump until the
CLI is on npm: the pin resolves against the registry for anyone outside this
workspace, so a bump pushed early breaks CI with `ERR_PNPM_NO_MATCHING_VERSION`.

Fresh clone or fresh worktree: the CLI's `tsc` build needs its workspace deps'
`dist/` output to already exist, which a bare `pnpm install` does not build.
Build them first with the same filter the root `build` script uses.

```bash
# 0. Fresh checkout only: build the CLI's workspace deps before its own build
pnpm --filter "@monoes/monomindcli^..." run build

# 1. Bump the version in BOTH package.json files. Leave the pin alone.
#    Direct edit — `npm version` chokes on workspace:* protocol entries.
npm run check:versions          # verify before going further

# 2. Build + publish the CLI (the real payload) — pnpm, not npm
cd packages/@monomind/cli && npm run build
pnpm publish --tag latest --no-git-checks

# 3. Publish the umbrella shim from repo root — pnpm, not npm
cd ../../.. && pnpm publish --tag latest --no-git-checks

# Verify — these two must report the SAME version (registry propagation can lag
# a few minutes behind a successful publish; re-check rather than re-publish)
npm view @monoes/monomindcli dist-tags --json
npm view monomind dist-tags --json
```

Publish the CLI **before** the umbrella: the umbrella pins the CLI exactly, so publishing
it first leaves a window where `npm i monomind` cannot resolve its own dependency.

Sub-packages (`@monoes/memory`, `@monoes/monograph`, …) version and publish independently
from their own directories — they are not part of the umbrella's lockstep.

## Keeping the `.claude` trees in sync

The same asset tree exists five times in this repo, and `@monoes/monomindcli` ships one of
those copies (`packages/@monomind/cli/.claude`) to every npm user:

| Tree | Role |
| --- | --- |
| `.claude/` | What maintainers edit and run against. |
| `packages/@monomind/cli/.claude/` | Shipped to npm, **and the asset source `init` copies from**. A deliberate **superset** — extra agents, skills, `commands/`. |
| `.agents/skills/` | Shared install target for opencode/kimi/codex. |
| `.gemini/skills/`, `.kimi-code/skills/` | Passive mirrors. |

`monomind init --force` is safe to run inside this repo. It only writes the trees a platform
adapter points at — `.claude/` and `.agents/skills` — and writes each shipped file exactly as it
ships: ownership is tracked by content hash in `.monomind/init-manifest.json`, not by markers in
the file (older versions wrapped the Mastermind skills in `skills:<owner>:<name>` marker blocks;
see GH #344). A file already identical to the shipped copy is not rewritten.

After hand-editing `.claude/`, before committing:

```bash
pnpm run sync:claude-trees          # mirror
pnpm run sync:claude-trees:check    # report only; exit 1 on divergence
```

It **mirrors only the intersection.** A path in both trees is made to agree with the root
`.claude/` copy; a path in only one is never created and never deleted. That is what keeps the
shipped superset safe — its predecessor `sync-claude-assets.sh` had `rsync --delete`
semantics, had to be hard-disabled in 2026-07, and is now gone.
`tests/repo/no-skill-ownership-markers.test.ts` fails if a committed skill file carries a
`skills:` ownership marker.

The check mode runs in `pnpm run verify` and in CI. Full rationale is at the top of
`scripts/sync-claude-trees.mjs`.

## Support

