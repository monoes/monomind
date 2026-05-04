---
name: sparc-methodology
description: |
  SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) comprehensive development methodology with multi-agent orchestration
---

# SPARC Methodology - Comprehensive Development Framework

## Overview

SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) is a systematic development methodology integrated with Monomind's multi-agent orchestration capabilities. It provides 17 specialized modes for comprehensive software development, from initial research through deployment and monitoring.

## Table of Contents

1. [Core Philosophy](#core-philosophy)
2. [Development Phases](#development-phases)
3. [Available Modes](#available-modes)
4. [Activation Methods](#activation-methods)
5. [Orchestration Patterns](#orchestration-patterns)
6. [TDD Workflows](#tdd-workflows)
7. [Best Practices](#best-practices)
8. [Integration Examples](#integration-examples)
9. [Common Workflows](#common-workflows)

---

## Core Philosophy

SPARC methodology emphasizes:

- **Systematic Approach**: Structured phases from specification to completion
- **Test-Driven Development**: Tests written before implementation
- **Parallel Execution**: Concurrent agent coordination for 2.8-4.4x speed improvements
- **Memory Integration**: Persistent knowledge sharing across agents and sessions
- **Quality First**: Comprehensive reviews, testing, and validation
- **Modular Design**: Clean separation of concerns with clear interfaces

### Key Principles

1. **Specification Before Code**: Define requirements and constraints clearly
2. **Design Before Implementation**: Plan architecture and components
3. **Tests Before Features**: Write failing tests, then make them pass
4. **Review Everything**: Code quality, security, and performance checks
5. **Document Continuously**: Maintain current documentation throughout

---

## Development Phases

### Phase 1: Specification
**Goal**: Define requirements, constraints, and success criteria

- Requirements analysis
- User story mapping
- Constraint identification
- Success metrics definition
- Pseudocode planning

**Key Modes**: `researcher`, `analyzer`, `memory-manager`

### Phase 2: Architecture
**Goal**: Design system structure and component interfaces

- System architecture design
- Component interface definition
- Database schema planning
- API contract specification
- Infrastructure planning

**Key Modes**: `architect`, `designer`, `orchestrator`

### Phase 3: Refinement (TDD Implementation)
**Goal**: Implement features with test-first approach

- Write failing tests
- Implement minimum viable code
- Make tests pass
- Refactor for quality
- Iterate until complete

**Key Modes**: `tdd`, `coder`, `tester`

### Phase 4: Review
**Goal**: Ensure code quality, security, and performance

- Code quality assessment
- Security vulnerability scanning
- Performance profiling
- Best practices validation
- Documentation review

**Key Modes**: `reviewer`, `optimizer`, `debugger`

### Phase 5: Completion
**Goal**: Integration, deployment, and monitoring

- System integration
- Deployment automation
- Monitoring setup
- Documentation finalization
- Knowledge capture

**Key Modes**: `workflow-manager`, `documenter`, `memory-manager`

---

## Available Modes

### Core Orchestration Modes

#### `orchestrator`
Multi-agent task orchestration with TodoWrite/Task/Memory coordination.

**Capabilities**:
- Task decomposition into manageable units
- Agent coordination and resource allocation
- Progress tracking and result synthesis
- Adaptive strategy selection
- Cross-agent communication

**Usage**:
```javascript
Task("coordinate feature development", "coordinate feature development", "sparc-orchestrator")
}
```

#### `swarm-coordinator`
Specialized swarm management for complex multi-agent workflows.

**Capabilities**:
- Topology optimization (mesh, hierarchical, ring, star)
- Agent lifecycle management
- Dynamic scaling based on workload
- Fault tolerance and recovery
- Performance monitoring

#### `workflow-manager`
Process automation and workflow orchestration.

**Capabilities**:
- Workflow definition and execution
- Event-driven triggers
- Sequential and parallel pipelines
- State management
- Error handling and retry logic

#### `batch-executor`
Parallel task execution for high-throughput operations.

**Capabilities**:
- Concurrent file operations
- Batch processing optimization
- Resource pooling
- Load balancing
- Progress aggregation

---

### Development Modes

#### `coder`
Autonomous code generation with batch file operations.

**Capabilities**:
- Feature implementation
- Code refactoring
- Bug fixes and patches
- API development
- Algorithm implementation

**Quality Standards**:
- ES2022+ standards
- TypeScript type safety
- Comprehensive error handling
- Performance optimization
- Security best practices

**Usage**:
```javascript
Task("implement user authentication with JWT", "implement user authentication with JWT", "sparc-coder")
}
```

#### `architect`
System design with Memory-based coordination.

**Capabilities**:
- Microservices architecture
- Event-driven design
- Domain-driven design (DDD)
- Hexagonal architecture
- CQRS and Event Sourcing

**Memory Integration**:
- Store architectural decisions
- Share component specifications
- Maintain design consistency
- Track architectural evolution

**Design Patterns**:
- Layered architecture
- Microservices patterns
- Event-driven patterns
- Domain modeling
- Infrastructure as Code

**Usage**:
```javascript
Task("design scalable e-commerce platform", "design scalable e-commerce platform", "sparc-architect")
}
```

#### `tdd`
Test-driven development with comprehensive testing.

**Capabilities**:
- Test-first development
- Red-green-refactor cycle
- Test suite design
- Coverage optimization (target: 90%+)
- Continuous testing

**TDD Workflow**:
1. Write failing test (RED)
2. Implement minimum code
3. Make test pass (GREEN)
4. Refactor for quality (REFACTOR)
5. Repeat cycle

**Testing Strategies**:
- Unit testing (Jest, Mocha, Vitest)
- Integration testing
- End-to-end testing (Playwright, Cypress)
- Performance testing
- Security testing

**Usage**:
```javascript
Task("shopping cart feature with payment integration", "shopping cart feature with payment integration", "sparc-tdd")
}
```

#### `reviewer`
Code review using batch file analysis.

**Capabilities**:
- Code quality assessment
- Security vulnerability detection
- Performance analysis
- Best practices validation
- Documentation review

**Review Criteria**:
- Code correctness and logic
- Design pattern adherence
- Comprehensive error handling
- Test coverage adequacy
- Maintainability and readability
- Security vulnerabilities
- Performance bottlenecks

**Batch Analysis**:
- Parallel file review
- Pattern detection
- Dependency checking
- Consistency validation
- Automated reporting

**Usage**:
```javascript
Task("review authentication module PR #123", "review authentication module PR #123", "sparc-reviewer")
}
```

---

### Analysis and Research Modes

#### `researcher`
Deep research with parallel WebSearch/WebFetch and Memory coordination.

**Capabilities**:
- Comprehensive information gathering
- Source credibility evaluation
- Trend analysis and forecasting
- Competitive research
- Technology assessment

**Research Methods**:
- Parallel web searches
- Academic paper analysis
- Industry report synthesis
- Expert opinion gathering
- Statistical data compilation

**Memory Integration**:
- Store research findings with citations
- Build knowledge graphs
- Track information sources
- Cross-reference insights
- Maintain research history

**Usage**:
```javascript
Task("research microservices best practices 2024", "research microservices best practices 2024", "sparc-researcher")
}
```

#### `analyzer`
Code and data analysis with pattern recognition.

**Capabilities**:
- Static code analysis
- Dependency analysis
- Performance profiling
- Security scanning
- Data pattern recognition

#### `optimizer`
Performance optimization and bottleneck resolution.

**Capabilities**:
- Algorithm optimization
- Database query tuning
- Caching strategy design
- Bundle size reduction
- Memory leak detection

---

### Creative and Support Modes

#### `designer`
UI/UX design with accessibility focus.

**Capabilities**:
- Interface design
- User experience optimization
- Accessibility compliance (WCAG 2.1)
- Design system creation
- Responsive layout design

#### `innovator`
Creative problem-solving and novel solutions.

**Capabilities**:
- Brainstorming and ideation
- Alternative approach generation
- Technology evaluation
- Proof of concept development
- Innovation feasibility analysis

#### `documenter`
Comprehensive documentation generation.

**Capabilities**:
- API documentation (OpenAPI/Swagger)
- Architecture diagrams
- User guides and tutorials
- Code comments and JSDoc
- README and changelog maintenance

#### `debugger`
Systematic debugging and issue resolution.

**Capabilities**:
- Bug reproduction
- Root cause analysis
- Fix implementation
- Regression prevention
- Debug logging optimization

#### `tester`
Comprehensive testing beyond TDD.

**Capabilities**:
- Test suite expansion
- Edge case identification
- Performance testing
- Load testing
- Chaos engineering

#### `memory-manager`
Knowledge management and context preservation.

**Capabilities**:
- Cross-session memory persistence
- Knowledge graph construction
- Context restoration
- Learning pattern extraction
- Decision tracking

---

## Activation Methods

### Method 1: MCP Tools (Preferred in Claude Code)

**Best for**: Integrated Claude Code workflows with full orchestration capabilities

```javascript
// Basic mode execution
Task("<task description>", "<task description>", "sparc-<mode-name>")

// Initialize swarm for complex tasks
mcp__monomind__swarm_init {
  topology: "hierarchical",  // or "mesh", "ring", "star"
  strategy: "auto",           // or "balanced", "specialized", "adaptive"
  maxAgents: 8
}

// Spawn specialized agents
mcp__monomind__agent_spawn {
  type: "<agent-type>",
  capabilities: ["<capability1>", "<capability2>"]
}

// Monitor execution
mcp__monomind__swarm_monitor {
  swarmId: "current",
  interval: 5000
}
```

### Method 2: NPX CLI (Fallback)

**Best for**: Terminal usage or when MCP tools unavailable

```bash
# Execute specific mode
npx monomind sparc run <mode> "task description"

# Use alpha features
npx monomind@alpha sparc run <mode> "task description"

# List all available modes
npx monomind sparc modes

# Get help for specific mode
npx monomind sparc help <mode>

# Run with options
npx monomind sparc run <mode> "task" --parallel --monitor

# Execute TDD workflow
npx monomind sparc tdd "feature description"

# Batch execution
npx monomind sparc batch <mode1,mode2,mode3> "task"

# Pipeline execution
npx monomind sparc pipeline "task description"
```

### Method 3: Local Installation

**Best for**: Projects with local monomind installation

```bash
# If monomind is installed locally
npx monomind sparc run <mode> "task description"
```

---

## Orchestration Patterns

### Pattern 1: Hierarchical Coordination

**Best for**: Complex projects with clear delegation hierarchy

```javascript
// Initialize hierarchical swarm
mcp__monomind__swarm_init {
  topology: "hierarchical",
  maxAgents: 12
}

// Spawn coordinator
mcp__monomind__agent_spawn {
  type: "coordinator",
  capabilities: ["planning", "delegation", "monitoring"]
}

// Spawn specialized workers
mcp__monomind__agent_spawn { type: "architect" }
mcp__monomind__agent_spawn { type: "coder" }
mcp__monomind__agent_spawn { type: "tester" }
mcp__monomind__agent_spawn { type: "reviewer" }
```

### Pattern 2: Mesh Coordination

**Best for**: Collaborative tasks requiring peer-to-peer communication

```javascript
mcp__monomind__swarm_init {
  topology: "mesh",
  strategy: "balanced",
  maxAgents: 6
}
```

### Pattern 3: Sequential Pipeline

**Best for**: Ordered workflow execution (spec → design → code → test → review)

```javascript
mcp__monomind__workflow_create {
  name: "development-pipeline",
  steps: [
    { mode: "researcher", task: "gather requirements" },
    { mode: "architect", task: "design system" },
    { mode: "coder", task: "implement features" },
    { mode: "tdd", task: "create tests" },
    { mode: "reviewer", task: "review code" }
  ],
  triggers: ["on_step_complete"]
}
```

### Pattern 4: Parallel Execution

**Best for**: Independent tasks that can run concurrently

```javascript
// Use Task tool for parallel execution
Task("build backend", "build backend API", "sparc-coder")
Task("build frontend", "build frontend UI", "sparc-coder")
Task("build database", "set up database schema", "sparc-coder")
// tests depend on backend and frontend completing first
Task("run integration tests", "run full-stack integration tests", "sparc-tdd")
```

### Pattern 5: Adaptive Strategy

**Best for**: Dynamic workloads with changing requirements

```javascript
mcp__monomind__swarm_init {
  topology: "hierarchical",
  strategy: "adaptive",  // Auto-adjusts based on workload
  maxAgents: 20
}
```

---

## TDD Workflows

### Complete TDD Workflow

```javascript
// Step 1: Initialize TDD swarm
mcp__monomind__swarm_init {
  topology: "hierarchical",
  maxAgents: 8
}

// Step 2: Research and planning
Task("research testing best practices for feature X", "research testing best practices for feature X", "sparc-researcher")

// Step 3: Architecture design
Task("design testable architecture for feature X", "design testable architecture for feature X", "sparc-architect")

// Step 4: TDD implementation
Task("implement feature X with 90% coverage", "implement feature X with 90% coverage", "sparc-tdd")

// Step 5: Code review
Task("review feature X implementation", "review feature X implementation", "sparc-reviewer")

// Step 6: Optimization
Task("optimize feature X performance", "optimize feature X performance", "sparc-optimizer")
```

### Red-Green-Refactor Cycle

```javascript
// RED: Write failing test
Task("create failing test for shopping cart add item", "create failing test for shopping cart add item", "sparc-tester")

// GREEN: Minimal implementation
Task("implement minimal code to pass test", "implement minimal code to pass test", "sparc-coder")

// REFACTOR: Improve code quality
Task("refactor shopping cart implementation", "refactor shopping cart implementation", "sparc-coder")
```

---

## Best Practices

### 1. Memory Integration

**Always use Memory for cross-agent coordination**:

```javascript
// Store architectural decisions
mcp__monomind__memory_store({
  key: "architecture/api-design-v1",
  value: JSON.stringify(apiDesign)
})

// Retrieve in subsequent agents
mcp__monomind__memory_search({ query: "api-design-v1" })
```

### 2. Parallel Operations

**Batch all related operations in single message**:

```javascript
// ✅ CORRECT: All operations together
[Single Message]:
  mcp__monomind__agent_spawn { type: "researcher" }
  mcp__monomind__agent_spawn { type: "coder" }
  mcp__monomind__agent_spawn { type: "tester" }
  TodoWrite { todos: [8-10 todos] }

// ❌ WRONG: Multiple messages
Message 1: mcp__monomind__agent_spawn { type: "researcher" }
Message 2: mcp__monomind__agent_spawn { type: "coder" }
Message 3: TodoWrite { todos: [...] }
```

### 3. Hook Integration

**Every SPARC mode should use hooks**:

```bash
# Before work
npx monomind@alpha hooks pre-task --description "implement auth"

# During work
npx monomind@alpha hooks post-edit --file "auth.js"

# After work
npx monomind@alpha hooks post-task --task-id "task-123"
```

### 4. Test Coverage

**Maintain minimum 90% coverage**:

- Unit tests for all functions
- Integration tests for APIs
- E2E tests for critical flows
- Edge case coverage
- Error path testing

### 5. Documentation

**Document as you build**:

- API documentation (OpenAPI)
- Architecture decision records (ADR)
- Code comments for complex logic
- README with setup instructions
- Changelog for version tracking

### 6. File Organization

**Never save to root folder**:

```
project/
├── src/           # Source code
├── tests/         # Test files
├── docs/          # Documentation
├── config/        # Configuration
├── scripts/       # Utility scripts
└── examples/      # Example code
```

---

## Integration Examples

### Example 1: Full-Stack Development

```javascript
[Single Message - Parallel Agent Execution]:

// Initialize swarm
mcp__monomind__swarm_init {
  topology: "hierarchical",
  maxAgents: 10
}

// Architecture phase
Task("design REST API with authentication", "design REST API with authentication", "sparc-architect")

// Research phase
Task("research authentication best practices", "research authentication best practices", "sparc-researcher")

// Implementation phase
Task("implement Express API with JWT auth", "implement Express API with JWT auth", "sparc-coder")

// Testing phase
Task("comprehensive API tests", "comprehensive API tests", "sparc-tdd")

// Review phase
Task("security and performance review", "security and performance review", "sparc-reviewer")

// Batch todos
TodoWrite {
  todos: [
    {content: "Design API schema", status: "completed"},
    {content: "Research JWT implementation", status: "completed"},
    {content: "Implement authentication", status: "in_progress"},
    {content: "Write API tests", status: "pending"},
    {content: "Security review", status: "pending"},
    {content: "Performance optimization", status: "pending"},
    {content: "API documentation", status: "pending"},
    {content: "Deployment setup", status: "pending"}
  ]
}
```

### Example 2: Research-Driven Innovation

```javascript
// Research phase
Task("research AI-powered search implementations", "research AI-powered search implementations", "sparc-researcher")

// Innovation phase
Task("propose novel search algorithm", "propose novel search algorithm", "sparc-innovator")

// Architecture phase
Task("design scalable search system", "design scalable search system", "sparc-architect")

// Implementation phase
Task("implement search algorithm", "implement search algorithm", "sparc-coder")

// Documentation phase
Task("document search system architecture and API", "document search system architecture and API", "sparc-documenter")
```

### Example 3: Legacy Code Refactoring

```javascript
// Analysis phase
Task("analyze legacy codebase dependencies", "analyze legacy codebase dependencies", "sparc-analyzer")

// Planning phase
Task("plan incremental refactoring strategy", "plan incremental refactoring strategy", "sparc-orchestrator")

// Testing phase (create safety net)
Task("create comprehensive test suite for legacy code", "create comprehensive test suite for legacy code", "sparc-tester")

// Refactoring phase
Task("refactor module X with modern patterns", "refactor module X with modern patterns", "sparc-coder")

// Review phase
Task("validate refactoring maintains functionality", "validate refactoring maintains functionality", "sparc-reviewer")
```

---

## Common Workflows

### Workflow 1: Feature Development

```bash
# Step 1: Research and planning
npx monomind sparc run researcher "authentication patterns"

# Step 2: Architecture design
npx monomind sparc run architect "design auth system"

# Step 3: TDD implementation
npx monomind sparc tdd "user authentication feature"

# Step 4: Code review
npx monomind sparc run reviewer "review auth implementation"

# Step 5: Documentation
npx monomind sparc run documenter "document auth API"
```

### Workflow 2: Bug Investigation

```bash
# Step 1: Analyze issue
npx monomind sparc run analyzer "investigate bug #456"

# Step 2: Debug systematically
npx monomind sparc run debugger "fix memory leak in service X"

# Step 3: Create tests
npx monomind sparc run tester "regression tests for bug #456"

# Step 4: Review fix
npx monomind sparc run reviewer "validate bug fix"
```

### Workflow 3: Performance Optimization

```bash
# Step 1: Profile performance
npx monomind sparc run analyzer "profile API response times"

# Step 2: Identify bottlenecks
npx monomind sparc run optimizer "optimize database queries"

# Step 3: Implement improvements
npx monomind sparc run coder "implement caching layer"

# Step 4: Benchmark results
npx monomind sparc run tester "performance benchmarks"
```

### Workflow 4: Complete Pipeline

```bash
# Execute full development pipeline
npx monomind sparc pipeline "e-commerce checkout feature"

# This automatically runs:
# 1. researcher - Gather requirements
# 2. architect - Design system
# 3. coder - Implement features
# 4. tdd - Create comprehensive tests
# 5. reviewer - Code quality review
# 6. optimizer - Performance tuning
# 7. documenter - Documentation
```

---

## Advanced Features

### Neural Pattern Training

```bash
# Train patterns from successful workflows
npx monomind neural train --pattern-type coordination --epochs 50
```

### Cross-Session Memory

```bash
# Save session state (stored in .monomind/sessions/)
npx monomind session save feature-auth-v1

# Restore in new session
npx monomind session restore feature-auth-v1
```

### GitHub Integration

```javascript
// Analyze repository
mcp__monomind__github_repo_analyze {
  repo: "owner/repo",
  analysis_type: "code_quality"
}

// Manage pull requests
mcp__monomind__github_pr_manage {
  repo: "owner/repo",
  pr_number: 123,
  action: "review"
}
```

### Performance Monitoring

```javascript
// Real-time swarm monitoring
mcp__monomind__swarm_monitor {
  swarmId: "current",
  interval: 5000
}

// Bottleneck analysis
mcp__monomind__bottleneck_analyze {
  component: "api-layer",
  metrics: ["latency", "throughput", "errors"]
}

// Token usage tracking
mcp__monomind__token_usage {
  operation: "feature-development",
  timeframe: "24h"
}
```

---

## Performance Benefits

**Proven Results**:
- **84.8%** SWE-Bench solve rate
- **32.3%** token reduction through optimizations
- **2.8-4.4x** speed improvement with parallel execution
- **27+** neural models for pattern learning
- **90%+** test coverage standard

---

## Support and Resources

- **Documentation**: https://github.com/nokhodian/monomind
- **Issues**: https://github.com/nokhodian/monomind/issues
- **NPM Package**: https://www.npmjs.com/package/monomind
- **Community**: Discord server (link in repository)

---

## Quick Reference

### Most Common Commands

```bash
# List modes
npx monomind sparc modes

# Run specific mode
npx monomind sparc run <mode> "task"

# TDD workflow
npx monomind sparc tdd "feature"

# Full pipeline
npx monomind sparc pipeline "task"

# Batch execution
npx monomind sparc batch <modes> "task"
```

### Most Common MCP Calls

```javascript
// Initialize swarm
mcp__monomind__swarm_init({ topology: "hierarchical" })

// Execute SPARC mode via Task tool
Task("task description", "task description", "sparc-coder")

// Monitor progress
mcp__monomind__swarm_monitor({ interval: 5000 })

// Store in memory
mcp__monomind__memory_store({ key: "...", value: "..." })
```

---

Remember: **SPARC = Systematic, Parallel, Agile, Refined, Complete**
