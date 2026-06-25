---
name: hooks:post-task
---

# hooks post-task

Record task completion for neural pattern learning.

## Usage

```bash
npx monomind hooks post-task [options]
```

## Options

| Flag | Short | Type | Required | Description |
|---|---|---|---|---|
| `--task-id` | `-i` | string | no | Task identifier (auto-generated if omitted) |
| `--success` | `-s` | boolean | no | Whether task succeeded (default: true) |
| `--quality` | `-q` | number | no | Quality score 0–1 |
| `--agent` | `-a` | string | no | Agent that executed the task |
| `--format` | — | string | no | Output format: `json` |

## Examples

```bash
# Record successful completion
npx monomind hooks post-task -i task-123 --success true

# Record failed task with quality score
npx monomind hooks post-task -i task-456 --success false -q 0.3

# Record with agent attribution
npx monomind hooks post-task -i task-789 --success true -a coder -q 0.95

# JSON output
npx monomind hooks post-task -i task-123 --success true --format json
```

## Output

- Patterns updated / new patterns discovered
- Task duration
- Trajectory ID (for intelligence system tracking)

## MCP Tool

```javascript
mcp__monomind__hooks_post_task({
  taskId: "task-123",
  success: true,
  quality: 0.95,
  agent: "coder",
  timestamp: Date.now()
})
```

## See Also

- `hooks pre-task` — register task start
- `hooks metrics` — view learning metrics
