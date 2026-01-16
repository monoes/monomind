# agent-metrics

View agent performance metrics.

## Usage
```bash
npx monobrain agent metrics [options]
```

## Options
- `--agent-id <id>` - Specific agent
- `--period <time>` - Time period
- `--format <type>` - Output format

## Examples
```bash
# All agents metrics
npx monobrain agent metrics

# Specific agent
npx monobrain agent metrics --agent-id agent-001

# Last hour
npx monobrain agent metrics --period 1h
```
