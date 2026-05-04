---
name: swarm-swarm-modes
description: Swarm topology modes reference — hierarchical, mesh, star topologies with when-to-use guidance for each coordination pattern
---

# Swarm Topology Modes

Reference for choosing the right topology when initializing a swarm.

## How to Invoke

```
Skill("swarm:swarm-modes")
```

---

## Topologies

### Hierarchical

```javascript
mcp__monomind__swarm_init({ topology: "hierarchical", maxAgents: 8, strategy: "specialized" })
```

- Coordinator agent manages worker agents
- Best for: feature development, sequential workflows with dependencies
- Example flow: architect → coders → tester → documenter

### Mesh

```javascript
mcp__monomind__swarm_init({ topology: "mesh", maxAgents: 6, strategy: "adaptive" })
```

- All agents communicate with all others — fully connected
- Best for: research, analysis, exploration where findings are shared across agents
- Example flow: multiple researcher agents sharing discovered facts in real time

### Star

```javascript
mcp__monomind__swarm_init({ topology: "star", maxAgents: 7, strategy: "parallel" })
```

- Central coordinator, isolated worker spokes
- Best for: parallel independent tasks (running multiple test suites, analyzing separate modules)
- Example flow: coordinator dispatches to 6 isolated test runner agents

## Quick Selection Guide

| Task | Topology | Why |
|------|----------|-----|
| Build a feature | hierarchical | Sequential: design → code → test |
| Research a topic | mesh | Knowledge shared across all researchers |
| Run test suites | star | Independent parallel execution |
| Security audit | mesh | Cross-agent findings correlation |
| Maintenance tasks | star | Sequential isolated steps |
| Performance optimization | mesh | Profilers share bottleneck data |

## CLI

```bash
npx monomind swarm init --topology hierarchical --max-agents 8
npx monomind swarm init --topology mesh --max-agents 6
npx monomind swarm init --topology star --max-agents 5
```
