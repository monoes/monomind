---
name: hive-mind:hive-mind-memory
---

# hive-mind memory

Access and manage hive shared memory — key-value store accessible to all agents in the hive.

## Usage
```bash
npx monomind hive-mind memory [options]
```

## Options

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--action` | `-a` | string | `list` | Action: `get`, `set`, `delete`, `list` |
| `--key` | `-k` | string | — | Memory key (required for `get`, `set`, `delete`) |
| `--value` | `-v` | string | — | Value to store (required for `set`) |
| `--format` | — | string | — | Output format: `json` |

## Examples

```bash
# List all keys in shared memory
npx monomind hive-mind memory

# Store a value
npx monomind hive-mind memory -a set -k "project-goal" -v "Build auth module"

# Retrieve a value
npx monomind hive-mind memory -a get -k "project-goal"

# Delete a key
npx monomind hive-mind memory -a delete -k "project-goal"

# List all keys as JSON
npx monomind hive-mind memory -a list --format json
```

## Actions

- **`list`** — Show all keys currently in shared memory with count (default)
- **`get`** — Retrieve the value at a key (requires `--key`)
- **`set`** — Store a value at a key (requires `--key` and `--value`)
- **`delete`** — Remove a key from shared memory (requires `--key`)

## Relationship to `monomind memory`

`hive-mind memory` operates on the **hive's shared memory namespace** — values here are visible to all agents coordinating in the current hive. This is distinct from `npx monomind memory` which operates on the global AgentDB.

Use hive memory for transient inter-agent coordination data (task results, intermediate state). Use global memory for patterns and knowledge that should persist across sessions.

## MCP Tool

```javascript
// List keys
mcp__monomind__hive-mind_memory({ action: "list" })

// Set a value
mcp__monomind__hive-mind_memory({
  action: "set",
  key: "project-goal",
  value: "Build auth module"
})

// Get a value
mcp__monomind__hive-mind_memory({ action: "get", key: "project-goal" })

// Delete a key
mcp__monomind__hive-mind_memory({ action: "delete", key: "project-goal" })
```
