---
name: monomind-release-rules
description: "Operating rules every role of monomind's release org follows on every command: environment prefix, scratch and tmp hygiene, evidence format, git identity and sandbox limits, process safety."
tags: ["operations","devops"]
tools: []
license: Apache-2.0
source: https://github.com/monoes/monomind
---
# Release rules (every role, every command)

**Names used below.** ORG_ROOT is the main checkout — the directory your session
starts in (`pwd` before you `cd` anywhere). SRC is the release worktree
`ORG_ROOT/.monomind/orgs/release/work/src`. GATE is this run's scratch directory
`$HOME/monomind-release/<VERSION>-<UTC timestamp>`; TMPDIR is `$HOME/mrg-tmp`.
Every task message gives you the run's VERSION, target SHA and GATE — use those,
never values remembered from an earlier run.

## Environment
- Prefix EVERY command that runs node, pnpm, npm, vitest or monomind with
  `env -u MONOMIND_SDK_AGENT -u MONOMIND_HOOK_QUIET -u MONOMIND_GRAPH_GATE -u MONOMIND_NO_LOCAL_EMBEDDINGS MONOMIND_CRASH_REPORTING=off MONOMIND_AUTO_UPDATE=false CI=true TMPDIR=$HOME/mrg-tmp npm_config_cache=$GATE/npm-cache`.
  Org sessions inject MONOMIND_SDK_AGENT/HOOK_QUIET/GRAPH_GATE/NO_LOCAL_EMBEDDINGS,
  which silently change monomind's own behavior (issue #249).
- Never write under /tmp: it is a RAM tmpfs with a per-user quota, and filling it
  breaks every shell on the machine. TMPDIR is short and has no dot-directories
  (monograph's watcher ignores dot-segment paths; Chrome's socket path must fit
  108 bytes).
- Never empty or recursively delete `$HOME/mrg-tmp` itself: it is shared by every
  role and by the agent harness's own per-session state, and blanket-deleting its
  contents bricked a role's shell for a whole run (issue #273). Delete only the
  specific subdirectories you created (`<check>-<short-sha>`, `home-<short-sha>`).

## Evidence
- Evidence comes ONLY from this run's `$GATE/logs`: check file mtimes against the
  run start and the SHA inside the log. Ignore anything older. `org logs` times
  are UTC with no zone marker (issue #253).
- Report every check as {name, command, exit_code, PASS|FAIL|SKIP|FLAKY, log path,
  one-line evidence}. SKIP needs the exact error proving the check is impossible
  on this machine. Never call a failure "environmental" without a reproduction
  that proves the cause.
- Finish every task with `org_task_done`, putting that table in the result.
  This org requires EVIDENCE, and a call without it wastes nothing but time —
  always pass `evidence` = { `headSha`, `worktree`, `checks` }:
  - `headSha`: the commit your checks ran on (`git -C <dir> rev-parse HEAD`);
    `worktree`: that git worktree (SRC for release work; omit only for ORG_ROOT).
  - Checks against an INSTALLED TARBALL or a scratch project still pin to the
    worktree the tarball was BUILT FROM (SRC and its HEAD) — a scratch dir is not
    a git worktree and is refused.
  - `checks`: one { command, exitCode, output } per acceptance criterion — the
    real command, its real exit code, the tail of its output. When the correct
    outcome is a non-zero exit (a 404 GET, an unset `git config --get`, a
    `--timeout 1s` run exiting 124), add `expectExit: <code>` AND a one-line
    `expectReason` saying why ("404 = branch not protected"); `expectExit`
    without a reason is refused. Never append `|| true` or otherwise rewrite a
    command to force exit 0: that destroys the evidence.
  - `expectExit` is for SINGLE-PURPOSE commands only. It is refused on a test
    suite or any aggregate runner (`vitest`, `jest`, a `pnpm`/`npm`/`yarn` test
    script, `node --test`, `pnpm -r`, `pnpm --filter … test`, `run verify`,
    `test:all`): a suite's exit code means "at least one of thousands of things
    failed", so declaring it expected accepts every OTHER failure too. When a
    suite has one known-failing test, run that test file on its own
    (`npx vitest run path/to/one.test.ts`) and put `expectExit` on THAT check,
    or exclude it from the suite command so the suite exits 0 and record the
    exclusion and why in the `result` table.
  - A REPORT task (QA, audit) is done when its checks RAN, not when they passed.
    Its acceptance checks prove the report exists and is complete (e.g.
    `test -s $GATE/logs/<round>/report.md`); every FAIL you found goes in the
    `result` table and to release-captain as a finding — never as a failing
    acceptance check.
  - A sha that is no longer that worktree's HEAD, or a failing check, is refused;
    after 3 such refusals the task is failed and escalated to release-captain.

## Destructive commands
- `cleanup` (any variant), `init --force`, recursive deletes, `git clean`,
  `git reset --hard`, `git checkout -- <path>` and anything else that deletes or
  overwrites files run ONLY inside a scratch project you created under
  `$HOME/mrg-tmp/`, with `cd` into it in the SAME command and a `pwd` check first:
  `cd $HOME/mrg-tmp/<check>-<short-sha> && case "$PWD" in $HOME/mrg-tmp/*) ;; *) exit 99;; esac && <command>`.
  A shell's cwd is ORG_ROOT by default: on 2026-09-22 `cleanup --force` run from
  there deleted 1003 tracked files and the project's memory store.
- If you damage anything outside your scratch, stop and report it to
  release-captain at once with exactly what ran and what changed.

## Git
- Never run `git config` in ANY checkout of this repo (worktrees share
  .git/config, so it rewrites the owner's identity repo-wide; issue #250). In
  scratch repos use `git -c user.name=qa -c user.email=qa@example.invalid ...`.
- Every commit on the release branch is made with
  `GIT_AUTHOR_NAME=nokhodian GIT_AUTHOR_EMAIL=nokhodian@gmail.com GIT_COMMITTER_NAME=nokhodian GIT_COMMITTER_EMAIL=nokhodian@gmail.com`
  and has NO Co-Authored-By, Claude-Session or "Generated with" lines. When it
  resolves an issue the body says `Fixes #N`; a bare `(#N)` leaves it open.
- Nobody edits, commits or checks out anything in ORG_ROOT (sole exception:
  publisher's LOCAL MAIN SYNC).
- Git policy is enforced by the runtime (issue #258): every role below
  policy.git "push" runs its shell in an OS sandbox with no git/GitHub
  credentials (`gh` is not logged in, ssh keys and GH_TOKEN are hidden, pushes
  fail) and, at "read", the repository's .git is read-only (no fetch, branch,
  worktree add/remove, commit). That is expected, not an environmental failure:
  anything needing GitHub auth or a ref change goes through publisher, and public
  GitHub state is read unauthenticated with
  `curl -s https://api.github.com/repos/monoes/monomind/...`.
- Never `git add -A` / `git commit -a`: the sandbox can leave zero-byte
  placeholder files in the working directory. Stage the exact paths you changed
  and check `git status --porcelain` before every commit.

## Processes
- A background process does not outlive the Bash call that started it: drive a
  browser in ONE command (`monomind browse open … && … && monomind browse close`)
  and never leave a server running for a later call.
- Never signal processes by name or pattern machine-wide (pkill, killall,
  `monomind cleanup --force`, reapers) except dummy processes you created; this
  org's own agents are claude-agent-sdk processes. Kill only PIDs you started.

## Unattended
- No web access. Never ask the human anything: org_gate is denied for every role,
  and ask_human for every role except release-captain, which may use it only
  during PREFLIGHT.
