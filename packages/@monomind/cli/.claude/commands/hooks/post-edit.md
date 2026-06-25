---
name: hooks:post-edit
---

# hooks post-edit

Record editing outcome for neural pattern learning.

## Usage

```bash
npx monomind hooks post-edit [options]
```

## Options

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--file` | `-f` | string | `unknown` | File path that was edited |
| `--success` | `-s` | boolean | `true` | Whether the edit succeeded |
| `--outcome` | `-o` | string | — | Outcome description |
| `--metrics` | `-m` | string | — | Performance metrics, e.g. `"time:500ms,quality:0.95"` |
| `--format` | — | string | — | Output format: `json` |

## Examples

```bash
# Record successful edit
npx monomind hooks post-edit --file src/utils.ts --success true

# Record failed edit with reason
npx monomind hooks post-edit -f src/api.ts --success false -o "Type error in return type"

# With performance metrics
npx monomind hooks post-edit -f src/auth.ts --success true -m "time:200ms,quality:0.9"

# JSON output
npx monomind hooks post-edit -f src/utils.ts --format json
```

## Output

- **Learning updates** — patterns updated, confidence adjustments, new patterns discovered

## Claude Code Integration

Typically fired automatically via `settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "^(Write|Edit|MultiEdit)$",
      "hooks": [{
        "type": "command",
        "command": "npx monomind hooks post-edit --file '${tool.params.file_path}' --success true"
      }]
    }]
  }
}
```

## MCP Tool

```javascript
mcp__monomind__hooks_post_edit({
  filePath: "src/utils.ts",
  success: true,
  outcome: "Added error handling",
  metrics: { time: 200, quality: 0.9 },
  timestamp: Date.now()
})
```

## See Also

- `hooks pre-edit` — get context before editing
- `hooks metrics` — view learning metrics
