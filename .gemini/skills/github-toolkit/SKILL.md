---
name: github-toolkit
description: >
  GitHub workflow guidance for monomind projects — issues, PRs, releases,
  repo structure, and multi-package sync. Trigger on "open a PR", "manage
  issues", "cut a release", "sync packages", or any GitHub Actions/repo
  automation request. All GitHub operations use the `gh` CLI plus monomind's
  MCP GitHub tools — there is no `monomind github` CLI command group.
---

# GitHub Toolkit

Guidance for GitHub-integrated workflows in monomind projects. All GitHub
operations go through the `gh` CLI directly (for PRs, issues, releases) or
through monomind's MCP GitHub tools when running inside a swarm.

## Core operations

- **Issues** — triage, label, and track via `gh issue` or `mcp__monomind__github_issue_track`.
  See `.claude/commands/github/issue-tracker.md`.
- **Pull requests** — create, review, and merge via `gh pr` or `mcp__monomind__github_pr_manage`.
  See `.claude/commands/github/pr-manager.md`.
- **Releases** — version bump, changelog, tag, and publish coordination.
  See `.claude/commands/github/release-manager.md`.
- **Repo structure** — multi-repo layout and package boundary decisions.
  See `.claude/commands/github/repo-architect.md`.
- **Multi-package sync** — version alignment and dependency sync across a monorepo.
  See `.claude/commands/github/sync-coordinator.md`.
- **Integration modes overview** — which mode to use for which workflow.
  See `.claude/commands/github/github-modes.md`.

## Quick reference

```bash
# Issues
gh issue list --state open
gh issue create --title "..." --body "..."

# Pull requests
gh pr create --title "..." --body "..."
gh pr view <number> --json reviews,statusCheckRollup

# Releases
gh release create v1.2.3 --generate-notes
```

## MCP tools (when running inside a swarm)

```javascript
mcp__monomind__github_pr_manage({ action: "review", pr: 123 })
mcp__monomind__github_issue_track({ action: "list", state: "open" })
mcp__monomind__github_metrics({ repo: "owner/repo" })
```

## When to reach for the full docs

Each linked command file under `.claude/commands/github/` has the complete
option/flag reference and swarm-coordination patterns for its area — read
the relevant one before doing multi-step GitHub automation (e.g. spawning
a `pr-manager` or `release-manager` agent).
