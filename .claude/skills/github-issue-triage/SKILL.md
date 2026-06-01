---
name: github-issue-triage
description: >
  Three-phase GitHub issue triage: automatic audit with 6-dimension analysis (categorization,
  PR cross-ref, Jaccard duplicate detection, risk classification, staleness, action recommendations),
  opt-in parallel deep analysis via AI agents, and draft-then-validate action execution.
  Args: "all" for deep analysis of all issues, issue numbers to focus (e.g. "42 57"), no arg = audit only.
allowed-tools:
  - Bash
  - Read
  - Grep
effort: medium
tags: [triage, issues, github, categorize, duplicates, risk, cross-ref]
---

# GitHub Issue Triage

// Pattern adapted from RTK (Rust Token Killer) issue-triage skill — rebranded for monomind

Three-phase workflow: automatic audit → opt-in deep analysis → draft-then-validate actions.

| Skill | Use case | Output |
|-------|----------|--------|
| `/github-issue-triage` | Audit issues, categorize, detect duplicates, post comments | Action tables + deep analysis reports + validated comments |
| `/github-repo-recap` | Full repo snapshot for team sharing | Markdown recap (PRs + issues + releases) |

**Triggers:**
- Manual: `/github-issue-triage`, `/github-issue-triage all`, `/github-issue-triage 42 57`
- Proactive: when >10 open issues without triage, or a stale issue (>30 days) is detected

## Preconditions

```bash
git rev-parse --is-inside-work-tree
gh auth status
```

If either fails, stop and explain what's missing.

---

## Phase 1 — Audit (always runs)

### Data Gathering (run in parallel)

```bash
# Repo identity
gh repo view --json nameWithOwner -q .nameWithOwner

# Open issues with full metadata
gh issue list --state open --limit 100 \
  --json number,title,author,createdAt,updatedAt,labels,assignees,body,comments

# Open PRs (for cross-referencing)
gh pr list --state open --limit 50 --json number,title,body

# Recently closed issues (for duplicate detection)
gh issue list --state closed --limit 20 \
  --json number,title,labels,closedAt

# Collaborators (never auto-close their issues)
gh api "repos/{owner}/{repo}/collaborators" --jq '.[].login'
```

**Collaborator fallback**: if `gh api .../collaborators` fails (403/404):
```bash
gh pr list --state merged --limit 10 --json author --jq '.[].author.login' | sort -u
```
If still ambiguous, use `AskUserQuestion` to clarify with the user.

**Note**: `author` is an object `{login: "..."}` — always extract `.author.login`.

### Analysis — 6 Dimensions

**1. Categorization** (existing labels take precedence; infer from title/body if unlabeled):
- **Bug**: keywords `crash`, `error`, `fail`, `broken`, `regression`, `wrong`, `unexpected`
- **Feature**: `add`, `implement`, `support`, `new`, `feat:`
- **Enhancement**: `improve`, `optimize`, `better`, `enhance`, `refactor`
- **Question/Support**: `how`, `why`, `help`, `unclear`, `docs`, `documentation`
- **Duplicate Candidate**: see dimension 3 below

**2. PR Cross-Reference**:
- Scan the `body` of every open PR for `fixes #N`, `closes #N`, `resolves #N` (case-insensitive, regex)
- Build a map: `issue_number → [PR numbers]`
- If the linked PR is already merged and the issue is still open → recommend closing

**3. Duplicate Detection**:
- Normalize titles: lowercase, strip common prefixes (`bug:`, `feat:`, `[bug]`, `[feature]`, etc.)
- **Jaccard similarity on title words**: if score > 60% between two issues → duplicate candidate
  - Jaccard = |intersection| / |union| — exclude stop words: a, the, is, in, of, for, to, with, on, at, by
- **Body keyword overlap** > 50% → reinforces the signal
- Compare against recently closed issues (last 20) too
- False positives are confirmed/rejected in Phase 2 — do not act on suspicion alone

**4. Risk Classification**:
- **Red (critical)**: keywords `CVE`, `vulnerability`, `injection`, `auth bypass`, `security`, `exploit`, `unsafe`, `credentials`, `leak`, `RCE`, `XSS`
- **Yellow (high)**: `breaking change`, `migration`, `deprecation`, `remove API`, `breaking`, `incompatible`
- **Green**: everything else

**5. Staleness**:
- > 30 days since `updatedAt` → **Stale**
- > 90 days since `updatedAt` → **Very Stale**
- Calculate from today's date; `updatedAt` null → fall back to `createdAt`

**6. Action Recommendations** (one per issue):
- `Accept & Prioritize` — issue is clear, reproducible, in scope
- `Label needed` — issue has no labels
- `Comment needed` — missing reproduction steps, version, environment, etc.
- `Linked to PR` — an open PR references this issue
- `Duplicate candidate` — suspected duplicate of `#N` (specify)
- `Close candidate` — very stale, no recent activity, or clearly out of scope (never for collaborator issues)
- `PR merged → close` — linked PR has been merged; issue is still open

### Output — 5 Tables

```
## Open Issues ({count})

### Critical (red risk)
| # | Title | Author | Age | Labels | Action |
| - | ----- | ------ | --- | ------ | ------ |

### Linked to a PR
| # | Title | Author | Linked PR(s) | PR Status | Action |
| - | ----- | ------ | ------------ | --------- | ------ |

### Active
| # | Title | Author | Category | Age | Labels | Action |
| - | ----- | ------ | -------- | --- | ------ | ------ |

### Duplicate Candidates
| # | Title | Duplicate of | Similarity | Action |
| - | ----- | ------------ | ---------- | ------ |

### Stale
| # | Title | Author | Last Activity | Action |
| - | ----- | ------ | ------------- | ------ |

### Summary
- Total: {N} open issues
- Critical: {N} (security or breaking-change risk)
- Linked to PR: {N}
- Duplicate candidates: {N}
- Stale (>30d): {N} | Very Stale (>90d): {N}
- No labels: {N}
- Quick wins (label or close quickly): {list}
```

Age = days since `createdAt`, format `{N}d`. Bold if > 30 days.

0 issues → print `No open issues.` and exit.

### Auto-Copy

After displaying the triage table, copy it to clipboard:
```bash
clip() {
  if command -v pbcopy &>/dev/null; then pbcopy
  elif command -v xclip &>/dev/null; then xclip -selection clipboard
  elif command -v wl-copy &>/dev/null; then wl-copy
  else cat
  fi
}
clip <<'EOF'
{full triage table}
EOF
```
Confirm: `Triage table copied to clipboard.`

---

## Phase 2 — Deep Analysis (opt-in)

### Issue Selection

**If an argument was passed:**
- `"all"` → analyze all open issues
- Numbers (e.g. `"42 57"`) → only those issues

**If no argument**, ask via `AskUserQuestion`:

```
question: "Which issues would you like to analyze in depth?"
header: "Deep Analysis"
multiSelect: true
options:
  - label: "All ({N} issues)"
    description: "Parallel deep analysis of every open issue"
  - label: "Critical only"
    description: "Focus on the {M} red/yellow-risk issues"
  - label: "Duplicate candidates"
    description: "Confirm or reject the {K} suspected duplicates"
  - label: "Stale only"
    description: "Close/keep decision on the {J} stale issues"
  - label: "Skip"
    description: "Finish here — audit only"
```

"Skip" → end workflow.

### Execution

For each selected issue, spawn an agent via **Task tool in parallel**:

```
subagent_type: general-purpose
model: sonnet
prompt: |
  Analyze GitHub issue #{num}: "{title}" by @{author}

  **Metadata**: Created {createdAt}, last updated {updatedAt}, labels: {labels}

  **Body**:
  {body}

  **Existing comments** ({comments_count} total, showing last 5):
  {last_5_comments}

  **Context**:
  - Linked PRs: {linked_prs or "none"}
  - Duplicate candidate of: {duplicate_of or "none"}
  - Risk classification: {risk_color}

  Analyze this issue and return a structured report:

  ### Scope Assessment
  What is this issue actually asking for? Is it clearly defined?

  ### Missing Information
  What's needed to act on this? (reproduction steps, version, environment, etc.)

  ### Risk & Impact
  Security risk? Breaking change? Who is affected?

  ### Effort Estimate
  XS (<1h) / S (1–4h) / M (1–2d) / L (3–5d) / XL (>1 week)

  ### Priority
  P0 (critical, act now) / P1 (high, this sprint) / P2 (medium, backlog) / P3 (low, someday)

  ### Recommended Action
  One of: Accept & Prioritize, Request More Info, Mark Duplicate (#N),
  Close (Stale), Close (Out of Scope), Link to Existing PR

  ### Draft Comment
  Draft a GitHub comment in English. Be specific, helpful, and constructive.
  Include: what was found, what action is being taken, and (if closing) why.
```

If an issue has > 50 comments, summarize the last 5 only.

Aggregate all agent reports. Display a summary after all analyses complete.

---

## Phase 3 — Actions (explicit validation required)

### Available Action Types

- **Comment**: `gh issue comment {num} --body-file -`
- **Label**: `gh issue edit {num} --add-label "{label}"` (skip if label already present)
- **Close**: `gh issue close {num} --reason "not planned"` (never without explicit user approval)

### Draft Generation

For each analyzed issue, generate the complete action set (comment + labels + close if applicable).

**Rules:**
- GitHub comment language: **English** (international audience)
- Tone: professional, constructive, factual
- Never re-label an issue that already has the label
- Never propose `close` for a collaborator's issue
- Always show the full draft before any `gh issue comment` is executed

### Display and Validation

Show **all drafts** in this format:

```
---
### Draft — Issue #{num}: {title}

**Proposed actions**: {Comment | Label: "bug" | Close}

**Comment**:
{full comment text}

---
```

Then ask for explicit approval via `AskUserQuestion`:

```
question: "These actions are ready. Which ones would you like to execute?"
header: "Execute"
multiSelect: true
options:
  - label: "All ({N} actions)"
    description: "Comment + label + close per the drafts above"
  - label: "Issue #{x} — {title_truncated}"
    description: "Execute only the actions for this issue"
  - label: "None"
    description: "Cancel — do nothing"
```

(Generate one option per issue, plus "All" and "None".)

### Execution

For each validated action, execute in order: comment → label → close.

```bash
# Comment
gh issue comment {num} --body-file - <<'COMMENT_EOF'
{comment}
COMMENT_EOF

# Label (if applicable)
gh issue edit {num} --add-label "{label}"

# Close (if applicable)
gh issue close {num} --reason "not planned"
```

Confirm each action: `Comment posted on issue #{num}: {title}`

"None" → `No actions executed. Workflow complete.`

---

## Edge Cases

| Situation | Behavior |
|-----------|----------|
| 0 open issues | Print `No open issues.` and exit |
| Issue without body | Categorize by title; recommend `Comment needed` |
| > 50 comments | Summarize last 5 only |
| False positive duplicate | Phase 2 confirms/rejects — never act on suspicion alone |
| Label already present | Skip, note "label already applied" |
| Collaborator issue | Never `close candidate` automatically |
| GitHub API rate limit | Reduce `--limit`, notify user |
| Merged PR linked to open issue | Recommend closing the issue |
| Issue inactive > 90d | Very Stale — propose close with a considerate message |
| Duplicate confirmed in Phase 2 | Post comment + close in favor of the original issue |

---

## Notes

- Always derive owner/repo via `gh repo view` — never hardcode
- Use `gh` CLI (not direct `curl` GitHub API calls, except the collaborators endpoint)
- `updatedAt` may be null on some issues → fall back to `createdAt`
- Never post or close without explicit user approval in this chat session
- Drafted comments must be shown in full BEFORE any `gh issue comment` is executed
