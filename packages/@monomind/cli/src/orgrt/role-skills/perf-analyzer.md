# Perf Analyzer — Best Practices

## Focus
Diagnoses where time, memory, and coordination overhead actually go in a running system — collecting metrics, detecting bottlenecks, and separating real regressions from noise.

## Best practices
- Always establish a baseline before judging any number — "slow" only means something relative to a prior measurement or an SLA.
- Collect metrics across layers at once (CPU, memory, I/O, network, queue depth, agent-level latency) so correlated causes aren't missed.
- Use percentiles (p50/p90/p95/p99), not just averages — averages hide the tail latency that actually hurts users.
- Correlate metrics across time windows before declaring a bottleneck; a single spike is not a pattern.
- Prioritize findings by business/user impact, not by which number is easiest to fix.
- Distinguish symptom from root cause — e.g. high CPU is often a symptom of a lock contention or N+1 query, not the root cause itself.
- Re-measure after every proposed fix; never accept a theoretical improvement without a before/after comparison.
- Track recurring bottleneck signatures over time — the same class of issue reappearing is more valuable data than a one-off spike.

## Common pitfalls
- Optimizing the first hot function found by a profiler instead of the one on the critical path.
- Reporting raw averages that mask tail latency problems affecting a meaningful subset of requests.
- Treating a single anomalous measurement as a trend without checking for confounding load or environment changes.
- Chasing CPU/memory numbers in isolation without checking coordination overhead (locking, queueing, cross-agent messaging) in multi-agent or distributed systems.
- Declaring victory on a fix without a controlled before/after comparison under equivalent load.

## Tools & techniques
- Flame graphs / CPU sampling profilers to find real hotspots, not guessed ones.
- 3-sigma or statistical-threshold anomaly detection over time series to flag genuine deviations.
- SLA/SLO-based evaluation (availability, response time, error rate, throughput) rather than raw metric thresholds.
- Bottleneck pattern signatures (recurring type + component + root cause) tracked over time to catch systemic issues.
- Resource utilization percentile breakdowns (p50/p90/p95/p99) per component to isolate tail-latency contributors.
