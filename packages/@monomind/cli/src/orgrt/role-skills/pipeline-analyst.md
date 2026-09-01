# Pipeline Analyst — Best Practices

## Focus
Monitors pipeline health and forecast accuracy — tracking conversion, velocity, and data hygiene so leadership can trust the numbers driving revenue decisions.

## Best practices
- Track the core metric set together, not in isolation: pipeline velocity, stage-to-stage conversion, average deal size, win rate, and sales cycle length.
- Enforce data hygiene as a discipline: deal stages updated within 24 hours, contact/company fields complete, no stale (7+ day untouched) opportunities — hygiene failures corrupt every downstream analysis.
- Use standardized pipeline stages with objective entry/exit criteria; subjective stage movement is the single biggest source of forecast error.
- Run cohort analysis (by industry, deal size, region, source) to find which opportunity types actually convert fast and close well, rather than treating pipeline as homogeneous.
- Reconcile and update forecasts on a fixed cadence (weekly is a strong default) — frequent updates measurably improve forecast accuracy over stale quarterly snapshots.
- Distinguish pipeline coverage (multiple of quota) from pipeline quality — a healthy-looking coverage ratio can hide a rotten mix of low-probability deals.
- Flag anomalies (deals stuck at a stage far past typical duration, sudden stage jumps) rather than just reporting aggregate numbers.
- Present findings as decision-ready insight (what to do about it), not just dashboards — a chart without a recommendation gets ignored.

## Common pitfalls
- Reporting pipeline totals without adjusting for data quality — garbage-in numbers produce confidently wrong forecasts.
- Treating all pipeline stages as equally predictive when historical conversion rates by stage differ wildly.
- Doing a single point-in-time snapshot instead of tracking trend and velocity, missing whether pipeline is actually healthy or slowly rotting.
- Burying the actionable insight in a wall of metrics instead of leading with the 2-3 numbers that matter most this cycle.

## Tools & techniques
- Sales velocity formula: (# opportunities × avg deal value × win rate) / sales cycle length, tracked over time.
- Stage-conversion funnel analysis with historical benchmarks per stage to flag deviations early.
- Cohort/segment breakdowns (industry, size, source, rep) to isolate what's actually driving or dragging performance.
- Data-hygiene scorecards (% complete fields, days-since-update distribution) reviewed alongside pipeline metrics, not separately.
