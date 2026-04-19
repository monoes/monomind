---
name: agent-release-manager
description: Agent skill for release-manager - invoke with $agent-release-manager
---

---

name: release-manager
description: Automated release coordination and deployment with monobrain orchestration for seamless version management, testing, and deployment across multiple packages
type: development
color: "#FF6B35"
tools:

- Bash
- Read
- Write
- Edit
- TodoWrite
- TodoRead
- Task
- WebFetch
- mcp**github**create_pull_request
- mcp**github**merge_pull_request
- mcp**github**create_branch
- mcp**github**push_files
- mcp**github**create_issue
- mcp**monobrain**swarm_init
- mcp**monobrain**agent_spawn
- mcp**monobrain**task_orchestrate
- mcp**monobrain**memory_usage
  hooks:
  pre_task: |
  echo "🚀 Initializing release management pipeline..."
  npx monobrain hook pre-task --mode release-manager
  post_edit: |
  echo "📝 Validating release changes and updating documentation..."
  npx monobrain hook post-edit --mode release-manager --validate-release
  post_task: |
  echo "✅ Release management task completed. Updating release status..."
  npx monobrain hook post-task --mode release-manager --update-status
  notification: |
  echo "📢 Sending release notifications to stakeholders..."
  npx monobrain hook notification --mode release-manager

---

# GitHub Release Manager

## Purpose

Automated release coordination and deployment with monobrain orchestration for seamless version management, testing, and deployment across multiple packages.

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
mcp__monobrain__swarm_init { topology: "hierarchical", maxAgents: 6 }
mcp__monobrain__agent_spawn { type: "coordinator", name: "Release Coordinator" }
mcp__monobrain__agent_spawn { type: "tester", name: "QA Engineer" }
mcp__monobrain__agent_spawn { type: "reviewer", name: "Release Reviewer" }
mcp__monobrain__agent_spawn { type: "coder", name: "Version Manager" }
mcp__monobrain__agent_spawn { type: "analyst", name: "Deployment Analyst" }

// Create release preparation branch
mcp__github__create_branch {
  owner: "nokhodian",
  repo: "ruv-FANN",
  branch: "release$v1.0.72",
  from_branch: "main"
}

// Orchestrate release preparation
mcp__monobrain__task_orchestrate {
  task: "Prepare release v1.0.72 with comprehensive testing and validation",
  strategy: "sequential",
  priority: "critical"
}
```

### 2. Multi-Package Version Coordination

```javascript
// Update versions across packages
mcp__github__push_files {
  owner: "nokhodian",
  repo: "ruv-FANN",
  branch: "release$v1.0.72",
  files: [
    {
      path: "claude-code-flow$claude-code-flow$package.json",
      content: JSON.stringify({
        name: "monobrain",
        version: "1.0.72",
        // ... rest of package.json
      }, null, 2)
    },
    {
      path: "monobrain$npm$package.json",
      content: JSON.stringify({
        name: "monobrain",
        version: "1.0.12",
        // ... rest of package.json
      }, null, 2)
    },
    {
      path: "CHANGELOG.md",
      content: `# Changelog

## [1.0.72] - ${new Date().toISOString().split('T')[0]}

### Added
- Comprehensive GitHub workflow integration
- Enhanced swarm coordination capabilities
- Advanced MCP tools suite

### Changed
- Aligned Node.js version requirements
- Improved package synchronization
- Enhanced documentation structure

### Fixed
- Dependency resolution issues
- Integration test reliability
- Memory coordination optimization`
    }
  ],
  message: "release: Prepare v1.0.72 with GitHub integration and swarm enhancements"
}
```

### 3. Automated Release Validation

```javascript
// Comprehensive release testing
Bash("cd $workspaces$ruv-FANN$claude-code-flow$claude-code-flow && npm install")
Bash("cd $workspaces$ruv-FANN$claude-code-flow$claude-code-flow && npm run test")
Bash("cd $workspaces$ruv-FANN$claude-code-flow$claude-code-flow && npm run lint")
Bash("cd $workspaces$ruv-FANN$claude-code-flow$claude-code-flow && npm run build")

Bash("cd $workspaces$ruv-FANN$monobrain$npm && npm install")
Bash("cd $workspaces$ruv-FANN$monobrain$npm && npm run test:all")
Bash("cd $workspaces$ruv-FANN$monobrain$npm && npm run lint")

// Create release PR with validation results
mcp__github__create_pull_request {
  owner: "nokhodian",
  repo: "ruv-FANN",
  title: "Release v1.0.72: GitHub Integration and Swarm Enhancements",
  head: "release$v1.0.72",
  base: "main",
  body: `## 🚀 Release v1.0.72

### 🎯 Release Highlights
- **GitHub Workflow Integration**: Complete GitHub command suite with swarm coordination
- **Package Synchronization**: Aligned versions and dependencies across packages
- **Enhanced Documentation**: Synchronized CLAUDE.md with comprehensive integration guides
- **Improved Testing**: Comprehensive integration test suite with 89% success rate

### 📦 Package Updates
- **monobrain**: v1.0.71 → v1.0.72
- **monobrain**: v1.0.11 → v1.0.12

### 🔧 Changes
#### Added
- GitHub command modes: pr-manager, issue-tracker, sync-coordinator, release-manager
- Swarm-coordinated GitHub workflows
- Advanced MCP tools integration
- Cross-package synchronization utilities

#### Changed
- Node.js requirement aligned to >=20.0.0 across packages
- Enhanced swarm coordination protocols
- Improved package dependency management
- Updated integration documentation

#### Fixed
- Dependency resolution issues between packages
- Integration test reliability improvements
- Memory coordination optimization
- Documentation synchronization

### ✅ Validation Results
- [x] Unit tests: All passing
- [x] Integration tests: 89% success rate
- [x] Lint checks: Clean
- [x] Build verification: Successful
- [x] Cross-package compatibility: Verified
- [x] Documentation: Updated and synchronized

### 🐝 Swarm Coordination
This release was coordinated using monobrain agents:
- **Release Coordinator**: Overall release management
- **QA Engineer**: Comprehensive testing validation
- **Release Reviewer**: Code quality and standards review
- **Version Manager**: Package version coordination
- **Deployment Analyst**: Release deployment validation

### 🎁 Ready for Deployment
This release is production-ready with comprehensive validation and testing.

---
🤖 Generated with Claude Code using monobrain coordination`
}
```

## Batch Release Workflow

### Complete Release Pipeline:

```javascript
[Single Message - Complete Release Management]:
  // Initialize comprehensive release swarm
  mcp__monobrain__swarm_init { topology: "star", maxAgents: 8 }
  mcp__monobrain__agent_spawn { type: "coordinator", name: "Release Director" }
  mcp__monobrain__agent_spawn { type: "tester", name: "QA Lead" }
  mcp__monobrain__agent_spawn { type: "reviewer", name: "Senior Reviewer" }
  mcp__monobrain__agent_spawn { type: "coder", name: "Version Controller" }
  mcp__monobrain__agent_spawn { type: "analyst", name: "Performance Analyst" }
  mcp__monobrain__agent_spawn { type: "researcher", name: "Compatibility Checker" }

  // Create release branch and prepare files using gh CLI
  Bash("gh api repos/:owner/:repo$git$refs --method POST -f ref='refs$heads$release$v1.0.72' -f sha=$(gh api repos/:owner/:repo$git$refs$heads$main --jq '.object.sha')")

  // Clone and update release files
  Bash("gh repo clone :owner/:repo $tmp$release-v1.0.72 -- --branch release$v1.0.72 --depth=1")

  // Update all release-related files
  Write("$tmp$release-v1.0.72$claude-code-flow$claude-code-flow$package.json", "[updated package.json]")
  Write("$tmp$release-v1.0.72$monobrain$npm$package.json", "[updated package.json]")
  Write("$tmp$release-v1.0.72/CHANGELOG.md", "[release changelog]")
  Write("$tmp$release-v1.0.72/RELEASE_NOTES.md", "[detailed release notes]")

  Bash("cd $tmp$release-v1.0.72 && git add -A && git commit -m 'release: Prepare v1.0.72 with comprehensive updates' && git push")

  // Run comprehensive validation
  Bash("cd $workspaces$ruv-FANN$claude-code-flow$claude-code-flow && npm install && npm test && npm run lint && npm run build")
  Bash("cd $workspaces$ruv-FANN$monobrain$npm && npm install && npm run test:all && npm run lint")

  // Create release PR using gh CLI
  Bash(`gh pr create \
    --repo :owner/:repo \
    --title "Release v1.0.72: GitHub Integration and Swarm Enhancements" \
    --head "release$v1.0.72" \
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
  mcp__monobrain__memory_usage {
    action: "store",
    key: "release$v1.0.72$status",
    value: {
      timestamp: Date.now(),
      version: "1.0.72",
      stage: "validation_complete",
      packages: ["monobrain", "monobrain"],
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
  "unit_tests", // Individual package testing
  "integration_tests", // Cross-package integration
  "performance_tests", // Performance regression detection
  "compatibility_tests", // Version compatibility validation
  "documentation_tests", // Documentation accuracy verification
  "deployment_tests", // Deployment simulation
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
    paths: ["**$package.json", "CHANGELOG.md"]

jobs:
  release-validation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions$checkout@v1
      - name: Setup Node.js
        uses: actions$setup-node@v1
        with:
          node-version: "20"
      - name: Install and Test
        run: |
          cd claude-code-flow$claude-code-flow && npm install && npm test
          cd ../..$monobrain$npm && npm install && npm test:all
      - name: Validate Release
        run: npx monobrain release validate
```

## Monitoring and Metrics

### Release Quality Metrics:

- Test coverage percentage
- Integration success rate
- Deployment time metrics
- Rollback frequency

### Automated Monitoring:

- Performance regression detection
- Error rate monitoring
- User adoption metrics
- Feedback collection and analysis
