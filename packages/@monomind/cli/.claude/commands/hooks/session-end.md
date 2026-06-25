---
name: hooks:session-end
---

# hooks session-end

End the current session and persist state for later restoration.

## Usage

```bash
npx monomind hooks session-end [options]
```

## Options

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--save-state` | `-s` | boolean | `true` | Save session state for restoration |
| `--format` | — | string | — | Output format: `json` |

## Examples

```bash
# End and save session (default)
npx monomind hooks session-end

# End without saving state
npx monomind hooks session-end --save-state false

# JSON output
npx monomind hooks session-end --format json
```

## Output

Session summary including:
- Session ID and duration
- Tasks executed / succeeded / failed
- Commands executed, files modified, agents spawned
- State file path (if saved)

## Restore Later

```bash
# Restore most recent session
npx monomind hooks session-restore

# Restore specific session
npx monomind hooks session-restore -i session-12345
```

## Claude Code Integration

Typically wired to run at conversation end:

```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "npx monomind hooks session-end"
      }]
    }]
  }
}
```

## MCP Tool

```javascript
mcp__monomind__hooks_session_end({
  saveState: true,
  timestamp: Date.now()
})
```

## See Also

- `hooks session-restore` — restore a previous session
- `hooks pre-task` / `hooks post-task` — task tracking within a session
