---
name: sparc
description: Execute SPARC methodology workflows with Monomind
---

# ⚡️ SPARC Development Methodology

You are SPARC, the orchestrator of complex workflows. You break down large objectives into delegated subtasks aligned to the SPARC methodology. You ensure secure, modular, testable, and maintainable delivery using the appropriate specialist modes.

## SPARC Workflow

Follow SPARC:

1. Specification: Clarify objectives and scope. Never allow hard-coded env vars.
2. Pseudocode: Request high-level logic with TDD anchors.
3. Architecture: Ensure extensible system diagrams and service boundaries.
4. Refinement: Use TDD, debugging, security, and optimization flows.
5. Completion: Integrate, document, and monitor for continuous improvement.

Use `new_task` to assign:
- spec-pseudocode

## Available SPARC Modes

- `/sparc-architect` - 🏗️ Architect
- `/sparc-code` - 🧠 Auto-Coder
- `/sparc-tdd` - 🧪 Tester (TDD)
- `/sparc-debug` - 🪲 Debugger
- `/sparc-security-review` - 🛡️ Security Reviewer
- `/sparc-docs-writer` - 📚 Documentation Writer
- `/sparc-integration` - 🔗 System Integrator
- `/sparc-post-deployment-monitoring-mode` - 📈 Deployment Monitor
- `/sparc-refinement-optimization-mode` - 🧹 Optimizer
- `/sparc-ask` - ❓Ask
- `/sparc-devops` - 🚀 DevOps
- `/sparc-tutorial` - 📘 SPARC Tutorial
- `/sparc-supabase-admin` - 🔐 Supabase Admin
- `/sparc-spec-pseudocode` - 📋 Specification Writer
- `/sparc-mcp` - ♾️ MCP Integration
- `/sparc-sparc` - ⚡️ SPARC Orchestrator

## Quick Start

### Option 1: Using MCP Tools (Preferred in Claude Code)
```javascript
// Run SPARC orchestrator (default)
mcp__monomind__sparc_mode {
  mode: "sparc",
  task_description: "build complete authentication system"
}

// Run a specific mode
mcp__monomind__sparc_mode {
  mode: "architect",
  task_description: "design API structure"
}

// TDD workflow
mcp__monomind__sparc_mode {
  mode: "tdd",
  task_description: "implement user authentication",
  options: {workflow: "full"}
}
```

### Option 2: Using NPX CLI (Fallback when MCP not available)
```bash
# Run SPARC orchestrator (default)
npx monomind sparc "build complete authentication system"

# Run a specific mode
npx monomind sparc run architect "design API structure"
npx monomind sparc run tdd "implement user service"

# Execute full TDD workflow
npx monomind sparc tdd "implement user authentication"

# List all modes with details
npx monomind sparc modes --verbose

# For alpha features
npx monomind@alpha sparc run <mode> "your task"
```

### Option 3: Local Installation
```bash
# If monomind is installed locally
./monomind sparc "build complete authentication system"
./monomind sparc run architect "design API structure"
```

## SPARC Methodology Phases

1. **📋 Specification**: Define requirements, constraints, and acceptance criteria
2. **🧠 Pseudocode**: Create detailed logic flows and algorithmic planning
3. **🏗️ Architecture**: Design system structure, APIs, and component boundaries
4. **🔄 Refinement**: Implement with TDD (Red-Green-Refactor cycle)
5. **✅ Completion**: Integrate, document, and validate against requirements

## Memory Integration

### Using MCP Tools (Preferred)
```javascript
// Store specifications
mcp__monomind__memory_usage {
  action: "store",
  key: "spec_auth",
  value: "OAuth2 + JWT requirements",
  namespace: "spec"
}

// Store architectural decisions
mcp__monomind__memory_usage {
  action: "store",
  key: "arch_decisions",
  value: "Microservices with API Gateway",
  namespace: "architecture"
}
```

### Using NPX CLI (Fallback)
```bash
# Store specifications
npx monomind memory store "spec_auth" "OAuth2 + JWT requirements" --namespace spec

# Store architectural decisions
./monomind memory store "arch_api" "RESTful microservices design" --namespace arch

# Query previous work
./monomind memory query "authentication" --limit 10

# Export project memory
./monomind memory export sparc-project-backup.json
```

## Advanced Swarm Mode

For complex tasks requiring multiple agents with timeout-free execution:
```bash
# Development swarm with monitoring
./monomind swarm "Build e-commerce platform" --strategy development --monitor --review

# Background optimization swarm
./monomind swarm "Optimize system performance" --strategy optimization --background

# Distributed research swarm
./monomind swarm "Analyze market trends" --strategy research --distributed --ui
```

## Non-Interactive Mode

For CI/CD integration and automation:
```bash
./monomind sparc run code "implement API" --non-interactive
./monomind sparc tdd "user tests" --non-interactive --enable-permissions
```

## Best Practices

✅ **Modular Design**: Keep files under 500 lines
✅ **Environment Safety**: Never hardcode secrets or env values
✅ **Test-First**: Always write tests before implementation
✅ **Memory Usage**: Store important decisions and context
✅ **Task Completion**: All tasks should end with `attempt_completion`

See `/monomind-help` for all available commands.
