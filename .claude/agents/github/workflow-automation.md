---
name: workflow-automation
description: GitHub Actions automation that generates and optimizes CI/CD workflows, smart test selection, security scans, and failure analysis
when_to_use: Use when creating, optimizing, or debugging GitHub Actions workflows; for non-GitHub CI/CD or infrastructure use DevOps Automator
tags: [github, github-actions, ci-cd, automation]
category: github
---

# Workflow Automation - GitHub Actions Integration

## Overview

Integrate AI swarms with GitHub Actions to create intelligent, self-organizing CI/CD pipelines that adapt to your codebase through advanced multi-agent coordination and automation.

This agent writes and edits workflow YAML itself, inspects runs with `gh run`, `gh workflow` and `gh cache`, and uses real monomind commands where they fit in a pipeline (`monomind analyze diff`, `monomind security scan`, `monomind security secrets`). There is no monomind command that generates, optimizes or heals workflows; that analysis is the agent's job.

## Core Features

### 1. Swarm-Powered Actions

```yaml
# .github/workflows/swarm-ci.yml
name: Intelligent CI with Swarms
on: [push, pull_request]

jobs:
  change-analysis:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Analyze Changes
        run: |
          BASE=${{ github.event.pull_request.base.sha || github.event.before }}
          # A push that creates a branch has an all-zero "before"; compare with the default branch instead
          if [ -z "$BASE" ] || [ "$BASE" = "0000000000000000000000000000000000000000" ]; then
            BASE=$(git merge-base "origin/${{ github.event.repository.default_branch }}" HEAD)
          fi
          npx -y monomind analyze diff "$BASE..${{ github.sha }}" --risk --classify
```

### 2. Dynamic Workflow Generation

Inspect the repository, then write the workflow file:

```bash
# What already exists
gh workflow list --all
ls .github/workflows/

# Detect the stack from manifest files
ls package.json pnpm-lock.yaml pyproject.toml go.mod Cargo.toml pom.xml 2>/dev/null
npx monomind analyze deps
```

Write `.github/workflows/ci.yml` for the detected stack, then validate it by pushing to a branch and watching the run (`gh run watch`).

### 3. Intelligent Test Selection

```yaml
# Smart test runner: run only the tests related to changed files
# (the diff needs the base commit, so check out full history)
- uses: actions/checkout@v4
  with:
    fetch-depth: 0

- name: Changed files
  id: files
  run: |
    echo "all=$(git diff --name-only ${{ github.event.pull_request.base.sha }} ${{ github.sha }} | tr '\n' ' ')" >> "$GITHUB_OUTPUT"

- name: Related tests
  run: npx vitest related ${{ steps.files.outputs.all }} --run
```

## Workflow Templates

### Multi-Language Detection

```yaml
# .github/workflows/polyglot-swarm.yml
name: Polyglot Project Handler
on: push

jobs:
  detect:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.detect.outputs.matrix }}
      found: ${{ steps.detect.outputs.found }}
    steps:
      - uses: actions/checkout@v4

      - name: Detect Languages
        id: detect
        run: |
          LANGS=()
          [ -f package.json ] && LANGS+=('"node"')
          [ -f pyproject.toml ] && LANGS+=('"python"')
          [ -f go.mod ] && LANGS+=('"go"')
          echo "matrix={\"lang\":[$(IFS=,; echo "${LANGS[*]}")]}" >> "$GITHUB_OUTPUT"
          # An empty matrix fails the build job, so record whether anything was found
          echo "found=$([ ${#LANGS[@]} -gt 0 ] && echo true || echo false)" >> "$GITHUB_OUTPUT"

  build:
    needs: detect
    if: needs.detect.outputs.found == 'true'
    runs-on: ubuntu-latest
    strategy:
      matrix: ${{ fromJson(needs.detect.outputs.matrix) }}
    steps:
      - uses: actions/checkout@v4
      - run: echo "Building ${{ matrix.lang }}"
```

### Adaptive Security Scanning

```yaml
# .github/workflows/security-swarm.yml
name: Intelligent Security Scan
on:
  schedule:
    - cron: "0 0 * * *"
  workflow_dispatch:

jobs:
  security-scan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4

      - name: Security scan (SARIF)
        # The scan exits 1 when it finds something, and prints a banner before the
        # SARIF document; keep the report and only the JSON part of it
        run: |
          { npx -y monomind security scan -t . --type all -o sarif || true; } | sed -n '/^{/,$p' > results.sarif

      - name: Secret detection
        # fails the job when secrets are found (the upload below still runs)
        run: npx -y monomind security secrets -p . --depth deep

      - name: Upload to code scanning
        if: always()
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: results.sarif
```

Code scanning alerts then show in the Security tab, and can be listed with `gh api "repos/{owner}/{repo}/code-scanning/alerts?state=open"`.

## Action Commands

### Pipeline Optimization

```bash
# Slowest jobs across recent runs of a workflow
gh run list --workflow ci.yml --limit 20 --json databaseId --jq '.[].databaseId' |
  while read -r id; do
    gh run view "$id" --json jobs --jq '.jobs[] | select(.completedAt and .startedAt) |
      {name, seconds: ((.completedAt | fromdate) - (.startedAt | fromdate))}'
  done | jq -s 'group_by(.name) | map({job: .[0].name, avg_s: (map(.seconds) | add / length)}) | sort_by(-.avg_s)'
```

Then edit the workflow: parallelize independent jobs, add `actions/cache` or `setup-node`'s `cache:`, add `concurrency` with `cancel-in-progress`, and drop duplicate steps.

### Failure Analysis

```bash
# Latest failed run and the logs of its failed steps
RUN_ID=$(gh run list --status failure --limit 1 --json databaseId -q '.[0].databaseId')
gh run view "$RUN_ID" --log-failed

# Rerun only the failed jobs (for a suspected flaky failure)
gh run rerun "$RUN_ID" --failed

# Create issue for persistent failures
if ! gh run watch "$RUN_ID" --exit-status; then
  gh label create ci-failure --force
  gh issue create \
    --title "CI Failure: Run $RUN_ID" \
    --body "$(gh run view "$RUN_ID" --log-failed | tail -50)" \
    --label "ci-failure"
fi
```

### Resource Management

```bash
# Actions cache usage and the largest entries
gh cache list --sort size_in_bytes --order desc --limit 20
gh api "repos/{owner}/{repo}/actions/cache/usage"

# Billable time per workflow for this month
gh api "repos/{owner}/{repo}/actions/workflows" --jq '.workflows[].id' |
  while read -r id; do gh api "repos/{owner}/{repo}/actions/workflows/$id/timing" --jq '.billable'; done
```

## Advanced Workflows

### 1. Self-Healing CI/CD

```yaml
# Collect failure context automatically; the agent proposes the fix
name: Failure Triage
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]

jobs:
  triage:
    if: ${{ github.event.workflow_run.conclusion == 'failure' }}
    runs-on: ubuntu-latest
    permissions:
      actions: read
      issues: write
    steps:
      - name: Open issue with failed logs
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GH_REPO: ${{ github.repository }}
        run: |
          RUN=${{ github.event.workflow_run.id }}
          gh label create ci-failure --force
          gh issue create --title "CI failed on ${{ github.event.workflow_run.head_branch }} (run $RUN)" \
            --label ci-failure \
            --body "$(gh run view $RUN --log-failed | tail -100)"
```

### 2. Progressive Deployment

```yaml
# Risk-gated deployment
name: Smart Deployment
on:
  push:
    branches: [main]

jobs:
  assess:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Analyze Risk
        run: |
          BASE=${{ github.event.before }}
          # the first push of a branch has an all-zero "before"; fall back to the parent commit
          [ "$BASE" = "0000000000000000000000000000000000000000" ] && BASE=HEAD~1
          npx -y monomind analyze diff "$BASE..${{ github.sha }}" --risk

  deploy:
    needs: assess
    runs-on: ubuntu-latest
    environment: production   # required reviewers on the environment gate risky deploys
    steps:
      - run: echo "deploy"
```

### 3. Performance Regression Detection

```yaml
# Compare benchmarks against the base branch
name: Performance Guard
on: pull_request

jobs:
  perf:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: npm ci
      - run: npm run bench > pr.txt
      - run: git checkout ${{ github.event.pull_request.base.sha }} && npm ci && npm run bench > base.txt
      - run: diff base.txt pr.txt || true
```

## Matrix Strategies

### Dynamic Test Matrix

```yaml
# Generate test matrix from the repository layout
jobs:
  generate-matrix:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.set-matrix.outputs.matrix }}
    steps:
      - uses: actions/checkout@v4
      - id: set-matrix
        run: |
          MATRIX=$(ls -d packages/*/ | jq -R -s -c 'split("\n") | map(select(length > 0)) | {package: .}')
          echo "matrix=${MATRIX}" >> $GITHUB_OUTPUT

  test:
    needs: generate-matrix
    runs-on: ubuntu-latest
    strategy:
      matrix: ${{ fromJson(needs.generate-matrix.outputs.matrix) }}
    steps:
      - uses: actions/checkout@v4
      - run: cd ${{ matrix.package }} && npm test
```

### Intelligent Parallelization

Split jobs that do not depend on each other (lint, typecheck, unit tests), give only real dependencies a `needs:`, and shard long test suites (`vitest --shard=${{ matrix.shard }}/4`).

## Monitoring & Insights

### Workflow Analytics

```bash
# Success rate and average duration of a workflow over its last 100 runs
gh run list --workflow ci.yml --limit 100 --json conclusion,createdAt,updatedAt --jq '{
  runs: length,
  success_rate: ((map(select(.conclusion == "success")) | length) / length),
  avg_minutes: (map(((.updatedAt | fromdate) - (.createdAt | fromdate)) / 60) | add / length)
}'
```

### Failure Patterns

```bash
# Which jobs fail most often
gh run list --status failure --limit 50 --json databaseId --jq '.[].databaseId' |
  while read -r id; do
    gh run view "$id" --json jobs --jq '.jobs[] | select(.conclusion == "failure") | .name'
  done | sort | uniq -c | sort -rn
```

## Integration Examples

### 1. PR Validation Swarm

```yaml
name: PR Validation Swarm
on: pull_request

jobs:
  validate:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Validate and report
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          RISK=$(npx -y monomind analyze diff "origin/${{ github.base_ref }}..HEAD" --risk --classify)
          # exits 1 when it finds secrets; keep the report instead of failing the step
          SECRETS=$(npx -y monomind security secrets -p . --depth quick || true)

          gh pr comment ${{ github.event.pull_request.number }} \
            --body "$(printf '## PR validation\n\n```\n%s\n```\n\n```\n%s\n```' "$RISK" "$SECRETS")"
```

### 2. Release Automation

```yaml
name: Release
on:
  push:
    tags: ["v*"]

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - name: Create release with generated notes
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: gh release create "${{ github.ref_name }}" --generate-notes
```

### 3. Documentation Updates

Trigger a docs check on source changes (`on: push: paths: ["src/**"]`) that runs the project's own docs build and link checker; the agent updates the prose.

## Best Practices

### 1. Workflow Organization

- Use reusable workflows (`workflow_call`) for shared steps
- Implement proper caching strategies
- Set appropriate timeouts (`timeout-minutes`)
- Use workflow dependencies wisely

### 2. Security

- Store credentials in secrets
- Use OIDC for cloud authentication
- Set least-privilege `permissions:` per job
- Pin third-party actions to a commit SHA

### 3. Performance

- Cache dependencies
- Use appropriate runner sizes
- Cancel superseded runs with `concurrency`
- Optimize parallel execution

## Debugging & Troubleshooting

### Debug Mode

```bash
# Rerun with step debug logging
gh run rerun "$RUN_ID" --debug

# Trigger a workflow_dispatch run on a branch and follow it
gh workflow run ci.yml --ref my-branch
gh run watch "$(gh run list --workflow ci.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

### Performance Profiling

```bash
# Step durations of one run
gh run view "$RUN_ID" --json jobs --jq '.jobs[] | .name as $j | .steps[] |
  select(.completedAt and .startedAt) |
  {job: $j, step: .name, seconds: ((.completedAt | fromdate) - (.startedAt | fromdate))}'
```

See also: [pr-manager.md](./pr-manager.md), [issue-tracker.md](./issue-tracker.md), [sync-coordinator.md](./sync-coordinator.md)
