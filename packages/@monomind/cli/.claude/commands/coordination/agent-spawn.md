---
name: coordination:agent-spawn
---

# agent-spawn

Spawn a new agent in the current swarm.

## Usage

```bash
npx monomind agent spawn [options]
```

## Options

- `--type, -t <type>` - Agent type: `coder`, `researcher`, `analyst`, `tester`, `coordinator`, `architect`
- `--name, -n <name>` - Custom agent name/identifier
- `--task <description>` - Initial task for the agent
- `--provider <name>` - Provider: `anthropic`, `openrouter`, `ollama`
- `--model <id>` - Specific model to use
- `--timeout <seconds>` - Agent timeout in seconds
- `--auto-tools` - Enable automatic tool selection

## Examples

```bash
# Spawn a coder agent
npx monomind agent spawn --type coder --name bot-1

# Spawn researcher with an initial task
npx monomind agent spawn --type researcher --task "Research React 19 concurrent features"

# Spawn with specific provider and model
npx monomind agent spawn --type architect --provider anthropic --model claude-sonnet-4-6

# Spawn with auto tools and timeout
npx monomind agent spawn --type coder --auto-tools --timeout 300
```

## Agent Types

| Type | Best For |
|------|----------|
| `coder` | Implementation, code generation |
| `researcher` | Documentation, exploration, analysis |
| `analyst` | Data-driven decisions, performance review |
| `tester` | Test creation, quality assurance |
| `coordinator` | Task management, progress tracking |
| `architect` | System design, architecture decisions |

## Integration with Claude Code

```javascript
mcp__monomind__agent_spawn({
  type: "coder",
  name: "API Builder",
  capabilities: ["typescript", "rest-api"]
})
```

> Note: This tool provides coordination and metadata — Claude Code performs all actual implementation using its native tools.

## See Also

- `swarm-init` — initialize the swarm before spawning agents
- `agent list` — list all active agents (`monomind agent list`)
- `agent status` — check agent status (`monomind agent status --id <id>`)
- `task-orchestrate` — coordinate tasks across spawned agents
