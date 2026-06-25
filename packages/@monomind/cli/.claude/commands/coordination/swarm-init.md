---
name: coordination:swarm-init
---

# swarm-init

Initialize a Monomind swarm with specified topology and configuration.

## Usage

```bash
npx monomind swarm init [options]
```

## Options

- `--topology, -t <type>` - Swarm topology (default: `hierarchical`)
- `--max-agents, -m <n>` - Maximum number of agents (default: `8`)
- `--strategy, -s <type>` - Coordination strategy: `balanced`, `parallel`, `sequential`, `specialized`
- `--auto-scale` - Enable automatic agent scaling
- `--v1-mode` - Enable v1 15-agent hierarchical mesh mode

## Examples

### Default hierarchical swarm

```bash
npx monomind swarm init
```

### Mesh topology for research tasks

```bash
npx monomind swarm init --topology mesh --max-agents 5 --strategy balanced
```

### Specialized development swarm

```bash
npx monomind swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

### Auto-scaling adaptive swarm

```bash
npx monomind swarm init --topology adaptive --auto-scale
```

### v1 high-performance mode (15 agents)

```bash
npx monomind swarm init --v1-mode
```

## Topologies

| Topology | Best For | Communication |
|----------|----------|---------------|
| `hierarchical` | Development, structured tasks, large projects | Efficient, clear chain of command |
| `hierarchical-mesh` | Complex cross-domain work (recommended default) | Balanced overhead + information sharing |
| `mesh` | Research, exploration, brainstorming | High information sharing |
| `ring` | Pipeline processing, sequential workflows | Low overhead, ordered |
| `star` | Centralized control, simple tasks | Minimal overhead |
| `adaptive` | Unknown complexity, dynamic workloads | Self-adjusting |
| `hybrid` | Mixed-mode tasks | Configurable |

## Integration with Claude Code

```javascript
mcp__monomind__swarm_init({
  topology: "hierarchical",
  maxAgents: 8,
  strategy: "specialized"
})
```

## See Also

- `agent-spawn` — create agents within the swarm
- `swarm status` — check swarm state (`monomind swarm status`)
- `swarm start` — start execution (`monomind swarm start --objective "..."`)
- `task-orchestrate` — coordinate tasks across agents
