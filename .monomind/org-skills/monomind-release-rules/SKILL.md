---
name: monomind-release-rules
description: "Standing rules of monomind's release org, pinned to every role: names, command prefix, scratch and git limits, evidence close, hand-off documents."
tags: ["operations","devops"]
tools: []
license: Apache-2.0
source: https://github.com/monoes/monomind
---
# Release rules (every role, every command)

**Names.** ORG_ROOT = your starting cwd (the owner's checkout; never change it). SRC, DOCS, FIX2 = `ORG_ROOT/.monomind/orgs/release/work/{src,docs,fix-2}`. GATE = `$HOME/monomind-release/<VERSION>-<UTC ts>`; TMPDIR = `$HOME/mrg-tmp`. VERSION, SHA, GATE and the ABSOLUTE worktree path come only from the task brief, never from an earlier run. Start a task with `org_recall` `lesson <area>` for each area the brief names; apply what fits, name it in your result.

**Commands**
- Prefix every node/pnpm/npm/vitest/monomind command: `env -u MONOMIND_SDK_AGENT -u MONOMIND_HOOK_QUIET -u MONOMIND_GRAPH_GATE -u MONOMIND_NO_LOCAL_EMBEDDINGS MONOMIND_CRASH_REPORTING=off MONOMIND_AUTO_UPDATE=false CI=true TMPDIR=$HOME/mrg-tmp npm_config_cache=$GATE/npm-cache` (org sessions inject those four variables and change monomind's behaviour, #249).
- Long work runs in the FOREGROUND, Bash `timeout: 600000`, output to `$GATE/logs/<area>/<step>.log` then `echo "exit=$?" >> <log>`; split anything over 10 min. Never `run_in_background`, never end a turn to wait (nothing wakes you; wait in an `until` loop). Keep turns short: org mail arrives only when a turn ends. Nothing outlives its Bash call; kill only PIDs you started, never pkill/killall/`cleanup --force`.
- Read in bulk (one Bash call printing every range, `git show <sha> -- <path>`, `grep -n`, Read offset/limit); never one-range peeks, whole logs or whole diffs.
- Never write under /tmp. Never empty or recursively delete `$HOME/mrg-tmp` (#273: it bricked a role's shell): delete only subdirectories you created. Never delete another run's GATE (earlier issues cite its logs).
- Destructive commands (`cleanup`, `init --force`, recursive deletes, `git clean`, `git reset --hard`, `git checkout -- <path>`) only in a scratch project under `$HOME/mrg-tmp`: `cd $HOME/mrg-tmp/<check>-<short-sha> && case "$PWD" in $HOME/mrg-tmp/*) ;; *) exit 99;; esac && <cmd>`. From ORG_ROOT, `cleanup --force` once deleted 1003 tracked files and the memory store. Damage outside scratch: stop, tell release-captain what ran and changed.
- Never run `scripts/check-published-pins.mjs` or `prepublishOnly` outside PUBLISH (waits ~8.5 min for versions that cannot exist yet).

**Git.** Never `git config` in any checkout of this repo (worktrees share it, #250); scratch repos: `git -c user.name=qa -c user.email=qa@example.invalid`. Nobody edits, commits in, checks out, deletes or moves anything in ORG_ROOT (sole exception: publisher's LOCAL MAIN SYNC); list strays in the report. Below policy.git `push` you have no GitHub credentials and at `read` `.git` is read-only: expected, not environmental (#258). Ask publisher for anything needing GitHub auth or a ref change; read public GitHub with unauthenticated `curl https://api.github.com/repos/monoes/monomind/...`.

**Evidence.** Only this run's `$GATE/logs` count (mtime after run start, SHA inside the log; `org logs` times are UTC, #253). Copy any drill or scratch artifact you cite into `$GATE/logs/<round>/` before cleaning up (#350). Per check: {name, command, exit, PASS|FAIL|SKIP|FLAKY, log, one line}; SKIP needs the exact error; never call a failure "environmental" without a reproduction.

**Closing a task.** `org_task_done`: `result` = check table + summary; `evidence` is its own argument `{headSha, worktree, checks}`, never text in `result`. `worktree` = the ABSOLUTE path of the worktree the checks ran in (SRC, DOCS or FIX2; omit only for ORG_ROOT), never a label like `src`; `headSha` = its CURRENT HEAD (tarball and scratch-project checks pin to the worktree the tarball was built from). `checks` = one `{command, exitCode, output}` per acceptance criterion: real command, real exit code, output tail. A criterion met by a non-zero exit needs `expectExit` and a one-line `expectReason`, only on a single-purpose command, never on a test suite or aggregate runner (run the one failing file alone), never `|| true`. A report task (QA, audit) is done when its checks RAN: FAILs go in `result` and to release-captain, `test -s <report>` proves the report exists. A task needing no change still closes with `headSha`, `worktree` and its verifying commands. Three refusals ("attempt n of 3") fail the task; a refusal with no evidence object does not count.

**Hand-offs.** Sections exchange work only as documents: publish yours with `org_doc_publish` (compact body: counts, SHAs, log paths, one line each; never log bodies), read others with `org_doc_read`. A document is readable by you only once accepted: otherwise use git and the logs, never wait. No web; only release-captain may ask a human, only in PREFLIGHT.
