---
name: release-commit
description: "Commit identity, trailer and staging rules for release roles that commit (maintainer, fixer, docs-writer, publisher)."
tags: ["operations","git"]
tools: []
license: Apache-2.0
source: https://github.com/monoes/monomind
---
# Committing on release branches

- Every commit: `GIT_AUTHOR_NAME=nokhodian GIT_AUTHOR_EMAIL=nokhodian@gmail.com GIT_COMMITTER_NAME=nokhodian GIT_COMMITTER_EMAIL=nokhodian@gmail.com git -C <worktree> commit ...` with NO Co-Authored-By, Claude-Session or "Generated with" lines. When it resolves an issue the body says `Fixes #N`; a bare `(#N)` leaves it open.
- Never `git add -A` / `git commit -a` (the sandbox can leave zero-byte placeholder files): stage the exact paths you changed and check `git status --porcelain` before every commit.
- Issues a range resolves: `git -C SRC log --format=%B <prev>..<sha> | grep -oiE '\b(fixes|closes|resolves) #[0-9]+' | sort -u`. Never `git log --grep="Fixes #\|Closes #" -E`: under -E `\|` is a literal pipe, and that scan missed `Fixes #320` in 2.16.0.
- Never `git config` anywhere in this repo. Never amend or rebase commits another role made; follow-ups are new commits.
