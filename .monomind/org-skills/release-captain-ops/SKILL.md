---
name: release-captain-ops
description: "Release captain's standing mechanics: release lock, VERSION mismatch reporting, the GitHub Tests gate, cross-run lessons."
tags: ["operations","devops"]
tools: []
license: Apache-2.0
source: https://github.com/monoes/monomind
---
# Captain mechanics

**Release lock** (your FIRST command, before PREFLIGHT; from ORG_ROOT with the core env prefix): `node scripts/release-lock.mjs acquire --runtime .monomind/orgs/release/runtime.json`. One lock per clone, shared by every worktree.
- exit 0: you hold it (also after a restart); put its output line in PREFLIGHT.md's folder notes and go on.
- exit 3 ("release already in progress by run X ..."): do NOTHING else (no PREFLIGHT, report, hygiene, CLEAN UP, task or message: the other run owns the shared scratch). `org_complete` outcome `partial`, blocker `external`, that line as summary.
- any other exit, or no script: record a WARNING and rely on the preflight's process check.
- Release it as the LAST step of CLEAN UP on EVERY outcome that got past the acquire (GO, NO-GO, failed PREFLIGHT), right before `org_complete`: `node scripts/release-lock.mjs release --runtime .monomind/orgs/release/runtime.json`. Never `release --force` a lock you do not hold; if the run dies first the next acquire takes it over.

**VERSION.** Publisher resolves it in SETUP. A version named in the task is the operator's expectation, not an order: use it only when it is above both `npm view @monoes/monomindcli version` and ORG_ROOT's package.json version. When it differs say so on the first line of PREFLIGHT.md, in REPORT.md's warnings and in the `org_complete` summary: `VERSION: task named X, npm already has Y, releasing Z`. Not an error, not a question for the human.

**Who takes the release number (#636), in every PREP brief.** VERSION goes into exactly two packages: root `monomind` and `@monoes/monomindcli`. Every other publishable package (`@monoes/*`, `monofence-ai`) keeps its own semver line and gets a patch (or minor) step only when its non-test source changed since the last release. Never brief "bump every package to VERSION" (2.24.0 jumped eight packages by a major; it cannot be unpublished). `check-package-bumps.mjs` blocks a sub-package whose MAJOR rose unless a commit touching it is breaking; treat that as a mis-briefed PREP, fix the versions, never set MONOMIND_ALLOW_MAJOR_BUMP. A bumped package with a first-use pin in `packages/@monomind/cli/src/utils/optional-deps*.ts` moves its pin, lock entry and code hashes in the same commit.

**GitHub CI gate.** The org's checks run on this machine; GitHub's `Tests` workflow (other filesystem and OS matrix) was red on every push 2.16.9 to 2.16.11 while three releases went out GO. Read it for TARGET (full SHA, already on origin) unauthenticated: `curl -s "https://api.github.com/repos/monoes/monomind/actions/runs?head_sha=<TARGET>&per_page=20" | jq -r '.workflow_runs[] | "\(.name) \(.status) \(.conclusion) \(.id)"'`; failed jobs: `curl -s https://api.github.com/repos/monoes/monomind/actions/runs/<id>/jobs | jq -r '.jobs[] | select(.conclusion == "failure") | .name, (.steps[] | select(.conclusion == "failure") | "  " + .name)'` (the job log needs `gh run view <id> --log-failed`: ask publisher). Queued or running: re-check in a foreground `sleep 60` loop of at most 20 minutes (Bash `timeout: 600000`); never a reason to skip. Failed: triage like any FAIL (reproduce on SRC); it blocks GO unless proven a pre-existing flake: the test passes 3/3 in isolation on SRC AND failed or flaked before this release's changes, with an issue filed. No `Tests` run for TARGET at all (never pushed): say so in REPORT.md; it does not block. Put the run id and conclusion in REPORT.md.

**Lessons across runs.** Org memory persists (`org_remember` writes, `org_recall` searches).
- RECORD: for every FAIL from builder or a QA role, every release-auditor REJECT and every operator intervention (a message that corrects, redirects or unblocks the run) distill ONE reusable rule, at most two sentences, what to do next time, naming the AREA (a QA SCOPE area, or `release-process`). First `org_recall` `lesson <area> <key words>`; if one already says it, store nothing. Else `org_remember` scope `org`, content `lesson: [<area>] <rule> (<VERSION>, <role> <finding>)`, and append that line to `lessons.md` in the run's report folder.
- PROPOSE in REPORT.md: a `## Lessons` section listing every line of `lessons.md`, then lessons you propose as permanent rules, each with the exact sentence and the section it belongs in (add any recorded after VERDICT). Propose, never apply: never edit a skill or an org config yourself, the owner decides.
