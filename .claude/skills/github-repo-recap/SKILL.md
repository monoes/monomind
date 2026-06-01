---
name: github-repo-recap
description: Generate a comprehensive repository recap (open PRs by category, issues, recent releases, executive summary) formatted as Markdown ready to share with the team. Detects overlapping PRs, author clusters, and issue-PR cross-references. Copies result to clipboard.
allowed-tools: Bash Read Grep
---

# GitHub Repo Recap

// Pattern adapted from RTK (Rust Token Killer) repo-recap skill — rebranded for monomind

Generate a structured snapshot of the repository state: open PRs (categorized by contributor type and health), open issues, recent releases, and an executive summary. Output is Markdown with clickable GitHub links, ready to paste into Slack or a team meeting.

## Preconditions

Before gathering data, verify:

```bash
# Must be inside a git repo
git rev-parse --is-inside-work-tree

# Must have gh CLI authenticated
gh auth status
```

If either check fails, stop and tell the user what's missing before proceeding.

## Steps

### 1. Gather Data (run in parallel)

```bash
# Repo identity (for constructing links)
gh repo view --json nameWithOwner -q .nameWithOwner

# Open PRs with full metadata
gh pr list --state open --limit 50 \
  --json number,title,author,createdAt,changedFiles,additions,deletions,reviewDecision,isDraft

# Open issues with metadata
gh issue list --state open --limit 50 \
  --json number,title,author,createdAt,labels,assignees

# Recent releases
gh release list --limit 5

# Recently merged PRs (contributor activity signal)
gh pr list --state merged --limit 10 --json number,title,author,mergedAt
```

Note: `author` in JSON results is an object `{login: "..."}` — always extract `.author.login` when processing.

### 2. Determine Maintainers

To distinguish internal PRs from external contributions:

```bash
gh api repos/{owner}/{repo}/collaborators --jq '.[].login'
```

If this fails (403/404 permissions), fall back to: authors who have merged PRs recently are likely maintainers. When genuinely ambiguous, ask the user.

### 3. Analyze and Categorize

#### PRs — Three groups:

**Our PRs** (author is a repo collaborator):
- List with PR number (linked), title, size (+additions, file count), review status

**External — Reviewable** (manageable size, no major blockers):
- Additions ≤ 1000 AND files ≤ 10
- No merge conflicts, CI not failing
- Include: PR link, author, title, size, review status, recommended action

**External — Problematic** (any of: too large, CI failing, overlapping, merge conflict):
- Additions > 1000 OR files > 10
- OR `reviewDecision == "CHANGES_REQUESTED"` or checks failing
- OR touches same files as another open PR
- Include: PR link, author, title, size, specific problem, required action

**Size labels** (use in the "Size" column for fast visual triage):

| Label | Additions |
| ----- | --------- |
| XS    | < 50      |
| S     | 50–200    |
| M     | 200–500   |
| L     | 500–1000  |
| XL    | > 1000    |

Format: `+{additions}, {files} files ({label})` — e.g., `+245, 2 files (S)`

#### Detect overlaps:

Two PRs overlap if they modify the same files. Use `changedFiles` from the JSON. If > 50% file overlap between two PRs, flag both as overlapping and cross-reference them in the table.

#### Flag clusters:

If one author has 3+ open PRs, note it as a "cluster" with a suggested review order (smallest first, or by dependency chain if apparent).

#### Issues — Categories:

- **In progress**: has an associated open PR (match by PR body containing `fixes #N`, `closes #N`, or `resolves #N`)
- **Quick fix**: small scope, actionable (bug reports, small enhancements)
- **Feature request**: larger scope, needs design discussion
- **Covered by PR**: an existing PR addresses this issue (link it)

### 4. Derive Recent Releases

From `gh release list` output, extract version, date, and name — list the 5 most recent.

If no releases found, check merged PRs for release-please pattern (titles matching `chore(*): release *`) as fallback.

### 5. Executive Summary

Produce 5–6 bullet points covering:
- Total open PRs and issues count
- Active contributors (who has the most open PRs/issues)
- Main risks (oversized PRs, CI failures, merge conflicts)
- Quick wins (XS/S PRs ready to merge with no blockers)
- Bug fixes needed (regressions, critical issues)
- Status of maintainer-owned PRs

### 6. Format Output

Structure the recap as Markdown:

```markdown
# {Repo Name} — Recap {date}

## Recent Releases

| Version | Date | Highlights |
| ------- | ---- | ---------- |

---

## Open PRs ({count} total)

### Our PRs

| PR | Title | Size | Status |
| -- | ----- | ---- | ------ |

### External — Reviewable

| PR | Author | Title | Size | Status | Action |
| -- | ------ | ----- | ---- | ------ | ------ |

### External — Problematic

| PR | Author | Title | Size | Problem | Action |
| -- | ------ | ----- | ---- | ------- | ------ |

---

## Open Issues ({count} total)

| # | Author | Subject | Priority |
| - | ------ | ------- | -------- |

---

## Executive Summary

- **Point 1**: ...
- **Point 2**: ...
```

**Rules:**
- All PR/issue numbers as clickable links: `[#123](https://github.com/{owner}/{repo}/pull/123)` for PRs, `.../issues/123` for issues
- Tables use Markdown pipe syntax
- Bold for emphasis on actions and risks
- Cross-reference related PRs and issues (e.g., "Covered by [#131](link)")
- Truncate long titles to ~60 chars for table readability

**Empty data handling:**
- 0 open PRs → `No open PRs.`
- 0 open issues → `No open issues.`
- 0 releases → `No recent releases.`

### 7. Copy to Clipboard

After displaying the recap, copy it automatically:

```bash
clip() {
  if command -v pbcopy &>/dev/null; then pbcopy
  elif command -v xclip &>/dev/null; then xclip -selection clipboard
  elif command -v wl-copy &>/dev/null; then wl-copy
  else cat
  fi
}

cat << 'EOF' | clip
{formatted recap content}
EOF
```

Confirm: "Copied to clipboard."

## Notes

- Always derive owner/repo from `gh repo view` — never hardcode
- Use `gh` CLI for all data gathering (not direct GitHub API calls, except the collaborators endpoint)
- `author` in gh JSON is an object — always use `.author.login`
- Keep tables compact — truncate long titles if needed
- Cross-reference overlapping PRs and related issues whenever possible
