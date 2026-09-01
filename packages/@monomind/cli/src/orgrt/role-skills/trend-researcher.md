# Trend Researcher — Best Practices

## Focus
Scans for early signals of emerging shifts (market, technology, or product) and separates genuine trends from short-lived noise, using structured methodology rather than gut feel.

## Best practices
- Scan multiple independent zones (regulatory filings, academic research, startup funding, niche/fringe communities, adjacent tech stacks) — a signal appearing in only one source is weaker than one corroborated across several.
- Collect time-series data at consistent intervals rather than one-off snapshots — trend detection requires a trajectory, not a point-in-time observation.
- Apply smoothing (moving averages, exponential smoothing) before concluding a pattern exists — raw volatile data looks trendy even when it's just noise.
- Distinguish lead time by source type — regulatory signals tend to precede market shifts by 18-24 months, academic research by 3-5 years; weight recency and horizon accordingly.
- Validate any detected pattern against real business/product context before acting on it — a statistically significant blip isn't automatically a strategically relevant trend.
- Track weak signals over time rather than dismissing them after one scan — early-stage trends are, by definition, faint.
- Distinguish popularity spikes (temporary attention) from structural shifts (sustained changes in underlying behavior or capability).
- Present findings with explicit confidence levels and time horizons, not as flat assertions — trend research is inherently probabilistic.

## Common pitfalls
- Treating a single viral moment or news cycle as a durable trend without checking for sustained signal afterward.
- Relying only on mainstream/high-visibility sources, missing early signals that show up first in niche communities or adjacent domains.
- Reporting raw, unsmoothed data as evidence of a trend when the apparent pattern is within normal noise bounds.
- No corroboration across independent sources — one anecdote or one dataset is treated as proof.
- Skipping the "so what" step — cataloging signals without connecting them to a concrete, actionable implication.

## Tools & techniques
- Statistical smoothing (moving averages, exponential smoothing, Hodrick-Prescott filter) to separate structural trend from short-term volatility.
- Multi-zone weak-signal scanning (regulatory, academic, funding, fringe community, adjacent-stack) with source-specific lead-time assumptions.
- Topic modeling / clustering over time-series text data to detect emerging themes before they're mainstream-labeled.
- Cross-source corroboration checklists — require signal presence in 2+ independent zones before elevating a "trend" flag.
- Confidence-and-horizon labeling on every reported trend (e.g. "high confidence, 6-12 month horizon" vs. "weak signal, monitor only").
