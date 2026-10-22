---
name: release-publish
description: "Publisher's PUBLISH, post-npm git/GitHub steps, LOCAL MAIN SYNC, ISSUE FILING and CLEAN UP tasks. Load first for those tasks."
tags: ["operations","devops"]
tools: []
license: Apache-2.0
source: https://github.com/monoes/monomind
---
# PUBLISH to CLEAN UP (publisher)

SRC/doc/publishing.md is the source of truth. Commits and tags use the `release-commit` identity rules.

## PUBLISH (only in a PUBLISH task from release-captain)
- First confirm yourself: verdict.json (ABSOLUTE path in the task, under `.monomind/orgs/release/reports/<VERSION>-<timestamp>/`, never $GATE; if omitted ask release-captain, do not search) says GO for the same SHA as SRC HEAD, AND the newest accepted `audit-verdict` (kind final) says APPROVE for that SHA. `npm whoami`; `git -C SRC fetch origin`; origin/main is an ancestor of HEAD (else STOP, NO-GO); none of packages_to_publish exists on npm.
- From SRC: `pnpm publish --tag latest --no-git-checks --access public`, ONE package at a time in the FOREGROUND, full output to `$GATE/logs/publisher/<pkg>-publish.log`, exit code checked (the CLI's prepublishOnly is a multi-minute build: "success" after seconds means it did not run). Order: changed sub-packages, then `@monoes/monomindcli`, then `monomind`. Sub-packages that do not depend on each other (e.g. monobrowse and monodesign) are published back to back before waiting on any, then confirmed together (2.15.6 paid the registry lag twice).
- Before each dependent, confirm its dependency is live on the registry, in ONE foreground call with `timeout: 600000`: `until curl -s https://registry.npmjs.org/<url-encoded name> | grep -qF '"<ver>":{'; do sleep 10; done`; if it times out run it once more, then report. Never end the turn or `org_task_block` to wait (2.16.1: idle 42 min). E409 "previously staged version" means STILL PROCESSING: wait, never re-publish. NEVER publish `monomind` before its exactly-pinned CLI version is confirmed. If an umbrella becomes latest while its CLI is missing: at once `npm dist-tag add monomind@<previous> latest`, wait for the CLI, `npm dist-tag add monomind@<VERSION> latest`, report the incident. npm demands an OTP/2FA: STOP, publish nothing further, never unpublish, report.
- If any org tool call (org_task_done, org_send, org_task_block) fails ("Tool permission request failed", "Stream closed"): say in plain text what finished, what is left, the log paths, and END THE TURN so the runtime restarts you (2.16.1 lost its tool channel mid-PUBLISH).

## After npm (the git side does not wait on registry propagation)
As soon as every publish exited 0 and each dependency is confirmed live for its dependent: push, tag, release; then the smoke test and Pages check (2.15.7's git side sat idle behind the umbrella's propagation).
1. `git -C SRC push origin <sha>:refs/heads/main` (fast-forward only, never force).
2. `git -C SRC tag -a vVERSION -m 'monomind VERSION' <sha>` (identity env) and push the tag.
3. CHANGELOG entry plus an `**npm**:` line to `$GATE/release-notes.md` (never inside the repo); `gh release create vVERSION --latest --title vVERSION --notes-file $GATE/release-notes.md`.
4. Registry install smoke in `$GATE/smoke`: `npm install monomind@VERSION --prefer-online`, `--version` reports VERSION, `init --help` works.
5. Pages: `until gh run list --workflow pages.yml --commit <sha> --json conclusion --jq '.[0].conclusion' | grep -qx success; do sleep 10; done` in a foreground call with `timeout: 600000`.
6. Close every still-open issue the range references (commit-body scan from `release-commit`) with a comment linking the release.
7. LOCAL MAIN SYNC, then report every step to release-captain.

## LOCAL MAIN SYNC (`<sha>` = release SHA, S = `ORG_ROOT-sync-VERSION`)
Only when ORG_ROOT is on `main` with no tracked changes (`git -C ORG_ROOT symbolic-ref --short HEAD` prints main, `git -C ORG_ROOT status --porcelain --untracked-files=no` prints nothing); otherwise change nothing and report why.
- WRITE PROBE FIRST (#667). The runtime binds the running CLI's package root read-only for every role (the operator's daemon runs that code), so a fast-forward that rewrites a file there dies with `unable to unlink ... Read-only file system` after half-applying (2.24.2 to 2.24.6). Sandbox working as designed: never weaken it, never retry the merge. Run `test -w ORG_ROOT/packages/@monomind/cli/package.json && test -w ORG_ROOT/.claude && test -w ORG_ROOT/.monomind/org-skills` (a release rewrites `.claude/` and `.monomind/org-skills/`, both protected). Any not writable: run NO merge that writes ORG_ROOT's working tree; report "LOCAL MAIN SYNC PENDING (operator)" with the one-line operator command `git -C ORG_ROOT merge --ff-only <sha>` (main an ancestor of `<sha>`), or, when local main had commits the release lacks, do the merge below in S, remove only worktree S, keep the branch, and give `git -C ORG_ROOT merge --ff-only sync/main-VERSION` then `git -C ORG_ROOT branch -d sync/main-VERSION`. Writable: continue.
- `<sha>` already in main (`merge-base --is-ancestor <sha> main`): nothing. main an ancestor of `<sha>`: `git -C ORG_ROOT merge --ff-only <sha>`.
- Otherwise merge the release into local main in a temporary worktree with the CHANGELOG.md merge driver registered for that one command: `printf 'CHANGELOG.md merge=monomind-changelog\n' > $GATE/sync.gitattributes`; `git -C ORG_ROOT worktree add -b sync/main-VERSION S main`; `<identity env> git -C S -c core.attributesFile=$GATE/sync.gitattributes -c merge.monomind-changelog.driver="node SRC/scripts/merge-changelog.mjs %O %A %B" merge --no-ff --no-edit <sha>`. Clean (exit 0, `git -C S diff --name-only --diff-filter=U` empty): re-check ORG_ROOT is still on main with no tracked changes (other sessions switch it), then `git -C ORG_ROOT merge --ff-only sync/main-VERSION` (probe failed: report the command instead). Conflict: record the files, `git -C S merge --abort`, ORG_ROOT untouched. Either way `git -C ORG_ROOT worktree remove --force S` and, unless the ff is left pending, `git -C ORG_ROOT branch -D sync/main-VERSION`.
- Never rebase, reset, amend or cherry-pick local main's commits, never push local main. Report: fast-forwarded, merged as <new sha>, the conflicting files, or PENDING with the command. PENDING is not a blocker and needs no issue.

## ISSUE FILING and CLEAN UP help
- For each draft the task names: `gh issue create --repo monoes/monomind --label bug --title "$(head -n 1 <file>)" --body "$(tail -n +2 <file>)"`; reply with the URLs.
- CLEAN UP: `git -C ORG_ROOT worktree remove --force` of SRC, DOCS, FIX2 (when present); `git -C ORG_ROOT branch -d <release/* branch>` only for branches `git branch --merged origin/main` lists; `git -C ORG_ROOT branch -D release/<VERSION>-docs` or `-fix-2` only when `git -C SRC cherry HEAD <branch>` prints no `+` (run it before removing SRC); delete everything in $GATE except `logs/` and prune `$HOME/mrg-tmp` only by the core narrow rule.
