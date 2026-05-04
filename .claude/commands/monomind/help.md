---
name: monomind-help
description: Monomind commands reference — quick overview of all skills, CLI subcommands, and MCP tools available in this session
---

# Monomind Help

Quick reference for all Monomind skills and CLI commands available in this project.

## Monomind Skills (invoke via Skill tool)

| Skill | Description |
|-------|-------------|
| `monomind:createtask` | Decompose a prompt, spec file, or folder into agent-optimized tasks on monotask |
| `monomind:do` | Execute tasks from monotask board with parallel/minimal/sequential agent modes |
| `monomind:idea` | Research ideas from a prompt and decompose them into subtasks on monotask |
| `monomind:improve` | Deeply analyze a component, research improvements, create tasks |
| `monomind:repeat` | Repeat a prompt on a schedule (default: 15 min, 10 times) |
| `monomind:understand` | Run semantic enrichment on the monograph knowledge graph |
| `monomind:specialagents` | Activate a specialist agent persona (browse categories or auto-select) |
| `monomind:swarm` | Swarm coordination reference — topologies, strategies, init patterns |
| `monomind:memory` | Memory CLI quick reference |

## Core CLI Commands

```bash
# Initialize project
npx monomind init --wizard

# Start background daemon
npx monomind daemon start

# System diagnostics
npx monomind doctor --fix

# Agent management
npx monomind agent spawn -t coder --name my-coder
npx monomind agent list
npx monomind agent status --id <agent-id>
npx monomind agent stop --id <agent-id>

# Swarm management
npx monomind swarm init --topology hierarchical --max-agents 8 --strategy specialized
npx monomind swarm status
npx monomind swarm stop

# Memory operations
npx monomind memory store --key "my-key" --value "my-value" --namespace patterns
npx monomind memory search --query "search terms"
npx monomind memory list --namespace patterns
npx monomind memory retrieve --key "my-key"

# Workflow management
npx monomind workflow run -t development --task "Build feature"
npx monomind workflow list

# Knowledge graph
npx monomind monograph build
npx monomind monograph search -q "authentication"
npx monomind monograph stats

# Neural patterns
npx monomind neural train --pattern coordination --epochs 50
npx monomind neural status --verbose

# Hooks
npx monomind hooks pre-task --description "task description"
npx monomind hooks post-task --task-id "id" --success true
npx monomind hooks route --task "task description"

# Session management
npx monomind session restore --latest
npx monomind session save

# Security
npx monomind security scan --depth full

# Performance
npx monomind performance benchmark --suite all
```

## Built-in Workflow Templates

`development`, `research`, `testing`, `security-audit`, `code-review`, `refactoring`, `sparc`, `custom`

## Swarm Topologies

| Topology | Use When |
|----------|----------|
| `hierarchical` | Feature dev, bug fixes (anti-drift, tight control) |
| `mesh` | Research, analysis (broad coverage) |
| `star` | Parallel testing, parallel maintenance |
| `hierarchical-mesh` | Large teams 10+ agents |

## Key MCP Tools

```javascript
// Memory
mcp__monomind__memory_store({ key: "...", value: "...", namespace: "..." })
mcp__monomind__memory_search({ query: "...", namespace: "..." })

// Knowledge graph
mcp__monomind__graphify_suggest({ task: "..." })
mcp__monomind__graphify_query({ query: "..." })

// Swarm
mcp__monomind__swarm_init({ topology: "hierarchical", maxAgents: 8, strategy: "specialized" })
mcp__monomind__swarm_status({})

// System
mcp__monomind__system_health({})
mcp__monomind__agent_health({})
```

## Support

- Documentation: https://github.com/nokhodian/monomind
- Issues: https://github.com/nokhodian/monomind/issues
