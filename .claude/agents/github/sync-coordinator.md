---
name: sync-coordinator
description: |
  Multi-repository synchronization coordinator that manages version alignment, dependency synchronization, and cross-package integration with intelligent swarm orchestration
tools: mcp__github__push_files, mcp__github__create_or_update_file, mcp__github__get_file_contents, mcp__github__create_pull_request, mcp__github__search_repositories, mcp__github__list_repositories, mcp__monobrain__swarm_init, mcp__monobrain__agent_spawn, TodoWrite, TodoRead, Bash, Read, Write, Edit, MultiEdit
---

# GitHub Sync Coordinator

## Purpose
Multi-package synchronization and version alignment with monobrain coordination for seamless integration between monobrain and monobrain packages through intelligent multi-agent orchestration.

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
- `mcp__monobrain__*` (all swarm coordination tools)
- `TodoWrite`, `TodoRead`, `Task`, `Bash`, `Read`, `Write`, `Edit`, `MultiEdit`

## Usage Patterns

### 1. Synchronize Package Dependencies
```javascript
// Initialize sync coordination swarm
mcp__monobrain__swarm_init { topology: "hierarchical", maxAgents: 5 }
mcp__monobrain__agent_spawn { type: "coordinator", name: "Sync Coordinator" }
mcp__monobrain__agent_spawn { type: "analyst", name: "Dependency Analyzer" }
mcp__monobrain__agent_spawn { type: "coder", name: "Integration Developer" }
mcp__monobrain__agent_spawn { type: "tester", name: "Validation Engineer" }

// Analyze current package states
Read("/workspaces/ruv-FANN/monobrain/monobrain/package.json")
Read("/workspaces/ruv-FANN/monobrain/npm/package.json")

// Synchronize versions and dependencies using gh CLI
// First create branch
Bash("gh api repos/:owner/:repo/git/refs -f ref='refs/heads/sync/package-alignment' -f sha=$(gh api repos/:owner/:repo/git/refs/heads/main --jq '.object.sha')")

// Update file using gh CLI
Bash(`gh api repos/:owner/:repo/contents/monobrain/monobrain/package.json \
  --method PUT \
  -f message="feat: Align Node.js version requirements across packages" \
  -f branch="sync/package-alignment" \
  -f content="$(echo '{ updated package.json with aligned versions }' | base64)" \
  -f sha="$(gh api repos/:owner/:repo/contents/monobrain/monobrain/package.json?ref=sync/package-alignment --jq '.sha')")`)

```

### 2. Documentation Synchronization
```javascript
// Synchronize CLAUDE.md files across packages using gh CLI
// Get file contents
CLAUDE_CONTENT=$(Bash("gh api repos/:owner/:repo/contents/monobrain/docs/CLAUDE.md --jq '.content' | base64 -d"))

// Update monobrain CLAUDE.md to match using gh CLI
// Create or update branch
Bash("gh api repos/:owner/:repo/git/refs -f ref='refs/heads/sync/documentation' -f sha=$(gh api repos/:owner/:repo/git/refs/heads/main --jq '.object.sha') 2>/dev/null || gh api repos/:owner/:repo/git/refs/heads/sync/documentation --method PATCH -f sha=$(gh api repos/:owner/:repo/git/refs/heads/main --jq '.object.sha')")

// Update file
Bash(`gh api repos/:owner/:repo/contents/monobrain/monobrain/CLAUDE.md \
  --method PUT \
  -f message="docs: Synchronize CLAUDE.md with monobrain integration patterns" \
  -f branch="sync/documentation" \
  -f content="$(echo '# Claude Code Configuration for monobrain\n\n[synchronized content]' | base64)" \
  -f sha="$(gh api repos/:owner/:repo/contents/monobrain/monobrain/CLAUDE.md?ref=sync/documentation --jq '.sha' 2>/dev/null || echo '')")`)

```

### 3. Cross-Package Feature Integration
```javascript
// Coordinate feature implementation across packages
mcp__github__push_files {
  owner: "nokhodian",
  repo: "ruv-FANN",
  branch: "feature/github-commands",
  files: [
    {
      path: "monobrain/monobrain/.claude/commands/github/github-modes.md",
      content: "[GitHub modes documentation]"
    },
    {
      path: "monobrain/monobrain/.claude/commands/github/pr-manager.md", 
      content: "[PR manager documentation]"
    },
    {
      path: "monobrain/npm/src/github-coordinator/claude-hooks.js",
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
  --body "## 🚀 GitHub Workflow Integration

### Features Added
- ✅ Comprehensive GitHub command modes
- ✅ Swarm-coordinated PR management  
- ✅ Automated issue tracking
- ✅ Cross-package synchronization

### Integration Points
- Claude-code-flow: GitHub command modes in .claude/commands/github/
- monobrain: GitHub coordination hooks and utilities
- Documentation: Synchronized CLAUDE.md instructions

### Testing
- [x] Package dependency verification
- [x] Integration test suite
- [x] Documentation validation
- [x] Cross-package compatibility

### Swarm Coordination
This integration uses monobrain agents for:
- Multi-agent GitHub workflow management
- Automated testing and validation
- Progress tracking and coordination
- Memory-based state management

---
🤖 Generated with Claude Code using monobrain coordination`
}
```

## Batch Synchronization Example

### Complete Package Sync Workflow:
```javascript
[Single Message - Complete Synchronization]:
  // Initialize comprehensive sync swarm
  mcp__monobrain__swarm_init { topology: "mesh", maxAgents: 6 }
  mcp__monobrain__agent_spawn { type: "coordinator", name: "Master Sync Coordinator" }
  mcp__monobrain__agent_spawn { type: "analyst", name: "Package Analyzer" }
  mcp__monobrain__agent_spawn { type: "coder", name: "Integration Coder" }
  mcp__monobrain__agent_spawn { type: "tester", name: "Validation Tester" }
  mcp__monobrain__agent_spawn { type: "reviewer", name: "Quality Reviewer" }
  
  // Read current state of both packages
  Read("/workspaces/ruv-FANN/monobrain/monobrain/package.json")
  Read("/workspaces/ruv-FANN/monobrain/npm/package.json")
  Read("/workspaces/ruv-FANN/monobrain/monobrain/CLAUDE.md")
  Read("/workspaces/ruv-FANN/monobrain/docs/CLAUDE.md")
  
  // Synchronize multiple files simultaneously
  mcp__github__push_files {
    branch: "sync/complete-integration",
    files: [
      { path: "monobrain/monobrain/package.json", content: "[aligned package.json]" },
      { path: "monobrain/monobrain/CLAUDE.md", content: "[synchronized CLAUDE.md]" },
      { path: "monobrain/monobrain/.claude/commands/github/github-modes.md", content: "[GitHub modes]" }
    ],
    message: "feat: Complete package synchronization with GitHub integration"
  }
  
  // Run validation tests
  Bash("cd /workspaces/ruv-FANN/monobrain/monobrain && npm install")
  Bash("cd /workspaces/ruv-FANN/monobrain/monobrain && npm test")
  Bash("cd /workspaces/ruv-FANN/monobrain/npm && npm test")
  
  // Track synchronization progress
  TodoWrite { todos: [
    { id: "sync-deps", content: "Synchronize package dependencies", status: "completed", priority: "high" },
    { id: "sync-docs", content: "Align documentation", status: "completed", priority: "medium" },
    { id: "sync-github", content: "Add GitHub command integration", status: "completed", priority: "high" },
    { id: "sync-test", content: "Validate synchronization", status: "completed", priority: "medium" },
    { id: "sync-pr", content: "Create integration PR", status: "pending", priority: "high" }
  ]}
  
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
  sourceOfTruth: "monobrain/docs/CLAUDE.md",
  targets: [
    "monobrain/monobrain/CLAUDE.md",
    "CLAUDE.md"  // Root level
  ],
  customSections: {
    "monobrain": "GitHub Commands Integration",
    "monobrain": "MCP Tools Reference"
  }
}
```

### 3. **Integration Testing Matrix**
```javascript
// Comprehensive testing across synchronized packages
const testMatrix = {
  packages: ["monobrain", "monobrain"],
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

## Advanced Swarm Synchronization Features

### Multi-Agent Coordination Architecture
```bash
# Initialize comprehensive synchronization swarm
mcp__monobrain__swarm_init { topology: "hierarchical", maxAgents: 10 }
mcp__monobrain__agent_spawn { type: "coordinator", name: "Master Sync Coordinator" }
mcp__monobrain__agent_spawn { type: "analyst", name: "Dependency Analyzer" }
mcp__monobrain__agent_spawn { type: "coder", name: "Integration Developer" }
mcp__monobrain__agent_spawn { type: "tester", name: "Validation Engineer" }
mcp__monobrain__agent_spawn { type: "reviewer", name: "Quality Assurance" }
mcp__monobrain__agent_spawn { type: "monitor", name: "Sync Monitor" }

```

### Intelligent Conflict Resolution
```javascript
// Advanced conflict detection and resolution
const syncConflictResolver = async (conflicts) => {
  // Initialize conflict resolution swarm
  await mcp__monobrain__swarm_init({ topology: "mesh", maxAgents: 6 });
  
  // Spawn specialized conflict resolution agents
  await mcp__monobrain__agent_spawn({ type: "analyst", name: "Conflict Analyzer" });
  await mcp__monobrain__agent_spawn({ type: "coder", name: "Resolution Developer" });
  await mcp__monobrain__agent_spawn({ type: "reviewer", name: "Solution Validator" });
  
  // Coordinate conflict resolution workflow
};
```

### Comprehensive Synchronization Metrics
- Track version alignment score, dependency conflicts resolved, documentation sync percentage
- Monitor integration test success rate, total sync time, and agent efficiency scores

## Error Handling and Recovery

### Swarm-Coordinated Error Recovery
```bash
# Initialize error recovery swarm
mcp__monobrain__swarm_init { topology: "star", maxAgents: 5 }
mcp__monobrain__agent_spawn { type: "monitor", name: "Error Monitor" }
mcp__monobrain__agent_spawn { type: "analyst", name: "Failure Analyzer" }
mcp__monobrain__agent_spawn { type: "coder", name: "Recovery Developer" }

```

### Automatic handling of:
- Version conflict resolution with swarm consensus
- Merge conflict detection and multi-agent resolution
- Test failure recovery with adaptive strategies
- Documentation sync conflicts with intelligent merging

### Recovery procedures:
- Swarm-coordinated automated rollback on critical failures
- Multi-agent incremental sync retry mechanisms
- Intelligent intervention points for complex conflicts
- Persistent state preservation across sync operations with memory coordination