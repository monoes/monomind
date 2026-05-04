---
name: hooks:setup
---

# Setting Up Monomind Hooks

## Quick Start

### 1. Initialize with Hooks

```bash
npx monomind init --hooks
```

This automatically creates `.claude/settings.json` with hook configurations.

### 2. Test Hook Functionality

```bash
# Test pre-edit hook
npx monomind hooks pre-edit --file src/utils.ts

# Test pre-task hook
npx monomind hooks pre-task -d "Implement user authentication"

# Test route
npx monomind hooks route -t "Fix authentication bug"
```

### 3. Customize Hooks

Edit `.claude/settings.json` to configure which hooks fire on which Claude Code events:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^(Write|Edit|MultiEdit)$",
        "hooks": [{
          "type": "command",
          "command": "npx monomind hooks pre-edit --file '${tool.params.file_path}'"
        }]
      },
      {
        "matcher": "^Bash$",
        "hooks": [{
          "type": "command",
          "command": "npx monomind hooks pre-command --command '${tool.params.command}'"
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "^(Write|Edit|MultiEdit)$",
        "hooks": [{
          "type": "command",
          "command": "npx monomind hooks post-edit --file '${tool.params.file_path}' --success true"
        }]
      },
      {
        "matcher": "^Bash$",
        "hooks": [{
          "type": "command",
          "command": "npx monomind hooks post-command --command '${tool.params.command}' --success true"
        }]
      }
    ]
  }
}
```

## Common Patterns

### Task Tracking (manual)

```bash
# Record task start
npx monomind hooks pre-task -d "Implement auth module"

# After completing work, record result
npx monomind hooks post-task -i task-123 --success true
```

### Route Before Spawning

```bash
# Get agent recommendation for a task
npx monomind hooks route -t "Optimize database queries"

# Understand why an agent was chosen
npx monomind hooks explain -t "Fix authentication bug"
```

### Bootstrap from Repository

```bash
# Pretrain on current repo (medium depth + embeddings)
npx monomind hooks pretrain

# Deep analysis only, no embeddings
npx monomind hooks pretrain --depth deep --no-with-embeddings

# Generate optimized agent configs from pretrain data
npx monomind hooks build-agents
```

### Session Persistence

```bash
# At session end
npx monomind hooks session-end

# At session start (restores latest)
npx monomind hooks session-restore
```

## Debugging

```bash
# Enable debug output
export MONOMIND_LOG_LEVEL=debug

# List all registered hooks
npx monomind hooks list

# View learning metrics
npx monomind hooks metrics

# Check background workers
npx monomind hooks worker list
```
