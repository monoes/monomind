---
name: monomind-release-rules
description: "Operating rules every role of monomind's release org follows on every command: environment prefix, scratch and tmp hygiene, evidence format, git identity and sandbox limits, process safety, cross-run lessons."
tags: ["operations","devops"]
tools: []
license: Apache-2.0
source: https://github.com/monoes/monomind
---
# Release rules (every role, every command)

**Names used below.** ORG_ROOT is the main checkout — the directory your session
starts in (`pwd` before you `cd` anywhere). SRC is the release worktree
`ORG_ROOT/.monomind/orgs/release/work/src`. DOCS (`.../work/docs`, branch
`release/<VERSION>-docs`) and FIX2 (`.../work/fix-2`, branch
`release/<VERSION>-fix-2`) are extra worktrees publisher creates when docs or a
second fix run in parallel with work on SRC. GATE is this run's scratch directory
`$HOME/monomind-release/<VERSION>-<UTC timestamp>`; TMPDIR is `$HOME/mrg-tmp`.
Every task's brief, delivered with its dispatch message, gives you the run's
VERSION, target SHA, GATE and the ABSOLUTE path of the worktree to use — use
those, never values remembered from an earlier run.

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
- Never delete another run's GATE under `$HOME/monomind-release/`, whatever its
  age: issues filed by earlier runs cite logs in it. Cleanup prunes only THIS
  run's GATE (to `logs/`). In 2.16.14 the captain removed every earlier GATE,
  including the evidence 2.16.13's issues #351 and #352 pointed at.
- Before filing an issue, copy the evidence it cites into this run's report
  folder (`.monomind/orgs/release/reports/<VERSION>-<timestamp>/evidence/`) and
  cite that path in the issue.

## Claude runtime prerequisite
- PREFLIGHT (6) checks both `claude auth status` and, with the Environment
  prefix above, `MONOMIND_NO_AUTO_INSTALL=1 monomind agent models --runtime claude --json`.
  Require exit 0, `supported: true`, a nonempty `models` list and no `error`.
  This loads and verifies the pinned SDK and starts its Claude executable to
  list models; it sends no prompt and installs nothing. A directory or package
  manifest existing is not enough to prove the SDK is usable (issue #592).
- A missing or unusable SDK is a PREFLIGHT blocker. Include its exact error
  and the remedy `monomind deps install` in the captain's single `ask_human`
  request. The operator runs it in their own terminal, outside any org role,
  before the captain retries the whole PREFLIGHT. Org roles must not install
  into the read-only dependency cache, including by clearing role markers.
- Never continue to SETUP until this prerequisite passes. Never accept a SKIP for the mandatory live Claude trials
  because the SDK is missing: the `none`, `stdio` and timeout checks remain
  mandatory in RUNTIME QA. The preflight model list does not replace them.

## Evidence
- Evidence comes ONLY from this run's `$GATE/logs`: check file mtimes against the
  run start and the SHA inside the log. Ignore anything older. `org logs` times
  are UTC with no zone marker (issue #253).
- Before citing a drill or scratch run (its `bus.jsonl`, run dir, logs), copy
  what you cite into `$GATE/logs/<round>/` and cite THAT path; only then clean
  the scratch dir up. In 2.16.9 a PASS claim could not be checked because its
  drill's bus.jsonl was deleted with the scratch dir (issue #350).
- Report every check as {name, command, exit_code, PASS|FAIL|SKIP|FLAKY, log path,
  one-line evidence}. SKIP needs the exact error proving the check is impossible
  on this machine. Never call a failure "environmental" without a reproduction
  that proves the cause.
- Finish every task with `org_task_done`, putting that table in the result.
  Keep `result` to the table and summary: `evidence` is a separate argument of
  `org_task_done`, next to `taskId` and `result` — never text inside `result`,
  which the gate does not read (2.16.14: docs-writer put its evidence inside
  `result` three times and escalated).
  This org requires EVIDENCE, and a call without it wastes nothing but time —
  always pass `evidence` = { `headSha`, `worktree`, `checks` }:
  - `headSha`: the commit your checks ran on (`git -C <dir> rev-parse HEAD`);
    `worktree`: the ABSOLUTE path of that git worktree — SRC, DOCS or FIX2,
    wherever the checks ran, e.g. `ORG_ROOT/.monomind/orgs/release/work/src`
    as the brief gives it; omit only for ORG_ROOT. Never a label like `src`,
    `docs` or `fix-2`: the gate resolves it against ORG_ROOT and refuses it
    (11 of 11 first closes in 2.16.1).
  - With `worktree` set, `headSha` must be that worktree's CURRENT HEAD; without
    it, any worktree HEAD or local branch tip is accepted. So a commit in DOCS or
    FIX2 never stales evidence pinned to SRC, and SRC only moves once no open
    task is pinned to it. If SRC evidence is refused as stale, the tree really
    moved: re-run against the new HEAD instead of pinning to another worktree.
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
  - A task that correctly needs no change (e.g. DOCS: "no doc commit needed")
    still closes with evidence: `headSha` = the unchanged HEAD of the worktree
    you checked, `worktree` = its absolute path, `checks` = the verification
    commands you ran (e.g. `node scripts/check-doc-refs.mjs`).
  - A sha that is no longer that worktree's HEAD, or a failing check, is refused;
    after 3 such refusals the task is failed and escalated to release-captain.
    Only refusals that report "attempt n of 3" count. A refusal of a call with
    no evidence at all says it "did not count against your attempts" — fix the
    call and retry; do not escalate on those.

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

## Scratch installs
- Install this round's build, never the registry's. Before a release is
  published, the local packages carry the SAME version as npm, so installing
  one tarball silently resolves its monomind siblings from the registry — the
  previous release's code. In 2.16.9 a live drill ran the pre-fix CLI this way
  and reported the release's own fix as broken (issue #349).
- Install ALL of the round's tarballs in ONE `npm install` command, or the
  output of `node scripts/pack-workspace-closure.mjs . <outDir>` run in SRC (prints the tarball paths).
- Then prove it before running anything, and put this check in your evidence;
  it must print nothing:
  `jq -r '.packages | to_entries[] | select(.key | test("node_modules/(monomind|monofence-ai|@monoes/[^/]+)$")) | select((.value.resolved // "") | startswith("file:") | not) | .key' node_modules/.package-lock.json`
  Any line it prints is a package that came from the registry: reinstall.

## Git
- Never run `git config` in ANY checkout of this repo (worktrees share
  .git/config, so it rewrites the owner's identity repo-wide; issue #250). In
  scratch repos use `git -c user.name=qa -c user.email=qa@example.invalid ...`.
- Every commit on the release branch is made with
  `GIT_AUTHOR_NAME=nokhodian GIT_AUTHOR_EMAIL=nokhodian@gmail.com GIT_COMMITTER_NAME=nokhodian GIT_COMMITTER_EMAIL=nokhodian@gmail.com`
  and has NO Co-Authored-By, Claude-Session or "Generated with" lines. When it
  resolves an issue the body says `Fixes #N`; a bare `(#N)` leaves it open.
- To list the issues a range resolves, scan the commit bodies:
  `git -C SRC log --format=%B <prev>..<sha> | grep -oiE '\b(fixes|closes|resolves) #[0-9]+' | sort -u`.
  Never combine `\|` alternation with `-E` (`git log --grep="Fixes #\|Closes #" -E`):
  under -E, `\|` is a literal pipe, and that scan missed `Fixes #320` in 2.16.0.
- Nobody edits, commits or checks out anything in ORG_ROOT (sole exception:
  publisher's LOCAL MAIN SYNC).
- Nobody deletes, moves or overwrites a file in ORG_ROOT, tracked or untracked,
  even one that looks like QA litter: it is the owner's checkout. List stray
  files in the run report for the owner instead. In 2.16.11 release-captain
  ran `rm -f ORG_ROOT/sample.js` during PREFLIGHT.
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

## GitHub CI
- The release org's own checks run on this machine; GitHub's `Tests` workflow
  runs on a different filesystem and OS matrix and has caught what they missed:
  it was red on every push from 2.16.9 to 2.16.11 (a stub test that only fails
  where freed inodes are reused at once) while three releases went out GO.
- Read it for TARGET (the SHA this run started from; it is already on origin)
  with the public API — no credentials needed:
  `curl -s "https://api.github.com/repos/monoes/monomind/actions/runs?head_sha=<TARGET full sha>&per_page=20" | jq -r '.workflow_runs[] | "\(.name) \(.status) \(.conclusion) \(.id)"'`
  and for a failed run its failed jobs:
  `curl -s https://api.github.com/repos/monoes/monomind/actions/runs/<id>/jobs | jq -r '.jobs[] | select(.conclusion == "failure") | .name, (.steps[] | select(.conclusion == "failure") | "  " + .name)'`
  (the job log itself needs `gh run view <id> --log-failed`, which only
  publisher can run).
- `Tests` still queued or in progress: re-check in the foreground (Bash
  `timeout: 600000`, a `sleep 60` loop of at most 20 minutes); it is never a
  reason to skip the check.
- `Tests` failed: triage it like any FAIL — reproduce the failing test on SRC.
  It blocks GO unless it is proven a pre-existing flake: the same test passes
  3/3 run in isolation on SRC AND failed or flaked before this release's changes,
  with an issue filed for it. No `Tests` run for TARGET at all (never pushed):
  say so in REPORT.md; it does not block.

## Processes
- No process outlives the Bash call that started it — not one started with
  `&`, nohup or setsid, and not the Bash tool's own `run_in_background` (in a
  sandboxed role it dies with the call). Drive a browser in ONE command
  (`monomind browse open … && … && monomind browse close`), never leave a
  server running for a later call, and run long work in the foreground (see
  Long-running commands).
- Never signal processes by name or pattern machine-wide (pkill, killall,
  `monomind cleanup --force`, reapers) except dummy processes you created; this
  org's own agents are claude-agent-sdk processes. Kill only PIDs you started.

## Long-running commands
- The Bash tool times out after 2 minutes unless you pass its `timeout`
  parameter, and the most it accepts is `timeout: 600000` (10 minutes). Run
  anything that can take longer than a minute — an install,
  `pnpm -r run build`, a test suite, a live org drill, a publish — in the
  FOREGROUND with `timeout: 600000`, output redirected to a `$GATE/logs/…`
  file and the exit code appended to it
  (`… > <log> 2>&1; echo "exit=$?" >> <log>`), then read the log's tail.
  2.16.0's round-1 TESTS ran without `timeout` and hit the 2-minute limit 5
  times.
- Split anything that can take longer than 10 minutes into steps that each
  finish well inside that limit — one suite or package per call
  (`pnpm --filter <pkg> test`), one drill per call — each logging to its own
  `$GATE/logs/…` file.
- A live org drill (`monomind org run` of a throwaway org) is bounded by
  `timeout`, because `org run` has no run-time limit of its own:
  `timeout -k 30 480 monomind org run <org> --task '…' -y > <log> 2>&1; echo "exit=$?" >> <log>`.
  Exit 124 means the drill did not finish in 8 minutes: report it as a
  finding with the bus log, never re-run it in a loop. In 2.16.2 an unbounded
  drill ran into the 10-minute Bash limit.
- Write a drill's task so the run can finish: only the org's boss role
  (the template's top role, e.g. dev-team's `tech-lead`) has `org_complete`,
  and its outcome is `achieved` or `blocked`. A drill that tells another role
  to finish sits idle until the 10-minute idle nudge (`run_config.idle_minutes`)
  and then hits the 8-minute timeout — issue #352 was exactly that, not a
  missed wake. In the drill's bus, a tool event's name is `.tool`, not
  `.data.name`; `org-stopped` carries `data.idleWatchdog.next_nudge_at`.
- Never run `scripts/check-published-pins.mjs` or a package's `prepublishOnly`
  outside PUBLISH: it asks npm whether each pinned version exists and waits
  ~8.5 minutes when one does not, and before PUBLISH this release's own
  versions never do. `pnpm publish` runs it by itself. In 2.16.2 it cost PREP
  and the final gate 8.6 and 5 minutes of pure waiting.
- Never use `run_in_background`, and never end your turn to "wait" for a
  command, a Monitor event or anything external (npm propagation, a Pages
  run): nothing wakes a task whose turn ended to wait except its blocked-task
  re-check. In 2.16.1 builder and publisher sat idle ~42 minutes that way, and
  a background build never ran at all. Wait inside a foreground call instead,
  e.g. for npm propagation, with `timeout: 600000`:
  `until curl -s https://registry.npmjs.org/<url-encoded name> | grep -qF '"<ver>":{'; do sleep 10; done`.
  If it times out, run the same loop once more before reporting.
- Messages (org_send from release-captain, operator notes) reach you only when
  your current turn ends. Keep turns short enough to see them: when the work
  is done, or you cannot go on, close the task with `org_task_done` (or report
  what blocks you) and end the turn — never loop inside one turn retrying or
  waiting.

## Reading source
- Gather what you need in as few calls as possible: one Bash command that prints
  every range (`sed -n '10,40p;120,160p' a.ts; sed -n '5,30p' b.ts`), or Read
  with offset/limit. Never a string of one-range `awk 'NR>=a && NR<=b'` or
  `sed -n` peeks: every call re-sends your whole context (the 2.16.0 DOCS task
  made 240 calls and cost 18% of the run).
- Never write a diff or log to a file just to Read it end to end, and never Read
  a whole source file or log: take the file list from `git diff --stat`, the
  hunks you need from `git show <sha> -- <path>`, and context with `grep -n` or
  Read offset/limit (the 2.16.7 pre-audit read 20 dumped diffs and 20 logs
  whole and cost $12.83).

## Parallel sessions (release lock, VERSION, local main sync)
Several sessions work in and release from this clone (ORG_ROOT and its
worktrees), and each may start this org. Commands below run from ORG_ROOT
with the Environment prefix.
- RELEASE LOCK (release-captain; your FIRST command, before PREFLIGHT):
  `node scripts/release-lock.mjs acquire --runtime .monomind/orgs/release/runtime.json`.
  It is one lock per clone, shared by every worktree (`~/.monomind/release-locks/`).
  - exit 0: this run holds it (also after a restart). Put its output line in
    PREFLIGHT.md and go on.
  - exit 3: another run is releasing ("release already in progress by run X
    (pid P on H, since T)"). Do NOTHING else: no PREFLIGHT, no report, no
    hygiene, no CLEAN UP, no task or message to any role (the other run owns
    the shared scratch). Call `org_complete` with outcome `partial`, blocker
    `external` and that line as the summary, and end.
  - any other exit, or no such script (an older checkout): record a WARNING
    with the error and rely on PREFLIGHT (5)'s process check.
  - Release it as the LAST step of CLEAN UP on EVERY outcome that got past
    the acquire (GO, NO-GO, failed PREFLIGHT), right before `org_complete`:
    `node scripts/release-lock.mjs release --runtime .monomind/orgs/release/runtime.json`.
    If the run dies first, the next acquire takes the lock over once the run
    shows as ended. Never `release --force` a lock you do not hold.
- VERSION (release-captain, at PREFLIGHT): resolve VERSION with SETUP's rule
  and write it in PREFLIGHT.md. A version named in the task is the operator's
  expectation, not an order: other sessions may have released since it was
  written. Use it only when it is above both `npm view @monoes/monomindcli
  version` and ORG_ROOT's package.json version (a deliberate minor or major);
  otherwise release the next free version. When the two differ, say so on the
  FIRST line of PREFLIGHT.md, in REPORT.md's warnings and in the
  `org_complete` summary: `VERSION: task named X, npm already has Y, releasing
  Z`. It is not an error and not a question for the human.
- TAG CHAIN (release-captain, at SETUP, after publisher's `fetch origin --tags`):
  `<previous>` is the version X of the last `chore(release): publish X` commit
  C reachable from the target (`git -C ORG_ROOT log -1 --format='%H %s'
  --grep='^chore(release): publish ' <target>`), and every `v<previous>` range
  in this run means C. Check that `vX` exists and points at C
  (`git -C ORG_ROOT rev-parse -q --verify 'refs/tags/vX^{commit}'`) and that
  `curl -s https://api.github.com/repos/monoes/monomind/releases/tags/vX` has
  tag_name vX. 2.18.3 shipped to npm and main with neither (issue #386).
  - Both present: nothing to do.
  - One missing and `npm view monomind@X version` prints X (X did ship): record
    a WARNING and send publisher a TAG HEAL task naming X and C, then go on
    without waiting — nothing in this run reads the tag, only C. Publisher runs
    only the missing steps: `GIT_AUTHOR_NAME=nokhodian GIT_AUTHOR_EMAIL=nokhodian@gmail.com
    GIT_COMMITTER_NAME=nokhodian GIT_COMMITTER_EMAIL=nokhodian@gmail.com
    git -C ORG_ROOT tag -a vX -m 'monomind X' C` and `git -C ORG_ROOT
    push origin vX`; then writes C's `## [X]` CHANGELOG.md section plus an
    `**npm**:` line to $GATE/release-notes-X.md and runs `gh release create vX
    --verify-tag --latest=false --title vX --notes-file $GATE/release-notes-X.md`
    (never `--latest`: that belongs to the newest release).
  - `vX` exists but points elsewhere, or X is not on npm: WARNING only; change
    no tag or release, and use C for the ranges.
- LOCAL MAIN SYNC (publisher, after the push to origin; `<sha>` = the release
  SHA, S = `ORG_ROOT-sync-VERSION`). Only when ORG_ROOT is on `main` with no
  tracked changes (`git -C ORG_ROOT symbolic-ref --short HEAD` prints main,
  `git -C ORG_ROOT status --porcelain --untracked-files=no` prints nothing);
  otherwise change nothing and report why.
  - `<sha>` already in main (`git -C ORG_ROOT merge-base --is-ancestor <sha> main`): nothing to do.
  - main is an ancestor of `<sha>`: `git -C ORG_ROOT merge --ff-only <sha>`.
  - Otherwise local main has commits the release lacks: merge the release
    into it in a temporary worktree, with the CHANGELOG.md merge driver
    registered for that one command (it resolves "the release renamed
    [Unreleased] while local main added entries under it"):
    `printf 'CHANGELOG.md merge=monomind-changelog\n' > $GATE/sync.gitattributes`;
    `git -C ORG_ROOT worktree add -b sync/main-VERSION S main`;
    `GIT_AUTHOR_NAME=nokhodian GIT_AUTHOR_EMAIL=nokhodian@gmail.com GIT_COMMITTER_NAME=nokhodian GIT_COMMITTER_EMAIL=nokhodian@gmail.com git -C S -c core.attributesFile=$GATE/sync.gitattributes -c merge.monomind-changelog.driver="node SRC/scripts/merge-changelog.mjs %O %A %B" merge --no-ff --no-edit <sha>`.
    Clean (exit 0, `git -C S diff --name-only --diff-filter=U` empty): re-check
    ORG_ROOT is still on main with no tracked changes (other sessions switch
    it), then `git -C ORG_ROOT merge --ff-only sync/main-VERSION`. Conflict:
    record the files `git -C S diff --name-only --diff-filter=U` lists, then
    `git -C S merge --abort`; ORG_ROOT stays untouched. Either way finish with
    `git -C ORG_ROOT worktree remove --force S` and
    `git -C ORG_ROOT branch -D sync/main-VERSION`.
  - Never rebase, reset, amend or cherry-pick local main's commits, and never
    push local main. Report the outcome (fast-forwarded, merged as <new sha>,
    or the conflicting files) to release-captain.

## Lessons across runs
Org memory persists across runs of this org (`org_remember` writes it,
`org_recall` searches it). Lessons are how a finding in one release stops the
same mistake in the next.
- RECORD (release-captain): for every FAIL from builder or a QA role, every
  release-auditor REJECT and every operator intervention (an operator message
  that corrects, redirects or unblocks the run), distill ONE short reusable
  rule — what to do next time, not what went wrong this run; at most two
  sentences; name the AREA (a QA SCOPE area: init/cleanup/hooks, monograph,
  memory/knowledge, MCP, agents/agent-exec, orgs, browse/design, packaging,
  docs-only — or `release-process` for how the org itself works). First
  `org_recall` with `lesson <area> <key words>`; if a lesson already says it,
  do not store a reworded copy. Otherwise `org_remember` with scope `org` and
  content `lesson: [<area>] <rule> (<VERSION>, <role> <finding>)`. Also append
  that line to `lessons.md` in this run's report folder
  (`.monomind/orgs/release/reports/<VERSION>-<timestamp>/`).
- APPLY (maintainer, fixer, docs-writer, cli-qa, integration-qa, runtime-qa):
  at the start of every task, `org_recall` with `lesson <area>` for each area
  the brief names and apply the lessons that fit. Name the ones you applied in
  your `org_task_done` result, one line each. A lesson never overrides the
  brief or these rules; when one conflicts, follow those and say so.
- PROPOSE (release-captain, in REPORT.md): a `## Lessons` section listing every
  line of `lessons.md`, then the lessons you PROPOSE as permanent rules for this
  skill, each with the exact sentence and the section it belongs in; add any
  recorded after VERDICT at DONE CHECK. Never edit this skill or an org config
  yourself: the owner decides.

## Unattended
- No web access. Never ask the human anything: org_gate is denied for every role,
  and ask_human for every role except release-captain, which may use it only
  during PREFLIGHT.
- Claude Code's own harness tools — AskUserQuestion, ScheduleWakeup, TaskCreate /
  TaskUpdate, CronCreate / CronDelete / CronList, EnterPlanMode — are not
  available to org roles. Use the org equivalents: ask_human (release-captain,
  PREFLIGHT only) to ask, org_task to create work, and a foreground command
  to wait (see Long-running commands).
