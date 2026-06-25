---
name: swarm-research
description: Research swarm strategy — parallel information gathering with mesh topology for deep research, literature review, and knowledge synthesis
---

# Research Swarm Strategy

Deep research through parallel information gathering.

## How to Invoke

```
Skill("swarm:research")
```

Then describe the research topic:
> "Start a research swarm on AI agent coordination patterns."
> "Research best practices for distributed consensus algorithms."

---

## Swarm Setup

```javascript
// Initialize research swarm
mcp__monomind__swarm_init({
  topology: "mesh",
  maxAgents: 6,
  strategy: "adaptive"
})

// Coordinate research
mcp__monomind__coordination_orchestrate({
  task: "research topic X",
  strategy: "parallel"
})
```

```bash
# CLI equivalent
npx monomind swarm init --topology mesh --max-agents 6
npx monomind swarm start "research topic X" --strategy research --parallel
```

## Agent Roles

```javascript
mcp__monomind__agent_spawn({ type: "researcher", capabilities: ["web-search", "content-extraction", "source-validation"] })
mcp__monomind__agent_spawn({ type: "researcher", capabilities: ["paper-analysis", "citation-tracking", "literature-review"] })
mcp__monomind__agent_spawn({ type: "analyst", capabilities: ["data-processing", "statistical-analysis"] })
mcp__monomind__agent_spawn({ type: "documenter", capabilities: ["synthesis", "technical-writing", "formatting"] })
```

## Knowledge Management

```javascript
// Store research findings for future sessions
mcp__monomind__memory_store({
  key: "research-findings",
  value: "summary of findings",
  namespace: "research"
})

// Search existing research
mcp__monomind__memory_search({
  query: "topic X",
  namespace: "research",
  limit: 20
})
```

## Monitoring

```javascript
mcp__monomind__swarm_status({ swarmId: "current" })
```
