---
name: monoswarm-multi-repo
description: Rolls one change out across many GitHub repositories — repo discovery, synchronized edits, linked PRs, and cross-repo dependency updates
when_to_use: Use when one change must land in many GitHub repos with linked PRs; for one repo's layout use repo-architect, for versions use sync-coordinator
tags: [github, multi-repo, automation, dependencies]
category: github
---

# Multi-Repo Swarm - Cross-Repository Swarm Orchestration

## Overview
Coordinate AI swarms across multiple repositories, enabling organization-wide automation and intelligent cross-project collaboration.

All GitHub work goes through the `gh` CLI (`gh repo`, `gh search`, `gh api`, `gh pr`, `gh issue`). Edits in each repository are made by subagents spawned with the Task tool, one per repository or batch of repositories. There is no monomind command that operates on many repositories; shared state between the subagents lives in `monomind memory`.

## Core Features

### 1. Cross-Repo Initialization
```bash
# List organization repositories that match the rollout
REPOS=$(gh repo list org --limit 100 --json name,description,primaryLanguage \
  --jq '.[] | select(.name | test("frontend|backend|shared"))')

# Get repository details
REPO_DETAILS=$(echo "$REPOS" | jq -r '.name' | while read -r repo; do
  gh api repos/org/$repo --jq '{name, default_branch, language, topics}'
done | jq -s '.')

# Share the rollout plan with every subagent
npx monomind memory store -k "multi-repo/rollout/plan" -n multi-repo --upsert \
  --value "$REPO_DETAILS"
```

### 2. Repository Discovery
```bash
# Search organization repositories by language
REPOS=$(gh repo list my-organization --limit 100 --language TypeScript \
  --json name,description,repositoryTopics)

# Analyze repository dependencies
DEPS=$(echo "$REPOS" | jq -r '.[].name' | while read -r repo; do
  gh api repos/my-organization/$repo/contents/package.json --jq '.content' 2>/dev/null | \
    base64 -d | jq --arg repo "$repo" '{repo: $repo, name, dependencies, devDependencies}'
done | jq -s '.')

# Which repositories depend on a given package
echo "$DEPS" | jq -r '.[] | select((.dependencies // {}) + (.devDependencies // {}) | has("@my-org/shared")) | .repo'

# Code search across the organization
gh search code "OldAPI" --owner my-organization --json repository,path \
  --jq '.[] | "\(.repository.nameWithOwner) \(.path)"'
```

### 3. Synchronized Operations
```bash
# Get matching repositories
MATCHING_REPOS=$(gh repo list org --limit 100 --json name \
  --jq '.[] | select(.name | test("-service$")) | .name')

# Show the targets and get the user's confirmation before touching any repository
echo "$MATCHING_REPOS"
# -> ask the user: "Open a dependency-update PR in each of these repositories?" Stop unless they agree.

BRANCH="update-dependencies-$(date +%Y%m%d)"
echo "$MATCHING_REPOS" | while read -r repo; do
  # Fresh directory per repo; the subshell never falls back to your own checkout
  D=$(mktemp -d) && gh repo clone org/$repo "$D" -- --depth=1 && (
    cd "$D" || exit 1

    # Apply the change (a subagent does the edits for anything beyond a command)
    npm update

    # Create PR if changes exist
    if [[ -n $(git status --porcelain) ]]; then
      git checkout -b "$BRANCH"
      git add -A
      git commit -m "chore: update dependencies"
      git push origin HEAD

      gh label create dependencies --force
      gh label create automated --force
      gh pr create \
        --title "Update dependencies" \
        --body "Automated dependency update across services" \
        --label "dependencies,automated" >> /tmp/created-prs.txt
    fi
  )
done

# Link related PRs: list every PR from the rollout in each one
LIST=$(sed 's/^/- /' /tmp/created-prs.txt)
while read -r url; do
  gh pr comment "$url" --body "Part of a multi-repo rollout:
$LIST"
done < /tmp/created-prs.txt
```

## Configuration

### Multi-Repo Config File
```yaml
# .swarm/multi-repo.yml — read by this agent to plan a rollout
version: 1
organization: my-org
repositories:
  - name: frontend
    url: github.com/my-org/frontend
    role: ui
    agents: [coder, designer, tester]

  - name: backend
    url: github.com/my-org/backend
    role: api
    agents: [architect, coder, tester]

  - name: shared
    url: github.com/my-org/shared
    role: library
    agents: [analyst, coder]

dependencies:
  - from: frontend
    to: [backend, shared]
  - from: backend
    to: [shared]
```

The `dependencies` list sets the rollout order: change `shared` first, then `backend`, then `frontend`.

### Repository Roles
```javascript
// Define repository roles and responsibilities
{
  "roles": {
    "ui": {
      "responsibilities": ["user-interface", "ux", "accessibility"],
      "default-agents": ["designer", "coder", "tester"]
    },
    "api": {
      "responsibilities": ["endpoints", "business-logic", "data"],
      "default-agents": ["architect", "coder", "security"]
    },
    "library": {
      "responsibilities": ["shared-code", "utilities", "types"],
      "default-agents": ["analyst", "coder", "documenter"]
    }
  }
}
```

## Orchestration Commands

### Dependency Management
```bash
# Create tracking issue first (gh issue create prints the new issue's URL)
gh label create dependencies --force
gh label create tracking --force
TRACKING_URL=$(gh issue create \
  --title "Dependency Update: typescript@5.0.0" \
  --body "Tracking issue for updating TypeScript across all repositories" \
  --label "dependencies,tracking")

# Get all repos with TypeScript
TS_REPOS=$(gh repo list org --limit 100 --json name --jq '.[].name' | \
  while read -r repo; do
    if gh api repos/org/$repo/contents/package.json --jq '.content' 2>/dev/null | \
       base64 -d | grep -q '"typescript"'; then
      echo "$repo"
    fi
  done)

# Show the targets and confirm with the user before changing them
echo "$TS_REPOS"

# Update each repository in its own temporary clone
echo "$TS_REPOS" | while read -r repo; do
  D=$(mktemp -d) && gh repo clone org/$repo "$D" -- --depth=1 && (
    cd "$D" || exit 1

    npm install --save-dev typescript@5.0.0

    if npm test; then
      git checkout -b update-typescript-5
      git add package.json package-lock.json
      git commit -m "chore: update TypeScript to 5.0.0

Part of $TRACKING_URL"

      git push origin HEAD
      gh label create dependencies --force
      gh pr create \
        --title "Update TypeScript to 5.0.0" \
        --body "Updates TypeScript to version 5.0.0

Tracking: $TRACKING_URL" \
        --label "dependencies"
    else
      # The URL pins the tracking repo; a bare number would resolve against this clone
      gh issue comment "$TRACKING_URL" \
        --body "❌ Failed to update $repo - tests failing"
    fi
  )
done
```

### Refactoring Operations
```bash
# Find every call site of the old API across the organization
gh search code "OldAPI" --owner org --json repository,path \
  --jq 'group_by(.repository.nameWithOwner)[] | {repo: .[0].repository.nameWithOwner, files: map(.path)}'
```

Give each repository's file list to a `coder` subagent, roll out in dependency order, and open one PR per repository referencing a shared tracking issue.

### Security Updates
```bash
# Open Dependabot alerts per repository
gh repo list org --limit 100 --json name --jq '.[].name' | while read -r repo; do
  gh api "repos/org/$repo/dependabot/alerts?state=open" \
    --jq ".[] | \"$repo \(.security_advisory.severity) \(.dependency.package.name)\"" 2>/dev/null
done

# In a cloned repository: local scan
npx monomind security scan -t . --type deps
```

## Communication Strategies

Subagents working on different repositories coordinate through shared memory, not a webhook or message bus:

```bash
# A subagent records what it changed
npx monomind memory store -k "multi-repo/rollout/backend" -n multi-repo --upsert \
  --value '{"status":"pr-open","pr":"https://github.com/org/backend/pull/42","exports-changed":["UserDTO"]}'

# Downstream subagents read it before editing
npx monomind memory retrieve -k "multi-repo/rollout/backend" -n multi-repo
npx monomind memory search -q "exports changed UserDTO" -n multi-repo
```

## Advanced Features

### 1. Cross-Repo Testing
```bash
# Check out the rollout branch in each repository and run its tests
for repo in shared backend frontend; do
  D=$(mktemp -d) && gh repo clone org/$repo "$D" -- --branch update-typescript-5 --depth=1 &&
    (cd "$D" || exit 1; npm ci && npm test) || echo "FAILED: $repo"
done

# Or watch CI on each rollout PR
while read -r url; do gh pr checks "$url" --watch --fail-fast; done < /tmp/created-prs.txt
```

### 2. Monorepo Migration
```bash
# Import a repository into a monorepo subdirectory, keeping its history
git remote add shared https://github.com/org/shared.git
git fetch shared
git merge -s ours --no-commit --allow-unrelated-histories shared/main
git read-tree --prefix=packages/shared/ -u shared/main
git commit -m "chore: import org/shared into packages/shared"
```

## Monitoring & Visualization

### Rollout Status
```bash
# Status of every PR in the rollout
while read -r url; do
  gh pr view "$url" --json url,state,mergeable,statusCheckRollup \
    --jq '{url, state, mergeable, checks: ([.statusCheckRollup[].conclusion] | unique)}'
done < /tmp/created-prs.txt

# Or find them by branch name across the organization
gh search prs --owner org --head update-typescript-5 --json repository,url,state
```

### Dependency Graph
```bash
# Mermaid graph of internal package dependencies (from the DEPS JSON above)
echo "$DEPS" | jq -r '"graph TD", (.[] | .repo as $r | (.dependencies // {}) | keys[] | select(startswith("@my-org/")) | "  \($r) --> \(.)")'
```

## Synchronization Patterns

### 1. Eventually Consistent
Open all PRs at once and let each merge when its checks pass. Suited to documentation and non-breaking dependency bumps.

### 2. Strong Consistency
Merge in dependency order and wait for each step: release `shared`, bump it in `backend`, then in `frontend`. Suited to breaking API changes and security updates.

```bash
# Wait for the checks to pass, then ask the user before merging or releasing
PR=https://github.com/org/shared/pull/10
gh pr checks "$PR" --watch --fail-fast
# -> confirm with the user: "Checks are green. Merge $PR and release org/shared v2.0.0?"
gh pr merge "$PR" --squash
gh release create v2.0.0 --repo org/shared --generate-notes
# then update the consumers and repeat
```

### 3. Hybrid Approach
Use strong consistency for security and breaking dependency updates and eventual consistency for everything else.

## Use Cases

### 1. Microservices Coordination
Update a shared contract (OpenAPI spec, protobuf, types package) first, then roll the change into each service in dependency order with one PR per service and a tracking issue.

### 2. Library Updates
```bash
# Find consumers of a shared library, then bump it in each one
gh search code '"@org/shared-lib"' --owner org --filename package.json --json repository \
  --jq '.[].repository.nameWithOwner' | sort -u
```

### 3. Organization-Wide Changes
```bash
# Check a policy file across repositories
gh repo list org --limit 100 --json name --jq '.[].name' | while read -r repo; do
  gh api repos/org/$repo/contents/SECURITY.md >/dev/null 2>&1 || echo "missing SECURITY.md: $repo"
done
```

## Best Practices

### 1. Repository Organization
- Clear repository roles and boundaries
- Consistent naming conventions
- Documented dependencies
- Shared configuration standards

### 2. Communication
- Use appropriate sync strategies
- One tracking issue per rollout, linked from every PR
- Monitor CI on every rollout PR
- Clear error propagation (comment failures on the tracking issue)

### 3. Security
- Use a token scoped to the repositories being changed
- Audit trail through PRs, never direct pushes to default branches
- Principle of least privilege

## Troubleshooting

### Permission Issues
```bash
# Confirm the token and its scopes
gh auth status

# Check your permission on a repository
gh api repos/org/backend --jq '.permissions'
```

### Rate Limits
```bash
gh api rate_limit --jq '.resources | {core: .core.remaining, search: .search.remaining, graphql: .graphql.remaining}'
```

## Examples

### Full-Stack Application Update
```bash
# One tracking issue, then PRs in dependency order
gh issue create --repo org/web-app --title "Rollout: new session API" --body "Tracks org/db-migrations, org/api-server, org/web-app"
# Spawn: coder for org/db-migrations, then org/api-server, then org/web-app
```

### Cross-Team Collaboration
```bash
# Request reviews from the owning team on each PR
while read -r url; do gh pr edit "$url" --add-reviewer org/backend-team; done < /tmp/created-prs.txt
```

See also: [pr-manager.md](./pr-manager.md), [project-board-sync.md](./project-board-sync.md)
