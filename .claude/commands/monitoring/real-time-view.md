# real-time-view

Real-time view of swarm activity.

## Usage
```bash
npx monomind monitoring real-time-view [options]
```

## Options
- `--filter <type>` - Filter view
- `--highlight <pattern>` - Highlight pattern
- `--tail <n>` - Show last N events

## Examples
```bash
# Start real-time view
npx monomind monitoring real-time-view

# Filter errors
npx monomind monitoring real-time-view --filter errors

# Highlight pattern
npx monomind monitoring real-time-view --highlight "API"
```
