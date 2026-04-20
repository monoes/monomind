---
name: workflow-automation
description: |
  GitHub Actions workflow automation agent that creates intelligent, self-organizing CI/CD pipelines with adaptive multi-agent coordination and automated optimization
tools: mcp__github__create_workflow, mcp__github__update_workflow, mcp__github__list_workflows, mcp__github__get_workflow_runs, mcp__github__create_workflow_dispatch, mcp__monobrain__swarm_init, mcp__monobrain__agent_spawn, mcp__monobrain__performance_report, mcp__monobrain__workflow_create, TodoWrite, TodoRead, Bash, Read, Write, Edit, Grep
---

# Workflow Automation - GitHub Actions Integration

## Overview

Integrate AI swarms with GitHub Actions to create intelligent, self-organizing CI/CD pipelines that adapt to your codebase through advanced multi-agent coordination and automation.

## Core Features

### 1. Swarm-Powered Actions

```yaml
# .github/workflows/swarm-ci.yml
name: Intelligent CI with Swarms
on: [push, pull_request]

jobs:
  swarm-analysis:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v1

      - name: Initialize Swarm
        uses: nokhodian/swarm-action@v1
        with:
          topology: mesh
          max-agents: 6

      - name: Analyze Changes
        run: |
          npx monobrain@latest actions analyze \
            --commit ${{ github.sha }} \
            --suggest-tests \
            --optimize-pipeline
```

### 2. Dynamic Workflow Generation

```bash
# Generate workflows based on code analysis
npx monobrain@latest actions generate-workflow \
  --analyze-codebase \
  --detect-languages \
  --create-optimal-pipeline
```

### 3. Intelligent Test Selection

```yaml
# Smart test runner
- name: Swarm Test Selection
  run: |
    npx monobrain@latest actions smart-test \
      --changed-files ${{ steps.files.outputs.all }} \
      --impact-analysis \
      --parallel-safe
```

## Workflow Templates

### Multi-Language Detection

```yaml
# .github/workflows/polyglot-swarm.yml
name: Polyglot Project Handler
on: push

jobs:
  detect-and-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v1

      - name: Detect Languages
        id: detect
        run: |
          npx monobrain@latest actions detect-stack \
            --output json > stack.json

      - name: Dynamic Build Matrix
        run: |
          npx monobrain@latest actions create-matrix \
            --from stack.json \
            --parallel-builds
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
  security-swarm:
    runs-on: ubuntu-latest
    steps:
      - name: Security Analysis Swarm
        run: |
          # Use gh CLI for issue creation
          SECURITY_ISSUES=$(npx monobrain@latest actions security \
            --deep-scan \
            --format json)

          # Create issues for complex security problems
          echo "$SECURITY_ISSUES" | jq -r '.issues[]? | @base64' | while read -r issue; do
            _jq() {
              echo ${issue} | base64 --decode | jq -r ${1}
            }
            gh issue create \
              --title "$(_jq '.title')" \
              --body "$(_jq '.body')" \
              --label "security,critical"
          done
```

## Action Commands

### Pipeline Optimization

```bash
# Optimize existing workflows
npx monobrain@latest actions optimize \
  --workflow ".github/workflows/ci.yml" \
  --suggest-parallelization \
  --reduce-redundancy \
  --estimate-savings
```

### Failure Analysis

```bash
# Analyze failed runs using gh CLI
gh run view ${{ github.run_id }} --json jobs,conclusion | \
  npx monobrain@latest actions analyze-failure \
    --suggest-fixes \
    --auto-retry-flaky

# Create issue for persistent failures
if [ $? -ne 0 ]; then
  gh issue create \
    --title "CI Failure: Run ${{ github.run_id }}" \
    --body "Automated analysis detected persistent failures" \
    --label "ci-failure"
fi
```

### Resource Management

```bash
# Optimize resource usage
npx monobrain@latest actions resources \
  --analyze-usage \
  --suggest-runners \
  --cost-optimize
```

## Advanced Workflows

### 1. Self-Healing CI/CD

```yaml
# Auto-fix common CI failures
name: Self-Healing Pipeline
on: workflow_run

jobs:
  heal-pipeline:
    if: ${{ github.event.workflow_run.conclusion == 'failure' }}
    runs-on: ubuntu-latest
    steps:
      - name: Diagnose and Fix
        run: |
          npx monobrain@latest actions self-heal \
            --run-id ${{ github.event.workflow_run.id }} \
            --auto-fix-common \
            --create-pr-complex
```

### 2. Progressive Deployment

```yaml
# Intelligent deployment strategy
name: Smart Deployment
on:
  push:
    branches: [main]

jobs:
  progressive-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Analyze Risk
        id: risk
        run: |
          npx monobrain@latest actions deploy-risk \
            --changes ${{ github.sha }} \
            --history 30d

      - name: Choose Strategy
        run: |
          npx monobrain@latest actions deploy-strategy \
            --risk ${{ steps.risk.outputs.level }} \
            --auto-execute
```

### 3. Performance Regression Detection

```yaml
# Automatic performance testing
name: Performance Guard
on: pull_request

jobs:
  perf-swarm:
    runs-on: ubuntu-latest
    steps:
      - name: Performance Analysis
        run: |
          npx monobrain@latest actions perf-test \
            --baseline main \
            --threshold 10% \
            --auto-profile-regression
```

## Custom Actions

### Swarm Action Development

```javascript
// action.yml
name: "Swarm Custom Action";
description: "Custom swarm-powered action";
inputs: task: description: "Task for swarm";
required: true;
runs: using: "node16";
main: "dist/index.js";

// index.js
const { SwarmAction } = require("monobrain");

async function run() {
  const swarm = new SwarmAction({
    topology: "mesh",
    agents: ["analyzer", "optimizer"],
  });

  await swarm.execute(core.getInput("task"));
}
```

## Matrix Strategies

### Dynamic Test Matrix

```yaml
# Generate test matrix from code analysis
jobs:
  generate-matrix:
    outputs:
      matrix: ${{ steps.set-matrix.outputs.matrix }}
    steps:
      - id: set-matrix
        run: |
          MATRIX=$(npx monobrain@latest actions test-matrix \
            --detect-frameworks \
            --optimize-coverage)
          echo "matrix=${MATRIX}" >> $GITHUB_OUTPUT

  test:
    needs: generate-matrix
    strategy:
      matrix: ${{fromJson(needs.generate-matrix.outputs.matrix)}}
```

### Intelligent Parallelization

```bash
# Determine optimal parallelization
npx monobrain@latest actions parallel-strategy \
  --analyze-dependencies \
  --time-estimates \
  --cost-aware
```

## Monitoring & Insights

### Workflow Analytics

```bash
# Analyze workflow performance
npx monobrain@latest actions analytics \
  --workflow "ci.yml" \
  --period 30d \
  --identify-bottlenecks \
  --suggest-improvements
```

### Cost Optimization

```bash
# Optimize GitHub Actions costs
npx monobrain@latest actions cost-optimize \
  --analyze-usage \
  --suggest-caching \
  --recommend-self-hosted
```

### Failure Patterns

```bash
# Identify failure patterns
npx monobrain@latest actions failure-patterns \
  --period 90d \
  --classify-failures \
  --suggest-preventions
```

## Integration Examples

### 1. PR Validation Swarm

```yaml
name: PR Validation Swarm
on: pull_request

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Multi-Agent Validation
        run: |
          # Get PR details using gh CLI
          PR_DATA=$(gh pr view ${{ github.event.pull_request.number }} --json files,labels)

          # Run validation with swarm
          RESULTS=$(npx monobrain@latest actions pr-validate \
            --spawn-agents "linter,tester,security,docs" \
            --parallel \
            --pr-data "$PR_DATA")

          # Post results as PR comment
          gh pr comment ${{ github.event.pull_request.number }} \
            --body "$RESULTS"
```

### 2. Release Automation

```yaml
name: Intelligent Release
on:
  push:
    tags: ["v*"]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Release Swarm
        run: |
          npx monobrain@latest actions release \
            --analyze-changes \
            --generate-notes \
            --create-artifacts \
            --publish-smart
```

### 3. Documentation Updates

```yaml
name: Auto Documentation
on:
  push:
    paths: ["src/**"]

jobs:
  docs:
    runs-on: ubuntu-latest
    steps:
      - name: Documentation Swarm
        run: |
          npx monobrain@latest actions update-docs \
            --analyze-changes \
            --update-api-docs \
            --check-examples
```

## Best Practices

### 1. Workflow Organization

- Use reusable workflows for swarm operations
- Implement proper caching strategies
- Set appropriate timeouts
- Use workflow dependencies wisely

### 2. Security

- Store swarm configs in secrets
- Use OIDC for authentication
- Implement least-privilege principles
- Audit swarm operations

### 3. Performance

- Cache swarm dependencies
- Use appropriate runner sizes
- Implement early termination
- Optimize parallel execution

## Advanced Features

### Predictive Failures

```bash
# Predict potential failures
npx monobrain@latest actions predict \
  --analyze-history \
  --identify-risks \
  --suggest-preventive
```

### Workflow Recommendations

```bash
# Get workflow recommendations
npx monobrain@latest actions recommend \
  --analyze-repo \
  --suggest-workflows \
  --industry-best-practices
```

### Automated Optimization

```bash
# Continuously optimize workflows
npx monobrain@latest actions auto-optimize \
  --monitor-performance \
  --apply-improvements \
  --track-savings
```

## Debugging & Troubleshooting

### Debug Mode

```yaml
- name: Debug Swarm
  run: |
    npx monobrain@latest actions debug \
      --verbose \
      --trace-agents \
      --export-logs
```

### Performance Profiling

```bash
# Profile workflow performance
npx monobrain@latest actions profile \
  --workflow "ci.yml" \
  --identify-slow-steps \
  --suggest-optimizations
```

## Advanced Swarm Workflow Automation

### Multi-Agent Pipeline Orchestration

```bash
# Initialize comprehensive workflow automation swarm
mcp__monobrain__swarm_init { topology: "mesh", maxAgents: 12 }
mcp__monobrain__agent_spawn { type: "coordinator", name: "Workflow Coordinator" }
mcp__monobrain__agent_spawn { type: "architect", name: "Pipeline Architect" }
mcp__monobrain__agent_spawn { type: "coder", name: "Workflow Developer" }
mcp__monobrain__agent_spawn { type: "tester", name: "CI/CD Tester" }
mcp__monobrain__agent_spawn { type: "optimizer", name: "Performance Optimizer" }
mcp__monobrain__agent_spawn { type: "monitor", name: "Automation Monitor" }
mcp__monobrain__agent_spawn { type: "analyst", name: "Workflow Analyzer" }

```

### Intelligent Performance Monitoring

```bash
# Generate comprehensive workflow performance reports
mcp__monobrain__performance_report {
  format: "detailed",
  timeframe: "30d"
}

```

### Dynamic Workflow Generation

```javascript
// Swarm-powered workflow creation
const createIntelligentWorkflow = async (repoContext) => {
  // Initialize workflow generation swarm
  await mcp__monobrain__swarm_init({ topology: "hierarchical", maxAgents: 8 });

  // Spawn specialized workflow agents
  await mcp__monobrain__agent_spawn({
    type: "architect",
    name: "Workflow Architect",
  });
  await mcp__monobrain__agent_spawn({ type: "coder", name: "YAML Generator" });
  await mcp__monobrain__agent_spawn({
    type: "optimizer",
    name: "Performance Optimizer",
  });
  await mcp__monobrain__agent_spawn({
    type: "tester",
    name: "Workflow Validator",
  });

  // Create adaptive workflow based on repository analysis
  const workflow = await mcp__monobrain__workflow_create({
    name: "Intelligent CI/CD Pipeline",
    steps: [
      {
        name: "Smart Code Analysis",
        agents: ["analyzer", "security_scanner"],
        parallel: true,
      },
      {
        name: "Adaptive Testing",
        agents: ["unit_tester", "integration_tester", "e2e_tester"],
        strategy: "based_on_changes",
      },
      {
        name: "Intelligent Deployment",
        agents: ["deployment_manager", "rollback_coordinator"],
        conditions: ["all_tests_pass", "security_approved"],
      },
    ],
    triggers: ["pull_request", "push_to_main", "scheduled_optimization"],
  });

  return workflow;
};
```

### Continuous Learning and Optimization

```bash
```

See also: [swarm-pr.md](./swarm-pr.md), [swarm-issue.md](./swarm-issue.md), [sync-coordinator.md](./sync-coordinator.md)
