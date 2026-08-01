---
name: workflows:development
description: Development workflow coordination pattern — hierarchical swarm for structured implementation tasks using real MCP tools and npx monomind workflow run -t development
---

# Development Workflow Coordination

Structure multi-agent development tasks using the built-in development template for maximum efficiency.

## How to Invoke

```
Skill("workflows:development")
```

---

## Quick Start

```bash
# Run the built-in development workflow
npx monomind workflow run -t development --task "Build REST API with auth"

# Preview stages without executing
npx monomind workflow run -t development --dry-run

# Show template details (stages, agents, duration)
npx monomind workflow template show development
```

## Stages

The `development` template runs these stages:
1. **Planning** — Requirements, architecture decisions
2. **Implementation** — Code writing
3. **Testing** — Unit and integration tests
4. **Review** — Code quality and security check
5. **Integration** — Connect all pieces

Agents: `coder`, `tester`, `reviewer` (in parallel where possible)

## MCP Coordination

For custom development coordination via MCP:

```javascript
// Initialize hierarchical swarm for development
mcp__monomind__swarm_init({
  topology: "hierarchical",
  maxAgents: 8,
  strategy: "specialized"
})

// Run the development workflow
mcp__monomind__workflow_run({
  template: "development",
  task: "Build REST API with authentication",
  options: { parallel: true, maxAgents: 6 }
})

// Check progress
mcp__monomind__workflow_status({ workflowId: "wf-123" })

// Store findings for future sessions
mcp__monomind__memory_store({
  key: "dev-pattern-rest-api",
  value: "JWT auth + Express + Zod validation worked well",
  namespace: "patterns"
})
```

## What Claude Code Actually Does

Claude Code handles all execution via native tools:
1. **Read/Write/Edit** tools — create and modify files
2. **Bash** tool — run tests, builds, type checks
3. **TodoWrite** tool — track implementation steps
4. **Task** tool — spawn parallel agent workers

The workflow template defines the coordination strategy; Claude Code does the actual work.

## Related Skills

- `workflows:workflow-execute` — Full workflow run reference
- `swarm:development` — Direct swarm-based development coordination
- `swarm:swarm-strategies` — Strategy selection guide
