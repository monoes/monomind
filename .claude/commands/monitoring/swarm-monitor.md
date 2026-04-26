# swarm-monitor

Real-time swarm monitoring.

## Usage
```bash
npx monomind swarm monitor [options]
```

## Options
- `--interval <ms>` - Update interval
- `--metrics` - Show detailed metrics
- `--export` - Export monitoring data

## Examples
```bash
# Start monitoring
npx monomind swarm monitor

# Custom interval
npx monomind swarm monitor --interval 5000

# With metrics
npx monomind swarm monitor --metrics
```
