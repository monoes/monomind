---
name: hive-mind:hive-mind-init
---

# hive-mind init

Initialize a hive mind with topology and consensus settings.

## Usage
```bash
npx monomind hive-mind init [options]
```

## Options

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--topology` | `-t` | string | `hierarchical-mesh` | Hive topology: `hierarchical`, `mesh`, `hierarchical-mesh`, `adaptive` |
| `--consensus` | `-c` | string | `byzantine` | Consensus strategy: `byzantine`, `raft`, `gossip`, `crdt`, `quorum` |
| `--max-agents` | `-m` | number | `15` | Maximum number of agents |
| `--persist` | `-p` | boolean | `true` | Enable persistent state across sessions |
| `--memory-backend` | — | string | `hybrid` | Memory backend: `agentdb`, `sqlite`, `hybrid` |

## Examples

```bash
# Initialize with recommended settings (interactive topology/consensus selection)
npx monomind hive-mind init

# Initialize hierarchical-mesh with Byzantine consensus
npx monomind hive-mind init -t hierarchical-mesh -c byzantine

# Large hive with 20 agents and CRDT consensus
npx monomind hive-mind init -t mesh -c crdt -m 20

# Minimal hive with no persistence
npx monomind hive-mind init -t hierarchical -c raft --persist false

# Output as JSON
npx monomind hive-mind init -t hierarchical-mesh --format json
```

## Topology Guide

- **`hierarchical`** — Queen controls workers directly. Best for small teams (< 8 agents). Prevents drift.
- **`mesh`** — Fully connected peers. Best when all agents are equals.
- **`hierarchical-mesh`** — Queen + peer communication. Recommended for 10+ agents. Most resilient.
- **`adaptive`** — Dynamically adjusts topology based on current load and task type.

## Consensus Guide

- **`byzantine`** — Tolerates up to 1/3 faulty or malicious agents. Most robust. Default.
- **`raft`** — Leader-based. Tolerates up to 1/2 failures. Faster than byzantine.
- **`gossip`** — Epidemic propagation. Eventually consistent. Best for very large swarms.
- **`crdt`** — Conflict-free. No coordination overhead. Best for parallel writes.
- **`quorum`** — Simple majority. Configurable threshold.

## MCP Tool

```javascript
mcp__monomind__hive-mind_init({
  topology: "hierarchical-mesh",
  consensus: "byzantine",
  maxAgents: 15,
  persist: true,
  memoryBackend: "hybrid"
})
```
