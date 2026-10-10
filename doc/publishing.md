# Publishing to npm

> Restored from the pre-regeneration CLAUDE.md (git HEAD). CLAUDE.md is now generator output, so this operational runbook lives here instead — edit it directly, do not paste it back into CLAUDE.md.

**These 10 packages are real.** Each has exactly one source directory in this repo and is
the only correct thing to publish. Anything on the npm account that is not in this table
is not a live package — see "Deprecated aliases" below.

| npm name | Source directory | Role |
| --- | --- | --- |
| `monomind` | repo root | **Umbrella shim only** — no code of its own; pins and re-execs the CLI |
| `@monoes/monomindcli` | `packages/@monomind/cli/` | The real CLI engine (all commands, MCP server, `.claude` tree) |
| `@monoes/monograph` | `packages/@monomind/monograph/` | Knowledge graph |
| `@monoes/memory` | `packages/@monomind/memory/` | Memory backend library |
| `@monoes/hooks` | `packages/@monomind/hooks/` | Hook registry + <!-- doc-count:workers -->9<!-- /doc-count:workers --> on-demand workers |
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
from their own directories — they are not part of the umbrella's lockstep. Only `monomind`
and `@monoes/monomindcli` take the release number. The 2.24.0 release published eight
sub-packages (`@monoes/monobrowse`, `@monoes/monodesign`, `@monoes/hooks`, `@monoes/mcp`,
`@monoes/memory`, `@monoes/monograph`, `@monoes/routing`, `monofence-ai`) at 2.24.0 instead of
on their own lines; that cannot be unpublished, so their lines continue from 2.24.0. To stop
it happening again, `scripts/check-package-bumps.mjs` (part of `npm run check:versions`) fails
when a sub-package's major version rose since the last release tag without a breaking commit
(`type(scope)!:` or a `BREAKING CHANGE:` footer) touching it. It skips when no release tag is
reachable, and `MONOMIND_ALLOW_MAJOR_BUMP=1` is the escape hatch. A package with a first-use
pin (`monofence-ai`, which the CLI installs on first use) moves its pin, lock entry and file
hashes in the same commit as its version.

Root `prepublishOnly` also runs `node scripts/generate-doc-counts.mjs --check` and
`node scripts/check-doc-refs.mjs`, so a doc that states a stale tool, agent, skill or worker
count, or cites a source symbol that no longer exists, blocks the publish. Regenerate counts
with `pnpm run docs:counts`.

## The release org

A release is run by the `release` org, defined in `.monomind/orgs/release.json` and mirrored in
`config/orgs/release.json`. It has ten roles: `release-captain` (boss), `builder`, `cli-qa`,
`integration-qa`, `runtime-qa`, `maintainer`, `fixer`, `docs-writer`, `publisher` and
`release-auditor`. It runs with a 4,000,000-token budget, task-scoped sessions and
`completion_evidence` on, so a task closes only on commands and exit codes pinned to a commit.

One run is meant to be unattended. PREFLIGHT comes first: it checks npm publish rights without
an OTP, GitHub and git push rights, a Claude login for the agent trials, tools and disk, and
asks the human once, only when something is missing. After that the org verifies, fixes, updates
docs and the site, bumps the version and CHANGELOG, and re-verifies the release commit. On an
evidence-backed GO it publishes to npm, fast-forwards `main`, tags, creates the GitHub release,
confirms the website deploy, syncs local `main`, files GitHub issues for anything left unfixed
and cleans up. Only the `publisher` role has `policy.git: push`; the captain and the auditor are
read-only.

The operator signs the org before it runs (`monomind org sign release`) and signs it again after
anything changes its instructions, including the release rules skill it loads. Start it with
`monomind org run release`; [Org Runtime](concepts/org-runtime.md) covers how org runs work.

## Several sessions, one repo

Several Claude sessions can work in the same clone and release from it.

**CHANGELOG.md merge driver.** A release turns `## [Unreleased]` into `## [X.Y.Z] — <date>`
on origin. A session that added entries under `## [Unreleased]` in the meantime used to hit
a CHANGELOG.md conflict on every `git merge origin/main`. `.gitattributes` routes
CHANGELOG.md to the `monomind-changelog` merge driver, `scripts/merge-changelog.mjs`. It keeps
the released sections verbatim and puts every entry that only your side added into one
`## [Unreleased]` above them, deduped and grouped under their `### Added` / `### Fixed` / …
headings. Any other kind of conflict is left to you as an ordinary one. Git only knows the
driver once it is registered in the clone's config, once per clone (every worktree shares it):

```bash
pnpm run setup:merge-drivers
```

Without it, `.gitattributes` has no effect and git merges CHANGELOG.md as plain text. To use
it for one merge without registering it:

```bash
git -c merge.monomind-changelog.driver="node scripts/merge-changelog.mjs %O %A %B" merge origin/main
```

If a merge already stopped on the conflict, register the driver, run
`git checkout -m CHANGELOG.md` to redo that file's merge with it, check the file has no
conflict markers left, and `git add CHANGELOG.md`.

**Release lock.** Only one release org run per clone at a time. Before PREFLIGHT,
release-captain runs `node scripts/release-lock.mjs acquire --runtime
.monomind/orgs/release/runtime.json`. That is an atomic `mkdir` under
`~/.monomind/release-locks/`, keyed by the clone's git common dir, so the main checkout
and every worktree share one lock. A second run finds the lock held, reports "release
already in progress by run X (pid, host, since)" and ends without doing anything. The
captain releases the lock at the end of every run, GO or NO-GO. The lock is not kept in
`.git` itself because the captain runs with `policy.git: read`, where `.git` is read-only.
A lock whose holder is gone is taken over by the next acquire: its run ended in
`runtime.json`, its run's `bus.jsonl` was quiet for 30 minutes, its pid is dead (checked
only from the pid namespace that recorded it), the machine rebooted, or it is older than 12
hours. To check or clear it by hand:

```bash
node scripts/release-lock.mjs status
node scripts/release-lock.mjs release --force   # only when no release is running
```

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
see GH #344). A file already identical to the shipped copy is not rewritten; a file you
hand-edited is left as-is and the incoming shipped version is written alongside it as
`<file>.monomind-new` so you can diff and merge at your own pace. The migration away from
the old markers runs on the next plain `init` or `init --force` (not `init upgrade`, which
only touches helpers, the statusline and `CLAUDE.md`/`CAPABILITIES.md`).

After hand-editing `.claude/`, before committing:

```bash
pnpm run sync:claude-trees          # mirror
pnpm run sync:claude-trees:check    # report only; exit 1 on divergence
```

It **mirrors only the intersection.** A path in both trees is made to agree with the root
`.claude/` copy; a path in only one is never deleted, and is created only for the two mirrors
that opt in: `.agents/skills` and `.gemini/skills` get a file missing inside a skill directory
they already hold (a skill that gained a new file keeps mirroring), and `.gemini/helpers` gets
any file missing from its full install copy of `.claude/helpers`. Nothing is ever deleted from
any mirror. That is what keeps the shipped superset safe — its predecessor
`sync-claude-assets.sh` had `rsync --delete` semantics, had to be hard-disabled in 2026-07, and
is now gone.
`tests/repo/no-skill-ownership-markers.test.ts` fails if a committed skill file carries a
`skills:` ownership marker.

The check mode runs in `pnpm run verify` and in CI. Full rationale is at the top of
`scripts/sync-claude-trees.mjs`.

## Support

