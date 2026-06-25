---
name: automation:smart-spawn
---

# smart-spawn

Automatically spawn agents at the start of a task using the hooks pre-task system.

## Usage

```bash
npx monomind hooks pre-task --description "<task>" --auto-spawn
```

## Options

- `--description, -d <text>` - Task description (used for agent selection)
- `--auto-spawn` - Enable automatic agent spawning based on task analysis
- `--id, -i <id>` - Task ID

## Examples

### Auto-spawn agents for a task

```bash
npx monomind hooks pre-task --description "Implement OAuth with Google" --auto-spawn
```

### Route + spawn in one step

```bash
npx monomind hooks route --task "Build REST API" --include-explanation
npx monomind hooks pre-task --description "Build REST API" --auto-spawn
```

## How It Works

The `pre-task` hook analyzes the task description and automatically selects and spawns the right agents:

- **Simple tasks** (`Fix typo`) → single coordinator agent
- **Complex tasks** (`Implement OAuth`) → Architect + Coder + Tester + Researcher
- **Parallel tasks** → mesh topology with load-balanced workers

## Integration with Claude Code

```javascript
// Initialize swarm with auto strategy
mcp__monomind__swarm_init({
  topology: "hierarchical",
  maxAgents: 8,
  strategy: "specialized"
})

// Then spawn the appropriate agent type
mcp__monomind__agent_spawn({
  type: "coder",
  name: "Task Handler",
  capabilities: ["typescript", "api"]
})
```

## See Also

- `auto-agent` — spawn agents manually with explicit type/task
- `workflow-select` — run a predefined workflow template
- `hooks pre-task` — full pre-task hook reference
