---
name: stop
description: Stop a running agent
aliases: [kill]
type: command
---

# Agent Stop Command

Stop a running agent with graceful or forced shutdown options.

## Usage

```bash
npx monobrain agent stop <agent-id> [options]
npx monobrain agent kill <agent-id> [options]  # Alias
```

## Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--force` | `-f` | Force stop without graceful shutdown | false |
| `--timeout` | | Graceful shutdown timeout in seconds | 30 |

## Examples

```bash
# Graceful stop (completes current task)
npx monobrain agent stop coder-lx7m9k2

# Force stop (immediate termination)
npx monobrain agent stop coder-lx7m9k2 --force

# Custom shutdown timeout
npx monobrain agent stop coder-lx7m9k2 --timeout 60

# Using kill alias
npx monobrain agent kill researcher-abc123 -f
```

## Graceful vs Force Stop

### Graceful Shutdown (Default)
1. Completes current task
2. Saves agent state to memory
3. Releases resources cleanly
4. Notifies swarm coordinator

```bash
npx monobrain agent stop coder-lx7m9k2

# Output:
# Stopping agent coder-lx7m9k2...
#   Completing current task...
#   Saving state...
#   Releasing resources...
# Agent coder-lx7m9k2 stopped successfully
```

### Force Stop
1. Immediate termination
2. No state preservation
3. May leave tasks incomplete

```bash
npx monobrain agent stop coder-lx7m9k2 --force

# Output:
# Stopping agent coder-lx7m9k2...
# Agent coder-lx7m9k2 stopped successfully
```

## Interactive Confirmation

Without `--force`, you'll be prompted to confirm:

```
? Are you sure you want to stop agent coder-lx7m9k2? (y/N)
```

## Batch Operations

To stop multiple agents:

```bash
# Stop all agents of a type
npx monobrain agent list -t coder --format json | \
  jq -r '.agents[].id' | \
  xargs -I {} npx monobrain agent stop {} -f

# Stop all idle agents
npx monobrain agent list -s idle --format json | \
  jq -r '.agents[].id' | \
  xargs -I {} npx monobrain agent stop {}
```

## Related Commands

- `npx monobrain agent list` - Find agent IDs
- `npx monobrain agent status` - Check status before stopping
- `npx monobrain swarm destroy` - Stop all agents in swarm
