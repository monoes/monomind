---
name: hooks:pre-task
---

# hooks pre-task

Register task start and get agent suggestions.

## Usage

```bash
npx monomind hooks pre-task [options]
```

## Options

| Flag | Short | Type | Required | Description |
|---|---|---|---|---|
| `--description` | `-d` | string | yes | Task description |
| `--task-id` | `-i` | string | no | Unique task ID (auto-generated if omitted) |
| `--auto-spawn` | `-a` | boolean | no | Auto-spawn suggested agents (default: false) |
| `--format` | — | string | no | Output format: `json` |

## Examples

```bash
# Register task start and get suggestions
npx monomind hooks pre-task -d "Implement user authentication"

# With explicit task ID
npx monomind hooks pre-task -i task-123 -d "Fix auth bug"

# With auto-spawn of suggested agents
npx monomind hooks pre-task -d "Implement feature" --auto-spawn

# JSON output for scripting
npx monomind hooks pre-task -d "Refactor database layer" --format json
```

## Output

The command outputs:
- **Task registration** — task ID, complexity estimate, estimated duration
- **Suggested agents** — agent type, confidence, reason
- **Potential risks** — issues to watch for
- **Recommendations** — approach suggestions

## Integration in Claude Code

Run before starting any significant task:

```bash
npx monomind hooks pre-task -d "Your task description here"
```

Then use the agent suggestions to guide your approach.

## MCP Tool

```javascript
mcp__monomind__hooks_pre_task({
  taskId: "task-123",
  description: "Implement authentication",
  autoSpawn: false,
  timestamp: Date.now()
})
```

## See Also

- `hooks post-task` — record task completion
- `hooks route` — manual agent routing
- `hooks explain` — explain routing decision
