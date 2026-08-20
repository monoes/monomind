---
name: optimization:auto-topology
description: Automatically select the optimal monoswarm topology based on task complexity — use pre-task hook recommendations, monoswarm init flags, and performance optimize CLI
---

# Auto Topology Selection

Automatically select the optimal monoswarm topology based on task complexity so you don't have to configure it manually.

## How It Works

### 1. Get a Routing Recommendation

Before spawning agents, run the `pre-task` hook. It analyzes task complexity and recommends a topology:

```bash
npx monomind hooks pre-task -d "Refactor authentication system with JWT, add tests, update docs"
```

Output includes agent and topology suggestions.

### 2. Initialize the Monoswarm With the Recommended Topology

```bash
# Simple/medium tasks — hierarchical (anti-drift, tight control)
npx monomind monoswarm init --topology hierarchical --max-agents 6 --strategy specialized

# Complex multi-domain tasks — hierarchical-mesh (peer communication + queen)
npx monomind monoswarm init --topology hierarchical-mesh --max-agents 12 --strategy specialized
```

### Topology Selection Guide

| Complexity | Agents Needed | Recommended Topology |
|---|---|---|
| Simple (single file) | 1–2 | `star` — skip monoswarm, use Edit tool directly |
| Medium | 3–5 | `hierarchical` |
| Complex (multi-module) | 6–8 | `hierarchical` |
| Large (10+ agents) | 10–15 | `hierarchical-mesh` |
| Sequential pipeline | any | `ring` |

## Optimize Existing Monoswarm Topology

If a monoswarm is already running, optimize its topology via the coordination MCP tool:

```javascript
mcp__monomind__coordination_topology({
  swarmId: "current",
  optimize: true
})
```

Or via the performance CLI:

```bash
# Analyze and recommend optimizations (dry run)
npx monomind performance optimize --target all --dry-run

# Apply recommended optimizations
npx monomind performance optimize --target all --apply
```

## Hook Integration

`pre-task` fires automatically if wired in `settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "^Task$",
      "hooks": [{
        "type": "command",
        "command": "npx monomind hooks pre-task -d '${tool.params.description}'"
      }]
    }]
  }
}
```

## See Also

- `monoswarm init` — initialize monoswarm with explicit topology
- `performance optimize` — system-level performance tuning
- `hooks pre-task` — get routing and topology recommendations
