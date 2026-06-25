---
name: automation:auto-agent
---

# auto-agent

Automatically spawn agents based on task requirements.

## Usage

```bash
npx monomind agent spawn [options]
```

## Options

- `--type, -t <type>` - Agent type: `coder`, `tester`, `researcher`, `coordinator`, `architect`, `analyst`
- `--name, -n <name>` - Agent name
- `--task <description>` - Task description
- `--timeout <ms>` - Timeout in milliseconds
- `--auto-tools` - Enable automatic tool selection

## Examples

### Spawn a coder agent for a task

```bash
npx monomind agent spawn --type coder --task "Build a REST API with authentication"
```

### Spawn coordinator with auto tools

```bash
npx monomind agent spawn --type coordinator --auto-tools --task "Refactor codebase"
```

### Check spawned agent status

```bash
npx monomind agent list
npx monomind agent status --id <agent-id>
```

## How It Works

1. **Task Analysis** — Parses task description and identifies required skills
2. **Agent Selection** — Matches skills to agent type (`coder`, `architect`, `tester`, etc.)
3. **Topology Selection** — Chooses swarm structure for multi-agent tasks
4. **Spawning** — Creates agent with role, assigns subtasks, enables coordination

## Agent Types

| Type | Best For |
|------|----------|
| `architect` | System design, architecture decisions |
| `coder` | Implementation, code generation |
| `tester` | Test creation, quality assurance |
| `analyst` | Performance, optimization |
| `researcher` | Documentation, best practices |
| `coordinator` | Task management, progress tracking |

## Integration with Claude Code

```javascript
// Spawn a single specialized agent
mcp__monomind__agent_spawn({
  type: "coder",
  name: "API Builder",
  task: "Build authentication system",
  capabilities: ["typescript", "rest-api"]
})

// For multi-agent coordination, initialize a swarm first
mcp__monomind__swarm_init({
  topology: "hierarchical",
  maxAgents: 6,
  strategy: "specialized"
})
```

## See Also

- `agent list` — list all active agents
- `agent status` — check agent status
- `swarm init` — initialize a multi-agent swarm
- `workflow-select` — choose predefined workflows
