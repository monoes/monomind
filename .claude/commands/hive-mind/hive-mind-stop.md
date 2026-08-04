---
name: hive-mind:hive-mind-stop
---

# hive-mind shutdown

Gracefully shutdown the hive mind, terminating all agents.

## Usage
```bash
npx monomind hive-mind shutdown [options]
```

## Options

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--force` | `-f` | boolean | `false` | Force immediate shutdown without confirmation |
| `--save-state` | `-s` | boolean | `true` | Save hive state before shutdown (default: on) |

## Examples

```bash
# Graceful shutdown with confirmation prompt
npx monomind hive-mind shutdown

# Force shutdown immediately, no prompt
npx monomind hive-mind shutdown --force

# Shutdown and save state for later recovery
npx monomind hive-mind shutdown --save-state

# Force shutdown without saving state
npx monomind hive-mind shutdown --force --save-state false
```

## Behavior

Without `--force`, the CLI prompts for confirmation before proceeding.

The shutdown report includes:
- Number of agents terminated
- Whether state was saved
- Shutdown timestamp

When `--save-state` is enabled (default), hive state is persisted and can be referenced in future sessions via `monomind session list`.

## MCP Tool

```javascript
mcp__monomind__hive-mind_shutdown({
  force: false,
  saveState: true
})
```
