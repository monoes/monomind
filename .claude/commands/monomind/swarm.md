---
name: monomind-swarm
description: Multi-agent swarm coordination — init, start, status, stop, scale, and coordinate agent teams
---

# Monomind Swarm Coordination

Multi-agent swarm coordination with hierarchical topology, distributed memory, and load balancing.

## Subcommands

| Subcommand | Description |
|---|---|
| `init` | Initialize a new swarm (topology + strategy) |
| `start` | Start swarm execution with an objective |
| `status` | Show current swarm status and progress |
| `stop` | Stop swarm execution |
| `scale` | Scale swarm agent count up or down |
| `coordinate` | Launch v1 15-agent hierarchical-mesh coordination |

## init — Initialize a Swarm

```bash
# Default (hierarchical, 15 agents)
npx monomind swarm init

# Anti-drift configuration (recommended)
npx monomind swarm init --topology hierarchical --max-agents 8 --strategy specialized

# v1 15-agent hierarchical-mesh
npx monomind swarm init --v1-mode
npx monomind swarm init --topology hierarchical-mesh --max-agents 15 --strategy specialized
```

**Flags:**

| Flag | Short | Default | Description |
|---|---|---|---|
| `--topology` | `-t` | `hierarchical` | Swarm topology (see table below) |
| `--max-agents` | `-m` | `15` | Maximum concurrent agents |
| `--strategy` | `-s` | — | Coordination strategy |
| `--auto-scale` | — | `true` | Enable automatic scaling |
| `--v1-mode` | — | `false` | Enable v1 hierarchical-mesh with 15 agents |

## Topologies

| Topology | Use When |
|---|---|
| `hierarchical` | Feature dev, bug fixes — anti-drift, tight control |
| `hierarchical-mesh` | Large teams 10-15 agents — v1 queen + peer communication |
| `mesh` | Research, analysis — broad coverage |
| `star` | Parallel testing, parallel maintenance |
| `ring` | Sequential pipeline processing |
| `hybrid` | Dynamic topology switching |

## Strategies

`specialized` (anti-drift, clear roles), `balanced`, `adaptive`, `development`, `research`, `testing`, `optimization`, `maintenance`, `analysis`

## start — Start Swarm Execution

```bash
# Start a development swarm
npx monomind swarm start -o "Build REST API with authentication" -s development

# Parallel research swarm
npx monomind swarm start -o "Analyze performance bottlenecks" -s research --parallel
```

**Flags:**

| Flag | Short | Default | Description |
|---|---|---|---|
| `--objective` | `-o` | — | Swarm objective/task (required) |
| `--strategy` | `-s` | `development` | Execution strategy |
| `--parallel` | `-p` | `true` | Enable parallel execution |
| `--monitor` | — | `true` | Enable real-time monitoring |

## status — Check Swarm Progress

```bash
# Overall status
npx monomind swarm status

# Status for a specific swarm ID
npx monomind swarm status swarm-abc123
```

## stop — Stop a Swarm

```bash
# Graceful stop (saves state by default)
npx monomind swarm stop swarm-abc123

# Force immediate stop
npx monomind swarm stop swarm-abc123 --force
```

**Flags:**

| Flag | Short | Default | Description |
|---|---|---|---|
| `--force` | `-f` | `false` | Force immediate stop |
| `--save-state` | — | `true` | Save state for potential resume |

## scale — Adjust Agent Count

```bash
# Scale to 12 agents
npx monomind swarm scale swarm-abc123 --agents 12

# Scale a specific agent type
npx monomind swarm scale swarm-abc123 --agents 8 --type coder
```

## coordinate — v1 15-Agent Coordination

```bash
# Full v1 15-agent hierarchical mesh
npx monomind swarm coordinate

# Subset of agents
npx monomind swarm coordinate --agents 8
```

Activates the v1 agent roster: Queen Coordinator, Security Architect, Security Auditor, Test Architect, Core Architect, Memory Specialist, Swarm Specialist, Integration Architect, Performance Engineer, CLI Developer, Hooks Developer, MCP Specialist, Project Coordinator, Documentation Lead, DevOps Engineer.

## MCP Tools

```javascript
// Initialize swarm
mcp__monomind__swarm_init({ topology: "hierarchical", maxAgents: 8, strategy: "specialized" })

// Check status
mcp__monomind__swarm_status({})

// Health check
mcp__monomind__swarm_health({})

// Shutdown swarm
mcp__monomind__swarm_shutdown({})
```

## Agent Team Routing

| Task Type | Agents | Topology |
|---|---|---|
| Bug Fix | coordinator, researcher, coder, tester | hierarchical |
| Feature | coordinator, architect, coder, tester, reviewer | hierarchical |
| Refactor | coordinator, architect, coder, reviewer | hierarchical |
| Performance | coordinator, perf-engineer, coder | hierarchical |
| Security | coordinator, security-architect, auditor | hierarchical |
| Research | coordinator, researcher x4, analyst x2 | mesh |

## See Also

- `npx monomind agent spawn` — Spawn individual agents
- `npx monomind hive-mind init` — Byzantine fault-tolerant consensus
- `/mastermind` — Interactive swarm topology selection

Documentation: https://github.com/nokhodian/monomind
