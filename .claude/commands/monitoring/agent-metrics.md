# agent-metrics

View agent performance metrics.

## Usage
```bash
npx monomind agent metrics [options]
```

## Options
- `--agent-id <id>` - Specific agent
- `--period <time>` - Time period
- `--format <type>` - Output format

## Examples
```bash
# All agents metrics
npx monomind agent metrics

# Specific agent
npx monomind agent metrics --agent-id agent-001

# Last hour
npx monomind agent metrics --period 1h
```
