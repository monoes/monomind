---
name: workflows:research
description: Research workflow coordination pattern — mesh swarm for comprehensive exploration using real MCP tools and npx monomind workflow run -t research
---

# Research Workflow Coordination

Coordinate multi-agent research activities for comprehensive, systematic exploration.

## How to Invoke

```
Skill("workflows:research")
```

---

## Quick Start

```bash
# Run the built-in research workflow
npx monomind workflow run -t research --task "Analyze modern web framework performance"

# Preview stages without executing
npx monomind workflow run -t research --dry-run

# Show template details
npx monomind workflow template show research
```

## Stages

The `research` template runs these stages:
1. **Discovery** — Identify sources, gather raw information
2. **Analysis** — Evaluate and compare findings
3. **Synthesis** — Combine into coherent conclusions
4. **Documentation** — Write up findings

Agents: `researcher`, `analyst` (mesh topology for broad coverage)

## MCP Coordination

For custom research coordination via MCP:

```javascript
// Initialize mesh swarm for broad exploration
mcp__monomind__swarm_init({
  topology: "mesh",
  maxAgents: 5,
  strategy: "balanced"
})

// Run the research workflow
mcp__monomind__workflow_run({
  template: "research",
  task: "Research modern web frameworks performance",
  options: { parallel: true, maxAgents: 4 }
})

// Store research findings in memory
mcp__monomind__memory_store({
  key: "research-web-frameworks-2026",
  value: "React/Next.js leads for SSR; Astro for static; Svelte for performance",
  namespace: "research"
})

// Search past research before starting
mcp__monomind__memory_search({
  query: "web framework performance analysis",
  namespace: "research",
  limit: 5
})
```

## What Claude Code Actually Does

1. **WebSearch** tool — finds relevant resources
2. **Read** tool — analyzes documentation and code
3. **Task** tool — spawns parallel research agents for different angles
4. Synthesizes findings in the conversation
5. Stores insights in memory for future sessions

The workflow template coordinates the research strategy; Claude Code does the actual searching and reading.

## Related Skills

- `workflows:workflow-execute` — Full workflow run reference
- `swarm:research` — Direct swarm-based research coordination
- `memory:memory-search` — Search past research findings
