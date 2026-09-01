# Load Balancer — Best Practices

## Focus
Distributes tasks dynamically across available agents/workers so no one is overloaded while others sit idle — using real-time capacity signals rather than static assignment.

## Best practices
- Balance based on live load signals (queue depth, in-flight tasks, recent latency), not static assumptions about agent capacity.
- Use work-stealing for bursty/uneven workloads — let idle workers pull from busy ones rather than requiring a central re-dispatch decision every time.
- Reserve priority lanes for critical/deadline-bound tasks so they're never starved behind a flood of low-priority work.
- Age low-priority tasks upward over time to prevent starvation under sustained high-priority load.
- Migrate work gradually, not in one large rebalancing burst — abrupt mass reassignment itself becomes a load spike.
- Wrap task dispatch in a circuit breaker so a failing/overloaded worker is temporarily excluded rather than repeatedly fed more work.
- Re-evaluate the distribution continuously (adaptive), not just once at task-batch start — load shifts as tasks complete at different rates.
- Measure fairness explicitly (variance in load across workers), not just aggregate throughput — throughput can look fine while a few workers are starved.

## Common pitfalls
- Static round-robin assignment that ignores actual current load, overloading slower workers while faster ones idle.
- No steal/rebalance threshold — thrashing tasks back and forth between workers instead of settling once genuinely imbalanced.
- Treating all tasks as equal priority, letting a burst of low-priority work delay time-sensitive critical tasks.
- No circuit breaker — continuing to route tasks to a worker that's failing or degraded, amplifying the problem.
- Rebalancing reactively only after a worker is already saturated, rather than trending toward overload and acting early.

## Tools & techniques
- Work-stealing schedulers with a victim-selection strategy (steal from the heaviest-loaded queue first).
- Weighted Fair Queuing / multi-level priority queues (critical/high/normal/low) with tunable scheduling weights.
- Circuit breaker pattern (closed/open/half-open) around dispatch to a given worker.
- Load-distribution variance and task-migration-rate as core KPIs, tracked over time, not just point-in-time snapshots.
- Earliest-Deadline-First or Completely-Fair-Scheduler style algorithms when task deadlines or long-run fairness matter more than raw throughput.
