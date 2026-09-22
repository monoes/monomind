---
name: monomind-dev-rules
description: "Operating rules every role of monomind's monomind-dev org follows on every command: repo and worktree layout, environment prefix, scratch and tmp hygiene, git identity and sandbox limits, evidence format, lint/build/baseline traps, brevity."
tags: ["engineering","operations"]
tools: []
license: Apache-2.0
source: https://github.com/monoes/monomind
---
# monomind-dev rules (every role, every command)

**Names used below.** REPO is the main checkout — the directory your session
starts in (`pwd` before you `cd` anywhere); it is on branch main. RUN is
`REPO/.monomind/orgs/monomind-dev/runs/<run-id>` and holds ledger.json, plans/,
logs/, evidence/ and REPORT.md. Each item works in its own worktree
WT=`REPO/.monomind/orgs/monomind-dev/work/<item-id>` on branch `dev/<item-id>`.
TMPDIR is `$HOME/mdev-tmp`. Every task message gives you the run id, the item id,
the SHA to work on and the paths of earlier evidence — use those, never values
remembered from an earlier task or run.

## The main checkout
- REPO may hold the owner's own uncommitted work: never modify, stash, reset,
  checkout or commit it. Only integrator changes local main, and only by
  fast-forward.

## Environment
- Prefix EVERY command that runs node, pnpm, npm, vitest or monomind with
  `env -u MONOMIND_SDK_AGENT -u MONOMIND_HOOK_QUIET -u MONOMIND_GRAPH_GATE -u MONOMIND_NO_LOCAL_EMBEDDINGS MONOMIND_CRASH_REPORTING=off MONOMIND_AUTO_UPDATE=false CI=true TMPDIR=$HOME/mdev-tmp`.
  Org sessions inject variables that silently change monomind's own behavior
  (issue #249).
- Never write under /tmp: it is a RAM tmpfs with a per-user quota, and filling it
  breaks every shell.
- SCRATCH: files you need to Read/Write/Edit with the file tools go in
  `REPO/.monomind/orgs/monomind-dev/scratch/<item-id>-<check>` (the file tools
  cannot reach paths outside the repo, issue #303). Sample projects that
  monograph must watch, and fake HOMEs, go in `$HOME/mdev-tmp/<item-id>-<check>`
  and are handled with Bash only (no dot-directories there: monograph's watcher
  ignores dot-segment paths).

## Git
- Never run `git config` in any checkout of this repo (worktrees share
  .git/config; issue #250).
- NEVER use `git stash` in any form: the stash stack is shared by every worktree
  and the owner has entries on it (issue #300). Use `git diff > $SCRATCH/x.patch`
  + `git apply -R`, or a scratch worktree at the base SHA.
- Known policy gaps (#299): at policy.git read, `merge-base`, `ls-remote`,
  `show-ref`, `reflog` are denied — use `git diff main...HEAD` /
  `git log main..HEAD` instead.
- Commit only with
  `GIT_AUTHOR_NAME=nokhodian GIT_AUTHOR_EMAIL=nokhodian@gmail.com GIT_COMMITTER_NAME=nokhodian GIT_COMMITTER_EMAIL=nokhodian@gmail.com git commit`
  using conventional commits (when it resolves an issue, put `Fixes #N` in the
  body; a bare `(#N)` leaves the issue open), and NO trailers (no
  Co-Authored-By, Claude-Session or 'Generated with').
- Stage explicit paths, never `git add -A` / `git add .`.
- Never push, never touch origin, npm or GitHub.

## Evidence
- Every claim is backed by a log under `RUN/logs/<role>/<item-id>-<check>.log`
  produced in THIS run, with the SHA it ran against.
- Report each check as {name, command, exit_code, PASS|FAIL|SKIP|FLAKY, log path,
  one-line evidence}. SKIP needs the exact error proving the check is impossible;
  never call a failure 'environmental' or 'pre-existing' without reproducing it
  on main.
- Finish every task with `org_task_done`, putting that table in the result.
  This org requires EVIDENCE: pass `evidence` = { `headSha`: the commit your
  checks ran on (`git -C <dir> rev-parse HEAD`), `worktree`: the item's WT when
  the work is on an item (omit it only for work on REPO itself, such as triage
  or the final report), `checks`: one { command, exitCode, output } per
  acceptance criterion — the real command, its real exit code, the tail of its
  output }. A non-zero exit or a sha that is no longer that worktree's HEAD is
  refused; after 3 refusals the task is failed and escalated to dev-lead. A task
  with nothing to run (a verdict, a plan) still names the command that proves
  it — e.g. `test -s <plan or verdict path>`, or `head -1 <verdict file>`.
- The evidence proves the task was done, not that the item is good: a FAIL,
  REJECT, REVISE or DROP verdict is a completed task. Its evidence checks are
  the commands that prove the verdict file exists and names the SHA; the failing
  commands and their exit codes go in the result's check table.

## Build, lint and test traps
- LINT: `pnpm run lint` from a worktree under .monomind/ silently checks 0 files
  (issue #297) — run `npx biome check packages tests scripts` and treat any
  output that does not report >1000 checked files as a FAIL.
- BUILD: if tsgo dies on a signal (SIGSEGV, not a TypeScript error), rerun that
  build once and log both; never copy dist/ from another checkout.
- BASELINE: the org's git guard env makes 17 git-config tests fail inside roles
  (issue #298: @monoes/monograph hooks-marker/hooks-install/hooks-status,
  role-sandbox.test.ts excludesFile) — a failure is a regression only if it is
  not in the verifier's baseline taken in the same role environment.

## Working style
- BREVITY: messages to other roles are instructions and evidence, not essays —
  at most ~20 lines plus log paths. Findings about the milestone go in the
  ledger entry, not in prose.
- Use monograph first for code navigation (monograph_suggest /
  monograph_context / monograph_impact), grep only as a fallback.
- Keep files under 500 lines. Follow the repo's CLAUDE.md coding principles:
  surgical changes, no speculative features, match surrounding style.

## Unattended
- After dev-lead's PREFLIGHT nobody asks the human anything:
  org_gate is denied for every role, and ask_human for every role except
  dev-lead, which may use it only during PREFLIGHT.
