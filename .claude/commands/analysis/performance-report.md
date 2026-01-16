# performance-report

Generate comprehensive performance reports for swarm operations.

## Usage
```bash
npx monobrain analysis performance-report [options]
```

## Options
- `--format <type>` - Report format (json, html, markdown)
- `--include-metrics` - Include detailed metrics
- `--compare <id>` - Compare with previous swarm

## Examples
```bash
# Generate HTML report
npx monobrain analysis performance-report --format html

# Compare swarms
npx monobrain analysis performance-report --compare swarm-123

# Full metrics report
npx monobrain analysis performance-report --include-metrics --format markdown
```
