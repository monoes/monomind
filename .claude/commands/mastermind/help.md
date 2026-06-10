---
name: mastermind-help
description: Mastermind commands reference — quick overview of all skills, CLI subcommands, and MCP tools available in this session
---

# Mastermind Help

Quick reference for all Mastermind skills and CLI commands available in this project.

## Mastermind Skills (invoke via Skill tool)

| Skill | Description |
|-------|-------------|
| `mastermind:createtask` | Decompose a prompt, spec file, or folder into tasks saved to `docs/tasks/` (add `--monotask` for board) |
| `mastermind:do` | Execute tasks from a task file (add `--file <path>`) or monotask board (`--monotask`) |
| `mastermind:ideate` | Research ideas, evaluate, elaborate, decompose — saved to `docs/ideas/` (add `--monotask` for board) |
| `mastermind:improve` | Analyze a component, research improvements, create tasks in `docs/improvements/` (`--monotask` for board) |
| `mastermind:repeat` | Repeat a prompt on a schedule (default: 15 min, 10 times) |
| `mastermind:understand` | Run semantic enrichment on the monograph knowledge graph |
| `mastermind:specialagents` | Activate a specialist agent persona (browse categories or auto-select) |
| `mastermind:swarm` | Swarm coordination reference — topologies, strategies, init patterns |
| `mastermind:memory` | Memory CLI quick reference |

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

# Pattern logging
npx monomind neural patterns --action list
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

- Documentation: https://github.com/monoes/monomind
- Issues: https://github.com/monoes/monomind/issues
