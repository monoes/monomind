---
name: hooks:pre-edit
---

# hooks pre-edit

Get context and agent suggestions before editing a file.

## Usage

```bash
npx monomind hooks pre-edit [options]
```

## Options

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--file` | `-f` | string | `unknown` | File path to edit |
| `--operation` | `-o` | string | `update` | Edit operation: `create`, `update`, `delete`, `refactor` |
| `--context` | `-c` | string | — | Additional context about the edit |
| `--format` | — | string | — | Output format: `json` |

## Examples

```bash
# Get context before editing a file
npx monomind hooks pre-edit --file src/auth/login.ts

# With operation type
npx monomind hooks pre-edit -f src/api.ts -o refactor

# With additional context
npx monomind hooks pre-edit -f src/auth.ts -o update -c "Adding JWT refresh logic"

# JSON output for scripting
npx monomind hooks pre-edit -f src/utils.ts --format json
```

## Output

- **File context** — file type, exists/not-exists, operation
- **Suggested agents** — which agent types are best for this file
- **Related files** — files likely affected by the edit
- **Learned patterns** — matching patterns from past edits with confidence scores
- **Potential risks** — warnings about the edit

## Claude Code Integration

Typically fired automatically via `settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "^(Write|Edit|MultiEdit)$",
      "hooks": [{
        "type": "command",
        "command": "npx monomind hooks pre-edit --file '${tool.params.file_path}'"
      }]
    }]
  }
}
```

## MCP Tool

```javascript
mcp__monomind__hooks_pre_edit({
  filePath: "src/auth/login.ts",
  operation: "update",
  context: "Adding JWT refresh logic",
  includePatterns: true,
  includeRisks: true
})
```

## See Also

- `hooks post-edit` — record edit outcome
- `hooks route` — manual agent routing
