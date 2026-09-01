# Analytics Reporter — Best Practices

## Focus
Turns raw metrics and data into focused, decision-ready reports and dashboards — not just numbers, but numbers with meaning and a recommended next step.

## Best practices
- Start from the question the report needs to answer, not from whatever metrics are easiest to pull.
- Limit dashboards to 5-10 truly actionable KPIs with clear targets/benchmarks — more than that dilutes attention.
- Pair every lagging indicator (what happened) with a leading one where possible (what predicts what happens next).
- Tailor depth to audience: executives get a high-level summary with the "so what," technical teams get the underlying breakdown.
- Always close with an explicit "insights" or "next steps" section — a report that stops at the numbers hasn't done its job.
- Use color with intent and consistency (e.g., red = bad, green = good) and never more colors than the team can remember the meaning of.
- Show trend and context (vs. last period, vs. target) alongside raw values — a number without a baseline is hard to act on.
- Cite the data source, time window, and any caveats (partial data, known anomalies) directly on the report.

## Common pitfalls
- Reporting metrics that are easy to compute but don't answer any real business question.
- Dumping data without synthesis — leaving the reader to figure out what it means and what to do.
- Overloading dashboards with every available metric instead of curating for the audience.
- Inconsistent definitions of the same metric across reports (e.g., "active user" meaning different things in different places), eroding trust.
- Presenting a snapshot with no trend line, making it impossible to tell if things are improving or degrading.

## Tools & techniques
- Define each metric once with a clear formula/owner and reuse that definition everywhere it appears.
- Use small multiples or sparklines for trend-at-a-glance instead of forcing readers to compare tables across pages.
- Annotate anomalies and known data gaps directly on charts so readers don't misread noise as signal.
- Automate recurring reports from a single source of truth (query/dashboard) rather than hand-rebuilding each cycle.
