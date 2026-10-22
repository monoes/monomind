---
name: release-closeout
description: "Release captain's VERDICT, REPORT, PUBLISH dispatch, DONE CHECK, issue drafting and CLEAN UP checklist. Load it when the final audit is in."
tags: ["operations","devops"]
tools: []
license: Apache-2.0
source: https://github.com/monoes/monomind
---
# VERDICT to CLEAN UP

**VERDICT (no human gate).** GO only if every mandatory check on the final release SHA is PASS (FLAKY only with 3/3 isolated-pass evidence), release-auditor APPROVES (`audit-verdict`, kind final, for that SHA), your own SUPERVISION re-check agrees, and the GitHub `Tests` gate passed (captain mechanics). Write `.monomind/orgs/release/reports/<VERSION>-<timestamp>/REPORT.md` (verdict first; release SHA and VERSION; issues found with fix commits; docs changes; table of every check; QA scope mapping; regression-triage results (repro, previous version, outcome); warnings; the `## Lessons` section) and `verdict.json` `{version, sha, verdict, auditor, checks, warnings, packages_to_publish}`. `packages_to_publish` = exactly the packages whose version in SRC is not on npm (`npm view <name>@<ver> version` each). verdict.json lives in that report directory and nowhere else, never in $GATE (publisher looked there in 2.15.6 and blocked). GO: send publisher a PUBLISH task carrying VERSION, release SHA, the ABSOLUTE verdict.json path and packages_to_publish (brief: `load skill release-publish`). NO-GO: do not publish; go to CLEAN UP.

**DONE CHECK (re-verify yourself, never trust the report).**
- every published package: `curl -s https://registry.npmjs.org/<url-encoded name>` lists the version and `dist-tags.latest` is it; a registry install smoke passed;
- `curl -s https://api.github.com/repos/monoes/monomind/commits/main` sha == release SHA; `.../commits/vVERSION` dereferences to it; `.../releases/latest` tag_name is vVERSION; `curl -s 'https://api.github.com/repos/monoes/monomind/actions/workflows/pages.yml/runs?head_sha=<sha>'` shows conclusion success;
- every issue the range references is closed: `git -C SRC log --format=%B v<previous>..<release sha> | grep -oiE '\b(fixes|closes|resolves) #[0-9]+' | sort -u` (never `git log --grep` with `\|` plus -E, #320), then `curl -s https://api.github.com/repos/monoes/monomind/issues/N` state closed;
- local main synced, or LOCAL MAIN SYNC PENDING with the operator command `git -C ORG_ROOT merge --ff-only <sha>` in REPORT.md and your org_complete message (not a failure, no issue).
Append `## Published` to REPORT.md (any incident included) and update verdict.json with `published: true` and those facts.

**GitHub issues: you draft, publisher files** (it has the credentials). Needed for (a) every pre-existing product defect found but not fixed (each REGRESSION TRIAGE result PRE-EXISTING, each defect that hit the FIX CAP) and (b) every monomind org-runtime problem the run hit (crash, lost context, DAG or policy misbehaviour, misleading log). Never for something fixed in this release. Check duplicates: `curl -s 'https://api.github.com/search/issues?q=repo:monoes/monomind+<keywords>'`. Copy the cited evidence into `<report dir>/evidence/` first and cite that path. Write each to `<report dir>/issues/<n>.md` (line 1 title, rest body, evidence plus a code reference checked against SRC), send publisher the list (ISSUE FILING) and put the returned URLs in REPORT.md.

**CLEAN UP (every outcome).** Kill processes roles started (recorded PIDs). Publisher task CLEAN UP: `git -C ORG_ROOT worktree remove --force` of SRC, DOCS and FIX2 when they exist; if published delete `release/<VERSION>` once in origin/main; delete `release/<VERSION>-docs` and `-fix-2` only when `git -C SRC cherry HEAD <branch>` prints no `+` (a branch holding a cancelled FIX task's commits is kept and named in REPORT.md); delete everything in $GATE except `logs/`; prune `$HOME/mrg-tmp` only by the narrow run-scoped rule (`<check>-<short-sha>` / `home-<short-sha>` subdirectories of this and earlier runs, never the root, never an entry you did not create, #273); `df -h /tmp` healthy. Then release the release lock (captain mechanics) and `org_complete` with: outcome, VERSION (and the task's when it differed), npm versions, release URL, local main state, filed issue URLs, REPORT.md path.
