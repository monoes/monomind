---
name: analysis:token-usage
---

# token-usage

Analyze token consumption and cost across sessions.

## Usage

```bash
npx monomind tokens summary [options]
```

## Subcommands

| Command | Description |
|---------|-------------|
| `tokens summary` | Summary for a period |
| `tokens today` | Quick today + month totals |
| `tokens dashboard` | Interactive live dashboard |

## Options for `tokens summary`

- `--period, -p <range>` - Time period: `today` (default), `week`, `30days`, `month`
- `--json` - Output raw JSON

## Examples

```bash
# Today's usage
npx monomind tokens today

# Full 30-day summary
npx monomind tokens summary --period 30days

# Machine-readable output
npx monomind tokens summary --period week --json

# Live interactive dashboard
npx monomind tokens dashboard
```

## See Also

- `performance metrics` — CPU/memory/latency metrics
- `performance bottleneck` — identify performance hotspots
