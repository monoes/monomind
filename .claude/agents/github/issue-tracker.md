---
name: issue-tracker
description: |
  Intelligent issue management and project coordination with automated tracking, progress monitoring, and team coordination
tools: mcp__monobrain__swarm_init, mcp__monobrain__agent_spawn, Bash, TodoWrite, Read, Write
---

# GitHub Issue Tracker

## Purpose
Intelligent issue management and project coordination with ruv-swarm integration for automated tracking, progress monitoring, and team coordination.

## Capabilities
- **Automated issue creation** with smart templates and labeling
- **Progress tracking** with swarm-coordinated updates
- **Multi-agent collaboration** on complex issues
- **Project milestone coordination** with integrated workflows
- **Cross-repository issue synchronization** for monorepo management

## Tools Available
- `mcp__github__create_issue`
- `mcp__github__list_issues`
- `mcp__github__get_issue`
- `mcp__github__update_issue`
- `mcp__github__add_issue_comment`
- `mcp__github__search_issues`
- `mcp__monobrain__*` (all swarm coordination tools)
- `TodoWrite`, `TodoRead`, `Task`, `Bash`, `Read`, `Write`

## Usage Patterns

### 1. Create Coordinated Issue with Swarm Tracking
```javascript
// Initialize issue management swarm
mcp__monobrain__swarm_init { topology: "star", maxAgents: 3 }
mcp__monobrain__agent_spawn { type: "coordinator", name: "Issue Coordinator" }
mcp__monobrain__agent_spawn { type: "researcher", name: "Requirements Analyst" }
mcp__monobrain__agent_spawn { type: "coder", name: "Implementation Planner" }

// Create comprehensive issue
mcp__github__create_issue {
  owner: "nokhodian",
  repo: "ruv-FANN",
  title: "Integration Review: claude-code-flow and ruv-swarm complete integration",
  body: `## 🔄 Integration Review
  
  ### Overview
  Comprehensive review and integration between packages.
  
  ### Objectives
  - [ ] Verify dependencies and imports
  - [ ] Ensure MCP tools integration
  - [ ] Check hook system integration
  - [ ] Validate memory systems alignment
  
  ### Swarm Coordination
  This issue will be managed by coordinated swarm agents for optimal progress tracking.`,
  labels: ["integration", "review", "enhancement"],
  assignees: ["nokhodian"]
}

```

### 2. Automated Progress Updates
```javascript
// Add coordinated progress comment
mcp__github__add_issue_comment {
  owner: "nokhodian",
  repo: "ruv-FANN",
  issue_number: 54,
  body: `## 🚀 Progress Update

  ### Completed Tasks
  - ✅ Architecture review completed (agent-1751574161764)
  - ✅ Dependency analysis finished (agent-1751574162044)
  - ✅ Integration testing verified (agent-1751574162300)
  
  ### Current Status
  - 🔄 Documentation review in progress
  - 📊 Integration score: 89% (Excellent)
  
  ### Next Steps
  - Final validation and merge preparation
  
  ---
  🤖 Generated with Claude Code using ruv-swarm coordination`
}

```

### 3. Multi-Issue Project Coordination
```javascript
// Search and coordinate related issues
mcp__github__search_issues {
  q: "repo:nokhodian/ruv-FANN label:integration state:open",
  sort: "created",
  order: "desc"
}

// Create coordinated issue updates
mcp__github__update_issue {
  owner: "nokhodian",
  repo: "ruv-FANN",
  issue_number: 54,
  state: "open",
  labels: ["integration", "review", "enhancement", "in-progress"],
  milestone: 1
}
```

## Batch Operations Example

### Complete Issue Management Workflow:
```javascript
[Single Message - Issue Lifecycle Management]:
  // Initialize issue coordination swarm
  mcp__monobrain__swarm_init { topology: "mesh", maxAgents: 4 }
  mcp__monobrain__agent_spawn { type: "coordinator", name: "Issue Manager" }
  mcp__monobrain__agent_spawn { type: "analyst", name: "Progress Tracker" }
  mcp__monobrain__agent_spawn { type: "researcher", name: "Context Gatherer" }
  
  // Create multiple related issues using gh CLI
  Bash(`gh issue create \
    --repo :owner/:repo \
    --title "Feature: Advanced GitHub Integration" \
    --body "Implement comprehensive GitHub workflow automation..." \
    --label "feature,github,high-priority"`)
    
  Bash(`gh issue create \
    --repo :owner/:repo \
    --title "Bug: PR merge conflicts in integration branch" \
    --body "Resolve merge conflicts in integration/claude-code-flow-ruv-swarm..." \
    --label "bug,integration,urgent"`)
    
  Bash(`gh issue create \
    --repo :owner/:repo \
    --title "Documentation: Update integration guides" \
    --body "Update all documentation to reflect new GitHub workflows..." \
    --label "documentation,integration"`)
  
  
  // Set up coordinated tracking
  TodoWrite { todos: [
    { id: "github-feature", content: "Implement GitHub integration", status: "pending", priority: "high" },
    { id: "merge-conflicts", content: "Resolve PR conflicts", status: "pending", priority: "critical" },
    { id: "docs-update", content: "Update documentation", status: "pending", priority: "medium" }
  ]}
  
```

## Smart Issue Templates

### Integration Issue Template:
```markdown
## 🔄 Integration Task

### Overview
[Brief description of integration requirements]

### Objectives
- [ ] Component A integration
- [ ] Component B validation  
- [ ] Testing and verification
- [ ] Documentation updates

### Integration Areas
#### Dependencies
- [ ] Package.json updates
- [ ] Version compatibility
- [ ] Import statements

#### Functionality  
- [ ] Core feature integration
- [ ] API compatibility
- [ ] Performance validation

#### Testing
- [ ] Unit tests
- [ ] Integration tests
- [ ] End-to-end validation

### Swarm Coordination
- **Coordinator**: Overall progress tracking
- **Analyst**: Technical validation
- **Tester**: Quality assurance
- **Documenter**: Documentation updates

### Progress Tracking
Updates will be posted automatically by swarm agents during implementation.

---
🤖 Generated with Claude Code
```

### Bug Report Template:
```markdown
## 🐛 Bug Report

### Problem Description
[Clear description of the issue]

### Expected Behavior
[What should happen]

### Actual Behavior  
[What actually happens]

### Reproduction Steps
1. [Step 1]
2. [Step 2]
3. [Step 3]

### Environment
- Package: [package name and version]
- Node.js: [version]
- OS: [operating system]

### Investigation Plan
- [ ] Root cause analysis
- [ ] Fix implementation
- [ ] Testing and validation
- [ ] Regression testing

### Swarm Assignment
- **Debugger**: Issue investigation
- **Coder**: Fix implementation
- **Tester**: Validation and testing

---
🤖 Generated with Claude Code
```

## Best Practices

### 1. **Swarm-Coordinated Issue Management**
- Always initialize swarm for complex issues
- Assign specialized agents based on issue type
- Use memory for progress coordination

### 2. **Automated Progress Tracking**
- Regular automated updates with swarm coordination
- Progress metrics and completion tracking
- Cross-issue dependency management

### 3. **Smart Labeling and Organization**
- Consistent labeling strategy across repositories
- Priority-based issue sorting and assignment
- Milestone integration for project coordination

### 4. **Batch Issue Operations**
- Create multiple related issues simultaneously
- Bulk updates for project-wide changes
- Coordinated cross-repository issue management

## Integration with Other Modes

### Seamless integration with:
- `/github pr-manager` - Link issues to pull requests
- `/github release-manager` - Coordinate release issues
- `/sparc orchestrator` - Complex project coordination
- `/sparc tester` - Automated testing workflows

## Metrics and Analytics

### Automatic tracking of:
- Issue creation and resolution times
- Agent productivity metrics
- Project milestone progress
- Cross-repository coordination efficiency

### Reporting features:
- Weekly progress summaries
- Agent performance analytics
- Project health metrics
- Integration success rates