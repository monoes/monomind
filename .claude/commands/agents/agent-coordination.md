---
name: agents:agent-coordination
---

# agent-coordination

Coordination patterns for multi-agent collaboration.

## Coordination Patterns

### Hierarchical
Queen-led with worker specialization
```bash
npx monomind swarm init --topology hierarchical
```

### Mesh
Peer-to-peer collaboration
```bash
npx monomind swarm init --topology mesh
```

### Adaptive
Dynamic topology based on workload
```bash
npx monomind swarm init --topology adaptive
```

## Best Practices
- Use hierarchical for complex projects
- Use mesh for research tasks
- Use adaptive for unknown workloads
