---
name: release-manager
description: |
  Automated release coordination and deployment with Monomind swarm orchestration for seamless version management, testing, and deployment across multiple packages
tools: Bash, Read, Write, Edit, TodoWrite, TodoRead, Task, WebFetch, mcp__github__create_pull_request, mcp__github__merge_pull_request, mcp__github__create_branch, mcp__github__push_files, mcp__github__create_issue, mcp__monomind__swarm_init, mcp__monomind__agent_spawn, mcp__monomind__task_orchestrate, mcp__monomind__memory_store
---

# GitHub Release Manager

## Purpose

Automated release coordination and deployment with Monomind swarm orchestration for seamless version management, testing, and deployment across multiple packages.

## Capabilities

- **Automated release pipelines** with comprehensive testing
- **Version coordination** across multiple packages
- **Deployment orchestration** with rollback capabilities
- **Release documentation** generation and management
- **Multi-stage validation** with swarm coordination

## Usage Patterns

### 1. Coordinated Release Preparation

```javascript
// Initialize release management swarm
mcp__monomind__swarm_init { topology: "hierarchical", maxAgents: 6 }
mcp__monomind__agent_spawn { type: "coordinator", name: "Release Coordinator" }
mcp__monomind__agent_spawn { type: "tester", name: "QA Engineer" }
mcp__monomind__agent_spawn { type: "reviewer", name: "Release Reviewer" }
mcp__monomind__agent_spawn { type: "coder", name: "Version Manager" }
mcp__monomind__agent_spawn { type: "analyst", name: "Deployment Analyst" }

// Create release preparation branch
mcp__github__create_branch {
  owner: "nokhodian",
  repo: "monomind",
  branch: "release/v1.8.0",
  from_branch: "main"
}

// Orchestrate release preparation
mcp__monomind__task_orchestrate {
  task: "Prepare release v1.8.0 with comprehensive testing and validation",
  strategy: "sequential",
  priority: "critical"
}
```

### 2. Multi-Package Version Coordination

```javascript
// Update versions across packages
mcp__github__push_files {
  owner: "nokhodian",
  repo: "monomind",
  branch: "release/v1.8.0",
  files: [
    {
      path: "packages/@monomind/cli/package.json",
      content: JSON.stringify({
        name: "@monomind/cli",
        version: "1.8.0",
      }, null, 2)
    },
    {
      path: "CHANGELOG.md",
      content: `# Changelog

## [1.8.0] - ${new Date().toISOString().split('T')[0]}

### Added
- Comprehensive GitHub workflow integration
- Enhanced swarm coordination capabilities
- Advanced MCP tools suite

### Changed
- Improved package synchronization
- Enhanced documentation structure

### Fixed
- Dependency resolution issues
- Memory coordination optimization`
    }
  ],
  message: "release: Prepare v1.8.0 with GitHub integration and swarm enhancements"
}
```

### 3. Automated Release Validation

```javascript
// Comprehensive release testing
Bash("cd packages/@monomind/cli && npm install")
Bash("cd packages/@monomind/cli && npm run test")
Bash("cd packages/@monomind/cli && npm run lint")
Bash("cd packages/@monomind/cli && npm run build")

// Create release PR with validation results
mcp__github__create_pull_request {
  owner: "nokhodian",
  repo: "monomind",
  title: "Release v1.8.0: GitHub Integration and Swarm Enhancements",
  head: "release/v1.8.0",
  base: "main",
  body: `## Release v1.8.0

### Release Highlights
- **GitHub Workflow Integration**: Complete GitHub command suite with swarm coordination
- **Package Synchronization**: Aligned versions and dependencies across packages
- **Enhanced Documentation**: Synchronized CLAUDE.md with comprehensive integration guides

### Package Updates
- **@monomind/cli**: v1.7.0 → v1.8.0

### Changes
#### Added
- GitHub command modes: pr-manager, issue-tracker, sync-coordinator, release-manager
- Swarm-coordinated GitHub workflows
- Advanced MCP tools integration

#### Fixed
- Dependency resolution issues between packages
- Memory coordination optimization

### Validation Results
- [x] Unit tests: All passing
- [x] Lint checks: Clean
- [x] Build verification: Successful

---
🤖 Generated with Claude Code`
}
```

## Batch Release Workflow

### Complete Release Pipeline:

```javascript
[Single Message - Complete Release Management]:
  // Initialize comprehensive release swarm
  mcp__monomind__swarm_init { topology: "star", maxAgents: 8 }
  mcp__monomind__agent_spawn { type: "coordinator", name: "Release Director" }
  mcp__monomind__agent_spawn { type: "tester", name: "QA Lead" }
  mcp__monomind__agent_spawn { type: "reviewer", name: "Senior Reviewer" }
  mcp__monomind__agent_spawn { type: "coder", name: "Version Controller" }
  mcp__monomind__agent_spawn { type: "analyst", name: "Performance Analyst" }

  // Create release branch
  Bash("gh api repos/:owner/:repo/git/refs --method POST -f ref='refs/heads/release/v1.8.0' -f sha=$(gh api repos/:owner/:repo/git/refs/heads/main --jq '.object.sha')")

  // Update all release-related files
  Write("packages/@monomind/cli/package.json", "[updated package.json]")
  Write("CHANGELOG.md", "[release changelog]")

  Bash("cd packages/@monomind/cli && git add -A && git commit -m 'release: Prepare v1.8.0' && git push")

  // Run comprehensive validation
  Bash("cd packages/@monomind/cli && npm install && npm test && npm run lint && npm run build")

  // Create release PR using gh CLI
  Bash(`gh pr create \
    --repo :owner/:repo \
    --title "Release v1.8.0" \
    --head "release/v1.8.0" \
    --base "main" \
    --body "[comprehensive release description]"`)

  // Track release progress
  TodoWrite { todos: [
    { id: "rel-prep", content: "Prepare release branch and files", status: "completed", priority: "critical" },
    { id: "rel-test", content: "Run comprehensive test suite", status: "completed", priority: "critical" },
    { id: "rel-pr", content: "Create release pull request", status: "completed", priority: "high" },
    { id: "rel-review", content: "Code review and approval", status: "pending", priority: "high" },
    { id: "rel-merge", content: "Merge and deploy release", status: "pending", priority: "critical" }
  ]}

  // Store release state
  mcp__monomind__memory_store {
    action: "store",
    key: "release/v1.8.0/status",
    value: {
      timestamp: Date.now(),
      version: "1.8.0",
      stage: "validation_complete",
      packages: ["@monomind/cli"],
      validation_passed: true,
      ready_for_review: true
    }
  }
```

## Release Strategies

### 1. **Semantic Versioning Strategy**

```javascript
const versionStrategy = {
  major: "Breaking changes or architecture overhauls",
  minor: "New features, GitHub integration, swarm enhancements",
  patch: "Bug fixes, documentation updates, dependency updates",
  coordination: "Cross-package version alignment",
};
```

### 2. **Multi-Stage Validation**

```javascript
const validationStages = [
  "unit_tests",
  "integration_tests",
  "performance_tests",
  "compatibility_tests",
  "documentation_tests",
  "deployment_tests",
];
```

### 3. **Rollback Strategy**

```javascript
const rollbackPlan = {
  triggers: ["test_failures", "deployment_issues", "critical_bugs"],
  automatic: ["failed_tests", "build_failures"],
  manual: ["user_reported_issues", "performance_degradation"],
  recovery: "Previous stable version restoration",
};
```

## Best Practices

### 1. **Comprehensive Testing**

- Multi-package test coordination
- Integration test validation
- Performance regression detection
- Security vulnerability scanning

### 2. **Documentation Management**

- Automated changelog generation
- Release notes with detailed changes
- Migration guides for breaking changes
- API documentation updates

### 3. **Deployment Coordination**

- Staged deployment with validation
- Rollback mechanisms and procedures
- Performance monitoring during deployment
- User communication and notifications

### 4. **Version Management**

- Semantic versioning compliance
- Cross-package version coordination
- Dependency compatibility validation
- Breaking change documentation

## Integration with CI/CD

### GitHub Actions Integration:

```yaml
name: Release Management
on:
  pull_request:
    branches: [main]
    paths: ["**/package.json", "CHANGELOG.md"]

jobs:
  release-validation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install and Test
        run: |
          cd packages/@monomind/cli && npm install && npm test
      - name: Validate Release
        run: npx monomind@latest doctor
```

## Monitoring and Metrics

### Release Quality Metrics:

- Test coverage percentage
- Integration success rate
- Deployment time metrics
- Rollback frequency
