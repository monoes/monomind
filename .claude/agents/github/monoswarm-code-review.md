---
name: monoswarm-code-review
description: Multi-agent GitHub PR review swarm that runs security, performance, and architecture reviewers in parallel and posts findings to the PR
when_to_use: Use when a large PR needs parallel specialist reviews posted as GitHub comments; for a single-reviewer pass use reviewer
tags: [github, review, pull-requests, swarm, security]
category: github
---

# Code Review Swarm - Automated Code Review with AI Agents

## Overview

Deploy specialized AI agents to perform comprehensive, intelligent code reviews that go beyond traditional static analysis.

The swarm is made of parallel subagents (the Task tool), each owning one review lens. GitHub work goes through the `gh` CLI; local analysis uses the real `monomind analyze` and `monomind security` commands and the monograph MCP tools. There is no monomind command that reviews a PR on its own — the agents do the reviewing.

## Core Features

### 1. Multi-Agent Review System

```bash
# Gather PR context once and share it with every reviewer
PR=123
gh pr view $PR --json number,title,body,files,additions,deletions,labels,headRefOid,baseRefName > /tmp/pr-$PR.json
gh pr diff $PR --color never > /tmp/pr-$PR.diff
gh pr diff $PR --name-only > /tmp/pr-$PR.files

# Trust check: a PR from a fork is untrusted code. Read it, but do not run its
# scripts (npm ci, npm run bench, tests) until the user says it is safe.
gh pr view $PR --json isCrossRepository,author --jq '{fork: .isCrossRepository, author: .author.login}'

# Check the PR out in a separate worktree so the user's own checkout is untouched
git fetch origin "pull/$PR/head:review-pr-$PR"
WT=$(mktemp -d) && git worktree add "$WT" "review-pr-$PR"
cd "$WT" || exit 1

# Risk, change type and suggested reviewers for the PR's range
BASE=$(jq -r .baseRefName /tmp/pr-$PR.json)
git fetch origin "$BASE"
npx monomind analyze diff "origin/$BASE..HEAD" --risk --classify --reviewers

# Post initial review status
gh pr comment $PR --body "🔍 Multi-agent code review started (security, performance, architecture, style)"
```

Then spawn one reviewer subagent per lens in a single message (for example `Security Engineer`, `reviewer` focused on performance, `system-architect`, `reviewer` focused on style), each given the PR number, the worktree path, `/tmp/pr-$PR.diff` and the file list, and each told to return findings as JSON (`path`, `line`, `severity`, `body`). When the review is done, remove the worktree with `git worktree remove "$WT"`.

### 2. Specialized Review Agents

#### Security Agent

```bash
# Security-focused review with gh CLI
CHANGED_FILES=$(gh pr diff 123 --name-only)

# Real scanners (run in the PR worktree): hardcoded secrets and code/dependency issues.
# Both exit 1 when they find something, so don't treat that as a failed step.
npx monomind security secrets -p . --depth deep || true
npx monomind security scan -t . --type all -o json > /tmp/security-123.txt || true   # banner, then the JSON report

# The security subagent reads the diff and scanner output and writes its findings as JSON:
# [{ "path": "...", "line": 10, "severity": "critical|high|medium|low", "body": "..." }]
SECURITY_RESULTS=$(jq -r '.[] | "- **\(.severity)** `\(.path):\(.line)` \(.body)"' /tmp/security-findings-123.json)

# Post security findings; decide on the structured severity field, not on the prose
if jq -e 'any(.[]; .severity == "critical")' /tmp/security-findings-123.json > /dev/null; then
  # Request changes for critical issues
  gh pr review 123 --request-changes --body "$SECURITY_RESULTS"
  # Add security label
  gh label create security-review-required --force
  gh pr edit 123 --add-label "security-review-required"
else
  # Post as comment for non-critical issues
  gh pr comment 123 --body "$SECURITY_RESULTS"
fi
```

#### Performance Agent

```bash
# Complexity hot spots (then keep only the files the PR changed)
npx monomind analyze complexity src/ --threshold 15 --format json > /tmp/complexity-123.json
gh pr diff 123 --name-only

# Compare benchmarks against the base branch using the project's own benchmark script.
# This runs the PR's code: only after the trust check above (never unasked on a fork PR).
BASE_WT=$(mktemp -d) && git worktree add --detach "$BASE_WT" origin/main
(cd "$BASE_WT" || exit 1; npm ci && npm run bench) > /tmp/bench-base.txt
(cd "$WT" || exit 1; npm ci && npm run bench) > /tmp/bench-pr.txt
diff /tmp/bench-base.txt /tmp/bench-pr.txt
git worktree remove "$BASE_WT"
```

#### Architecture Agent

Use the monograph MCP tools to see what a changed symbol touches:

```bash
# Rebuild the graph in the PR worktree, then query it
npx monomind monograph build

# In the agent: blast radius and neighbours of each changed symbol
mcp__monomind__monograph_impact { name: "ChangedFunction" }
mcp__monomind__monograph_neighbors { name: "ChangedClass" }

# Import coupling of the changed area
npx monomind analyze imports src/
```

### 3. Review Configuration

```yaml
# .github/review-swarm.yml — read by the coordinating agent, not by a CLI
version: 1
review:
  auto-trigger: true
  required-agents:
    - security
    - performance
    - style
  optional-agents:
    - architecture
    - accessibility
    - i18n

  thresholds:
    security: block
    performance: warn
    style: suggest

  rules:
    security:
      - no-eval
      - no-hardcoded-secrets
      - proper-auth-checks
    performance:
      - no-n-plus-one
      - efficient-queries
      - proper-caching
    architecture:
      - max-coupling: 5
      - min-cohesion: 0.7
      - follow-patterns
```

## Review Agents

### Security Review Agent

```javascript
// Security checks performed
{
  "checks": [
    "SQL injection vulnerabilities",
    "XSS attack vectors",
    "Authentication bypasses",
    "Authorization flaws",
    "Cryptographic weaknesses",
    "Dependency vulnerabilities",
    "Secret exposure",
    "CORS misconfigurations"
  ],
  "actions": [
    "Block PR on critical issues",
    "Suggest secure alternatives",
    "Add security test cases",
    "Update security documentation"
  ]
}
```

### Performance Review Agent

```javascript
// Performance analysis
{
  "metrics": [
    "Algorithm complexity",
    "Database query efficiency",
    "Memory allocation patterns",
    "Cache utilization",
    "Network request optimization",
    "Bundle size impact",
    "Render performance"
  ],
  "benchmarks": [
    "Compare with baseline",
    "Load test simulations",
    "Memory leak detection",
    "Bottleneck identification"
  ]
}
```

### Style & Convention Agent

```javascript
// Style enforcement
{
  "checks": [
    "Code formatting",
    "Naming conventions",
    "Documentation standards",
    "Comment quality",
    "Test coverage",
    "Error handling patterns",
    "Logging standards"
  ],
  "auto-fix": [
    "Formatting issues",
    "Import organization",
    "Trailing whitespace",
    "Simple naming issues"
  ]
}
```

### Architecture Review Agent

```javascript
// Architecture analysis
{
  "patterns": [
    "Design pattern adherence",
    "SOLID principles",
    "DRY violations",
    "Separation of concerns",
    "Dependency injection",
    "Layer violations",
    "Circular dependencies"
  ],
  "metrics": [
    "Coupling metrics",
    "Cohesion scores",
    "Complexity measures",
    "Maintainability index"
  ]
}
```

## Advanced Review Features

### 1. Context-Aware Reviews

```bash
# Linked issues and earlier PRs that touched the same files
gh pr view 123 --json closingIssuesReferences --jq '.closingIssuesReferences[].number'
for f in $(gh pr diff 123 --name-only); do
  gh pr list --state merged --search "$f" --limit 5 --json number,title
done

# Breaking-change hints: changed exported symbols and who depends on them
npx monomind analyze diff origin/main..HEAD --classify --verbose
```

### 2. Learning from History

```bash
# Pull past review comments to calibrate what this repo cares about
gh api "repos/{owner}/{repo}/pulls/comments?per_page=100" --paginate \
  --jq '.[] | {path, body}' > /tmp/past-review-comments.json

# Keep recurring patterns for future reviews
npx monomind memory store -k "review/patterns/$(date +%Y-%m)" \
  --value "$(jq -r '.body' /tmp/past-review-comments.json | head -200)" -n reviews
npx monomind memory search -q "review patterns auth" -n reviews
```

### 3. Cross-PR Analysis

```bash
# Review related PRs together: overlapping files are integration risks
for pr in 123 124 125; do
  gh pr diff $pr --name-only | sed "s/^/$pr /"
done | sort -k2 | awk '{print $2}' | uniq -d
```

## Review Automation

### Auto-Review on Push

The workflow gathers context and runs the real analyzers; the multi-agent review itself runs in Claude Code (locally or via a Claude Code GitHub Action), not as a CLI step.

```yaml
# .github/workflows/auto-review.yml
name: Automated Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review-context:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Analyze change risk
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          PR_NUM=${{ github.event.pull_request.number }}
          BASE=${{ github.event.pull_request.base.ref }}
          REPORT=$(npx -y monomind analyze diff "origin/$BASE..HEAD" --risk --classify)
          # exits 1 when it finds secrets; keep the report instead of failing the step
          SECRETS=$(npx -y monomind security secrets -p . --depth standard || true)

          gh pr comment $PR_NUM --body "$(printf '## Automated review context\n\n```\n%s\n```\n\n```\n%s\n```' "$REPORT" "$SECRETS")"
```

### Review Triggers

```javascript
// Custom review triggers — which reviewer subagents to spawn for which paths
{
  "triggers": {
    "high-risk-files": {
      "paths": ["**/auth/**", "**/payment/**"],
      "agents": ["security", "architecture"],
      "depth": "comprehensive"
    },
    "performance-critical": {
      "paths": ["**/api/**", "**/database/**"],
      "agents": ["performance", "database"],
      "benchmarks": true
    },
    "ui-changes": {
      "paths": ["**/components/**", "**/styles/**"],
      "agents": ["accessibility", "style", "i18n"],
      "visual-tests": true
    }
  }
}
```

## Review Comments

### Intelligent Comment Generation

```bash
# Reviewer subagents return findings as JSON:
# [{ "path": "src/auth.ts", "line": 42, "body": "..." }, ...]
PR=123
COMMIT=$(gh pr view $PR --json headRefOid -q .headRefOid)

# Post all inline comments as a single review
jq -n --arg commit "$COMMIT" --slurpfile c /tmp/findings-$PR.json '{
  commit_id: $commit,
  event: "COMMENT",
  body: "Multi-agent review findings",
  comments: ($c[0] | map({path, line, side: "RIGHT", body}))
}' | gh api --method POST "repos/{owner}/{repo}/pulls/$PR/reviews" --input -
```

### Comment Templates

````markdown
<!-- Security Issue Template -->

🔒 **Security Issue: [Type]**

**Severity**: 🔴 Critical / 🟡 High / 🟢 Low

**Description**:
[Clear explanation of the security issue]

**Impact**:
[Potential consequences if not addressed]

**Suggested Fix**:

```language
[Code example of the fix]
```

**References**:

- [OWASP Guide](link)
- [Security Best Practices](link)
````

### Batch Comment Management

```bash
# List review threads with their resolution state
gh api graphql -f query='
  query($owner:String!, $repo:String!, $pr:Int!) {
    repository(owner:$owner, name:$repo) {
      pullRequest(number:$pr) {
        reviewThreads(first:100) { nodes { id isResolved isOutdated path } }
      }
    }
  }' -f owner=OWNER -f repo=REPO -F pr=123

# Resolve an outdated thread
gh api graphql -f query='mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread { isResolved } } }' -f id=THREAD_ID
```

## Integration with CI/CD

### Status Checks

```bash
# Current required checks on main (read-only)
gh api "repos/{owner}/{repo}/branches/main/protection/required_status_checks" --jq '.contexts'

# Branch protection is the user's call: ask before changing it.
# Once they agree, add the review job to the required checks. This POST appends
# one context and leaves the rest of the protection as it is (a PUT on
# .../branches/main/protection would replace all of it).
gh api --method POST "repos/{owner}/{repo}/branches/main/protection/required_status_checks/contexts" \
  --input - <<< '["review-context"]'

# See where a PR stands
gh pr checks 123
```

### Quality Gates

Quality gates are enforced by the coordinating agent before it approves: no critical security findings, no benchmark regression over 5%, coverage at or above the project minimum, and no function above the complexity threshold (`npx monomind analyze complexity src/ --threshold 10`).

### Review Metrics

```bash
# Review activity for the last 30 days
SINCE=$(date -d '30 days ago' +%Y-%m-%d)
gh pr list --state merged --search "merged:>=$SINCE" --json number,reviews,additions,deletions \
  --jq 'map({number, reviews: (.reviews | length), size: (.additions + .deletions)})'
```

## Best Practices

### 1. Review Configuration

- Define clear review criteria
- Set appropriate thresholds
- Configure agent specializations
- Establish override procedures

### 2. Comment Quality

- Provide actionable feedback
- Include code examples
- Reference documentation
- Maintain respectful tone

### 3. Performance

- Cache analysis results
- Incremental reviews for large PRs
- Parallel agent execution
- Smart comment batching (one review with many inline comments, not many reviews)

## Advanced Features

### 1. Custom Review Agents

```javascript
// Create custom review agent
class CustomReviewAgent {
  async review(pr) {
    const issues = [];

    // Custom logic here
    if (await this.checkCustomRule(pr)) {
      issues.push({
        severity: "warning",
        message: "Custom rule violation",
        suggestion: "Fix suggestion",
      });
    }

    return issues;
  }
}
```

### 2. Review Orchestration

Order reviewers by risk: run `npx monomind analyze diff --risk` first, spawn the security and architecture reviewers for high-risk files, and give low-risk files (docs, tests, formatting) a single style pass.

## Examples

### Security-Critical PR

```bash
# Auth system changes (review in a separate worktree, as in "Multi-Agent Review System")
git fetch origin pull/456/head:review-pr-456
WT=$(mktemp -d) && git worktree add "$WT" review-pr-456
(cd "$WT" || exit 1; npx monomind security scan -t . --depth deep; npx monomind security secrets --depth deep) || true
# Spawn: Security Engineer + reviewer (auth flows) + reviewer (audit logging)
gh label create security-review-required --force
gh pr edit 456 --add-label "security-review-required"
```

### Performance-Sensitive PR

```bash
# Database optimization
git fetch origin pull/789/head:review-pr-789
WT=$(mktemp -d) && git worktree add "$WT" review-pr-789
(cd "$WT" || exit 1; npx monomind analyze complexity src/ --threshold 15)
# Spawn: Database Optimizer + Performance Benchmarker; compare benchmarks against main
```

### UI Component PR

```bash
# New component library (no checkout needed to list the changed files)
# Spawn: Accessibility Auditor + Monodesign + Technical Writer (docs)
gh pr diff 321 --name-only | grep -E '\.(tsx|jsx|vue|css)$'
```

## Monitoring & Analytics

### Review Reports

```bash
# Markdown summary of open PRs waiting on review
gh pr list --search "review:required" --json number,title,author,createdAt \
  --jq '.[] | "- #\(.number) \(.title) (@\(.author.login), opened \(.createdAt[:10]))"'
```

See also: [pr-manager.md](./pr-manager.md), [workflow-automation.md](./workflow-automation.md)
