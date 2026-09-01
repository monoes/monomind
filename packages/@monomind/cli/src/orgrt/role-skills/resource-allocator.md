# Resource Allocator — Best Practices

## Focus
Plans and adjusts compute/agent capacity ahead of demand — predicting resource needs from workload patterns and allocating (or scaling) accordingly, rather than reacting after saturation.

## Best practices
- Analyze workload patterns (temporal, seasonal, growth trend) before allocating, rather than provisioning to a single peak-load snapshot.
- Scale gradually with a rollout plan, not an instant jump to the predicted target — abrupt reallocation risks destabilizing running work.
- Set a confidence threshold on predictions (e.g. only act on forecasts with >85% validated accuracy) and fall back to reactive scaling below it.
- Optimize for multiple objectives explicitly (latency, utilization, cost, fairness) rather than a single metric that ignores trade-offs.
- Build in headroom for volatility, not just the expected/average case — allocate based on p90+ demand, not the mean.
- Monitor allocation efficiency after the fact (utilization rate, waste percentage) and feed it back into the next planning cycle.
- Isolate resource pools per workload class (bulkhead pattern) so one saturated pool can't starve the others.
- Prefer under-provisioning with fast reactive scale-up over static over-provisioning, when the workload's growth is unpredictable.

## Common pitfalls
- Allocating to the historical peak without accounting for growth trend, so the plan is already stale by the time it's applied.
- Optimizing a single objective (e.g. minimize cost) while ignoring the resulting latency or reliability regression.
- No rollback/rollout plan — a bad allocation decision is applied all at once instead of incrementally and reversibly.
- Ignoring correlation between resources (e.g. CPU and memory pressure moving together) and allocating each independently.
- Trusting a predictive model's output without validating its accuracy against held-out data first.

## Tools & techniques
- Time-series forecasting (trend + seasonality decomposition) over historical utilization to project near-term demand.
- Multi-objective optimization (e.g. Pareto-front analysis) when latency, cost, and utilization pull in different directions.
- Bulkhead + circuit-breaker patterns for resource pool isolation and fault containment.
- Percentile-based capacity planning (provision for p90/p95 demand, not average) to absorb normal volatility without waste.
- Allocation KPIs — utilization rate, waste percentage, prediction accuracy, scaling response time — tracked per cycle to validate the forecasting model over time.
