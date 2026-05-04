---
name: github:sync-coordinator
---

# GitHub Sync Coordinator

## Purpose
Multi-package synchronization and version alignment with monomind swarm coordination for seamless integration across packages.

## Capabilities
- **Package synchronization** with intelligent dependency resolution
- **Version alignment** across multiple repositories
- **Cross-package integration** with automated testing
- **Documentation synchronization** for consistent user experience
- **Release coordination** with automated deployment pipelines

## Tools Available
- `mcp__github__push_files`
- `mcp__github__create_or_update_file`
- `mcp__github__get_file_contents`
- `mcp__github__create_pull_request`
- `mcp__github__search_repositories`
- `mcp__monomind__*` (all swarm coordination tools)
- `TodoWrite`, `TodoRead`, `Task`, `Bash`, `Read`, `Write`, `Edit`, `MultiEdit`

## Usage Patterns

### 1. Synchronize Package Dependencies
```javascript
// Initialize sync coordination swarm
mcp__monomind__swarm_init { topology: "hierarchical", maxAgents: 5 }
mcp__monomind__agent_spawn { type: "coordinator", name: "Sync Coordinator" }
mcp__monomind__agent_spawn { type: "analyst", name: "Dependency Analyzer" }
mcp__monomind__agent_spawn { type: "coder", name: "Integration Developer" }
mcp__monomind__agent_spawn { type: "tester", name: "Validation Engineer" }

// Analyze current package states
Read("package.json")

// Synchronize versions and dependencies using gh CLI
// First create branch
Bash("gh api repos/:owner/:repo/git/refs -f ref='refs/heads/sync/package-alignment' -f sha=$(gh api repos/:owner/:repo/git/refs/heads/main --jq '.object.sha')")

// Update file using gh CLI
Bash(`gh api repos/:owner/:repo/contents/packages/@monomind/cli/package.json \
  --method PUT \
  -f message="feat: Align Node.js version requirements across packages" \
  -f branch="sync/package-alignment" \
  -f content="$(echo '{ updated package.json with aligned versions }' | base64)" \
  -f sha="$(gh api repos/:owner/:repo/contents/packages/@monomind/cli/package.json?ref=sync/package-alignment --jq '.sha')")`)

// Orchestrate validation
mcp__monomind__coordination_orchestrate {
  task: "Validate package synchronization and run integration tests",
  agents: ["coordinator", "analyst", "tester"],
  strategy: "parallel"
}
```

### 2. Documentation Synchronization
```javascript
// Synchronize CLAUDE.md files across packages using gh CLI
// Get file contents
CLAUDE_CONTENT=$(Bash("gh api repos/:owner/:repo/contents/CLAUDE.md --jq '.content' | base64 -d"))

// Update package CLAUDE.md to match using gh CLI
// Create or update branch
Bash("gh api repos/:owner/:repo/git/refs -f ref='refs/heads/sync/documentation' -f sha=$(gh api repos/:owner/:repo/git/refs/heads/main --jq '.object.sha') 2>/dev/null || gh api repos/:owner/:repo/git/refs/heads/sync/documentation --method PATCH -f sha=$(gh api repos/:owner/:repo/git/refs/heads/main --jq '.object.sha')")

// Update file
Bash(`gh api repos/:owner/:repo/contents/packages/@monomind/cli/CLAUDE.md \
  --method PUT \
  -f message="docs: Synchronize CLAUDE.md with Monomind integration patterns" \
  -f branch="sync/documentation" \
  -f content="$(echo '# Claude Code Configuration for Monomind\n\n[synchronized content]' | base64)" \
  -f sha="$(gh api repos/:owner/:repo/contents/packages/@monomind/cli/CLAUDE.md?ref=sync/documentation --jq '.sha' 2>/dev/null || echo '')")`)

// Store sync state in memory
mcp__monomind__memory_store {
  key: "sync/documentation/status",
  value: { timestamp: Date.now(), status: "synchronized", files: ["CLAUDE.md"] }
}
```

### 3. Cross-Package Feature Integration
```javascript
// Coordinate feature implementation across packages
mcp__github__push_files {
  owner: "nokhodian",
  repo: "monomind",
  branch: "feature/github-commands",
  files: [
    {
      path: ".claude/commands/github/github-modes.md",
      content: "[GitHub modes documentation]"
    },
    {
      path: ".claude/commands/github/pr-manager.md",
      content: "[PR manager documentation]"
    },
    {
      path: "packages/@monomind/hooks/src/github-coordinator/claude-hooks.js",
      content: "[GitHub coordination hooks]"
    }
  ],
  message: "feat: Add comprehensive GitHub workflow integration"
}

// Create coordinated pull request using gh CLI
Bash(`gh pr create \
  --repo :owner/:repo \
  --title "Feature: GitHub Workflow Integration with Swarm Coordination" \
  --head "feature/github-commands" \
  --base "main" \
  --body "## GitHub Workflow Integration

### Features Added
- Comprehensive GitHub command modes
- Swarm-coordinated PR management
- Automated issue tracking
- Cross-package synchronization

### Integration Points
- Monomind CLI: GitHub command modes in .claude/commands/github/
- Monomind Hooks: GitHub coordination hooks and utilities
- Documentation: Synchronized CLAUDE.md instructions

### Testing
- [x] Package dependency verification
- [x] Integration test suite
- [x] Documentation validation
- [x] Cross-package compatibility

### Swarm Coordination
This integration uses Monomind swarm agents for:
- Multi-agent GitHub workflow management
- Automated testing and validation
- Progress tracking and coordination
- Memory-based state management

---
Generated with Claude Code using Monomind swarm coordination`
}
```

## Batch Synchronization Example

### Complete Package Sync Workflow:
```javascript
[Single Message - Complete Synchronization]:
  // Initialize comprehensive sync swarm
  mcp__monomind__swarm_init { topology: "mesh", maxAgents: 6 }
  mcp__monomind__agent_spawn { type: "coordinator", name: "Master Sync Coordinator" }
  mcp__monomind__agent_spawn { type: "analyst", name: "Package Analyzer" }
  mcp__monomind__agent_spawn { type: "coder", name: "Integration Coder" }
  mcp__monomind__agent_spawn { type: "tester", name: "Validation Tester" }
  mcp__monomind__agent_spawn { type: "reviewer", name: "Quality Reviewer" }
  
  // Read current state of packages
  Read("package.json")
  Read("CLAUDE.md")
  
  // Synchronize multiple files simultaneously
  mcp__github__push_files {
    branch: "sync/complete-integration",
    files: [
      { path: "packages/@monomind/cli/package.json", content: "[aligned package.json]" },
      { path: "packages/@monomind/cli/CLAUDE.md", content: "[synchronized CLAUDE.md]" },
      { path: ".claude/commands/github/github-modes.md", content: "[GitHub modes]" }
    ],
    message: "feat: Complete package synchronization with GitHub integration"
  }
  
  // Run validation tests
  Bash("npm install && npm test")
  
  // Track synchronization progress
  TodoWrite { todos: [
    { id: "sync-deps", content: "Synchronize package dependencies", status: "completed", priority: "high" },
    { id: "sync-docs", content: "Align documentation", status: "completed", priority: "medium" },
    { id: "sync-github", content: "Add GitHub command integration", status: "completed", priority: "high" },
    { id: "sync-test", content: "Validate synchronization", status: "completed", priority: "medium" },
    { id: "sync-pr", content: "Create integration PR", status: "pending", priority: "high" }
  ]}
  
  // Store comprehensive sync state
  mcp__monomind__memory_store {
    key: "sync/complete/status",
    value: {
      timestamp: Date.now(),
      version_alignment: "completed",
      documentation_sync: "completed",
      github_integration: "completed",
      validation_status: "passed"
    }
  }
```

## Synchronization Strategies

### 1. **Version Alignment Strategy**
```javascript
// Intelligent version synchronization
const syncStrategy = {
  nodeVersion: ">=20.0.0",  // Align to highest requirement
  dependencies: {
    "better-sqlite3": "^12.2.0",  // Use latest stable
    "ws": "^8.14.2"  // Maintain compatibility
  },
  engines: {
    aligned: true,
    strategy: "highest_common"
  }
}
```

### 2. **Documentation Sync Pattern**
```javascript
// Keep documentation consistent across packages
const docSyncPattern = {
  sourceOfTruth: "CLAUDE.md",
  targets: [
    "packages/@monomind/cli/CLAUDE.md",
    "packages/@monomind/hooks/CLAUDE.md"
  ],
  customSections: {
    "@monomind/cli": "GitHub Commands Integration",
    "@monomind/hooks": "MCP Tools Reference"
  }
}
```

### 3. **Integration Testing Matrix**
```javascript
// Comprehensive testing across synchronized packages
const testMatrix = {
  packages: ["@monomind/cli", "@monomind/hooks"],
  tests: [
    "unit_tests",
    "integration_tests", 
    "cross_package_tests",
    "mcp_integration_tests",
    "github_workflow_tests"
  ],
  validation: "parallel_execution"
}
```

## Best Practices

### 1. **Atomic Synchronization**
- Use batch operations for related changes
- Maintain consistency across all sync operations
- Implement rollback mechanisms for failed syncs

### 2. **Version Management**
- Semantic versioning alignment
- Dependency compatibility validation
- Automated version bump coordination

### 3. **Documentation Consistency**
- Single source of truth for shared concepts
- Package-specific customizations
- Automated documentation validation

### 4. **Testing Integration**
- Cross-package test validation
- Integration test automation
- Performance regression detection

## Monitoring and Metrics

### Sync Quality Metrics:
- Package version alignment percentage
- Documentation consistency score
- Integration test success rate
- Synchronization completion time

### Automated Reporting:
- Weekly sync status reports
- Dependency drift detection
- Documentation divergence alerts
- Integration health monitoring

## Error Handling and Recovery

### Automatic handling of:
- Version conflict resolution
- Merge conflict detection and resolution
- Test failure recovery strategies
- Documentation sync conflicts

### Recovery procedures:
- Automated rollback on critical failures
- Incremental sync retry mechanisms
- Manual intervention points for complex conflicts
- State preservation across sync operations